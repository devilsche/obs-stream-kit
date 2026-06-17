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
local sess = { damageTaken = 0, healthRegen = 0, manaSpent = 0, manaRegen = 0, xpGained = 0 }
local lastHp, lastMana, lastXp = nil, nil, nil
-- Sprünge größer als das = Laden/Level-up/Respawn, nicht als Schaden/Regen zählen.
local MAX_STAT_JUMP = 500

-- Stufe 2: Kill-Counter + News-Ticker + Ingame-Uhr (Live-Subsysteme).
-- VORSICHT: diese beiden machen Engine-Zugriffe, die HART crashen können (nicht
-- per pcall fangbar). Beide stehen daher auf false, bis in-game einzeln verifiziert.
-- Zum Testen GENAU EINEN auf true setzen, Spiel neu starten, schauen ob's crasht.
-- In-game verifiziert (2026-06-17): Waffen/Schlag/Uhr/Kills laufen sauber → an.
-- readSpell CRASHT hart (GetSpellConfigGivenACharacter, vermutl. interner null-deref
-- ohne aktiven Zauber) → aus, bis sicherer Weg gefunden.
local READ_SPELL   = false  -- CRASHT — MagicScriptLibrary:GetSpellConfigGivenACharacter
local READ_WEAPONS = true   -- InventoryComponent:GetFirstEquipped*Weapon + GetFullName
local READ_ATTACK  = true   -- DataModuleLibrary:GetCombatDataModule:GetCurrentAttackDirection
local READ_CLOCK   = true   -- GameTimeSubsystem:GetCurrentClockTime + ClockTimeLibrary:GetHour
local READ_KILLS   = true   -- PuzzlesSubsystem:GetCreatureKillCounterMap (TMap:ForEach)
local killBase    = nil   -- Map-Snapshot beim ersten Read (für Session-Summe)
local lastKillMap = nil   -- letzte Map (für News-Delta)
local killNews    = {}    -- jüngste Events {type=, n=}, max MAX_NEWS
local MAX_NEWS    = 12
local diagDone    = false  -- einmaliges Diagnose-Log
local killDbg     = ""      -- temporäres Diagnose-Feld für die Kill-Map

local function isValid(o)
    return o and pcall(function() return o:IsValid() end) and o:IsValid()
end

-- ── Player-Pawn cachen (Pattern aus mods-g1r main.lua + stats.lua) ──────────
RegisterHook("/Script/Engine.PlayerController:ClientRestart", function(self, NewPawn)
    local ok, pawn = pcall(function() return NewPawn:get() end)
    if ok and isValid(pawn) then CachedPlayer = pawn end
end)

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
    if not isValid(subsys) then killDbg = "no-subsys"; return nil end
    local map = nil
    pcall(function() map = subsys:GetCreatureKillCounterMap() end)
    if map == nil then killDbg = "map-nil"; return nil end
    pcall(function() map = unwrap(map) end)  -- evtl. RemoteUnrealParam-Wrapper entpacken
    local out, any, n = {}, false, 0
    local ok = pcall(function()
        map:ForEach(function(k, v)
            n = n + 1
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
    if not ok then killDbg = "foreach-err(n=" .. n .. ")"; return nil end
    killDbg = "entries=" .. n
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
            killNews[#killNews + 1] = { type = typ, n = cnt - prev }
            while #killNews > MAX_NEWS do table.remove(killNews, 1) end
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

local function buildJson(pos, items, distCm, stats, guild, spell, weapon, attack, clock, kills, news)
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
    -- Temporäres Diagnose-Feld (Kills) — wird nach dem Fix wieder entfernt.
    parts[#parts+1] = string.format('"dbg":"K[%s]"', jsonEsc(killDbg or ""))
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
    if not worldOk then CachedPlayer = nil; lastPos = nil; lastHp = nil; lastMana = nil; lastXp = nil; return end
    local pos, items
    pcall(function() pos = readPosition(char) end)
    -- Laufstrecke aufsummieren (horizontal; Teleports/Ladezonen über MAX_STEP_CM raus).
    if pos then
        if lastPos then
            local dx, dy = pos.x - lastPos.x, pos.y - lastPos.y
            local d = math.sqrt(dx * dx + dy * dy)
            if d <= MAX_STEP_CM then totalDistCm = totalDistCm + d end
        end
        lastPos = pos
    end
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
        if hp ~= nil and lastHp ~= nil then
            local d = hp - lastHp
            if math.abs(d) <= MAX_STAT_JUMP then
                if d < 0 then sess.damageTaken = sess.damageTaken - d
                elseif d > 0 then sess.healthRegen = sess.healthRegen + d end
            end
        end
        if hp ~= nil then lastHp = hp end
        if mana ~= nil and lastMana ~= nil then
            local d = mana - lastMana
            if math.abs(d) <= MAX_STAT_JUMP then
                if d < 0 then sess.manaSpent = sess.manaSpent - d
                elseif d > 0 then sess.manaRegen = sess.manaRegen + d end
            end
        end
        if mana ~= nil then lastMana = mana end
        if xp ~= nil and lastXp ~= nil then
            local d = xp - lastXp
            if d > 0 then sess.xpGained = sess.xpGained + d end  -- nur Zuwachs
        end
        if xp ~= nil then lastXp = xp end
    end
    local guild
    pcall(function() guild = readGuild(char) end)
    local spell
    if READ_SPELL then pcall(function() spell = readSpell(char) end) end
    local weapon
    if READ_WEAPONS then pcall(function() weapon = readWeapon(char) end) end
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
    if READ_KILLS then pcall(function() kills = updateKills() end) end
    local json = buildJson(pos, items or {}, totalDistCm, stats or {}, guild, spell,
                           weapon, attack, clock, kills, killNews)
    local f = io.open(OUTPUT_PATH, "w")
    if f then f:write(json); f:close() end
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
