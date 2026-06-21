--[[ ===========================================================================
  G1RExport — schlanker UE4SS-Lua-Mod für Gothic 1 Remake
  ---------------------------------------------------------------------------
  Liest periodisch Spieler-Position + Inventar aus dem laufenden Spiel und
  schreibt sie als JSON-Datei. Ein lokaler Mini-Server (server.py) liest die
  Datei und serviert sie an das OBS-Overlay.

  PROTOTYP — Position + Items. Keine Karte (kommt später).

  Installation:
    Diesen Ordner (G1RExport) nach
      <Gothic1Remake>/...Binaries/Win64/ue4ss/Mods/
    kopieren und in Mods/mods.txt eintragen:  G1RExport : 1
    (Pfad je nach UE4SS-Version; siehe README.md.)

  Belegte Patterns aus github.com/AndreyDudak/mods-g1r (StatEditorMod).
  Position via K2_GetActorLocation = UE5-Standard (am echten Build verifizieren).
=========================================================================== ]]

-- ── Konfiguration ─────────────────────────────────────────────────────────
-- Wohin die JSON geschrieben wird. MUSS mit server.py (STATE_FILE) übereinstimmen.
-- Doppelte Backslashes unter Windows. Beispiel:
local OUTPUT_PATH = [[C:\obs-g1r\g1r-state.json]]
local POLL_INTERVAL_MS = 250   -- ~4×/s; für flüssigere Position runter (z.B. 100)

-- ── State ──────────────────────────────────────────────────────────────────
local CachedPlayer = nil
local totalDistCm  = 0      -- aufsummierte horizontale Laufstrecke (cm), ab Mod-Start
local lastPos      = nil    -- letzte Position für die Delta-Berechnung
local MAX_STEP_CM  = 1000   -- Delta/Tick > 10 m → Teleport/Ladezone → ignorieren
local STEP_LEN_M   = 0.75   -- grobe Schrittlänge für die Schritt-Schätzung

-- Session-Zähler: aus HP/Mana/XP-Deltas aufsummiert (analog Strecke), ab Mod-Start.
-- Eigene Session-Rekorde (rec*) damit die Career-Card pro Scope sauber bleibt
-- (session ODER all — nicht mischen): scope=session zeigt diese, scope=all die totals.
local sess = { damageTaken = 0, healthRegen = 0, manaSpent = 0, manaRegen = 0, xpGained = 0,
               recHardestTaken = 0, recManaTick = 0, recRunM = 0, recHardestDealt = 0 }
local lastHp, lastMana, lastXp = nil, nil, nil
-- Sprünge größer als das = Laden/Level-up/Respawn, nicht als Schaden/Regen zählen.
local MAX_STAT_JUMP = 500
-- Nach (Wieder-)Eintritt in eine gültige Welt füllt das Spiel HP/Mana über mehrere
-- Ticks auf (und beim Schließen fällt es ab). Diese künstlichen Deltas NICHT als
-- Regen/Schaden zählen: so viele Ticks Warmup überspringen (tick ~250ms → ~3s).
local WARMUP_TICKS = 12
local warmup = WARMUP_TICKS

-- ── Persistente Gesamt-Werte (über ALLE Sessions) + Rekorde ─────────────────
-- Beim Mod-Start aus g1r-totals.json laden, Session-Deltas drauf addieren,
-- periodisch zurückschreiben. recHardestDealt/damageDealt werden nur gefüllt,
-- wenn der Damage-Hook (READ_DMG_OUT) aktiv ist.
local TOTALS_PATH = [[C:\obs-g1r\g1r-totals.json]]
local totals = { damageTaken=0, healthRegen=0, manaSpent=0, manaRegen=0, xpGained=0,
                 distanceM=0, steps=0, damageDealt=0, kills=0,
                 recHardestTaken=0, recManaTick=0, recRunM=0, recHardestDealt=0 }
local sessDamageDealt = 0   -- ausgeteilter Schaden DIESER Session (Damage-Hook)
-- Hook-basierte Kills (READ_KILLS_HOOK): {creatureType=count} dieser Session + Gesamt-Session-Zahl.
-- Ersetzt die tote PuzzlesSubsystem-Map; gleiches Map-Format → Widget/News bleiben unverändert.
local hookKills = {}
local sessKills = 0
local killHookDiag = false   -- erster Kill loggt #args + Causer (Spieler-Filter belegen)
local dmgOutDiag = false      -- erster Treffer loggt self-Kette (Spieler-Filter belegen)
local combo = nil            -- laufender Combo-/Schlagzähler (READ_COMBO), Int oder nil
pcall(function()
    local f = io.open(TOTALS_PATH, "r"); if not f then return end
    local s = f:read("*a"); f:close()
    for k in pairs(totals) do
        local n = s:match('"' .. k .. '"%s*:%s*(-?%d+%.?%d*)')
        if n then totals[k] = tonumber(n) end
    end
end)
local lastTotalsWrite = 0

-- Optionale Reader (Stand 2026-06-17, in-game verifiziert).
-- An: Schlag (Schlagrichtung) + Uhr laufen stabil.
-- Aus: SPELL + WEAPONS crashen HART am G1R-Build (GetSpellConfigGivenACharacter /
--   GetEquipedWeaponDefinition = C++-AccessViolation, auch auf dem Game-Thread, nicht
--   per pcall fangbar). KILLS läuft zwar, aber die Map (PuzzlesSubsystem) liefert keine
--   Daten → aus. Waffen/Zauber zeigt das Widget stattdessen crashfrei aus dem Inventar.
local READ_SPELL   = false  -- CRASHT — MagicScriptLibrary:GetSpellConfigGivenACharacter
local READ_WEAPONS = false  -- CRASHT — DataModule_Combat:GetEquipedWeaponDefinition
local READ_ATTACK  = true   -- läuft — DataModule_Combat:GetCurrentAttackDirection
local READ_CLOCK   = true   -- läuft — GameTimeSubsystem:GetCurrentClockTime
local READ_KILLS   = false  -- Map liefert keine Daten (PuzzlesSubsystem) → aus
local READ_DMG_OUT = false  -- ausgeteilter Schaden via Damage-Hook (Engine-Eingriff) → erst in-game testen
-- ── Neue Reader/Hooks aus dem Object-Dump (alle erst in-game zu verifizieren) ──
-- Reihenfolge zum Freischalten (eins nach dem anderen, UE4SS.log beobachten):
--   1) READ_KILLS_HOOK  — AIAgentCharacter:HandleDefeated(DefeatingCharacterActor); Causer==Spieler → Kill.
--                         Ersatz für die tote PuzzlesSubsystem-Map. Erster Kill loggt #args + Causer-Name.
--   2) READ_CARRY       — CarryComponent:GetEquippedItemDefinition → geführte Waffe (crashfrei, statt DataModule).
--                         Erster Read loggt, über welchen Pfad die Component gefunden wurde.
--   3) READ_COMBO       — DataModule_Combat:GetAttackCount → laufender Combo-/Schlagzähler (Int).
--   4) READ_DMG_OUT     — MeleeWeaponVisual:OnDamageDealt(Target, relativeDamage:float). MELEE-only.
--                         Erster Treffer loggt self-Kette, damit der Spieler-Filter belegbar wird.
local READ_KILLS_HOOK = false  -- ungetestet (Hook bei Kill) → einzeln via g1r-flags.txt testen
local READ_CARRY      = true   -- läuft: geführte Waffe + "in hand" (CarryComponent)
local READ_COMBO      = true   -- läuft: GetAttackCount (gleiches Modul wie attack)
local READ_STATE      = false  -- CRASHT beim Reiten/Verwandeln (Pawn-Wechsel → Mount/AnimInstance-Zugriff) → AUS lassen

