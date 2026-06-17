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

-- Robuste TArray-Iteration: ForEach (UE4SS-nativ) bevorzugt, sonst Index-Loop.
local function arrForEach(arr, fn)
    if not arr then return end
    local okFE = pcall(function() arr:ForEach(function(i, elemWrap)
        local el = elemWrap; pcall(function() el = elemWrap:get() end)
        fn(i, el)
    end) end)
    if okFE then return end
    local n = 0; pcall(function() n = arr:GetArrayNum() end)
    if n == 0 then pcall(function() n = #arr end) end
    for i = 0, n - 1 do pcall(function() fn(i, arr[i]) end) end
end

local function readInventory(char)
    local items = {}
    local lib = getLib()
    if not (lib and isValid(lib)) then return items end

    local ok, container = pcall(function()
        return lib:GetContainerDataModule(char)
    end)
    if not (ok and isValid(container)) then return items end

    -- VirtualData für den MainContainer finden (Pattern aus mods-g1r inventory.lua):
    -- NICHT m_Values[INVENTORY_MAIN] (das ist der ENUM-Wert, kein Index!), sondern
    -- a) prüfen ob m_Values direkt m_Slots trägt, sonst
    -- b) in m_Keys den Index finden, wo key == INVENTORY_MAIN → m_Values[Index].
    local vd = nil
    pcall(function()
        local inv = container.m_Inventory
        local values = inv.m_Values
        local sok, s = pcall(function() return values.m_Slots end)
        if sok and s then vd = values; return end
        local keys = inv.m_Keys
        arrForEach(keys, function(idx, key)
            if vd then return end
            local kv = key
            if type(key) ~= "number" then pcall(function() kv = key.Value end) end
            if kv == INVENTORY_MAIN then
                pcall(function() vd = values[idx] end)
            end
        end)
    end)
    if not vd then return items end

    local slots = nil
    pcall(function() slots = vd.m_Slots end)
    if not slots then return items end

    arrForEach(slots, function(_, slot)
        pcall(function()
            local sd  = slot.m_SlotData
            local n   = sd.m_ItemCount or 0
            if n and n > 0 then
                local cls  = sd.m_ItemDefinition
                local full = cls and select(2, pcall(function() return cls:GetFullName() end))
                items[#items + 1] = { name = shortName(full), count = n }
            end
        end)
    end)
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
    -- Items vorerst DEAKTIVIERT: G1R-Inventar-Reflection (ScriptStruct m_Slots)
    -- braucht den vollen mods-g1r-Helper-Stack (UnwrapValue/GetArrayElement) bzw.
    -- den UI-Weg (GetItemNameByPos). readInventory() bleibt im File für später.
    -- Zum Reaktivieren: nächste Zeile durch
    --   pcall(function() items = readInventory(char) or {} end)
    -- ersetzen.
    items = {}
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
