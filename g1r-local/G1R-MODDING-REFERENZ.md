# G1R Modding-Referenz (aus UE4SS Object-Dump)

Gothic 1 Remake ist Closed-Source-UE5. Die **einzige verlässliche „Doku"** sind die
UObject-Klassen/-Funktionen aus dem **UE4SS Object-Dump** — NICHT raten.

## Dump erzeugen / durchsuchen
- Im Spiel **Strg+Shift+J** (Hotkey im `G1RExport`-Mod) → schreibt `UE4SS_ObjectDump.txt`
  neben `…\G1R\Binaries\Win64\UE4SS.log`.
- Dump-Zeilenformat: `[addr] <Typ> /Script/<Modul>.<Klasse>:<Member> [...]`
  - `Class` = UClass, `Function` = UFunction, `…Property` = Feld/Parameter.
  - `:ReturnValue` an einer Function-Zeile zeigt den Rückgabetyp (z.B. `IntProperty`).
  - `BlueprintGeneratedClass /Game/...X_C` = die echte Runtime-Klasse (Suffix **`_C`**!).
- Suchen, statt zu raten:
  ```
  grep -aE "^\[.*\] Class /Script/G1R" UE4SS_ObjectDump.txt | grep -iE "save|profile|slot"
  grep -aE "Function /Script/G1R.<Klasse>:" UE4SS_ObjectDump.txt   # alle Methoden einer Klasse
  ```

## Zugriff aus UE4SS-Lua
- **Subsystem-Instanz holen:** `FindFirstOf("<KlasseOhne/Script/Modul>")` — z.B.
  `FindFirstOf("PersistentDataSubsystem")`. Liefert die laufende Instanz.
- **Blueprint-Klassen** brauchen das `_C`-Suffix: `FindFirstOf("GothicGameInstance_C")`
  (`FindFirstOf("GameInstance")`/`"GothicGameInstance"` trifft NICHT → war der nil-Fehler).