-- ── Lokale Flag-Overrides (überleben Pull/Kopieren) ─────────────────────────
-- Problem: beim Aktualisieren der main.lua stehen die Flags wieder auf Default false →
-- in-game freigeschaltete Reader gehen verloren. Lösung: optionale Datei
--   C:\obs-g1r\g1r-flags.txt   mit Zeilen wie  READ_CARRY=true  (# = Kommentar).
-- Die Datei wird NICHT von Git/Kopieren angefasst → deine Einstellungen bleiben.
-- Nur dort gesetzte Flags überschreiben den Default; alles andere bleibt wie oben.
do
    local f = io.open([[C:\obs-g1r\g1r-flags.txt]], "r")
    if f then
        local s = f:read("*a"); f:close()
        local function ov(cur, name)
            -- Zeilenanfang verankern, damit READ_KILLS nicht in READ_KILLS_HOOK matcht.
            local v = s:match("\n%s*" .. name .. "%s*=%s*(%a+)")
                   or s:match("^%s*" .. name .. "%s*=%s*(%a+)")
            if v then return v:lower() == "true" end
            return cur
        end
        READ_SPELL      = ov(READ_SPELL,      "READ_SPELL")
        READ_WEAPONS    = ov(READ_WEAPONS,    "READ_WEAPONS")
        READ_ATTACK     = ov(READ_ATTACK,     "READ_ATTACK")
        READ_CLOCK      = ov(READ_CLOCK,      "READ_CLOCK")
        READ_KILLS      = ov(READ_KILLS,      "READ_KILLS")
        READ_DMG_OUT    = ov(READ_DMG_OUT,    "READ_DMG_OUT")
        READ_KILLS_HOOK = ov(READ_KILLS_HOOK, "READ_KILLS_HOOK")
        READ_CARRY      = ov(READ_CARRY,      "READ_CARRY")
        READ_COMBO      = ov(READ_COMBO,      "READ_COMBO")
        READ_STATE      = ov(READ_STATE,      "READ_STATE")
        print(string.format(
            "[G1RExport] Flag-Overrides aus g1r-flags.txt: CARRY=%s COMBO=%s KILLS_HOOK=%s DMG_OUT=%s\n",
            tostring(READ_CARRY), tostring(READ_COMBO), tostring(READ_KILLS_HOOK), tostring(READ_DMG_OUT)))
    end
end

local killBase    = nil   -- Map-Snapshot beim ersten Read (für Session-Summe)
local lastKillMap = nil   -- letzte Map (für News-Delta)
local killNews    = {}    -- jüngste Events {type=, n=}, max MAX_NEWS
local MAX_NEWS    = 12
local pendingEvents = {}    -- rohe Event-Liste seit dem letzten Schreiben (hit_dealt/hit_taken/kill)
local diagDone    = false  -- einmaliges Diagnose-Log
local guildDiagDone = false -- einmalige Gilden-Diagnose (Root-Cause "keine Gilde")
local guildDiagTicks = 0    -- zählt Ticks bis State gültig (Timing vs. echter Fehler)
local saveDiagDone = false  -- einmalige Save-Kennungs-Diagnose (GameInstance/SaveSystem)

local function isValid(o)
    return o and pcall(function() return o:IsValid() end) and o:IsValid()
end

-- ── Player-Pawn cachen (Pattern aus mods-g1r main.lua + stats.lua) ──────────
RegisterHook("/Script/Engine.PlayerController:ClientRestart", function(self, NewPawn)
    local ok, pawn = pcall(function() return NewPawn:get() end)
    if ok and isValid(pawn) then CachedPlayer = pawn end
end)

-- Hinweis: Die Engine-Hooks (Damage-Out via MeleeWeaponVisual:OnDamageDealt und
-- Kills via AIAgentCharacter:HandleDefeated) brauchen shortName + Player-Vergleich
-- und werden darum weiter unten registriert (Abschnitt "Engine-Hooks"), wo alle
-- Helfer definiert sind. Der alte ApplyDamageTo-Hook ist raus: HitData trägt laut
-- Object-Dump KEINEN Schadenswert (nur WeaponUsed/Impact/Deflect/Parry).

local function getPlayer()
    if isValid(CachedPlayer) then return CachedPlayer end
    -- Fallback 1: PlayerController.Pawn
    local ok, pc = pcall(function() return FindFirstOf("PlayerController") end)
    if ok and isValid(pc) then
        local ok2, pawn = pcall(function() return pc.Pawn end)
        if ok2 and isValid(pawn) then CachedPlayer = pawn; return pawn end
    end
    -- Fallback 2: GothicPlayerCharacter direkt (belegt aus mods-g1r)
    local ok3, p = pcall(function() return FindFirstOf("GothicPlayerCharacter") end)
    if ok3 and isValid(p) then CachedPlayer = p; return p end
    return nil
end

-- ── Position lesen ──────────────────────────────────────────────────────────
-- K2_GetActorLocation (BlueprintCallable) ist der robusteste Reflection-Weg.
-- Fallbacks falls am G1R-Build anders reflektiert. Werte in cm (UE5).
local function readPosition(char)
    local function tryLoc(fn)
        local ok, loc = pcall(fn)
        if ok and loc and loc.X ~= nil then
            return { x = loc.X, y = loc.Y, z = loc.Z }
        end
        return nil
    end
    return tryLoc(function() return char:K2_GetActorLocation() end)
        or tryLoc(function() return char:GetActorLocation() end)
        or tryLoc(function() return char.RootComponent.RelativeLocation end)
end

-- ── Inventar lesen (Pattern aus mods-g1r inventory.lua) ─────────────────────
-- Defensiv: wenn ein Pfad am Build nicht greift, kommt halt eine leere Liste —
-- die Position funktioniert davon unabhängig.
local INVENTORY_MAIN = 1
local DataModuleLibrary = nil
local function getLib()
    if not DataModuleLibrary then
        local ok, lib = pcall(function()
            return StaticFindObject("/Script/G1R.Default__DataModuleLibrary")
        end)
        if ok then DataModuleLibrary = lib end
    end
    return DataModuleLibrary
end

local function shortName(fullName)
    if not fullName then return "Item" end
    local s = string.match(fullName, "%.([^%.]+)$") or fullName
    -- Klassen-/Default-Objekte: 'Default__ItMw_1H_Sword_01_C' -> 'ItMw_1H_Sword_01'
    s = s:gsub("^Default__", ""):gsub("_C$", "")
    return s
end

-- ── Inventar-Lesen: vollständiger mods-g1r-Helper-Stack (1:1 adaptiert) ──────
-- Kern: m_Slots IST direkt lesbar — aber Array-Elemente kommen als
-- RemoteUnrealParam/LocalUnrealParam-Wrapper, die VOR dem Member-Zugriff mit
-- UnwrapValue (:get() rekursiv) entpackt werden müssen. Sonst ScriptStruct-Fehler.

local function isParamWrapper(v)
    if type(v) ~= "userdata" or not v.type then return false end
    local ok, t = pcall(function() return v:type() end)
    return ok and (t == "RemoteUnrealParam" or t == "LocalUnrealParam")
end

local function unwrap(v)
    if v == nil then return nil end
    if isParamWrapper(v) then
        local ok, u = pcall(function() return v:get() end)
        if ok and u ~= nil then return unwrap(u) end
    end
    return v
end

local function arrLen(arr)
    if arr == nil then return 0 end
    local ok, n = pcall(function() return arr:GetArrayNum() end)
    if ok and type(n) == "number" then return n end
    if type(arr) == "table" then return #arr end
    return 0
end

local function arrGet(arr, idx)
    local ok, el = pcall(function() return arr[idx] end)
    if ok then return unwrap(el) end
    if type(arr) == "table" then return unwrap(arr[idx + 1]) end
    return nil
end

local function iterItems(items, visitor)
    if items == nil then return end
    local n = arrLen(items)
    for i = 0, n - 1 do
        local ok, raw = pcall(function() return items[i] end)
        if ok then
            local it = unwrap(raw)
            if it and visitor(i, it) then return end
        end
    end
end

local function invTypeEquals(a, b)
    if a == nil or b == nil then return false end
    if a == b then return true end
    local an, bn = tonumber(tostring(a)), tonumber(tostring(b))
    return an ~= nil and bn ~= nil and an == bn
end

local function readInvType(vd)
    if not vd then return nil end
    local ok, t = pcall(function() return vd.m_InventoryType end)
    if ok then return t end
    return nil
end

-- Findet das VirtualData-Objekt (mit m_Slots) im ContainerVirtualDataArray.
-- 4 Fallback-Pfade wie mods-g1r GetMainContainerVirtualData.
local function getMainVirtualData(container)
    if not container then return nil end
    local ok, invMap = pcall(function() return container.m_Inventory end)
    if not ok or invMap == nil then return nil end
    local vok, values = pcall(function() return invMap.m_Values end)
    if vok and values then
        -- 1: m_Values trägt m_Slots direkt
        local dok, ds = pcall(function() return values.m_Slots end)
        if dok and ds then return values end
        -- 2: m_Values.Items → InventoryType==MAIN, sonst erstes mit Slots
        local iok, items = pcall(function() return values.Items end)
        if iok and items then
            local found = nil
            iterItems(items, function(_, data)
                if found then return true end
                if invTypeEquals(readInvType(data), INVENTORY_MAIN) then
                    found = unwrap(data); return true
                end
                return false
            end)
            if found then return found end
            local n = arrLen(items)
            for i = 0, n - 1 do
                local data = unwrap(arrGet(items, i))
                if data then
                    local sok, s = pcall(function() return data.m_Slots end)
                    if sok and s and arrLen(s) > 0 then return data end
                end
            end
        end
        -- 3: m_Values direkt iterieren
        if values.GetArrayNum then
            local n = values:GetArrayNum()
            for i = 0, n - 1 do
                local data = unwrap(arrGet(values, i))
                if data then
                    local sok, s = pcall(function() return data.m_Slots end)
                    if sok and s and arrLen(s) > 0 then return data end
                end
            end
        end
    end
    -- 4: Keys/Values-Map
    local kok, keys = pcall(function() return invMap.m_Keys end)
    if kok and keys and vok and values then
        local kn = arrLen(keys)
        for i = 0, kn - 1 do
            if invTypeEquals(arrGet(keys, i), INVENTORY_MAIN) then
                local data = arrGet(values, i)
                if data then return unwrap(data) end
            end
        end
    end
    return nil
end

-- ── Inventar (UI-Weg, lokalisierte Namen) ──────────────────────────────────
-- GothicCharacter:GetInventory() -> InventoryBase (bzw. InventoryMain mit
-- GetInventoryBase()). InventoryBase hat eine By-Pos-API mit dem LOKALISIERTEN
-- Namen direkt aus dem Spiel (GetItemNameByPos -> FText -> :ToString()), d.h.
-- automatisch in Spielsprache (Deutsch) — KEIN Mapping nötig. Belegt im
-- Object-Dump: ItemsNum, GetItemNameByPos(int), GetItemAmountByPos(int),
-- IsItemValidByPos(int). Liefert {display=<DE-Name>, count}.
local function readInventoryUI(char)
    if not isValid(char) then return nil end
    local ok, inv = pcall(function() return char:GetInventory() end)
    if not (ok and isValid(inv)) then return nil end

    -- GetInventory kann ein InventoryMain (UI-Wrapper) ODER direkt ein
    -- InventoryBase sein. InventoryMain hat GetInventoryBase() -> Daten-Schicht.
    local base = inv
    pcall(function()
        local b = inv:GetInventoryBase()
        if isValid(b) then base = b end
    end)

    local n = nil
    pcall(function() n = base:ItemsNum() end)
    if not n or n <= 0 then return nil end   -- nil -> tick fällt auf Container-Weg zurück

    local items = {}
    for i = 0, n - 1 do
        pcall(function()
            local valid = true
            pcall(function() valid = base:IsItemValidByPos(i) end)
            if valid == false then return end
            local nameTxt; pcall(function() nameTxt = base:GetItemNameByPos(i) end)
            local name
            if nameTxt then pcall(function() name = nameTxt:ToString() end) end
            if not name or name == "" then return end
            local cnt = 1
            pcall(function() cnt = base:GetItemAmountByPos(i) or 1 end)
            items[#items + 1] = { display = name, count = cnt }
        end)
    end
    return items
end

-- ── Inventar (Fallback: Container-Daten, technische Klassennamen) ───────────
-- Greift, falls der UI-Weg am Build nichts liefert. Namen sind Klassennamen
-- (z.B. ItemGold) -> server.py übersetzt sie via item_names.json.
local function readInventoryContainer(char)
    local items = {}
    local lib = getLib()
    if not (lib and isValid(lib)) then return items end
    local ok, container = pcall(function() return lib:GetContainerDataModule(char) end)
    if not (ok and isValid(container)) then return items end

    local vd = getMainVirtualData(container)
    if not vd then return items end

    local sok, slots = pcall(function() return vd.m_Slots end)
    if not sok or slots == nil then return items end

    local n = arrLen(slots)
    for i = 0, n - 1 do
        local item = arrGet(slots, i)   -- WICHTIG: arrGet entpackt den Wrapper
        if item then
            pcall(function()
                local sd = item.m_SlotData
                local cnt = 0
                pcall(function() cnt = sd.m_ItemCount or 0 end)
                if cnt and cnt > 0 then
                    local cls; pcall(function() cls = sd.m_ItemDefinition end)
                    local full = cls and select(2, pcall(function() return cls:GetFullName() end))
                    items[#items + 1] = { name = shortName(full), count = cnt }
                end
            end)
        end
    end
    return items
end

-- UI-Weg bevorzugt (lokalisierte Namen), sonst Container-Fallback.
local function readInventory(char)
    local ui = readInventoryUI(char)
    if ui ~= nil then return ui end
    return readInventoryContainer(char)
end

-- ── Stats lesen (GAS, Pattern aus mods-g1r stats.lua) ──────────────────────
-- AIGASLibrary:GetAttributeValue(Character, SetClass, FName). SetClass via
-- StaticFindObject(SetPath), Attr-Name als FName. Klasse/Fraktion/Lager ist in
-- G1R NICHT auslesbar (kein Weg im Repo) — daher nicht dabei.
local AIGAS = nil
local function getGas()
    if not AIGAS then pcall(function() AIGAS = StaticFindObject("/Script/G1R.Default__AIGASLibrary") end) end
    return AIGAS
end

local classCache = {}
local function findClass(path)
    if classCache[path] == nil then
        local ok, c = pcall(function() return StaticFindObject(path) end)
        classCache[path] = (ok and c) or false
    end
    return classCache[path] or nil
end

-- FName-Helper: UEHelpers bevorzugt, sonst globaler FName-Konstruktor, sonst String.
local UEHelpers = nil
pcall(function() UEHelpers = require("UEHelpers") end)
local function fname(name)
    if UEHelpers and UEHelpers.FindFName then
        local ok, fn = pcall(function() return UEHelpers.FindFName(name) end)
        if ok and fn then return fn end
    end
    local ok, fn = pcall(function() return FName(name) end)
    if ok and fn then return fn end
    return name
end

-- Auswahl der wichtigsten Stats fürs Overlay (label, AttributeSet-Pfad, Attribut).
local STAT_DEFS = {
    { "level",      "/Script/G1R.AttributeSet_LevelProgression", "Level" },
    { "xp",         "/Script/G1R.AttributeSet_LevelProgression", "Experience" },
    { "learnPts",   "/Script/G1R.AttributeSet_LevelProgression", "SkillPoints" },
    { "strength",   "/Script/G1R.AttributeSet_Strength",         "Strength" },
    { "dexterity",  "/Script/G1R.AttributeSet_Dexterity",        "Dexterity" },
    { "hp",         "/Script/G1R.AttributeSet_Health",           "Health" },
    { "hpMax",      "/Script/G1R.AttributeSet_Health",           "MaxHealth" },
    { "mana",       "/Script/G1R.AttributeSet_Mana",             "Mana" },
    { "manaMax",    "/Script/G1R.AttributeSet_Mana",             "MaxMana" },
    { "magicCircle","/Script/G1R.AttributeSet_Mana",             "MagicianLevel" },
    { "resFire",    "/Script/G1R.AttributeSet_Armor",            "Resistance_Fire" },
    { "resIce",     "/Script/G1R.AttributeSet_Armor",            "Resistance_Ice" },
    { "resEdge",    "/Script/G1R.AttributeSet_Armor",            "Resistance_Edge" },
    { "resPoint",   "/Script/G1R.AttributeSet_Armor",            "Resistance_Point" },
    { "resBlunt",   "/Script/G1R.AttributeSet_Armor",            "Resistance_Blunt" },
    { "resEnergy",  "/Script/G1R.AttributeSet_Armor",            "Resistance_Energy" },
    { "resWind",    "/Script/G1R.AttributeSet_Armor",            "Resistance_Wind" },
}

local function readStats(char)
    local out = {}
    local gas = getGas()
    if not (gas and isValid(gas)) then return out end
    for _, d in ipairs(STAT_DEFS) do
        local setClass = findClass(d[2])
        if setClass then
            local ok, v = pcall(function()
                return gas:GetAttributeValue(char, setClass, fname(d[3]))
            end)
            if ok and type(v) == "number" then out[d[1]] = v end
        end
    end
    return out
end

-- ── Gilde lesen (GothicCharacterState:GetGuild → FGameplayTag) ──────────────
-- Im Dump belegt: GothicCharacterState hat GetGuild(); Rückgabe ist ein
-- GameplayTag (FGameplayTag). Wir lesen dessen TagName als String. Enum-Werte
-- (EPlayerGuild): 0 None,1 Templars,2 Novices,3 MagesWater,4 Mercenaries,
-- 5 Rogues,6 MagesFire,7 Guards,8 Shadows.
-- BP_GetCharacterState verträgt KEINE Mehrfachaufrufe pro tick (Guild UND Waffen riefen
-- es → "entweder Guild oder Weapon"). Daher den State pro tick cachen: erster Aufruf holt,
-- alle weiteren nutzen den Cache. Cache wird im tick zu Beginn invalidiert (setCharStateDirty).
local CachedState = nil
local function setCharStateDirty() CachedState = nil end
local function getCharacterState(char)
    if isValid(CachedState) then return CachedState end
    local s = nil
    pcall(function() s = char:BP_GetCharacterState() end)
    if isValid(s) then CachedState = s; return s end
    pcall(function() s = char.m_CharacterState end)
    if isValid(s) then CachedState = s; return s end
    return nil
end

local function readGuild(char)
    local state = getCharacterState(char)
    if not state then return nil end
    local ok, tag = pcall(function() return state:GetGuild() end)
    if not ok or tag == nil then return nil end
    -- tag = FGameplayTag → .TagName (FName) → String. Mehrere Zugriffe defensiv.
    local name = nil
    pcall(function()
        local tn = tag.TagName
        if tn ~= nil then
            local ok2, str = pcall(function() return tn:ToString() end)
            name = (ok2 and str) or tostring(tn)
        end
    end)
    if (not name) or name == "" then
        -- Fallback: ganzes Tag als String
        pcall(function() name = tostring(tag) end)
    end
    return name
end

-- ── Aktiver Zauber lesen ────────────────────────────────────────────────────
-- MagicScriptLibrary:GetSpellConfigGivenACharacter(char) → SpellConfig, dann
-- SpellConfig:GetSpellCategoryTag() → FGameplayTag → .TagName (roh, z.B.
-- "SpellCategory.Fireball"). Kein Zauber gewählt → nil. server.py mappt den Tag.
-- Selbes Tag-Pattern wie readGuild. Library als Singleton via StaticFindObject.
local MAGICLIB = nil
local function getMagicLib()
    if not MAGICLIB then
        pcall(function() MAGICLIB = StaticFindObject("/Script/G1R.Default__MagicScriptLibrary") end)
    end
    return MAGICLIB
end

local function readSpell(char)
    local lib = getMagicLib()
    if not (lib and isValid(lib)) then return nil end
    local ok, cfg = pcall(function() return lib:GetSpellConfigGivenACharacter(char) end)
    if not (ok and isValid(cfg)) then return nil end
    local ok2, tag = pcall(function() return cfg:GetSpellCategoryTag() end)
    if not ok2 or tag == nil then return nil end
    local name = nil
    pcall(function()
        local tn = tag.TagName
        if tn ~= nil then
            local ok3, str = pcall(function() return tn:ToString() end)
            name = (ok3 and str) or tostring(tn)
        end
    end)
    if (not name) or name == "" then
        pcall(function() name = tostring(tag) end)
    end
    if (not name) or name == "" or name == "None" then return nil end
    return name
end

-- ── Ausgerüstete Waffe lesen ────────────────────────────────────────────────
-- defName: WeaponDefinition/Item-Klasse → Klassenname (ItMw_*/ItRw_*), den server.py
-- via item_names.json übersetzt. shortName strippt Default__/_C.
local function defName(def)
    if not isValid(def) then return nil end
    local ok, full = pcall(function() return def:GetFullName() end)
    if not ok or not full then return nil end
    local n = shortName(full)
    if n == "" or n == "Item" then return nil end
    return n
end

-- Die aktuell geführte Waffe über das Combat-DataModule (GetEquipedWeaponDefinition).
-- BEWUSST NICHT über CharacterState.InventoryComponent — das kollidiert mit dem
-- Gilden-Reader (beide am selben State → "entweder Guild oder Weapon"). Das Combat-Modul
-- läuft über DataModuleLibrary (wie readAttack) und ist konfliktfrei. Liefert die gerade
-- geführte Waffe (Schwert ODER Armbrust, je nachdem was in der Hand ist).
local function readWeapon(char)
    local lib = getLib()
    if not (lib and isValid(lib)) then return nil end
    local combat = nil
    pcall(function() combat = lib:GetCombatDataModule(char) end)
    if not isValid(combat) then return nil end
    local def = nil
    pcall(function() def = combat:GetEquipedWeaponDefinition() end)
    return defName(def)
end

-- ── Laufender Schlag (Schlagrichtung) ───────────────────────────────────────
-- DataModuleLibrary:GetCombatDataModule(char) → DataModule_Combat, dann
-- GetCurrentAttackDirection() → FGameplayTag → .TagName (z.B. "AttackDirection.Left").
-- Nur während eines Angriffs gesetzt, sonst nil (flackert bei ~250ms-Poll). Selbes
-- Tag-Pattern wie readGuild/readSpell; Library = DataModuleLibrary (schon via getLib()).
local function readAttack(char)
    local lib = getLib()
    if not (lib and isValid(lib)) then return nil end
    local ok, combat = pcall(function() return lib:GetCombatDataModule(char) end)
    if not (ok and isValid(combat)) then return nil end
    local ok2, tag = pcall(function() return combat:GetCurrentAttackDirection() end)
    if not ok2 or tag == nil then return nil end
    local name = nil
    pcall(function()
        local tn = tag.TagName
        if tn ~= nil then
            local ok3, str = pcall(function() return tn:ToString() end)
            name = (ok3 and str) or tostring(tn)
        end
    end)
    if (not name) or name == "" or name == "None" then return nil end
    return name
end

-- ── Geführte Waffe via CarryComponent (READ_CARRY, crashfrei) ───────────────
-- Object-Dump: CarryComponent:GetEquippedItemDefinition() → ItemDefinition. Das ist
-- der crashfreie Ersatz für DataModule_Combat:GetEquipedWeaponDefinition (AccessViolation).
-- Die Component hängt am Spieler-Pawn; der Zugriffspfad ist am Build zu verifizieren —
-- darum mehrere defensive Wege + einmaliges Diag, welcher griff.
local carryDiag = false
local CARRY_CLASS = nil
local function getCarryComponent(char)
    -- 1: direkter Getter
    local c = nil
    pcall(function() c = char:GetCarryComponent() end)
    if isValid(c) then return c, "GetCarryComponent" end
    -- 2: Property-Namen
    pcall(function() c = char.CarryComponent end)
    if isValid(c) then return c, "CarryComponent" end
    pcall(function() c = char.m_CarryComponent end)
    if isValid(c) then return c, "m_CarryComponent" end
    -- 3: GetComponentByClass mit der CarryComponent-Klasse
    if CARRY_CLASS == nil then
        CARRY_CLASS = findClass("/Script/G1R.CarryComponent") or false
    end
    if CARRY_CLASS then
        pcall(function() c = char:GetComponentByClass(CARRY_CLASS) end)
        if isValid(c) then return c, "GetComponentByClass" end
    end
    return nil, nil
end

local function readCarryWeapon(char)
    local comp, via = getCarryComponent(char)
    if not carryDiag then
        carryDiag = true
        pcall(function()
            print(string.format("[G1RExport] Carry-Diag: component via=%s valid=%s\n",
                tostring(via), tostring(isValid(comp))))
        end)
    end
    if not isValid(comp) then return nil end
    local def = nil
    pcall(function() def = comp:GetEquippedItemDefinition() end)
    local name = defName(def)
    -- Im Wasser/Schwimmen steckt die Engine die Waffe weg → CarryComponent liefert eine
    -- Faust-/Pseudowaffe ("Human Fist No Weapon Water Walking" o.ä.). Das ist KEINE
    -- echte Waffe → rausfiltern, damit "in hand" dann sauber leer bleibt statt Müll.
    if name then
        local low = name:lower()
        if low:find("fist") or low:find("noweapon") or low:find("no_weapon")
           or low:find("unarmed") or low:find("humanfist") then
            return nil
        end
    end
    return name
end

-- ── Combo-/Schlagzähler via DataModule_Combat:GetAttackCount (READ_COMBO) ─────
-- Gleiches Modul wie readAttack (läuft stabil). GetAttackCount → Int. Semantik
-- (laufende Combo vs. Gesamt-Schläge) ist in-game zu deuten; wir geben den Rohwert raus.
local function readCombo(char)
    local lib = getLib()
    if not (lib and isValid(lib)) then return nil end
    local ok, comb = pcall(function() return lib:GetCombatDataModule(char) end)
    if not (ok and isValid(comb)) then return nil end
    local n = nil
    pcall(function() n = comb:GetAttackCount() end)
    if type(n) == "number" then return n end
    return nil
end

-- ── Spieler-Zustand: im Wasser / verwandelt / reitet (READ_STATE) ───────────
-- Object-Dump: GothicAnimInstance trägt die Bool-Flags (m_IsInWater, bIsTransformed),
-- erreichbar über den Mesh (Engine.Character:Mesh → SkeletalMeshComponent:GetAnimInstance).
-- Reiten über GothicCharacter:GetMountComponent → GetMountCharacter (gültig = reitet).
-- Alles defensiv (pcall); fehlt etwas, bleibt das jeweilige Flag false.
local stateDiag = false
local function getAnimInstance(char)
    local mesh = nil
    pcall(function() mesh = char.Mesh end)            -- Engine.Character:Mesh
    if not isValid(mesh) then
        pcall(function() mesh = char:GetMesh() end)    -- Fallback-Getter
    end
    if not isValid(mesh) then return nil end
    local anim = nil
    pcall(function() anim = mesh:GetAnimInstance() end)
    return isValid(anim) and anim or nil
end

local function readState(char)
    local st = { inWater = false, transformed = false, riding = false }
    local anim = getAnimInstance(char)
    if anim then
        pcall(function() if anim.m_IsInWater == true then st.inWater = true end end)
        pcall(function() if anim.bIsTransformed == true then st.transformed = true end end)
    end
    pcall(function()
        local mc = char:GetMountComponent()
        if isValid(mc) then
            local rider = nil
            pcall(function() rider = mc:GetMountCharacter() end)
            if isValid(rider) then st.riding = true end
        end
    end)
    if not stateDiag then
        stateDiag = true
        pcall(function()
            print(string.format("[G1RExport] State-Diag: anim=%s inWater=%s transformed=%s riding=%s\n",
                tostring(anim ~= nil), tostring(st.inWater), tostring(st.transformed), tostring(st.riding)))
        end)
    end
    return st
end

-- ── Ingame-Uhr ──────────────────────────────────────────────────────────────
-- GameTimeSubsystem:GetCurrentClockTime() (parameterlos) → ClockTime,
-- ClockTimeLibrary:GetHour/GetMinute(ClockTime) → int. Subsystem als Live-Instanz
-- via FindFirstOf (NICHT Default__/CDO — das hätte keinen State).
local TIMESUBSYS, CLOCKLIB = nil, nil
local function getTimeSubsys()
    if not isValid(TIMESUBSYS) then
        pcall(function() TIMESUBSYS = FindFirstOf("GameTimeSubsystem") end)
    end
    return TIMESUBSYS
end
local function getClockLib()
    if not CLOCKLIB then
        pcall(function() CLOCKLIB = StaticFindObject("/Script/G1R.Default__ClockTimeLibrary") end)
    end
    return CLOCKLIB
end

local function readClock()
    local ts = getTimeSubsys()
    if not isValid(ts) then return nil end
    local ct = nil
    pcall(function() ct = ts:GetCurrentClockTime() end)
    if ct == nil then return nil end
    local lib = getClockLib()
    if not (lib and isValid(lib)) then return nil end
    local hour, minute
    pcall(function() hour = lib:GetHour(ct) end)
    pcall(function() minute = lib:GetMinute(ct) end)
    if type(hour) ~= "number" then return nil end
    return { hour = hour, minute = (type(minute) == "number" and minute) or 0 }
end

-- ── Kill-Counter (Map Kreatur→Anzahl) + News-Ticker ─────────────────────────
-- PuzzlesSubsystem:GetCreatureKillCounterMap() → TMap<Name,Int>. Live-Instanz via
-- FindFirstOf. Map pro Tick lesen; Session = jetzt − Snapshot; Anstieg = News-Event.
local PUZZLES = nil
local function getPuzzles()
    if not isValid(PUZZLES) then
        pcall(function() PUZZLES = FindFirstOf("PuzzlesSubsystem") end)
    end
    return PUZZLES
end

-- Liest die rohe Kill-Map als Lua-Tabelle {nameString = count} oder nil.
local function readKillMap()
    local subsys = getPuzzles()
    if not isValid(subsys) then return nil end
    local map = nil
    pcall(function() map = subsys:GetCreatureKillCounterMap() end)
    if map == nil then return nil end
    pcall(function() map = unwrap(map) end)  -- evtl. RemoteUnrealParam-Wrapper entpacken
    local out, any = {}, false
    local ok = pcall(function()
        map:ForEach(function(k, v)
            local key = unwrap(k)
            local val = unwrap(v)
            if key ~= nil then
                local ks
                pcall(function() ks = key:ToString() end)
                ks = ks or tostring(key)
                if ks and ks ~= "" then out[ks] = tonumber(val) or 0; any = true end
            end
        end)
    end)
    if not ok then return nil end
    if not any then return {} end
    return out
end

-- Aktualisiert Session-Kills + News-Queue aus der aktuellen Map. Gibt die
-- Session-Kill-Tabelle zurück (jetzt − Baseline), oder nil wenn Map nicht lesbar.
local function updateKills()
    local map = readKillMap()
    if map == nil then return nil end
    if killBase == nil then
        -- Erster Read: Baseline setzen, noch keine News (Vergangenheit nicht zählen).
        killBase = map
        lastKillMap = map
        return {}
    end
    -- News: Anstieg gegenüber dem letzten Tick.
    for typ, cnt in pairs(map) do
        local prev = (lastKillMap and lastKillMap[typ]) or 0
        if cnt > prev then
            local n = cnt - prev
            killNews[#killNews + 1] = { type = typ, n = n }
            while #killNews > MAX_NEWS do table.remove(killNews, 1) end
            pendingEvents[#pendingEvents+1] = { kind = "kill", value = n, meta = { type = typ } }
        end
    end
    lastKillMap = map
    -- Session-Summe = jetzt − Baseline.
    local out = {}
    for typ, cnt in pairs(map) do
        local base = killBase[typ] or 0
        if cnt > base then out[typ] = cnt - base end
    end
    return out
end

-- ── JSON (minimal, nur für unsere Struktur) ─────────────────────────────────
local function jsonEsc(s)
    return (tostring(s):gsub('[\\"%z\1-\31]', function(c)
        return string.format('\\u%04x', string.byte(c))
    end):gsub('\\u0022', '\\"'):gsub('\\u005c', '\\\\'))
end

-- ── Run-/Profil-Kennung (saveKey) ──────────────────────────────────────────
-- PersistentDataSubsystem (GameInstanceSubsystem) hat GetCurrentProfileId()→Int.
-- Quelle: UE4SS Object-Dump (siehe G1R-MODDING-REFERENZ.md). Profil wechselt nur
-- beim Laden eines anderen Spielstands → letzten Wert cachen (FindFirstOf ist nicht gratis).
local cachedSaveKey = nil
local function readSaveKey()
    local pds = FindFirstOf("PersistentDataSubsystem")
    if not isValid(pds) then return cachedSaveKey end
    local ok, id = pcall(function() return pds:GetCurrentProfileId() end)
    if ok and type(id) == "number" then cachedSaveKey = id end
    return cachedSaveKey
end

local function buildJson(pos, items, distCm, stats, guild, spell, weapon, attack, clock, kills, news, combo, state)
    local parts = {}
    parts[#parts+1] = '"ok":true'
    if guild and guild ~= "" then
        parts[#parts+1] = string.format('"guild":"%s"', jsonEsc(guild))
    else
        parts[#parts+1] = '"guild":null'
    end
    if spell and spell ~= "" then
        parts[#parts+1] = string.format('"spell":"%s"', jsonEsc(spell))
    else
        parts[#parts+1] = '"spell":null'
    end
    if weapon and weapon ~= "" then
        parts[#parts+1] = string.format('"weapon":"%s"', jsonEsc(weapon))
    else
        parts[#parts+1] = '"weapon":null'
    end
    if attack and attack ~= "" then
        parts[#parts+1] = string.format('"attack":"%s"', jsonEsc(attack))
    else
        parts[#parts+1] = '"attack":null'
    end
    if type(combo) == "number" then
        parts[#parts+1] = string.format('"combo":%d', math.floor(combo + 0.5))
    else
        parts[#parts+1] = '"combo":null'
    end
    if type(state) == "table" then
        parts[#parts+1] = string.format('"state":{"inWater":%s,"transformed":%s,"riding":%s}',
            tostring(state.inWater == true), tostring(state.transformed == true),
            tostring(state.riding == true))
    else
        parts[#parts+1] = '"state":null'
    end
    if clock and type(clock.hour) == "number" then
        parts[#parts+1] = string.format('"clock":{"hour":%d,"minute":%d}', clock.hour, clock.minute or 0)
    else
        parts[#parts+1] = '"clock":null'
    end
    -- Session-Kills als Objekt {typ:anzahl}
    if kills then
        local kp = {}
        for typ, n in pairs(kills) do
            kp[#kp+1] = string.format('"%s":%d', jsonEsc(typ), n)
        end
        parts[#parts+1] = '"kills":{' .. table.concat(kp, ",") .. '}'
    else
        parts[#parts+1] = '"kills":null'
    end
    -- News-Ticker als Array [{type,n},...]
    local np = {}
    for _, ev in ipairs(news or {}) do
        np[#np+1] = string.format('{"type":"%s","n":%d}', jsonEsc(ev.type), ev.n)
    end
    parts[#parts+1] = '"killNews":[' .. table.concat(np, ",") .. ']'
    if pos then
        parts[#parts+1] = string.format('"pos":{"x":%.1f,"y":%.1f,"z":%.1f}', pos.x, pos.y, pos.z)
    else
        parts[#parts+1] = '"pos":null'
    end
    local meters = (distCm or 0) / 100
    local steps = math.floor(meters / STEP_LEN_M)
    parts[#parts+1] = string.format('"distanceM":%.1f,"steps":%d', meters, steps)
    -- Session-Zähler (ab Mod-Start): Schaden/Regen/Mana-Verbrauch/XP + Strecke/Schritte.
    parts[#parts+1] = string.format(
        '"session":{"damageTaken":%d,"healthRegen":%d,"manaSpent":%d,"manaRegen":%d,"xpGained":%d,"steps":%d,"distanceM":%.1f}',
        math.floor(sess.damageTaken + 0.5), math.floor(sess.healthRegen + 0.5),
        math.floor(sess.manaSpent + 0.5), math.floor(sess.manaRegen + 0.5),
        math.floor(sess.xpGained + 0.5), steps, meters)
    parts[#parts+1] = string.format('"session_damageDealt":%d', math.floor(sessDamageDealt + 0.5))
    parts[#parts+1] = string.format('"session_kills":%d', math.floor(sessKills + 0.5))
    -- Session-Rekorde (spiegelt "records", aber nur diese Session) → Career-Card scope=session.
    parts[#parts+1] = string.format(
        '"sessionRecords":{"hardestTaken":%d,"manaTick":%d,"runM":%.1f,"hardestDealt":%d}',
        math.floor(sess.recHardestTaken+0.5), math.floor(sess.recManaTick+0.5),
        sess.recRunM, math.floor(sess.recHardestDealt+0.5))
    -- Persistente Gesamt-Werte (alle Sessions).
    parts[#parts+1] = string.format(
        '"totals":{"damageTaken":%d,"healthRegen":%d,"manaSpent":%d,"manaRegen":%d,"xpGained":%d,"distanceM":%.1f,"steps":%d,"damageDealt":%d,"kills":%d}',
        math.floor(totals.damageTaken+0.5), math.floor(totals.healthRegen+0.5), math.floor(totals.manaSpent+0.5),
        math.floor(totals.manaRegen+0.5), math.floor(totals.xpGained+0.5), totals.distanceM, totals.steps,
        math.floor(totals.damageDealt+0.5), math.floor((totals.kills or 0)+0.5))
    -- Rekorde.
    parts[#parts+1] = string.format(
        '"records":{"hardestTaken":%d,"manaTick":%d,"runM":%.1f,"hardestDealt":%d}',
        math.floor(totals.recHardestTaken+0.5), math.floor(totals.recManaTick+0.5),
        totals.recRunM, math.floor(totals.recHardestDealt+0.5))
    -- Stats als Objekt {label:wert,...}
    local st = {}
    for k, v in pairs(stats or {}) do
        st[#st+1] = string.format('"%s":%s', k, tostring(v))
    end
    parts[#parts+1] = '"stats":{' .. table.concat(st, ",") .. '}'
    local it = {}
    for _, item in ipairs(items) do
        -- UI-Weg liefert "display" (lokalisierter DE-Name), Container-Fallback "name"
        -- (Klassenname, von server.py übersetzt). Beide Felder optional mitschreiben.
        local fields = { string.format('"count":%d', item.count or 1) }
        if item.name and item.name ~= "" then
            fields[#fields+1] = string.format('"name":"%s"', jsonEsc(item.name))
        end
        if item.display and item.display ~= "" then
            fields[#fields+1] = string.format('"display":"%s"', jsonEsc(item.display))
        end
        it[#it+1] = "{" .. table.concat(fields, ",") .. "}"
    end
    parts[#parts+1] = '"items":[' .. table.concat(it, ",") .. ']'
    -- saveKey = aktuelle Profil-/Run-ID aus PersistentDataSubsystem (GameInstanceSubsystem;
    -- Quelle: Object-Dump, GetCurrentProfileId → Int). Profil ändert sich nur bei
    -- Spielstand-Wechsel → Wert cachen. Run-Erkennung im Backend nutzt das.
    local sk = readSaveKey()
    parts[#parts+1] = (sk ~= nil) and string.format('"saveKey":%d', sk) or '"saveKey":null'
    local evParts = {}
    for _, ev in ipairs(pendingEvents) do
        if ev.kind == "kill" then
            evParts[#evParts+1] = string.format('{"kind":"kill","value":%d,"meta":{"type":"%s"}}',
                math.floor((ev.value or 1)), jsonEsc(tostring(ev.meta and ev.meta.type or "")))
        else
            evParts[#evParts+1] = string.format('{"kind":"%s","value":%d}', ev.kind, math.floor(ev.value or 0))
        end
    end
    parts[#parts+1] = '"events":[' .. table.concat(evParts, ",") .. ']'
    return "{" .. table.concat(parts, ",") .. "}"
end

-- ── Schreib-Schleife ────────────────────────────────────────────────────────
local function tick()
    setCharStateDirty()  -- CharacterState-Cache pro tick frisch holen (1 Aufruf, beide Reader teilen ihn)
    local char = getPlayer()
    if not char then return end
    -- Beim Spiel-Schließen / Hauptmenü räumt die Engine die Objekte ab. Prüfen, ob
    -- die Welt noch lebt — sonst Cache leeren und NICHTS tun (verhindert Zugriffe auf
    -- halb-zerstörte Objekte, die beim Shutdown sonst einen Fehler werfen).
    local worldOk = false
    pcall(function()
        local w = char:GetWorld()
        worldOk = w ~= nil and w:IsValid()
    end)
    if not worldOk then
        CachedPlayer = nil; lastPos = nil; lastHp = nil; lastMana = nil; lastXp = nil
        warmup = WARMUP_TICKS  -- beim nächsten gültigen Tick erst Baseline aufbauen
        return
    end
    local pos, items
    pcall(function() pos = readPosition(char) end)
    -- Laufstrecke aufsummieren (horizontal; Teleports/Ladezonen über MAX_STEP_CM raus).
    if pos then
        if lastPos then
            local dx, dy = pos.x - lastPos.x, pos.y - lastPos.y
            local d = math.sqrt(dx * dx + dy * dy)
            if d <= MAX_STEP_CM then
                totalDistCm = totalDistCm + d
                totals.distanceM = totals.distanceM + d / 100
                totals.steps = math.floor(totals.distanceM / STEP_LEN_M)
            end
        end
        lastPos = pos
    end
    -- Rekord "weiteste Strecke" = höchste Session-Strecke (totalDistCm seit Mod-Start).
    local sessM = totalDistCm / 100
    if sessM > sess.recRunM then sess.recRunM = sessM end
    if sessM > totals.recRunM then totals.recRunM = sessM end
    -- Items via vollständigem mods-g1r-Helper-Stack (unwrap/arrGet) — entpackt die
    -- RemoteUnrealParam-Wrapper, umgeht so den ScriptStruct-m_Slots-Stolperstein.
    pcall(function() items = readInventory(char) or {} end)
    local stats
    pcall(function() stats = readStats(char) or {} end)
    -- Session-Zähler aus den Stat-Deltas: HP runter = Schaden, HP rauf = Regen;
    -- Mana runter = Verbrauch, rauf = Regen; XP rauf = Zuwachs. Große Sprünge
    -- (Laden/Level-up/Respawn) über MAX_STAT_JUMP ignorieren.
    if stats then
        local hp, mana, xp = stats.hp, stats.mana, stats.xp
        -- Teardown-Schutz: beim Spiel-Schließen/Hauptmenü baut die Engine die Attribute
        -- ab (hpMax fällt auf 0/ungültig) BEVOR worldOk umschlägt → der HP/Mana-Abfall
        -- darf NICHT als Schaden/Mana-Verbrauch zählen. Unplausible Stats → wie Warmup.
        local sane = type(stats.hpMax) == "number" and stats.hpMax > 0
        if warmup > 0 or not sane then
            -- Warmup nach Welt-Load/Schließen ODER Teardown: Baseline mitführen, Deltas
            -- NICHT zählen (Auffüllen/Abfallen von HP/Mana ist kein echter Regen/Schaden).
            if warmup > 0 then warmup = warmup - 1 end
            if not sane then warmup = WARMUP_TICKS end  -- bei Re-Entry erst sauber rebaselinen
        else
            if hp ~= nil and lastHp ~= nil then
                local d = hp - lastHp
                if math.abs(d) <= MAX_STAT_JUMP then
                    if d < 0 then
                        sess.damageTaken = sess.damageTaken - d
                        totals.damageTaken = totals.damageTaken - d
                        if -d > sess.recHardestTaken then sess.recHardestTaken = -d end
                        if -d > totals.recHardestTaken then totals.recHardestTaken = -d end
                        pendingEvents[#pendingEvents+1] = { kind = "hit_taken", value = math.floor(-d + 0.5) }
                    elseif d > 0 then
                        sess.healthRegen = sess.healthRegen + d
                        totals.healthRegen = totals.healthRegen + d
                    end
                end
            end
            if mana ~= nil and lastMana ~= nil then
                local d = mana - lastMana
                if math.abs(d) <= MAX_STAT_JUMP then
                    if d < 0 then
                        sess.manaSpent = sess.manaSpent - d
                        totals.manaSpent = totals.manaSpent - d
                        if -d > sess.recManaTick then sess.recManaTick = -d end
                        if -d > totals.recManaTick then totals.recManaTick = -d end
                    elseif d > 0 then
                        sess.manaRegen = sess.manaRegen + d
                        totals.manaRegen = totals.manaRegen + d
                    end
                end
            end
            if xp ~= nil and lastXp ~= nil then
                local d = xp - lastXp
                if d > 0 then sess.xpGained = sess.xpGained + d; totals.xpGained = totals.xpGained + d end
            end
        end
        -- Baseline IMMER aktualisieren (auch im Warmup), damit der erste echte Delta sauber ist.
        if hp ~= nil then lastHp = hp end
        if mana ~= nil then lastMana = mana end
        if xp ~= nil then lastXp = xp end
    end
    local guild
    pcall(function() guild = readGuild(char) end)
    -- Einmalige Gilden-Diagnose: zeigt, ob der CharacterState da ist, was GetGuild
    -- roh liefert und was readGuild daraus macht. So lässt sich "keine Gilde" als
    -- "noch keiner Gilde beigetreten" (None) vs. "Reader kaputt" unterscheiden.
    if not guildDiagDone then
        guildDiagTicks = guildDiagTicks + 1
        local st = getCharacterState(char)
        if isValid(st) then
            -- State endlich da → echtes GetGuild-Ergebnis loggen (das ist die Wahrheit).
            guildDiagDone = true
            pcall(function()
                local rawTag, rawType = "(nil)", "(nil)"
                pcall(function()
                    local t = st:GetGuild()
                    rawType = type(t)
                    rawTag = tostring(t)
                    if type(t) == "userdata" and t.TagName ~= nil then
                        pcall(function() rawTag = t.TagName:ToString() end)
                    end
                end)
                print(string.format(
                    "[G1RExport] Guild-Diag: state=OK nach %d Ticks GetGuild.type=%s rawTag=%q readGuild=%q\n",
                    guildDiagTicks, tostring(rawType), tostring(rawTag), tostring(guild)))
            end)
        elseif guildDiagTicks >= 40 then
            -- ~10s und immer noch kein State → die verschluckten Roh-Fehler einfangen,
            -- um BP_GetCharacterState (wirft?) von m_CharacterState (nil?) zu trennen.
            guildDiagDone = true
            pcall(function()
                local ok1, r1 = pcall(function() return char:BP_GetCharacterState() end)
                local ok2, r2 = pcall(function() return char.m_CharacterState end)
                print(string.format(
                    "[G1RExport] Guild-Diag: State nach ~10s nil | BP_GetCharacterState ok=%s val=%s | m_CharacterState ok=%s val=%s | charValid=%s\n",
                    tostring(ok1), tostring(r1), tostring(ok2), tostring(r2), tostring(isValid(char))))
            end)
        end
    end
    if not saveDiagDone then
        saveDiagDone = true
        pcall(function()
            local gi, gs = "(nil)", "(nil)"
            pcall(function()
                local inst = FindFirstOf("GothicGameInstance") or FindFirstOf("GameInstance")
                if inst then gi = tostring(inst:GetFullName()) end
            end)
            pcall(function()
                local sgs = FindFirstOf("GothicSaveGameSystem") or FindFirstOf("SaveGameSystem")
                if sgs then gs = tostring(sgs:GetFullName()) end
            end)
            print(string.format("[G1RExport] Save-Diag: GameInstance=%q SaveSys=%q\n", gi, gs))
        end)
    end
    local spell
    if READ_SPELL then pcall(function() spell = readSpell(char) end) end
    local weapon
    if READ_WEAPONS then pcall(function() weapon = readWeapon(char) end) end
    -- CarryComponent-Weg bevorzugt, wenn an (crashfrei). Überschreibt den alten Reader nur,
    -- wenn er tatsächlich etwas liefert.
    if READ_CARRY then pcall(function() local w = readCarryWeapon(char); if w then weapon = w end end) end
    if READ_COMBO then pcall(function() combo = readCombo(char) end) else combo = nil end
    local state
    if READ_STATE then pcall(function() state = readState(char) end) end
    local attack
    if READ_ATTACK then pcall(function() attack = readAttack(char) end) end
    -- Einmaliges Diagnose-Log (Stufe 2). Steht VOR den riskanten Readern und nutzt nur
    -- FindFirstOf (sicher) — kommt also auch dann, wenn clock/kills deaktiviert sind.
    if not diagDone then
        diagDone = true
        pcall(function()
            -- FindFirstOf NUR wenn das Flag an ist (sonst kein Engine-Zugriff → sicher).
            local ts = READ_CLOCK and tostring(isValid(getTimeSubsys())) or "(aus)"
            local pz = READ_KILLS and tostring(isValid(getPuzzles())) or "(aus)"
            print(string.format(
                "[G1RExport] Diag: tick laeuft. SPELL=%s WEAPONS=%s ATTACK=%s CLOCK=%s KILLS=%s | GameTime=%s Puzzles=%s\n",
                tostring(READ_SPELL), tostring(READ_WEAPONS), tostring(READ_ATTACK),
                tostring(READ_CLOCK), tostring(READ_KILLS), ts, pz))
        end)
    end
    local clock
    if READ_CLOCK then pcall(function() clock = readClock() end) end
    local kills
    if READ_KILLS_HOOK then
        kills = hookKills            -- Hook-Zähler (echte Kills, Causer==Spieler)
    elseif READ_KILLS then
        pcall(function() kills = updateKills() end)   -- alter Map-Weg (PuzzlesSubsystem, tot)
    end
    local json = buildJson(pos, items or {}, totalDistCm, stats or {}, guild, spell,
                           weapon, attack, clock, kills, killNews, combo, state)
    local f = io.open(OUTPUT_PATH, "w")
    if f then f:write(json); f:close(); pendingEvents = {} end
    -- Gesamt-Werte nicht jeden Tick schreiben (I/O), nur ~alle 10 s.
    lastTotalsWrite = lastTotalsWrite + 1
    if lastTotalsWrite >= 40 then
        lastTotalsWrite = 0
        local tp = {}
        for k, v in pairs(totals) do tp[#tp+1] = string.format('"%s":%.2f', k, v) end
        local tf = io.open(TOTALS_PATH, "w")
        if tf then tf:write("{" .. table.concat(tp, ",") .. "}"); tf:close() end
    end
end

-- ── Engine-Hooks (Kills + ausgeteilter Schaden) ─────────────────────────────
-- Beide hängen am Spiel-Code → strikt hinter Flags + alles in pcall. Sie laufen auf
-- dem Game-Thread; ein Fehler hier darf den tick nicht reißen. Stehen NACH allen
-- Helfern (shortName/getPlayer/isValid), damit die Upvalues gültig sind.

-- Vergleicht einen (ggf. gewrappten) Actor mit dem Spieler-Pawn über den vollen Namen.
local function isPlayerActor(actor)
    local a = unwrap(actor)
    if not isValid(a) then return false end
    local p = getPlayer()
    if not isValid(p) then return false end
    if a == p then return true end
    local an, pn
    pcall(function() an = a:GetFullName() end)
    pcall(function() pn = p:GetFullName() end)
    return an ~= nil and an == pn
end

-- Kills: AIAgentCharacter:HandleDefeated(DefeatingCharacterActor). self = sterbender
-- Gegner, Arg = wer ihn besiegt hat. Causer == Spieler → echter Kill. Ersetzt die tote
-- PuzzlesSubsystem-Map; gleiches {typ:anzahl}-Format → Widget/News unverändert.
if READ_KILLS_HOOK then
    pcall(function()
        RegisterHook("/Script/G1R.AIAgentCharacter:HandleDefeated", function(self, DefeatingCharacterActor)
            pcall(function()
                local causer = DefeatingCharacterActor
                if not killHookDiag then
                    killHookDiag = true
                    local cn = "(nil)"
                    pcall(function() cn = unwrap(causer):GetFullName() end)
                    print(string.format("[G1RExport] Kill-Hook feuerte. Causer=%q isPlayer=%s\n",
                        tostring(cn), tostring(isPlayerActor(causer))))
                end
                if not isPlayerActor(causer) then return end
                local dying = unwrap(self)
                local typ = "Creature"
                pcall(function() typ = shortName(dying:GetFullName()) end)
                hookKills[typ] = (hookKills[typ] or 0) + 1
                sessKills = sessKills + 1
                totals.kills = (totals.kills or 0) + 1
                killNews[#killNews + 1] = { type = typ, n = 1 }
                while #killNews > MAX_NEWS do table.remove(killNews, 1) end
                pendingEvents[#pendingEvents + 1] = { kind = "kill", value = 1, meta = { type = typ } }
            end)
        end)
    end)
end

-- Ausgeteilter Schaden: MeleeWeaponVisual:OnDamageDealt(Target, relativeDamage:float).
-- MELEE-only (kein Bogen/Armbrust/Zauber). self = WeaponVisual; ohne sauberen Träger-
-- Bezug ist der Spieler-Filter unsicher → erster Treffer loggt die self-Kette, damit der
-- Filter belegbar wird. Solange ungefiltert: NUR zählen, wenn self über die Owner-Kette
-- auf den Spieler zeigt (sonst würde fremder Mob-Schaden mitgezählt).
local function visualBelongsToPlayer(weaponVisual)
    local cur = unwrap(weaponVisual)
    for _ = 1, 4 do
        if not isValid(cur) then return false end
        if isPlayerActor(cur) then return true end
        local nxt = nil
        pcall(function() nxt = cur:GetOwner() end)
        cur = unwrap(nxt)
        if not cur then return false end
    end
    return false
end

if READ_DMG_OUT then
    pcall(function()
        RegisterHook("/Script/G1R.MeleeWeaponVisual:OnDamageDealt", function(self, Target, relativeDamage)
            pcall(function()
                local dmg = unwrap(relativeDamage)
                if type(dmg) ~= "number" then return end
                local mine = visualBelongsToPlayer(self)
                if not dmgOutDiag then
                    dmgOutDiag = true
                    local sn = "(nil)"
                    pcall(function() sn = unwrap(self):GetFullName() end)
                    print(string.format("[G1RExport] DmgOut-Hook feuerte. self=%q relativeDamage=%s belongsToPlayer=%s\n",
                        tostring(sn), tostring(dmg), tostring(mine)))
                end
                if not mine or dmg <= 0 then return end
                sessDamageDealt = sessDamageDealt + dmg
                totals.damageDealt = totals.damageDealt + dmg
                if dmg > sess.recHardestDealt then sess.recHardestDealt = dmg end
                if dmg > totals.recHardestDealt then totals.recHardestDealt = dmg end
                pendingEvents[#pendingEvents + 1] = { kind = "hit_dealt", value = math.floor(dmg + 0.5) }
            end)
        end)
    end)
end

-- UE4SS-Loop: alle POLL_INTERVAL_MS einmal schreiben.
LoopAsync(POLL_INTERVAL_MS, function()
    -- Bei einem Fehler im tick (z.B. Objekt beim Shutdown gerade abgeräumt) den
    -- Player-Cache leeren, damit der nächste Durchlauf nicht erneut auf ein totes
    -- Objekt zugreift.
    local ok = pcall(tick)
    if not ok then CachedPlayer = nil; lastPos = nil end
    return false  -- nie stoppen
end)

-- ── Dump-Hotkey: Strg+Shift+J → kompletter Object-Dump für Reverse Engineering ──
-- Schreibt UE4SS_ObjectDump.txt (im selben Ordner wie UE4SS.log). Damit lässt sich
-- z.B. nach Faction/Guild/Camp/Reputation am GothicPlayerCharacter suchen.
pcall(function()
    RegisterKeyBind(Key.J, { ModifierKey.CONTROL, ModifierKey.SHIFT }, function()
        print("[G1RExport] Object-Dump gestartet (Strg+Shift+J) — kann ein paar Sekunden dauern, Spiel stockt kurz ...\n")
        local ok, err = pcall(function() DumpAllObjects() end)
        if ok then
            print("[G1RExport] Object-Dump FERTIG → UE4SS_ObjectDump.txt (im selben Ordner wie UE4SS.log)\n")
        else
            print("[G1RExport] Object-Dump FEHLER: " .. tostring(err) .. "\n")
        end
    end)
end)

print("[G1RExport] geladen — schreibt nach " .. OUTPUT_PATH .. " · Dump-Hotkey: Strg+Shift+J\n")
