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

-- ── JSON (minimal, nur für unsere Struktur) ─────────────────────────────────
local function jsonEsc(s)
    return (tostring(s):gsub('[\\"%z\1-\31]', function(c)
        return string.format('\\u%04x', string.byte(c))
    end):gsub('\\u0022', '\\"'):gsub('\\u005c', '\\\\'))
end

local function buildJson(pos, items)
    local parts = {}
    parts[#parts+1] = '"ok":true'
    if pos then
        parts[#parts+1] = string.format('"pos":{"x":%.1f,"y":%.1f,"z":%.1f}', pos.x, pos.y, pos.z)
    else
        parts[#parts+1] = '"pos":null'
    end
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
    local pos, items
    pcall(function() pos = readPosition(char) end)
    -- Items via vollständigem mods-g1r-Helper-Stack (unwrap/arrGet) — entpackt die
    -- RemoteUnrealParam-Wrapper, umgeht so den ScriptStruct-m_Slots-Stolperstein.
    pcall(function() items = readInventory(char) or {} end)
    local json = buildJson(pos, items or {})
    local f = io.open(OUTPUT_PATH, "w")
    if f then f:write(json); f:close() end
end

-- UE4SS-Loop: alle POLL_INTERVAL_MS einmal schreiben.
LoopAsync(POLL_INTERVAL_MS, function()
    pcall(tick)
    return false  -- nie stoppen
end)

print("[G1RExport] geladen — schreibt nach " .. OUTPUT_PATH .. "\n")