- **CharacterState/Pawn-Reader nur 1×/Tick aufrufen + cachen** — `BP_GetCharacterState`
  verträgt keine Mehrfachaufrufe pro Tick (sonst „entweder Guild ODER Weapon").

## Woher kommt welches Feld? (Mod-Output → UE-Quelle → Status)

| JSON-Feld | Quelle (UE-Klasse:Funktion / AttributeSet) | Status |
|---|---|---|
| `stats.level` / `xp` / `learnPts` | `AttributeSet_LevelProgression` (Level/Experience/SkillPoints) | ✅ |
| `stats.strength` | `AttributeSet_Strength.Strength` | ✅ |
| `stats.dexterity` | `AttributeSet_Dexterity.Dexterity` | ✅ |
| `stats.hp` / `hpMax` | `AttributeSet_Health.Health/MaxHealth` | ✅ |
| `stats.mana` / `manaMax` / `magicCircle` | `AttributeSet_Mana.Mana/MaxMana/MagicianLevel` | ✅ |
| `stats.resFire/Ice/Edge/Point/Blunt/Energy/Wind` | `AttributeSet_Armor.Resistance_*` | ✅ |
| `items[]` | `Pawn:GetInventory()` → InventoryBase: `ItemsNum()` / `GetItemNameByPos(i)` / `GetItemAmountByPos(i)` | ✅ |
| `guild` | `Pawn:BP_GetCharacterState()` → `GothicCharacterState:GetGuild()` (FGameplayTag) | ✅ |
| `clock` | `FindFirstOf("GameTimeSubsystem"):GetCurrentClockTime()` | ✅ |
| `attack` | `DataModule_Combat:GetCurrentAttackDirection` | ✅ |
| **`saveKey`** | `FindFirstOf("PersistentDataSubsystem"):GetCurrentProfileId()` → Int | ✅ (neu verdrahtet) |
| `session` / `totals` / `records` | im Mod aus Stat-Deltas berechnet (+ persistiert in `g1r-totals.json`) | ✅ |
| `strongestMelee/Ranged/Spell` | **Proxy `server.py`** aus `items` (Präfix `ItMw_`/`ItRw_` + `weapon_damage.json` + `magicCircle`) | ✅ (Proxy, nicht Mod) |
| `spell` (aktiver Zauber) | `MagicScriptLibrary:GetSpellConfigGivenACharacter` | ❌ **CRASHT** → `READ_SPELL=false` |
| `weapon` (Live-Waffe) | `DataModule_Combat:GetEquipedWeaponDefinition` | ❌ **CRASHT** → `READ_WEAPONS=false` |
| `kills` | `PuzzlesSubsystem:GetCreatureKillCounterMap` | ❌ liefert keine Daten → `READ_KILLS=false` |
| `damageDealt` (ausgeteilt) | Damage-Hook (Engine-Eingriff) | ❌ `READ_DMG_OUT=false` (in-game testen) |

**Heißt:** Stats, Inventar, Gilde, Uhr, Distanz/Steps, Session/Totals/Records (außer
ausgeteiltem Schaden), saveKey kommen. Aktiver Zauber + Live-Waffe + Kills + ausgeteilter
Schaden fehlen noch (Crash/keine Daten) — Kandidaten zum Nachschlagen im Dump:
alternative Kill-Zähler, ein nicht-crashender Waffen-Getter, Spell-API ohne Character-Param.

## Kernklassen

### GameInstance
- `/Script/G1R.G1RGameInstance` (C++), Runtime-BP **`GothicGameInstance_C`**
  (`/Game/GameFramework/GothicGameInstance.GothicGameInstance_C`).
- Methoden u.a.: `GetSettings`, `SaveSettings`, `GetInputMode`/`SetInputMode`,
  `SetQuickLoadAfterLoadMap`, `OnMainMapLoadedComplete…`.

### PersistentDataSubsystem  ← Save / Profil / Run
`/Script/G1R.PersistentDataSubsystem` (GameInstanceSubsystem, Parent
`ScriptGameInstanceSubsystem`). Zugriff: `FindFirstOf("PersistentDataSubsystem")`.
- **`GetCurrentProfileId()` → Int** — stabile Profil-/Run-ID = **`saveKey`** (Run-Erkennung).
- `GetCurrentProfile()` → Struct (volle Profildaten).
- `GetSavePublicName()` — Anzeigename des Spielstands.
- `GetMostRecentSave()` / `GetMostRecentSaveForProfile()` / `GetMostRecentPlayTime()`.
- `GetGameSave()` / `GetSharedSave()` — Savegame-Objekte.
- `GetProfiles()` / `HasProfile()` / `CheckIsPermaDeath()`.
- `BP_LoadOrCreateDataGame()` / `BP_LoadOrCreateSettings()`.

### Persistente Daten-Subsysteme (Parent `PersistentDataBaseSubsystem`)
- `CharacterStatePersistentDataSubsystem` — Charakter-State-Persistenz.
- `GameTimePersistentDataSubsystem` + `GameTimeSubsystem` — Spielzeit/Uhr.
- `CrimeMemoryPersistentDataSubsystem`, `LockPersistentDataSubsystem`.

### CharacterState (Stats, Gilde) — bereits genutzt
- Pawn → `BP_GetCharacterState()` (bzw. `.m_CharacterState`) → `GothicCharacterState`.
- `GetGuild()` → `FGameplayTag` (`.TagName:ToString()`); Enum `EPlayerGuild`
  0 None,1 Templars,2 Novices,3 MagesWater,4 Mercenaries,5 Rogues,6 MagesFire,7 Guards,8 Shadows.
- Stats via GAS: `/Script/G1R.AttributeSet_Mana` (Mana/MaxMana) etc.

### Weitere Save-bezogene Klassen (für später)
`GothicScreenshotsSave` (erbt `LocalPlayerSaveGame`, Feld `SaveSlotName`),
`SavedSlotInfo`, `ProfileSlotInfo`, `SavedGamesPageWidget`, `ProfileSelectionPageWidget`,
`GothicSavegameMigrationScript`, `SaveWorldActorInterface`.

## Engine-Basis (zum Vergleich)
- `/Script/Engine.SaveGame`, `/Script/Engine.LocalPlayerSaveGame` (`SaveSlotName`,
  `SavedDataVersion`), `/Script/Engine.GameInstance`, `…GameInstance.LocalPlayers`.
- Generisch (kein Spiel-Slot-Name!): `AsyncActionHandleSaveGame:AsyncSaveGameToSlot`
  (Param `SlotName`/`UserIndex`).
