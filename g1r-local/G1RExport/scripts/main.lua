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
    return string.match(fullName, "%.([^%.]+)$") or fullName
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

local function readInventory(char)
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
local function getCharacterState(char)
    local s = nil
    pcall(function() s = char:BP_GetCharacterState() end)
    if isValid(s) then return s end
    pcall(function() s = char.m_CharacterState end)
    if isValid(s) then return s end
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

-- ── JSON (minimal, nur für unsere Struktur) ─────────────────────────────────
local function jsonEsc(s)
    return (tostring(s):gsub('[\\"%z\1-\31]', function(c)
        return string.format('\\u%04x', string.byte(c))
    end):gsub('\\u0022', '\\"'):gsub('\\u005c', '\\\\'))
end

local function buildJson(pos, items, distCm, stats, guild)
    local parts = {}
    parts[#parts+1] = '"ok":true'
    if guild and guild ~= "" then
        parts[#parts+1] = string.format('"guild":"%s"', jsonEsc(guild))
    else
        parts[#parts+1] = '"guild":null'
    end
    if pos then
        parts[#parts+1] = string.format('"pos":{"x":%.1f,"y":%.1f,"z":%.1f}', pos.x, pos.y, pos.z)
    else
        parts[#parts+1] = '"pos":null'
    end
    local meters = (distCm or 0) / 100
    parts[#parts+1] = string.format('"distanceM":%.1f,"steps":%d', meters, math.floor(meters / STEP_LEN_M))
    -- Stats als Objekt {label:wert,...}
    local st = {}
    for k, v in pairs(stats or {}) do
        st[#st+1] = string.format('"%s":%s', k, tostring(v))
    end
    parts[#parts+1] = '"stats":{' .. table.concat(st, ",") .. '}'
    local it = {}
    for _, item in ipairs(items) do
        it[#it+1] = string.format('{"name":"%s","count":%d}', jsonEsc(item.name), item.count)
    end
    parts[#parts+1] = '"items":[' .. table.concat(it, ",") .. ']'
    return "{" .. table.concat(parts, ",") .. "}"
end

-- ── Schreib-Schleife ────────────────────────────────────────────────────────
local function tick()
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
    if not worldOk then CachedPlayer = nil; lastPos = nil; return end
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
    local guild
    pcall(function() guild = readGuild(char) end)
    local json = buildJson(pos, items or {}, totalDistCm, stats or {}, guild)
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
