import datetime
from pubg.db_pg import get_setting



# Battle-Royale-Modes — alles andere (TDM, War-Mode, Event-Modes, Labs,
# Esports) gilt als 'Event' und wird aus K/D / Win-Rate / Streak /
# Achievement-Detection ausgenommen. Allow-List: robust gegen neue
# Event-Modes die PUBG einfuehrt.
BATTLE_ROYALE_MODES = (
    "solo", "solo-fpp",
    "duo",  "duo-fpp",
    "squad","squad-fpp",
    "normal-solo", "normal-solo-fpp",
    "normal-duo",  "normal-duo-fpp",
    "normal-squad","normal-squad-fpp",
    "ranked-solo", "ranked-solo-fpp",
    "ranked-duo",  "ranked-duo-fpp",
    "ranked-squad","ranked-squad-fpp",
)
_BR_PLACEHOLDERS = ",".join("?" * len(BATTLE_ROYALE_MODES))

def _br_filter(alias="m"):
    """SQL-Fragment + Params um auf BR-Matches zu filtern.
    Beispiel: where, params = _br_filter('m')
              cursor.execute(f'... WHERE x AND {where}', [other_params, *params])"""
    return (f"{alias}.game_mode IN ({_BR_PLACEHOLDERS})",
            list(BATTLE_ROYALE_MODES))

def is_br_mode(game_mode):
    return game_mode in BATTLE_ROYALE_MODES


def _parse_iso(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _session_filter(conn, tenant_id: int):
    """Bestimmt den Session-Cutoff. Priorität:
    1. Wenn `sessionStartedAt` in settings explizit gesetzt → nimm den.
    2. Sonst auto-detect: gehe Match-Timestamps rückwärts durch.
       Erste Lücke > sessionGapHours (default 4h) zwischen zwei Matches
       → das ist der Session-Start.
    3. Wenn keine Lücke gefunden → alle Matches in DB sind eine Session."""
    started_at = get_setting(conn.raw, tenant_id, "sessionStartedAt")
    if started_at and started_at > "1970-01-02":
        return started_at

    gap_hours = float(get_setting(conn.raw, tenant_id, "sessionGapHours", "4"))
    rows = conn.execute(
        "SELECT played_at FROM matches WHERE tenant_id = ? ORDER BY played_at DESC LIMIT 200",
        (tenant_id,)
    ).fetchall()
    if not rows:
        return "1970-01-01T00:00:00Z"

    last_ts = None
    for r in rows:
        cur = _parse_iso(r["played_at"])
        if cur is None:
            continue
        if last_ts is not None:
            gap_secs = (last_ts - cur).total_seconds()
            if gap_secs > gap_hours * 3600:
                return last_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        last_ts = cur
    return rows[-1]["played_at"]


def _range_filter(conn, tenant_id: int, range_key):
    if range_key == "session":
        return _session_filter(conn, tenant_id)
    if range_key == "day":
        d = datetime.datetime.utcnow().strftime("%Y-%m-%dT00:00:00Z")
        return d
    if range_key == "week":
        d = (datetime.datetime.utcnow() - datetime.timedelta(days=7)) \
              .strftime("%Y-%m-%dT00:00:00Z")
        return d
    return "1970-01-01T00:00:00Z"


def compute_session_stats(conn, tenant_id: int, my_account_id: str,
                          range_key: str = "session") -> dict:
    if range_key == "session":
        started = _session_filter(conn, tenant_id)
        explicit = get_setting(conn.raw, tenant_id, "sessionStartedAt")
        session_mode = "manual" if (explicit and explicit > "1970-01-02") else "auto"
    else:
        started = _range_filter(conn, tenant_id, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
        session_mode = range_key
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.played_at,
               pa.kills, pa.damage_dealt, pa.place, pa.headshot_kills,
               pa.longest_kill, pa.boosts, pa.heals, pa.revives,
               pa.weapons_acquired, pa.walk_distance, pa.ride_distance,
               pa.swim_distance, pa.assists, pa.dbnos, pa.time_survived
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?
          AND {br_where}
        ORDER BY m.played_at ASC
    """, (tenant_id, my_account_id, started, *br_params)).fetchall()

    kills = sum(r["kills"] or 0 for r in rows)
    headshots = sum(r["headshot_kills"] or 0 for r in rows)
    damage = sum(r["damage_dealt"] or 0.0 for r in rows)
    wins = sum(1 for r in rows if (r["place"] or 99) == 1)
    top10s = sum(1 for r in rows if (r["place"] or 99) <= 10)
    best_place = min((r["place"] for r in rows if r["place"]), default=None)
    longest = max((r["longest_kill"] or 0.0 for r in rows), default=0.0)
    boosts = sum(r["boosts"] or 0 for r in rows)
    heals = sum(r["heals"] or 0 for r in rows)
    revives = sum(r["revives"] or 0 for r in rows)
    weapons = sum(r["weapons_acquired"] or 0 for r in rows)
    walk_m = sum(r["walk_distance"] or 0.0 for r in rows)
    ride_m = sum(r["ride_distance"] or 0.0 for r in rows)
    swim_m = sum(r["swim_distance"] or 0.0 for r in rows)
    assists = sum(r["assists"] or 0 for r in rows)
    dbnos = sum(r["dbnos"] or 0 for r in rows)
    survived_sec = sum(r["time_survived"] or 0 for r in rows)

    map_breakdown = {}
    for r in rows:
        m = r["map_name"]
        map_breakdown[m] = map_breakdown.get(m, 0) + 1

    return {
        "matches": len(rows),
        "kills": kills,
        "damage": damage,
        "wins": wins,
        "top10s": top10s,
        "kd": kills / max(len(rows) - wins, 1),
        "kpm": kills / max(len(rows), 1),
        "headshotPct": (headshots / kills * 100) if kills else 0,
        "bestPlace": best_place,
        "longestKill": longest,
        "totalBoosts": boosts,
        "totalHeals": heals,
        "totalRevives": revives,
        "totalWeaponsAcquired": weapons,
        "totalAssists": assists,
        "totalDbnos": dbnos,
        "totalSurvivedSec": survived_sec,
        "walkKm": walk_m / 1000.0,
        "rideKm": ride_m / 1000.0,
        "swimKm": swim_m / 1000.0,
        "sessionStartedAt": started,
        "sessionMode": session_mode,  # "manual" oder "auto"
        "mapBreakdown": [{"map": m, "count": c}
                         for m, c in sorted(map_breakdown.items(),
                                            key=lambda x: -x[1])],
    }


def compute_last_match(conn, tenant_id: int, my_account_id: str):
    row = conn.execute("""
        SELECT m.* FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ?
        ORDER BY m.played_at DESC LIMIT 1
    """, (tenant_id, my_account_id,)).fetchone()
    if not row:
        return None
    parts = conn.execute(
        "SELECT * FROM participants WHERE tenant_id = ? AND match_id = ?",
        (tenant_id, row["match_id"],)
    ).fetchall()
    me = next((p for p in parts if p["account_id"] == my_account_id), None)
    mates = [p for p in parts if p["account_id"] != my_account_id]
    return {
        "matchId": row["match_id"],
        "map": row["map_name"],
        "mode": row["game_mode"],
        "place": me["place"] if me else None,
        "durationSec": row["duration_secs"],
        "playedAt": row["played_at"],
        "myStats": dict(me) if me else None,
        "mates": [{"name": p["name"], "accountId": p["account_id"],
                   "stats": dict(p)} for p in mates],
    }


SORT_KEYS = {
    "avgPlace":          "avg_place ASC",
    "kd":                "kd DESC",                # meine K/D in gemeinsamen Matches
    "mateKd":            "mate_kd DESC",           # K/D des Mates
    "winRate":           "win_rate DESC",
    "mostPlayed":        "shared DESC",
    # Most Chicken: absolute Win-Anzahl primär, bei Gleichstand höhere
    # Win-Rate vor (mehr Effizienz pro Match besser als reine Match-Anzahl)
    "chickensTogether":  "wins DESC, win_rate DESC, shared DESC",
    # Composite — sortBy "synergy": KDA-Fokus, Win-Rate gewichtet, log(matches)
    # für Stabilität (1-Match-Glück bekommt nicht die Top-Position).
    # SQL macht das gleiche wie der Python-key in compute_top_mates Postprocess:
    "synergy":           "((kd + mate_kd)/2) * (1.0 + win_rate/100.0) DESC, shared DESC",
}


def _invert_order(order: str) -> str:
    """Invertiert ASC/DESC in einer ORDER BY-Klausel (Komma-getrennt).
    Wird fuer 'anti-mates' verwendet — dieselbe Sort-Logik, aber
    schlechteste zuerst."""
    out = []
    for term in order.split(","):
        t = term.strip()
        if t.upper().endswith(" DESC"):
            out.append(t[:-5] + " ASC")
        elif t.upper().endswith(" ASC"):
            out.append(t[:-4] + " DESC")
        else:
            out.append(t + " DESC")
    return ", ".join(out)


def compute_top_mates(conn, tenant_id: int, my_account_id: str,
                      sort_by: str = "avgPlace",
                      limit: int = 5,
                      min_matches: int = 10,
                      range_key: str = None,
                      worst: bool = False) -> list:
    """range_key: None=alle DB-Matches; 'session'/'day'/'week' filtert.
    worst=True kehrt die Sort-Reihenfolge um (= Anti-Mates: schlechteste
    zuerst)."""
    order = SORT_KEYS.get(sort_by, SORT_KEYS["avgPlace"])
    if worst:
        order = _invert_order(order)
    if range_key:
        cutoff = _range_filter(conn, tenant_id, range_key)
        params = (my_account_id, cutoff, tenant_id, my_account_id, min_matches, limit)
        match_filter = "JOIN matches m ON m.match_id = mate.match_id AND m.tenant_id = mate.tenant_id AND m.played_at >= ?"
    else:
        params = (my_account_id, tenant_id, my_account_id, min_matches, limit)
        match_filter = ""
    rows = conn.execute(f"""
        WITH co AS (
            SELECT mate.account_id, mate.name, mate.match_id, mate.place,
                   me.kills AS my_kills, me.damage_dealt AS my_dmg,
                   mate.kills AS mate_kills, mate.damage_dealt AS mate_dmg
            FROM participants mate
            JOIN participants me ON me.match_id = mate.match_id AND me.tenant_id = mate.tenant_id AND me.account_id = ?
            {match_filter}
            WHERE mate.tenant_id = ? AND mate.account_id != ?
        )
        SELECT account_id, name,
               COUNT(*) AS shared,
               AVG(place) AS avg_place,
               SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS wins,
               (CAST(SUM(my_kills) AS REAL) / GREATEST(COUNT(*) - SUM(CASE WHEN place=1 THEN 1 ELSE 0 END), 1)) AS kd,
               (CAST(SUM(mate_kills) AS REAL) / GREATEST(COUNT(*) - SUM(CASE WHEN place=1 THEN 1 ELSE 0 END), 1)) AS mate_kd,
               AVG(my_dmg) AS avg_dmg,
               AVG(mate_dmg) AS mate_avg_dmg,
               (CAST(SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS win_rate
        FROM co
        GROUP BY account_id, name
        HAVING COUNT(*) >= ?
        ORDER BY {order}
        LIMIT ?
    """, params).fetchall()

    out = []
    for r in rows:
        my_kd = r["kd"] or 0
        mate_kd = r["mate_kd"] or 0
        win_rate = r["win_rate"] or 0
        # Synergy = Team-KDA × Win-Rate-Bonus.
        # KEIN Stability-Faktor — der minMatches-Filter kümmert sich um
        # Glücks-Stats. Konsistent mit SQL-Sort und anderen Widgets.
        synergy = ((my_kd + mate_kd) / 2.0) * (1.0 + win_rate / 100.0)
        out.append({
            "accountId":       r["account_id"],
            "name":            r["name"],
            "sharedMatches":   r["shared"],
            "winsTogether":    r["wins"],
            "avgPlace":        r["avg_place"],
            "kd":              my_kd,
            "mateKd":          mate_kd,
            "teamKd":          (my_kd + mate_kd) / 2.0,
            "avgDmg":          r["avg_dmg"],
            "mateAvgDmg":      r["mate_avg_dmg"],
            "winRate":         win_rate,
            "synergyScore":    synergy,
        })
    return out


# PUBG Weapon-ID → (Pretty-Name, Category). Kategorie steuert
# Filterung im Widget. Roadkills/Throwables stehen unter eigenen
# Kategorien (kein klassischer 'Waffen-Skill').
WEAPON_NAMES = {
    # Quelle: github.com/pubg/api-assets damageCauserName.json
    # Assault Rifles
    "WeapHK416_C":          ("M416",        "ar"),
    "WeapDuncansHK416_C":   ("M416",        "ar"),  # Marketplace-Skin
    "WeapBerylM762_C":      ("Beryl",       "ar"),
    "WeapAK47_C":           ("AKM",         "ar"),
    "WeapSCAR-L_C":         ("SCAR-L",      "ar"),
    "WeapAUG_C":            ("AUG A3",      "ar"),
    "WeapM16A4_C":          ("M16A4",       "ar"),
    "WeapG36C_C":           ("G36C",        "ar"),
    "WeapGroza_C":          ("Groza",       "ar"),
    "WeapMk47Mutant_C":     ("Mk47 Mutant", "ar"),
    "WeapACE32_C":          ("ACE32",       "ar"),
    "WeapFamasG2_C":        ("FAMAS",       "ar"),
    "WeapK2_C":             ("K2",          "ar"),
    "WeapQBZ95_C":          ("QBZ95",       "ar"),
    # DMRs
    "WeapMini14_C":         ("Mini 14",     "dmr"),
    "WeapMk12_C":           ("Mk12",        "dmr"),
    "WeapMk14_C":           ("Mk14 EBR",    "dmr"),
    "WeapSKS_C":            ("SKS",         "dmr"),
    "WeapDragunov_C":       ("Dragunov",    "dmr"),
    "WeapQBU88_C":          ("QBU88",       "dmr"),
    "WeapVSS_C":            ("VSS",         "dmr"),
    "WeapFNFal_C":          ("SLR",         "dmr"),
    # Snipers
    "WeapKar98k_C":         ("Kar98k",      "sniper"),
    "WeapJuliesKar98k_C":   ("Kar98k",      "sniper"),  # Marketplace-Skin
    "WeapM24_C":            ("M24",         "sniper"),
    "WeapAWM_C":            ("AWM",         "sniper"),
    "WeapMosinNagant_C":    ("Mosin-Nagant","sniper"),
    "WeapWin94_C":          ("Win94",       "sniper"),
    "WeapL6_C":             ("Lynx AMR",    "sniper"),
    # SMGs
    "WeapMP5K_C":           ("MP5K",        "smg"),
    "WeapUMP_C":            ("UMP45",       "smg"),
    "WeapVector_C":         ("Vector",      "smg"),
    "WeapUZI_C":            ("Micro Uzi",   "smg"),
    "WeapThompson_C":       ("Tommy Gun",   "smg"),
    "WeapP90_C":            ("P90",         "smg"),
    "WeapJS9_C":            ("JS9",         "smg"),
    "WeapMP9_C":            ("MP9",         "smg"),
    "WeapBizonPP19_C":      ("Bizon",       "smg"),
    "Weapvz61Skorpion_C":   ("Skorpion",    "smg"),
    # Shotguns
    "WeapDP12_C":           ("DBS",         "shotgun"),
    "WeapSaiga12_C":        ("S12K",        "shotgun"),
    "WeapOriginS12_C":      ("O12",         "shotgun"),
    "WeapBerreta686_C":     ("S686",        "shotgun"),
    "WeapSawnoff_C":        ("Sawed-off",   "shotgun"),
    "WeapWinchester_C":     ("S1897",       "shotgun"),
    # LMGs
    "WeapM249_C":           ("M249",        "lmg"),
    "WeapMG3_C":            ("MG3",         "lmg"),
    "WeapDP28_C":           ("DP-28",       "lmg"),
    # Pistols
    "WeapM1911_C":          ("P1911",       "pistol"),
    "WeapM9_C":             ("P92",         "pistol"),
    "WeapG18_C":            ("P18C",        "pistol"),
    "WeapDesertEagle_C":    ("Deagle",      "pistol"),
    "WeapRhino_C":          ("R45",         "pistol"),
    "WeapNagantM1895_C":    ("R1895",       "pistol"),
    # Throwables
    "ProjGrenade_C":              ("Granate",      "throwable"),
    "ProjMolotov_C":              ("Molotov",      "throwable"),
    "ProjStickyGrenade_C":        ("Klebebombe",   "throwable"),
    "ProjC4_C":                   ("C4",           "throwable"),
    "PanzerFaust100M_Projectile_C": ("Panzerfaust","throwable"),
    "Mortar_Projectile_C":        ("Moerser",      "throwable"),
    # Melee
    "WeapCowbar_C":            ("Brechstange",   "melee"),
    "WeapMachete_C":           ("Machete",       "melee"),
    "WeapMacheteProjectile_C": ("Machete (Wurf)","melee"),
    "WeapPan_C":               ("Pfanne",        "melee"),
    "WeapPanProjectile_C":     ("Pfanne (Wurf)", "melee"),
    "WeapSickle_C":            ("Sichel",        "melee"),
    "WeapSickleProjectile_C":  ("Sichel (Wurf)", "melee"),
    "WeapPickaxeProjectile_C": ("Spitzhacke (Wurf)","melee"),
    "WeapCrossbow_1_C":        ("Armbrust",      "other"),
}


# Vehicle-Pattern → Klartext-Name. Mehrere Skins/Varianten desselben
# Modells werden zusammengefasst (Mirado_A_02 / Mirado_A_03_Esports / ...
# alle → 'Mirado').
_VEHICLE_PATTERNS = [
    ("Mirado",        "Mirado"),
    ("PickupTruck",   "Pickup Truck"),
    ("Motorbike",     "Motorbike"),
    ("Dacia",         "Dacia"),
    ("Uaz",           "UAZ"),
    ("Niva",          "Niva"),
    ("BearV2",        "Bear"),
    ("Bear",          "Bear"),
    ("PonyCoupe",     "Pony Coupe"),
    ("CoupeRB",       "Coupe RB"),
    ("Blanc",         "Blanc"),
    ("PicoBus",       "Pico Bus"),
    ("Van_",          "Van"),
    ("BRDM",          "BRDM"),
    ("Pillar_Car",    "Pillar Car"),
    ("Buggy",         "Buggy"),
    ("Boat",          "Aquarail"),
    ("Snowmobile",    "Snowmobile"),
    ("Tukshai",       "Tukshai"),
    ("Lava_Mtb",      "Mountain Bike"),
    ("Scooter",       "Scooter"),
]

# Environment / Misc — Brand/Bombe/Care-Package-Drop etc.
_ENVIR_NAMES = {
    "BP_Baltic_GasPump_C":          "Gas Pump (Boom)",
    "BP_CarePackageDrop_nonDest_C": "Care Package",
    "BP_FireEffectController_C":    "Fire",
    "BP_MolotovFireDebuff_C":       "Molotov Fire",
    "Bluezonebomb_EffectActor_C":   "Red Zone",
    "Jerrycan":                     "Jerry Can (Boom)",
    "JerrycanFire":                 "Jerry Can (Fire)",
    # PUBG-System-Actor (kein echter Spieler):
    # TslGameModeBase = Game-Mode-System (meistens Blue Zone-Damage
    # waehrend DBNO, fallschaden in der Zone, etc.)
    "TslGameModeBase_BattleRoyaleBP_C":           "Blue Zone",
    "RedZoneBombingField_Def_C":                  "Red Zone Bomb",
    "RedZoneBombingField_Savage_C":               "Red Zone Bomb",
    "BP_VK_Train_A_B_C":                          "Train",
    "Buff_DecreaseBreathInApnea_C":               "Drowning",
    # BlueChip-Carepackage-Drop (faellt auf Spieler) — verschiedene Map-Varianten
    "BP_CarePackageDrop_Bluechip_C":              "BlueChip Care Package",
    "BP_CarePackageDrop_Bluechip_DihorOtok_C":    "BlueChip Care Package",
    "BP_CarePackageDrop_Bluechip_Neon_C":         "BlueChip Care Package",
}


def _death_cause_label(death_ev, victim_acc, weapon_id, weapon_name,
                         ev_rows=None):
    """Liefert eine lesbare Todesursache wenn der Tod NICHT durch einen
    Gegner kam (Vehicle-Eject, Fall, Zone, Ertrinken etc.). Sonst None
    — dann nutzt das Frontend die Standard 'durch <killer> mit <weapon>'.

    Special-Case: Wenn das Kill-Event KEINE weapon und KEINEN attacker hat
    (PUBG-Telemetrie bei 'sprang aus fahrendem Auto'), schauen wir in
    ev_rows nach einem VehicleLeave-Event des Opfers innerhalb 5 s vor
    dem Tod — Indikator fuer Auto-Ausstieg.
    """
    actor = death_ev.get("actor_account")
    is_self = (actor == victim_acc)
    is_no_attacker = (actor is None or actor == "")

    # 1. Weapon-less + actor-less Kill → meist Vehicle-Eject
    if not weapon_id and is_no_attacker and ev_rows is not None:
        death_ts = death_ev.get("timestamp_ms") or 0
        for e in ev_rows:
            if e["event_type"] != "VehicleLeave": continue
            if e["actor_account"] != victim_acc: continue
            ets = e["timestamp_ms"] or 0
            if 0 < (death_ts - ets) < 5000:  # innerhalb 5 s vor Tod
                return "aus Fahrzeug gesprungen"
        return "unbekannter Selbsttod"

    if not weapon_id:
        return None
    wid = weapon_id

    # Mesh-Self-Damage → Ragdoll (z.B. Fall aus Auto, weapon=PlayerFemale_A_C)
    if is_self and wid in ("PlayerFemale_A_C", "PlayerMale_A_C"):
        if ev_rows is not None:
            death_ts = death_ev.get("timestamp_ms") or 0
            for e in ev_rows:
                if e["event_type"] != "VehicleLeave": continue
                if e["actor_account"] != victim_acc: continue
                ets = e["timestamp_ms"] or 0
                if 0 < (death_ts - ets) < 5000:
                    return "aus Fahrzeug gesprungen"
        return "Sturz"

    # Ragdoll-Sprung (direkt vom Weapon-Field)
    if "RagdollPhysics" in wid or "Damage_HelpMeGroundFall" in wid:
        return "aus Fahrzeug gesprungen" if is_self else "Ragdoll-Impact"
    # Fall-Damage
    if "Damage_Falling" in wid or "Damage_Instant_Fall" in wid:
        return "Sturz"
    # Zone
    if "BattleRoyaleModeController" in wid:
        return "Blue Zone"
    if "Bluezonebomb" in wid:
        return "Red Zone"
    # Ertrinken
    if "DecreaseBreathInApnea" in wid or "Drown" in wid:
        return "ertrunken"
    # Vehicle-Crash als Selbst-Kill (Spieler hat eigenes Auto geschrottet)
    if is_self:
        for needle, label in _VEHICLE_PATTERNS:
            if needle in wid:
                return f"Selbst-Crash ({label})"
        return "Selbsttod"
    return None


def _weapon_label(weapon_id):
    if not weapon_id or weapon_id == "None":
        return ("Unknown", "other")
    # Punch / Melee mit Faust — PUBG kodiert das ueber den Player-Mesh
    if weapon_id in ("PlayerFemale_A_C", "PlayerMale_A_C"):
        return ("Faust", "melee")
    # Explizite Lookups zuerst
    if weapon_id in WEAPON_NAMES:
        return WEAPON_NAMES[weapon_id]
    if weapon_id in _ENVIR_NAMES:
        return (_ENVIR_NAMES[weapon_id], "envir")
    # Vehicle-Pattern matchen — fasst Skin-Varianten zusammen
    for needle, label in _VEHICLE_PATTERNS:
        if needle in weapon_id:
            return (label, "vehicle")
    # Letzter Fallback — Raw, aber sauber gestripped (nicht naiv mit
    # global-replace, das zerlegt 'BP_Pillar_Car_C' zu 'BParillarar')
    raw = weapon_id
    if raw.endswith("_C"):
        raw = raw[:-2]
    if raw.startswith("BP_"):
        raw = raw[3:]
    if raw.startswith("Weap"):
        raw = raw[4:]
    return (raw.replace("_", " "), "other")


def compute_weapon_stats(conn, tenant_id: int, my_account_id, range_key="session",
                          from_iso=None, to_iso=None, actor_account=None):
    """Pro Waffe Kill-Count + Ø/Max-Distanz + Anzahl Matches mit Kills
    + Kills-pro-Match. Default fuer my_account_id (= self), via
    actor_account kann ein beliebiger Squad-Mate adressiert werden
    (Telemetrie-Events fuer Squad-Member sind in der DB).

    Distance in der DB ist cm — wir liefern Meter zurueck.
    Range-aware: session/day/week/all + explizite from/to ISO.
    """
    actor = actor_account or my_account_id
    if from_iso:
        cutoff = from_iso
        end_filter = " AND m.played_at <= ?" if to_iso else ""
        params = [tenant_id, actor, cutoff]
        if to_iso:
            params.append(to_iso)
    else:
        cutoff = (_range_filter(conn, tenant_id, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        end_filter = ""
        params = [tenant_id, actor, cutoff]
    br_sql, br_params = _br_filter("m")
    params += br_params

    rows = conn.execute(f"""
        SELECT te.weapon AS weapon,
               COUNT(*) AS kills,
               AVG(te.distance) AS avg_dist_cm,
               MAX(te.distance) AS max_dist_cm,
               COUNT(DISTINCT te.match_id) AS used_matches
        FROM telemetry_events te
        JOIN matches m ON m.match_id = te.match_id AND m.tenant_id = ?
        WHERE te.event_type = 'Kill'
          AND te.actor_account = ?
          AND m.played_at >= ?{end_filter}
          AND {br_sql}
        GROUP BY te.weapon
    """, params).fetchall()

    out = []
    for r in rows:
        wid = r["weapon"]
        name, cat = _weapon_label(wid)
        avg_m = (r["avg_dist_cm"] or 0) / 100.0
        max_m = (r["max_dist_cm"] or 0) / 100.0
        out.append({
            "weaponId":   wid or "",
            "name":       name,
            "category":   cat,
            "kills":      r["kills"] or 0,
            "avgDist":    round(avg_m, 1),
            "maxDist":    round(max_m, 1),
            "usedInMatches": r["used_matches"] or 0,
            "killsPerMatch": round(
                (r["kills"] or 0) / max(r["used_matches"] or 1, 1), 2),
        })
    out.sort(key=lambda w: -w["kills"])
    return out


def _compute_player_vehicle_evictions(conn, tenant_id: int, account_id, match_ids):
    """Wie oft hat dieser Spieler andere 'rausgeschossen' und wie oft
    wurde er selbst rausgeschossen — ueber die gegebenen Matches.

    'Rausgeschossen' = Gegner im Vehicle eliminiert. Konkret:
       Kill-Event mit target=Gegner UND Gegner im Vehicle zum
       Zeitpunkt des Kills. Plus Knock-Event mit target=Gegner im
       Vehicle, danach Tod ohne Revive (geknockt → rausgeflogen → tot).

    Returns (dealt, taken).
    """
    if not match_ids:
        return (0, 0)
    ph = ",".join("?" * len(match_ids))
    rows = conn.execute(f"""
        SELECT match_id, event_type, timestamp_ms,
               actor_account, target_account
        FROM telemetry_events
        WHERE match_id IN ({ph})
          AND event_type IN ('VehicleEnter','VehicleLeave',
                              'Knock','Kill','Revive')
        ORDER BY match_id, timestamp_ms ASC
    """, [tenant_id] + list(match_ids)).fetchall()
    if not rows:
        return (0, 0)

    INF = 10**15
    # Pro Match die Events sammeln + Vehicle-Intervalle pro betroffenem
    # Account aufbauen — wir wissen nicht im Voraus welche Accounts es
    # sind, deshalb on-demand.
    by_match = {}
    for r in rows:
        by_match.setdefault(r["match_id"], []).append({
            "type": r["event_type"], "ts": r["timestamp_ms"],
            "actor": r["actor_account"], "target": r["target_account"],
        })

    dealt = taken = 0
    for mid, events in by_match.items():
        # Vehicle-Intervalle: nur fuer Accounts die wir brauchen — als
        # actor (fuer self-im-vehicle als victim) und als target von
        # diesem player (fuer Gegner-im-vehicle als victim).
        intervals_self = []
        intervals_targets = {}  # other_account_id -> list
        cur = None
        for e in events:
            if e["actor"] == account_id:
                if e["type"] == "VehicleEnter":
                    cur = e["ts"]
                elif e["type"] == "VehicleLeave" and cur is not None:
                    intervals_self.append((cur, e["ts"]))
                    cur = None
        if cur is not None:
            intervals_self.append((cur, INF))
        # Targets (Gegner): iteriere ueber alle distinct accounts die
        # mal ein VehicleEnter haben — nur die brauchen wir fuer dealt.
        for e in events:
            if e["type"] != "VehicleEnter" or not e["actor"]:
                continue
            if e["actor"] == account_id or e["actor"] in intervals_targets:
                continue
            cur2 = None
            ivals = []
            for ev in events:
                if ev["actor"] != e["actor"]:
                    continue
                if ev["type"] == "VehicleEnter":
                    cur2 = ev["ts"]
                elif ev["type"] == "VehicleLeave" and cur2 is not None:
                    ivals.append((cur2, ev["ts"]))
                    cur2 = None
            if cur2 is not None:
                ivals.append((cur2, INF))
            intervals_targets[e["actor"]] = ivals

        def _in(ts, ivals):
            return any(a <= ts <= b for a, b in ivals) if ts is not None else False

        for e in events:
            t  = e["type"]; ts = e["ts"]
            a  = e["actor"]; v = e["target"]
            if t == "Kill" and a == account_id and v:
                if _in(ts, intervals_targets.get(v, [])):
                    dealt += 1
            elif t == "Kill" and v == account_id:
                if _in(ts, intervals_self):
                    taken += 1
            elif t == "Knock":
                # Knock-then-died-Pfad: zaehlt wenn das Knock im Vehicle
                # passierte UND spaeter ein Kill ohne Revive folgt.
                if a == account_id and v and _in(ts, intervals_targets.get(v, [])):
                    revived = died = False
                    for later in events:
                        if later["ts"] is None or later["ts"] <= ts:
                            continue
                        if later["type"] == "Revive" and later["target"] == v:
                            revived = True; break
                        if later["type"] == "Kill" and later["target"] == v:
                            died = True; break
                    if died and not revived:
                        # War schon ein Kill-Event mit Vehicle-Match —
                        # zaehlen wir nicht doppelt. Pruefen ob das Kill
                        # ebenfalls im Vehicle war.
                        kill_in_veh = False
                        for later in events:
                            if (later["type"] == "Kill" and later["target"] == v
                                    and later["ts"] and later["ts"] > ts):
                                kill_in_veh = _in(later["ts"], intervals_targets.get(v, []))
                                break
                        if not kill_in_veh:
                            dealt += 1
                elif v == account_id and _in(ts, intervals_self):
                    revived = died = False
                    for later in events:
                        if later["ts"] is None or later["ts"] <= ts:
                            continue
                        if later["type"] == "Revive" and later["target"] == account_id:
                            revived = True; break
                        if later["type"] == "Kill" and later["target"] == account_id:
                            died = True; break
                    if died and not revived:
                        kill_in_veh = False
                        for later in events:
                            if (later["type"] == "Kill" and later["target"] == account_id
                                    and later["ts"] and later["ts"] > ts):
                                kill_in_veh = _in(later["ts"], intervals_self)
                                break
                        if not kill_in_veh:
                            taken += 1
    return (dealt, taken)


def compute_co_player(conn, tenant_id: int, my_account_id: str, name_or_id: str) -> dict:
    p = conn.execute("""
        SELECT * FROM players WHERE tenant_id = ? AND (name = ? OR account_id = ?) LIMIT 1
    """, (tenant_id, name_or_id, name_or_id)).fetchone()
    if not p:
        return {"error": "player not found"}

    self_row = conn.execute(
        "SELECT name FROM players WHERE tenant_id = ? AND account_id = ? LIMIT 1",
        (tenant_id, my_account_id,)
    ).fetchone()
    my_name = self_row["name"] if self_row else "Self"

    if p["account_id"] == my_account_id:
        lifetime = conn.execute(
            "SELECT * FROM player_lifetime "
            "WHERE tenant_id = ? AND account_id = ? AND mode = 'all'",
            (tenant_id, my_account_id,)
        ).fetchone()
        return {
            "name": p["name"],
            "myName": my_name,
            "accountId": p["account_id"],
            "isSelf": True,
            "sharedHistory": None,
            "careerLifetime": dict(lifetime) if lifetime else None,
        }

    shared = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at, mate.place,
               mate.kills AS mate_kills, mate.damage_dealt AS mate_damage,
               me.kills   AS my_kills,   me.damage_dealt   AS my_damage
        FROM matches m
        JOIN participants mate ON mate.match_id = m.match_id AND mate.tenant_id = m.tenant_id
        JOIN participants me ON me.match_id = m.match_id AND me.tenant_id = m.tenant_id AND me.account_id = ?
        WHERE m.tenant_id = ? AND mate.account_id = ?
        ORDER BY m.played_at DESC
    """, (my_account_id, tenant_id, p["account_id"])).fetchall()

    # Vehicle-Eviction-Counter ueber die geteilten Matches:
    #   dealt — Kills die DIESER Spieler an Gegnern im Vehicle verursacht hat
    #   taken — Kills/Knock-Death die DIESER Spieler im Vehicle erlitten hat
    # Nur valide wenn Telemetrie da ist (Squad-Member werden gefiltert).
    shared_match_ids = [r["match_id"] for r in shared] if shared else []
    evict_dealt = evict_taken = 0
    if shared_match_ids:
        try:
            evict_dealt, evict_taken = _compute_player_vehicle_evictions(
                conn, tenant_id, p["account_id"], shared_match_ids)
        except Exception:
            evict_dealt = evict_taken = 0

    if not shared:
        history = {"matches": 0}
    else:
        n = len(shared)
        wins = sum(1 for r in shared if (r["place"] or 99) == 1)
        my_kills = sum(r["my_kills"] or 0 for r in shared)
        mate_kills = sum(r["mate_kills"] or 0 for r in shared)
        my_avg_dmg = sum(r["my_damage"] or 0.0 for r in shared) / n
        mate_avg_dmg = sum(r["mate_damage"] or 0.0 for r in shared) / n
        avg_place = sum(r["place"] for r in shared if r["place"]) / n
        deaths = max(n - wins, 1)
        map_dist = {}
        for r in shared:
            map_dist[r["map_name"]] = map_dist.get(r["map_name"], 0) + 1
        history = {
            "matches": n,
            "kd": my_kills / deaths,           # MEINE K/D in shared matches
            "mateKd": mate_kills / deaths,     # MATE-K/D in shared matches
            "avgDmg": my_avg_dmg,              # MEINER avg dmg
            "mateAvgDmg": mate_avg_dmg,        # MATE avg dmg
            "avgPlace": avg_place,
            "winRate": (wins / n) * 100,
            "wins": wins,
            "mapDistribution": [{"map": m, "count": c}
                                for m, c in sorted(map_dist.items(),
                                                    key=lambda x: -x[1])],
            "last5Matches": [{
                "matchId": r["match_id"], "map": r["map_name"],
                "playedAt": r["played_at"], "place": r["place"],
                "kills": r["mate_kills"],     # Mate kills im Match
                "damage": r["mate_damage"],
                "myKills": r["my_kills"],
                "myDamage": r["my_damage"],
            } for r in shared[:5]],
            "vehicleEvictionsDealt": evict_dealt,  # andere im Auto rausgeschossen
            "vehicleEvictionsTaken": evict_taken,  # selbst im Auto rausgeflogen
        }

    lifetime = conn.execute(
        "SELECT * FROM player_lifetime "
        "WHERE tenant_id = ? AND account_id = ? AND mode = 'all'",
        (tenant_id, p["account_id"],)
    ).fetchone()

    # Same-Lobby-Different-Team-Stat: Matches in denen wir BEIDE in der
    # Lobby waren (laut match_team_mapping), aber NICHT im selben Squad.
    # Setzt voraus dass match_team_mapping befüllt ist (match_schema=2).
    same_lobby = conn.execute("""
        SELECT COUNT(DISTINCT mtm_them.match_id) AS lobby_matches
        FROM match_team_mapping mtm_me
        JOIN match_team_mapping mtm_them
          ON mtm_them.match_id = mtm_me.match_id AND mtm_them.tenant_id = mtm_me.tenant_id
        WHERE mtm_me.tenant_id = ? AND mtm_me.account_id = ?
          AND mtm_them.account_id = ?
          AND mtm_me.team_id != mtm_them.team_id
    """, (tenant_id, my_account_id, p["account_id"])).fetchone()
    lobby_only = (same_lobby["lobby_matches"] or 0) if same_lobby else 0

    return {
        "name": p["name"],
        "myName": my_name,
        "accountId": p["account_id"],
        "sharedHistory": history,
        "careerLifetime": dict(lifetime) if lifetime else None,
        "lobbyOnlyMatches": lobby_only,  # gleiche Lobby, anderes Team
    }


def compute_mates(conn, tenant_id: int, my_account_id: str,
                        range_key: str = "session",
                        min_matches: int = 1,
                        min_total: int = 1) -> list:
    """Mates aktiv im range.
    - min_matches: Mindest-Anzahl Matches IN DER RANGE (z.B. ≥3 in der Woche)
    - min_total:   Mindest-Anzahl Matches LIFETIME (Random-Squad rausfiltern)
    """
    cutoff = _range_filter(conn, tenant_id, range_key)
    rows = conn.execute("""
        SELECT mate.account_id, mate.name,
               COUNT(*) AS shared,
               AVG(mate.kills) AS kills_avg,
               SUM(mate.kills) AS kills_total,
               SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) AS wins_total,
               AVG(mate.damage_dealt) AS dmg_avg,
               (SELECT COUNT(*) FROM participants p2
                JOIN participants me2 ON me2.match_id = p2.match_id AND me2.tenant_id = p2.tenant_id
                WHERE p2.tenant_id = ? AND p2.account_id = mate.account_id AND me2.account_id = ?) AS total_with_me
        FROM participants mate
        JOIN participants me ON me.match_id = mate.match_id AND me.tenant_id = mate.tenant_id AND me.account_id = ?
        JOIN matches m ON m.match_id = mate.match_id AND m.tenant_id = mate.tenant_id
        WHERE mate.tenant_id = ? AND mate.account_id != ? AND m.played_at >= ?
        GROUP BY mate.account_id, mate.name
        HAVING COUNT(*) >= ? AND
               (SELECT COUNT(*) FROM participants p2
                JOIN participants me2 ON me2.match_id = p2.match_id AND me2.tenant_id = p2.tenant_id
                WHERE p2.tenant_id = ? AND p2.account_id = mate.account_id AND me2.account_id = ?) >= ?
        ORDER BY shared DESC
    """, (tenant_id, my_account_id, my_account_id,
          tenant_id, my_account_id, cutoff,
          min_matches,
          tenant_id, my_account_id, min_total)).fetchall()

    out = []
    for r in rows:
        lt = conn.execute(
            "SELECT * FROM player_lifetime "
            "WHERE tenant_id = ? AND account_id = ? AND mode = 'all'",
            (tenant_id, r["account_id"],)).fetchone()
        # K/D = kills / deaths, mit deaths = matches - wins (in BR stirbt
        # man immer ausser bei place=1). Frueher war hier kills/matches,
        # was K/M ist - daher die Abweichung zum chat-stats-popup, das
        # in compute_co_player mit deaths-basierter K/D rechnet.
        deaths = max((r["shared"] or 0) - (r["wins_total"] or 0), 1)
        out.append({
            "accountId": r["account_id"],
            "name": r["name"],
            "sharedMatchesToday": r["shared"],
            "totalWithMe": r["total_with_me"],
            "kdToday": (r["kills_total"] or 0) / deaths,
            "dmgToday": r["dmg_avg"],
            "careerLifetime": dict(lt) if lt else None,
        })
    return out


def compute_best_worst_map(conn, tenant_id: int, my_account_id, range_key="all", min_matches=3):
    """Liefert Best- und Worst-Map basierend auf K/D mit Mindest-Match-Schwelle."""
    cutoff = (_range_filter(conn, tenant_id, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")
    rows = conn.execute("""
        SELECT m.map_name,
               COUNT(*) AS n,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               SUM(pa.kills) AS kills,
               AVG(pa.damage_dealt) AS avg_dmg,
               AVG(pa.place) AS avg_place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?
        GROUP BY m.map_name
        HAVING COUNT(*) >= ?
    """, (tenant_id, my_account_id, cutoff, min_matches)).fetchall()
    if not rows:
        return {"best": None, "worst": None}

    def _kd(r):
        return (r["kills"] or 0) / max((r["n"] or 0) - (r["wins"] or 0), 1)

    enriched = [{
        "map": r["map_name"], "matches": r["n"], "wins": r["wins"],
        "kills": r["kills"], "kd": _kd(r),
        "avgDmg": r["avg_dmg"], "avgPlace": r["avg_place"],
    } for r in rows]
    best = max(enriched, key=lambda x: x["kd"])
    worst = min(enriched, key=lambda x: x["kd"])
    return {"best": best, "worst": worst}


def compute_map_distribution(conn, tenant_id: int, my_account_id, range_key="session"):
    cutoff = _range_filter(conn, tenant_id, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    rows = conn.execute("""
        SELECT m.map_name,
               COUNT(*) AS cnt,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               AVG(pa.place) AS avg_place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?
        GROUP BY m.map_name
        ORDER BY cnt DESC
    """, (tenant_id, my_account_id, cutoff)).fetchall()
    return [{"map": r["map_name"], "count": r["cnt"],
             "wins": r["wins"], "avgPlace": r["avg_place"]} for r in rows]


def compute_session_matches(conn, tenant_id: int, my_account_id, range_key="session",
                             from_iso=None, to_iso=None,
                             include_events=True):
    """Flache Liste der Matches in der Range — leichtgewichtig.
    Genutzt von Streak-Counter, Session-Goal, Achievements etc.
    from_iso/to_iso überschreiben range_key (für historische Sessions).

    include_events=True (Default): Events bleiben in der Liste, sind
       aber mit isEvent=True markiert. Konsumer der Stats berechnet
       (compute_streaks, compute_session_achievements) sollten filtern.
    include_events=False: harter Filter — Events kommen gar nicht raus."""
    if from_iso:
        cutoff = from_iso
        end_filter = " AND m.played_at <= ?" if to_iso else ""
        params = [tenant_id, my_account_id, cutoff]
        if to_iso:
            params.append(to_iso)
    else:
        cutoff = (_range_filter(conn, tenant_id, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        end_filter = ""
        params = [tenant_id, my_account_id, cutoff]
    br_where = ""
    if not include_events:
        br_sql, br_params = _br_filter("m")
        br_where = f" AND {br_sql}"
        params = list(params) + br_params
    rows = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.game_mode, m.played_at,
               m.duration_secs,
               pa.kills, pa.damage_dealt, pa.place, pa.time_survived,
               pa.longest_kill, pa.headshot_kills, pa.assists, pa.dbnos
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?{end_filter}{br_where}
        ORDER BY m.played_at DESC
    """, params).fetchall()
    return [{
        "matchId":     r["match_id"],
        "map":         r["map_name"],
        "mode":        r["game_mode"],
        "isEvent":     not is_br_mode(r["game_mode"]),
        "playedAt":    r["played_at"],
        "durationSec": r["duration_secs"],
        "kills":       r["kills"] or 0,
        "damage":      r["damage_dealt"] or 0,
        "place":       r["place"],
        "survivedSec": r["time_survived"] or 0,
        "longestKill": r["longest_kill"] or 0,
        "headshots":   r["headshot_kills"] or 0,
        "assists":     r["assists"] or 0,
        "dbnos":       r["dbnos"] or 0,
    } for r in rows]


def compute_match_detail(conn, tenant_id: int, my_account_id, match_id):
    """v2: liefert pro Member ein lives[]-Array. Jedes Leben hat
    planeRoute, landing, groundPath, death (oder None), kills.
    Comeback-Detection ueber Telemetry-Split an Kill-target=member.

    Returns dict:
      {
        "matchId": ..., "mapName": ...,
        "members": [
          {
            "accountId", "name", "isSelf",
            "lives": [
              {
                "lifeIndex": 1, "planeRoute": [[x,y,ts], ...],
                "landing": {"x", "y", "tsMs"},
                "groundPath": [[x,y,ts], ...],
                "death": {"x", "y", "tsMs", "killerName", "weaponId",
                          "weaponName", "distanceM"} | None,
                "kills": [{"actorX", "actorY", "victimX", "victimY",
                            "tsMs", "weapon", "victimName"}, ...]
              },
              ...
            ],
            "revivePts": [[x, y, tsMs], ...]
          }, ...
        ]
      }
    """
    m_row = conn.execute(
        "SELECT match_id, map_name, played_at FROM matches "
        "WHERE tenant_id = ? AND match_id = ?",
        (tenant_id, match_id,)).fetchone()
    if not m_row:
        return None
    map_name = m_row["map_name"]
    match_start_ms = None
    if m_row["played_at"]:
        try:
            import datetime as _dt
            start_dt = _dt.datetime.fromisoformat(
                m_row["played_at"].replace("Z", "+00:00"))
            match_start_ms = int(start_dt.timestamp() * 1000)
        except Exception:
            pass

    # Plane-Takeoff = Match-Zeit 0. PUBG feuert LogMatchStart exakt zum
    # Takeoff-Zeitpunkt — vor Takeoff (Lobby/Insert) sind die Match-Zeiten
    # negativ. Fallback: match_start_ms (= Lobby-Start) wenn kein
    # MatchStart-Event in der DB (alte Matches vor 2026-05-31).
    takeoff_row = conn.execute(
        "SELECT timestamp_ms FROM telemetry_events "
        "WHERE match_id = ? AND event_type = 'MatchStart' "
        "ORDER BY timestamp_ms ASC LIMIT 1",
        (match_id,)).fetchone()
    takeoff_ms = (takeoff_row["timestamp_ms"]
                   if (takeoff_row and takeoff_row["timestamp_ms"])
                   else match_start_ms)

    # Squad-Mitglieder
    team_row = conn.execute(
        "SELECT team_id FROM match_team_mapping "
        "WHERE tenant_id = ? AND match_id = ? AND account_id = ?",
        (tenant_id, match_id, my_account_id)).fetchone()
    if not team_row:
        return {"matchId": match_id, "mapName": map_name, "members": [], "events": []}
    members_rows = conn.execute("""
        SELECT mtm.account_id, mtm.slot, p.name
        FROM match_team_mapping mtm
        LEFT JOIN players p ON p.account_id = mtm.account_id AND p.tenant_id = mtm.tenant_id
        WHERE mtm.tenant_id = ? AND mtm.match_id = ? AND mtm.team_id = ?
        ORDER BY mtm.slot NULLS LAST, p.name
    """, (tenant_id, match_id, team_row["team_id"])).fetchall()

    squad_accs = [r["account_id"] for r in members_rows if r["account_id"]]
    if not squad_accs:
        return {"matchId": match_id, "mapName": map_name, "members": [], "events": []}

    # Squad-Stats-Batch — Participants-Tabelle + Telemetrie-Counter
    # (revives received/given, bot-kills). Wird in out_members reingemergt.
    _ph_sq = ",".join(["?"] * len(squad_accs))
    parts_rows = conn.execute(
        f"""SELECT account_id, kills, headshot_kills, assists, dbnos,
                   damage_dealt, time_survived, place
            FROM participants
            WHERE tenant_id = ? AND match_id = ?
              AND account_id IN ({_ph_sq})""",
        (tenant_id, match_id, *squad_accs)).fetchall()
    parts_by_acc = {r["account_id"]: r for r in parts_rows}
    # Clan-Info pro Squad-Member (one shot join statt n+1 in der Loop)
    _clan_by_acc = {}
    if squad_accs:
        for r in conn.execute(
                f"""SELECT pc.account_id, c.clan_tag, c.clan_name
                    FROM player_clans pc
                    LEFT JOIN clans c ON c.clan_id = pc.clan_id
                    WHERE pc.account_id IN ({_ph_sq})""",
                squad_accs).fetchall():
            if r["clan_tag"]:
                _clan_by_acc[r["account_id"]] = {
                    "tag": r["clan_tag"], "name": r["clan_name"]}
    revives_received_by = {a: 0 for a in squad_accs}
    revives_given_by    = {a: 0 for a in squad_accs}
    bot_kills_by        = {a: 0 for a in squad_accs}
    for r in conn.execute(
        f"""SELECT actor_account, COUNT(*) AS c FROM telemetry_events
            WHERE match_id = ? AND event_type='Revive'
              AND actor_account IN ({_ph_sq})
            GROUP BY actor_account""",
        (match_id, *squad_accs)).fetchall():
        revives_given_by[r["actor_account"]] = r["c"]
    for r in conn.execute(
        f"""SELECT target_account, COUNT(*) AS c FROM telemetry_events
            WHERE match_id = ? AND event_type='Revive'
              AND target_account IN ({_ph_sq})
            GROUP BY target_account""",
        (match_id, *squad_accs)).fetchall():
        revives_received_by[r["target_account"]] = r["c"]
    for r in conn.execute(
        f"""SELECT actor_account, COUNT(*) AS c FROM telemetry_events
            WHERE match_id = ? AND event_type='Kill'
              AND actor_account IN ({_ph_sq})
              AND target_account LIKE 'ai.%'
            GROUP BY actor_account""",
        (match_id, *squad_accs)).fetchall():
        bot_kills_by[r["actor_account"]] = r["c"]

    # Vehicle-Intervalle fuer ALLE Spieler in der Lobby (nicht nur Squad)
    # — sonst kann victimVehicleLabel fuer Enemy-Knocks/Kills nicht
    # gesetzt werden. Bei einem 100er-Lobby sind das ~50-300 Events,
    # vertretbar.
    veh_intervals_by_acc = {}
    _veh_rows = conn.execute("""
        SELECT actor_account, event_type, timestamp_ms, weapon
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('VehicleEnter', 'VehicleLeave')
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    _veh_evs_by = {}
    for r in _veh_rows:
        _veh_evs_by.setdefault(r["actor_account"], []).append(r)
    for _acc, _evs in _veh_evs_by.items():
        _cur_enter = None; _cur_veh = None
        _ivals = []
        for _e in _evs:
            if _e["event_type"] == "VehicleEnter":
                _cur_enter = _e["timestamp_ms"]
                _cur_veh = _e["weapon"]
            elif _e["event_type"] == "VehicleLeave" and _cur_enter is not None:
                _ivals.append((_cur_enter, _e["timestamp_ms"], _cur_veh))
                _cur_enter = None; _cur_veh = None
        if _cur_enter is not None:
            _ivals.append((_cur_enter, float("inf"), _cur_veh))
        veh_intervals_by_acc[_acc] = _ivals

    out_members = []
    for mem in members_rows:
        acc = mem["account_id"]
        if not acc:
            continue
        # Alle relevanten Events des Members chronologisch
        ev_rows = conn.execute("""
            SELECT event_type, timestamp_ms, actor_x, actor_y, actor_z,
                   actor_health, target_account, victim_x, victim_y,
                   weapon, distance, actor_account
            FROM telemetry_events
            WHERE match_id = ?
              AND (actor_account = ? OR target_account = ?)
              AND timestamp_ms IS NOT NULL
            ORDER BY timestamp_ms ASC
        """, (match_id, acc, acc)).fetchall()

        # Vehicle-Intervalle des Members (für 'wurde aus Fahrzeug erschossen').
        # VehicleEnter/Leave-Events haben actor_account = der Spieler im
        # Fahrzeug, weapon-Feld trägt die vehicleId (z.B. "BP_PicoBus_C").
        veh_intervals = []
        _cur_enter = None
        _cur_veh   = None
        for _e in ev_rows:
            if _e["actor_account"] != acc:
                continue
            if _e["event_type"] == "VehicleEnter":
                _cur_enter = _e["timestamp_ms"]
                _cur_veh   = _e["weapon"]
            elif _e["event_type"] == "VehicleLeave" and _cur_enter is not None:
                veh_intervals.append((_cur_enter, _e["timestamp_ms"], _cur_veh))
                _cur_enter = None
                _cur_veh   = None
        if _cur_enter is not None:
            veh_intervals.append((_cur_enter, float("inf"), _cur_veh))

        veh_intervals_by_acc[acc] = list(veh_intervals)

        def _vehicle_label_at(ts):
            """Wenn der Member zum Zeitpunkt ts im Fahrzeug war: Klartext
            zurückgeben (z.B. 'Pico Bus'), sonst None."""
            if ts is None:
                return None
            for a, b, vid in veh_intervals:
                if a <= ts <= b and vid:
                    for needle, label in _VEHICLE_PATTERNS:
                        if needle in vid:
                            return label
                    return vid  # Fallback: raw id wenn nicht gemappt
            return None

        # Death-Events isolieren (Kill mit target=acc)
        death_events = [e for e in ev_rows
                        if e["event_type"] == "Kill" and e["target_account"] == acc]
        # Lives-Splitting: jedes Leben endet entweder mit einem death_event
        # oder dem Match-Ende. Pro Death suchen wir die Cruise-Phase davor
        # als Start des Lebens.
        live_segments = []
        last_death_ts = None
        for de in death_events:
            seg_start_ts = last_death_ts if last_death_ts is not None else 0
            live_segments.append((seg_start_ts, de["timestamp_ms"], de))
            last_death_ts = de["timestamp_ms"]
        # Letztes Segment ohne Death (Survival oder Match-Ende)
        live_segments.append((
            last_death_ts if last_death_ts is not None else 0,
            10**15,  # Match-Ende-Sentinel
            None
        ))

        lives = []
        for life_idx, (seg_start, seg_end, death_ev) in enumerate(live_segments, 1):
            # Plane-Cruise-Start fuer dieses Leben: erstes Event ab seg_start
            # mit z>=80000 (>=800m). Initial-Drop-Plane ~1500m, Comeback-BR-
            # Plane nur ~1000m → niedrigere Schwelle damit beides erkannt wird.
            cruise_ts = None
            for e in ev_rows:
                ts = e["timestamp_ms"]
                if ts < seg_start: continue
                if ts > seg_end: break
                if e["actor_account"] != acc: continue
                z = e["actor_z"]
                if z is not None and z >= 80000:
                    cruise_ts = ts
                    break
            if cruise_ts is None:
                # Kein Cruise gefunden — Leben hat evtl. nur Death (Edge),
                # skip dieses Segment damit lives nicht mit "leeren" Eintraegen
                # gefuellt wird. Ausnahme: lifeIndex==1 + erstes Leben → trotzdem
                # einen leeren Stub liefern damit Frontend rendern kann.
                if life_idx == 1 and not lives:
                    lives.append({
                        "lifeIndex": 1, "planeRoute": [],
                        "landing": None, "groundPath": [],
                        "death": None, "kills": [],
                    })
                continue
            path_start_ms = cruise_ts + 3000

            # Landing-Event in diesem Leben (erstes Landing nach cruise_ts)
            landing_ev = next((
                e for e in ev_rows
                if e["event_type"] == "Landing"
                and e["actor_account"] == acc
                and e["timestamp_ms"] >= cruise_ts
                and e["timestamp_ms"] <= seg_end
                and e["actor_x"] is not None
            ), None)
            landing = None
            if landing_ev:
                landing = {
                    "x": landing_ev["actor_x"],
                    "y": landing_ev["actor_y"],
                    "tsMs": landing_ev["timestamp_ms"],
                }
            landing_ts = landing["tsMs"] if landing else cruise_ts

            # planeRoute: ab path_start_ms bis landing_ts (inkl.)
            plane_route = [
                [e["actor_x"], e["actor_y"], e["timestamp_ms"]]
                for e in ev_rows
                if e["actor_account"] == acc
                and e["event_type"] in ("Position", "Landing",
                                         "VehicleEnter", "VehicleLeave")
                and e["actor_x"] is not None
                and e["timestamp_ms"] >= path_start_ms
                and e["timestamp_ms"] <= landing_ts
            ]

            # groundPath: nach landing_ts bis seg_end (oder death_ev.ts)
            path_end = death_ev["timestamp_ms"] if death_ev else seg_end
            ground_path = [
                [e["actor_x"], e["actor_y"], e["timestamp_ms"]]
                for e in ev_rows
                if e["actor_account"] == acc
                and e["event_type"] in ("Position", "Landing",
                                         "VehicleEnter", "VehicleLeave")
                and e["actor_x"] is not None
                and e["timestamp_ms"] > landing_ts
                and e["timestamp_ms"] <= path_end
            ]

            # Kills die der Member in diesem Leben gemacht hat
            life_kills = []
            for e in ev_rows:
                if e["event_type"] != "Kill": continue
                if e["actor_account"] != acc: continue
                if e["target_account"] == acc: continue  # eigener death
                if e["timestamp_ms"] < cruise_ts or e["timestamp_ms"] > seg_end:
                    continue
                # Victim-Name nachschlagen (players + participants)
                vrow = conn.execute("""
                    SELECT COALESCE(p.name, pa.name) AS n
                    FROM (SELECT NULL AS dummy) x
                    LEFT JOIN players p ON p.tenant_id = ? AND p.account_id = ?
                    LEFT JOIN participants pa ON pa.tenant_id = ? AND pa.match_id = ?
                          AND pa.account_id = ?
                """, (tenant_id, e["target_account"],
                       tenant_id, match_id, e["target_account"])).fetchone()
                # Distanz: actor → victim in Metern (cm/100). Wenn DB-
                # weapon-Field eine eigene 'distance' hatte (Kill-Event-
                # native), bevorzugen, sonst aus Koordinaten rechnen.
                dist_m = None
                if (e["actor_x"] is not None and e["actor_y"] is not None
                        and e["victim_x"] is not None and e["victim_y"] is not None):
                    dx = (e["actor_x"] - e["victim_x"]) / 100.0
                    dy = (e["actor_y"] - e["victim_y"]) / 100.0
                    dist_m = round((dx*dx + dy*dy) ** 0.5, 1)
                wlabel = _weapon_label(e["weapon"])[0] if e["weapon"] else None
                life_kills.append({
                    "actorX":  e["actor_x"],
                    "actorY":  e["actor_y"],
                    "victimX": e["victim_x"],
                    "victimY": e["victim_y"],
                    "tsMs":    e["timestamp_ms"],
                    "weapon":  e["weapon"],
                    "weaponName": wlabel,
                    "distanceM":  dist_m,
                    "victimName": vrow["n"] if vrow else None,
                })

            # Death-Detail
            death_info = None
            if death_ev:
                wid = death_ev["weapon"]
                weapon_name = _weapon_label(wid)[0] if wid else None
                # Killer-Name analog
                kn = None
                if death_ev["actor_account"]:
                    krow = conn.execute("""
                        SELECT COALESCE(p.name, pa.name) AS n
                        FROM (SELECT NULL AS dummy) x
                        LEFT JOIN players p ON p.tenant_id = ? AND p.account_id = ?
                        LEFT JOIN participants pa ON pa.tenant_id = ? AND pa.match_id = ?
                              AND pa.account_id = ?
                    """, (tenant_id, death_ev["actor_account"],
                          tenant_id, match_id,
                          death_ev["actor_account"])).fetchone()
                    kn = krow["n"] if krow else None
                # Crawl-Path: war der Spieler vor dem Tod im DBNO-Zustand?
                # Letztes Knock-Event mit target=acc vor death suchen.
                knock_ts = None
                knock_ev = None
                for k in ev_rows:
                    if k["event_type"] != "Knock": continue
                    if k["target_account"] != acc: continue
                    kts = k["timestamp_ms"]
                    if kts is None or kts >= death_ev["timestamp_ms"]: continue
                    # Falls Revive zwischen Knock und Death — Knock zaehlt nicht
                    revived = any(
                        r["event_type"] == "Revive" and r["target_account"] == acc
                        and r["timestamp_ms"] and kts < r["timestamp_ms"] < death_ev["timestamp_ms"]
                        for r in ev_rows)
                    if revived: continue
                    if knock_ts is None or kts > knock_ts:
                        knock_ts = kts
                        knock_ev = k
                crawl = []
                if knock_ts is not None:
                    crawl = [
                        [e["actor_x"], e["actor_y"], e["timestamp_ms"]]
                        for e in ev_rows
                        if e["actor_account"] == acc
                        and e["event_type"] == "Position"
                        and e["actor_x"] is not None
                        and e["timestamp_ms"] >= knock_ts
                        and e["timestamp_ms"] <= death_ev["timestamp_ms"]
                    ]
                cause_label = _death_cause_label(death_ev, acc, wid,
                                                  weapon_name, ev_rows=ev_rows)
                # Wenn Tod selbst keine Ursache liefert, aber ein Knock
                # davor — schaue ob DER Knock ein Vehicle-Eject-Knock war.
                # Frontend kann dann 'knocked aus Fahrzeug gesprungen'
                # rendern. Vehicle-Eject-Knock-Pattern: actor=NULL ODER
                # actor==victim mit Mesh-weapon, plus VehicleLeave davor.
                knock_cause_label = None
                if knock_ev is not None:
                    kw = knock_ev["weapon"]
                    knock_cause_label = _death_cause_label(
                        knock_ev, acc, kw,
                        _weapon_label(kw)[0] if kw else None,
                        ev_rows=ev_rows)
                # Fahrzeug-Kontext: war das Opfer beim Tod / beim Knock im
                # Fahrzeug? (z.B. 'wurde aus dem Pico Bus rausgeschossen')
                victim_vehicle_label = _vehicle_label_at(death_ev["timestamp_ms"])
                knock_victim_vehicle_label = _vehicle_label_at(knock_ts)
                death_info = {
                    "x":           death_ev["victim_x"],
                    "y":           death_ev["victim_y"],
                    "tsMs":        death_ev["timestamp_ms"],
                    "killerName":  kn,
                    "weaponId":    wid,
                    "weaponName":  weapon_name,
                    "causeLabel":  cause_label,
                    "knockCauseLabel": knock_cause_label,
                    "victimVehicleLabel":      victim_vehicle_label,
                    "knockVictimVehicleLabel": knock_victim_vehicle_label,
                    "distanceM":   (round((death_ev["distance"] or 0) / 100.0, 1)
                                    if death_ev["distance"] else None),
                    "knockTsMs":   knock_ts,
                    "crawl":       crawl,
                }

            lives.append({
                "lifeIndex":  life_idx,
                "planeRoute": plane_route,
                "landing":    landing,
                "groundPath": ground_path,
                "death":      death_info,
                "kills":      life_kills,
            })

        # Revive-Pts (innerhalb von DBNO-Revives, separat von Comeback)
        revive_rows = conn.execute("""
            SELECT actor_x, actor_y, timestamp_ms
            FROM telemetry_events
            WHERE match_id = ? AND target_account = ?
              AND event_type = 'Revive'
              AND actor_x IS NOT NULL
            ORDER BY timestamp_ms ASC
        """, (match_id, acc)).fetchall()
        revive_pts = [[r["actor_x"], r["actor_y"], r["timestamp_ms"]]
                       for r in revive_rows]

        # Stat-Bundle aus participants + telemetry-Countern
        _pr = parts_by_acc.get(acc) or {}
        out_members.append({
            "accountId":       acc,
            "name":            mem["name"] or acc[:8],
            "slot":            mem["slot"] if "slot" in mem.keys() else None,
            "isSelf":          (acc == my_account_id),
            "lives":           lives,
            "revivePts":       revive_pts,
            # Stat-Fields fuer die Squad-Tabelle im Slide-In Panel
            "kills":           _pr.get("kills") or 0,
            "headshotKills":   _pr.get("headshot_kills") or 0,
            "assists":         _pr.get("assists") or 0,
            "dbnos":           _pr.get("dbnos") or 0,
            "damageDealt":     _pr.get("damage_dealt") or 0,
            "timeSurvived":    _pr.get("time_survived") or 0,
            "place":           _pr.get("place"),
            "revivesReceived": revives_received_by.get(acc, 0),
            "revivesGiven":    revives_given_by.get(acc, 0),
            "botKills":        bot_kills_by.get(acc, 0),
            "clan":            _clan_by_acc.get(acc),
        })

    # Sortierung: Slot 1..4 wie In-Game-Roster (Self steht NICHT
    # automatisch oben — der Streamer ist halt der Slot den er hat).
    # Slot=NULL als Fallback ans Ende, dann alphabetisch.
    out_members.sort(key=lambda x: (
        x["slot"] if x["slot"] is not None else 999,
        x["name"].lower(),
    ))
    # Slot-Fallback fuer alte Matches ohne Slot-Info in match_team_mapping
    # (52k+ Rows NULL pre-Slot-Schema). Wir vergeben aufsteigend 1..4
    # an Member ohne echten Slot, sodass Frontend Slot-Farben anwenden
    # kann. Self (= acc == my_account_id) bekommt bevorzugt Slot 1.
    _used_slots = {m["slot"] for m in out_members if m["slot"] is not None}
    _free_slots = [s for s in (1, 2, 3, 4) if s not in _used_slots]
    # Erst Self ohne Slot
    for m in out_members:
        if m["slot"] is None and m.get("isSelf") and _free_slots:
            m["slot"] = _free_slots.pop(0)
    # Dann die anderen in member-order
    for m in out_members:
        if m["slot"] is None and _free_slots:
            m["slot"] = _free_slots.pop(0)

    # ============================================================
    # Shared-Vehicle-Pfad-Unifikation
    # Wenn ≥2 Squad-Mates im selben Fahrzeug mit ueberlappenden
    # VehicleEnter/Leave-Intervallen sind, werden ihre Position-Events
    # in dem Intervall durch eine Union ersetzt → Linien sind deckungs-
    # gleich auf der Map.
    # ============================================================
    sq_pos_rows = conn.execute(f"""
        SELECT actor_account, actor_x, actor_y, timestamp_ms
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Position'
          AND actor_account IN ({_ph_sq})
          AND actor_x IS NOT NULL
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id, *squad_accs)).fetchall()
    pos_by_acc_unify = {}
    for r in sq_pos_rows:
        pos_by_acc_unify.setdefault(r["actor_account"], []).append(r)

    # VehicleEnter-Events mit seatIndex fuer Fahrer-Detection. seat_index=0
    # ist der Fahrer; Beifahrer haben 1+. Sitzwechsel = Leave + neuer Ride.
    ride_seat_rows = conn.execute(f"""
        SELECT actor_account, weapon, timestamp_ms, seat_index
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'VehicleEnter'
          AND actor_account IN ({_ph_sq})
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id, *squad_accs)).fetchall()
    rides_by_acc = {}
    for r in ride_seat_rows:
        rides_by_acc.setdefault(r["actor_account"], []).append(r)

    # Shared-Vehicle-Episoden finden (≥2 Squad-Members, selber vid,
    # ueberlappendes Intervall)
    shared_episodes = []
    seen_keys = set()
    for a_outer in squad_accs:
        for (s, e, vid) in veh_intervals_by_acc.get(a_outer, []):
            if not vid:
                continue
            riders = {a_outer}
            ep_start = s
            ep_end   = e
            # Open-ended (kein VehicleLeave): float('inf') als end_ts
            if ep_end == float("inf"):
                ep_end = ep_start + 10**11  # ~3 Jahre, faktisch unendlich
            for b_other in squad_accs:
                if b_other == a_outer:
                    continue
                for (s2, e2, vid2) in veh_intervals_by_acc.get(b_other, []):
                    if vid2 != vid:
                        continue
                    e2x = e2 if e2 != float("inf") else (ep_end + 1)
                    if s2 < ep_end and e2x > ep_start:
                        riders.add(b_other)
                        ep_start = min(ep_start, s2)
                        ep_end   = max(ep_end, e2x)
            if len(riders) < 2:
                continue
            key = (vid, frozenset(riders), ep_start, ep_end)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            # Fahrer = wer zuletzt mit seatIndex=0 ins Fahrzeug eingestiegen
            # ist (handhabt Sitzwechsel). Fallback (alte Daten ohne
            # seat_index): wer den Wagen zuerst betrat.
            driver = None
            driver_seat0_ts = -1
            for r_acc in riders:
                for r in rides_by_acc.get(r_acc, []):
                    if r["weapon"] != vid:
                        continue
                    if r["timestamp_ms"] > ep_end:
                        continue
                    if r.get("seat_index") == 0:
                        if r["timestamp_ms"] > driver_seat0_ts:
                            driver_seat0_ts = r["timestamp_ms"]
                            driver = r_acc
            if driver is None:
                # Fallback fuer alte Daten
                driver_start = float("inf")
                for r_acc in riders:
                    for (rs, re_, rvid) in veh_intervals_by_acc.get(r_acc, []):
                        if rvid != vid:
                            continue
                        re_x = re_ if re_ != float("inf") else (ep_end + 1)
                        if rs < ep_end and re_x > ep_start:
                            if rs < driver_start:
                                driver_start = rs
                                driver = r_acc
                            break
            # Union aller Position-Events der Mitfahrer im Episoden-Intervall
            # — ABER nur Positionen die in IHREM eigenen Vehicle-Intervall
            # mit DIESEM vid liegen. Sonst kann ein kurzer Aussteiger/
            # Schwimmer eine Position aus dem Wasser in die Driver-Linie
            # einschleusen → Pin laeuft uebers Wasser.
            pts = []
            for r_acc in riders:
                r_ivals = veh_intervals_by_acc.get(r_acc, [])
                for p in pos_by_acc_unify.get(r_acc, []):
                    ts = p["timestamp_ms"]
                    if ts < ep_start or ts > ep_end:
                        continue
                    # Check: war r_acc zum ts wirklich in DIESEM Fahrzeug?
                    in_vehicle = False
                    for (rs, re_, rvid) in r_ivals:
                        if rvid != vid:
                            continue
                        re_x = re_ if re_ != float("inf") else (ep_end + 1)
                        if rs <= ts <= re_x:
                            in_vehicle = True
                            break
                    if in_vehicle:
                        pts.append([p["actor_x"], p["actor_y"], ts])
            pts.sort(key=lambda x: x[2])
            shared_episodes.append({
                "vid":    vid,
                "start":  ep_start,
                "end":    ep_end,
                "riders": list(riders),
                "driver": driver,
                "points": pts,
            })

    # Pro Member: groundPath in jeder Life rewriten.
    # - Fahrer: Unified-Points im Shared-Intervall einsetzen (eigene Punkte
    #   sind im Intervall ohnehin schon raus, weil wir sie filtern).
    # - Passagier: KEINE Punkte im Shared-Intervall (Gap entsteht; auf der
    #   Map wird so nur die Fahrer-Linie sichtbar).
    for mem in out_members:
        acc_u = mem["accountId"]
        my_eps = sorted(
            [ep for ep in shared_episodes if acc_u in ep["riders"]],
            key=lambda ep: ep["start"])
        if not my_eps:
            continue
        for life in mem["lives"]:
            gp = life.get("groundPath") or []
            if not gp:
                continue
            new_gp = []
            for p in gp:
                t = p[2]
                in_ep = False
                for ep in my_eps:
                    if ep["start"] <= t <= ep["end"]:
                        in_ep = True
                        break
                if not in_ep:
                    new_gp.append(p)
            # Nur der Fahrer bekommt die Unified-Episode-Points einge-
            # speist. Passagiere haben Gap → keine Linie auf der Map.
            gp_sorted_orig = sorted(gp, key=lambda p: p[2])
            life_t0 = gp_sorted_orig[0][2] if gp_sorted_orig else None
            life_t1 = gp_sorted_orig[-1][2] if gp_sorted_orig else None
            for ep in my_eps:
                if ep.get("driver") != acc_u:
                    continue  # Passagier: kein Pfad
                if life_t0 is None:
                    break
                seg_s = max(ep["start"], life_t0)
                seg_e = min(ep["end"], life_t1)
                if seg_s > seg_e:
                    continue
                for ux, uy, ut in ep["points"]:
                    if seg_s <= ut <= seg_e:
                        new_gp.append([ux, uy, ut])
            new_gp.sort(key=lambda p: p[2])
            life["groundPath"] = new_gp

    # ============================================================
    # Squad-weite + chained-enemy Event-Liste fuer Match-Detail-Timeline.
    # Eine Zeile pro Event (knock / kill / kill_finish / kill_steal /
    # revive), mit Team-Label fuer Enemies und Wall-Clock-absTs.
    # Chained-Enemy: wenn unser Squad einen Gegner geknockt hat, kommen
    # dessen Folge-Events (Revive durch Teammate, Tod) auch in die Timeline.
    # ============================================================
    import datetime as _dt_evt
    from datetime import timezone as _tz_evt

    # 1) Alle Knock/Kill/Revive/Redeploy-Events im Match (Lobby-weit) —
    # Filter in Python. Redeploy = Comeback-Antenne (Wiederbelebung
    # eines toten Mate aus der Ferne).
    all_events_rows = conn.execute("""
        SELECT event_type, timestamp_ms, actor_account, target_account,
               victim_x, victim_y, actor_x, actor_y,
               weapon, distance, damage_reason, attachments
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('Kill', 'Knock', 'Revive', 'Redeploy', 'Login')
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()

    # Comeback-BR (Rondo & Co): toter Mate kommt via Redeploy-Aircraft
    # zurueck. PUBG-Telemetrie hat dafuer KEIN explizites Event — wir
    # erkennen es am VehicleEnter mit vehicleId 'RedeployAircraft_*_C'
    # (Tiger, Falcon, je nach Map). Wir emitten ein synthetisches
    # "Comeback"-Event in die Timeline.
    comeback_rows = conn.execute("""
        SELECT actor_account, timestamp_ms, actor_x, actor_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'VehicleEnter'
          AND weapon LIKE 'RedeployAircraft_%'
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()

    # BlueChip-Mechanik (Comeback-BR). PUBG's creatorAccountId in
    # LogItemPickupFromLootBox ist NICHT der originale Chip-Owner — bei
    # einem toten Spieler der mehrere Chips trug, schreibt PUBG ALLE Chips
    # in seiner Box mit creatorAccountId = ihm selbst (die Original-Owner
    # gehen verloren). Das In-Game-UI zeigt aber den echten Owner via
    # Client-State.
    #
    # Loesung: wir simulieren das Inventar selbst. Pro Spieler eine FIFO-
    # Queue der Chip-Original-Creators. Bei Tod fallen alle Chips an die
    # Death-Position als ground_chips mit ihrem TRUE creator. Bei Pickup
    # (vom Boden ODER aus Box) matchen wir zum naechsten ground_chip.
    chip_pickup_rows = conn.execute("""
        SELECT event_type, actor_account, target_account,
               timestamp_ms, actor_x, actor_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('ItemPickup', 'ItemPickupBox')
          AND weapon = 'Item_Bluechip_C'
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    chip_drop_rows = conn.execute("""
        SELECT actor_account, timestamp_ms, actor_x, actor_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'ItemDrop'
          AND weapon = 'Item_Bluechip_C'
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    chip_upload_rows = conn.execute("""
        SELECT actor_account, timestamp_ms, actor_x, actor_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'ItemUse'
          AND weapon = 'Item_Bluechip_C'
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    # Carepackage-Spawns mit BlueChip-ItemPackage = 2 enemy-chips wurden
    # an einem Tower hochgeladen. PUBG feuert LogItemUse fuer Bluechip
    # nicht zuverlaessig — diese Carepackage-Spawns sind der robuste
    # Trigger. Attribution via naechstem Position-Event eines Squad-
    # Members in der Naehe (Spieler musste am Tower stehen).
    carepkg_rows = conn.execute("""
        SELECT timestamp_ms, actor_x, actor_y, attachments
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'CarePackageSpawn'
          AND weapon LIKE '%Bluechip%'
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()

    # 1b) TakeDamage-Events fuer Bleed-Out-Heuristik. Brauchen nur die
    # letzten 3-5 Sekunden vor jedem Kill. Pull global einmalig, gruppieren
    # nach Target.
    dmg_rows = conn.execute("""
        SELECT timestamp_ms, target_account, actor_account, damage, weapon,
               actor_x, actor_y, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'TakeDamage'
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    dmg_by_target = {}
    for d in dmg_rows:
        tgt = d["target_account"]
        if not tgt:
            continue
        dmg_by_target.setdefault(tgt, []).append(d)

    def _is_bleed_out(victim_acc, kill_ts):
        """Heuristik: hat das Opfer geblutet bis zum Tod, ohne signifikanten
        Finisher-Schaden in der letzten Sekunde davor? Bleed-Ticks sind
        klein (<=5 HP)."""
        history = dmg_by_target.get(victim_acc, [])
        BLEED_TICK_MAX = 5      # HP — alles drueber ist "echter" Schaden
        WINDOW_MS = 1000        # 1s vor Kill (User-Vorgabe)
        for d in history:
            ts = d["timestamp_ms"]
            if ts >= kill_ts:
                break
            if (kill_ts - ts) > WINDOW_MS:
                continue
            if (d["damage"] or 0) > BLEED_TICK_MAX:
                return False
        return True

    # 2) Dynamische Tracking-Menge der "noch offenen" Knocks unseres
    # Squads. Geht hier rein, wenn squad einen Enemy knockt; raus, sobald
    # der Enemy revived oder gekillt wird (Story-Bogen geschlossen).
    sq_set = set(squad_accs)
    currently_knocked_by_squad = set()

    # 3) Team-ID-Lookup fuer die ganze Lobby
    team_rows = conn.execute("""
        SELECT account_id, team_id FROM match_team_mapping
        WHERE tenant_id = ? AND match_id = ?
    """, (tenant_id, match_id)).fetchall()
    team_by_acc = {r["account_id"]: r["team_id"] for r in team_rows}

    def _team_label_for(acc):
        """Team-Label fuer Enemies. None fuer Squad-Mates / unbekannt /
        actor=None (Selbstmord-Event ohne Akteur)."""
        if not acc or acc in sq_set:
            return None
        tid = team_by_acc.get(acc)
        if tid is None:
            return None
        return f"Team #{tid}"

    # 4) Name-Lookup (Cache) — PUBG-Namen sind universell pro Account
    # (gleicher Account in mehreren Tenants = gleicher Name). Wir suchen
    # daher OHNE tenant_id-Filter, sodass auch Enemies erkannt werden die
    # nur ein anderer Tenant ingestet hat.
    _name_cache = {}
    def _name_of(acc):
        if not acc:
            return None
        if acc in _name_cache:
            return _name_cache[acc]
        nrow = conn.execute("""
            SELECT COALESCE(
                (SELECT name FROM players
                  WHERE account_id = ? AND name IS NOT NULL LIMIT 1),
                (SELECT name FROM participants
                  WHERE match_id = ? AND account_id = ?
                    AND name IS NOT NULL LIMIT 1)
            ) AS n
        """, (acc, match_id, acc)).fetchone()
        n = nrow["n"] if nrow else None
        _name_cache[acc] = n
        return n

    # Clan-Lookup-Cache (player_clans → clans join). Wird per Account
    # lazily aufgeloest, so dass enemy-Lookups die in Timeline auftauchen
    # auch ihren Tag bekommen.
    _clan_cache = {}
    def _clan_of(acc):
        if not acc:
            return None
        if acc in _clan_cache:
            return _clan_cache[acc]
        r = conn.execute("""
            SELECT c.clan_tag, c.clan_name FROM player_clans pc
            JOIN clans c ON c.clan_id = pc.clan_id
            WHERE pc.account_id = ?
        """, (acc,)).fetchone()
        if r and r["clan_tag"]:
            v = {"tag": r["clan_tag"], "name": r["clan_name"]}
        else:
            v = None
        _clan_cache[acc] = v
        return v

    slot_by_acc = {mem["accountId"]: mem.get("slot") for mem in out_members}

    def _veh_label_for(acc, ts):
        """Vehicle-Label nur fuer Squad-Mates (intervals_by_acc enthaelt
        keine Non-Squad)."""
        if not acc or acc not in veh_intervals_by_acc:
            return None
        for a, b, vid in veh_intervals_by_acc[acc]:
            if a <= ts <= b and vid:
                for needle, label in _VEHICLE_PATTERNS:
                    if needle in vid:
                        return label
                return vid
        return None

    def _abs_ts_iso(ts_ms):
        """Wall-Clock-ISO fuer ts_ms (Offset ab Match-Start)."""
        if match_start_ms is None or ts_ms is None:
            return None
        secs = (match_start_ms + ts_ms) / 1000.0
        return _dt_evt.datetime.fromtimestamp(
            secs, tz=_tz_evt.utc).isoformat().replace("+00:00", "Z")

    # 5) Pro-Target: letzter unbeantworteter Knock — fuer Kill-Subtyping
    # (kill / kill_finish / kill_steal). Revive loescht den Knock aus dem
    # State, da das Opfer dann wieder oben war.
    last_knock_by_target = {}  # target_account → Knock-Event-Row

    def _row_skeleton(et_row, ts_row, actor_row, target_row,
                       vx, vy, weapon_row=None, dist_cm=None,
                       ax=None, ay=None):
        """Gemeinsame Felder fuer eine Timeline-Row bauen.
        tsMs ist MATCH-RELATIV (ms ab Match-Start) — Frontend formatiert
        als MM:SS Ingame-Zeit."""
        wn = _weapon_label(weapon_row)[0] if weapon_row else None
        dist_m_local = (round((dist_cm or 0) / 100.0, 1)
                        if dist_cm else None)
        ts_rel = (ts_row - match_start_ms
                   if (match_start_ms and ts_row) else ts_row)
        return {
            "tsMs":          ts_rel,
            "absTs":         _abs_ts_iso(ts_row),
            "actorAccount":  actor_row,
            "actorName":     _name_of(actor_row),
            "actorSlot":     slot_by_acc.get(actor_row),
            "actorTeamId":   team_by_acc.get(actor_row),
            "actorTeamLabel": _team_label_for(actor_row),
            "actorIsSquad":  actor_row in sq_set,
            "actorClan":     _clan_of(actor_row),
            "targetAccount": target_row,
            "targetName":    _name_of(target_row),
            "targetSlot":    slot_by_acc.get(target_row),
            "targetTeamId":  team_by_acc.get(target_row),
            "targetTeamLabel": _team_label_for(target_row),
            "targetIsSquad": target_row in sq_set,
            "targetClan":    _clan_of(target_row),
            "weapon":        weapon_row,
            "weaponName":    wn,
            "distanceM":     dist_m_local,
            "victimX":       vx,
            "victimY":       vy,
            "actorX":        ax,
            "actorY":        ay,
            "victimVehicleLabel":  _veh_label_for(target_row, ts_row),
            "shooterVehicleLabel": _veh_label_for(actor_row, ts_row),
        }

    # Position-Cache der Knock-Opfer (fuer Revive-POI-Fallback wenn
    # LogPlayerRevive keine victim_x/y mitgeschickt hat — alte Daten).
    knock_pos_by_target = {}

    events_out = []
    for e in all_events_rows:
        et     = e["event_type"]
        actor  = e["actor_account"]
        target = e["target_account"]
        ts     = e["timestamp_ms"]
        weapon = e["weapon"]

        # Lobby-Joins fuer Squad-Members anzeigen (negative Match-Zeit
        # relativ zum Takeoff). Non-Squad-Logins ignorieren — 100-Spieler-
        # Lobby waere Flut.
        if et == "Login":
            if actor in sq_set:
                join_row = _row_skeleton("Join", ts, actor, None, None, None)
                join_row["type"] = "join"
                events_out.append(join_row)
            continue

        # Inferred-Revive Szenarien (PUBG-Telemetrie liefert nicht immer
        # ein explizites Revive-Event — wir synthetisieren):
        #   A) chained-Enemy knockt aktiv jemand → muss revived sein
        #      (DBNO-Spieler kann nicht knocken)
        #   B) chained-Enemy wird ERNEUT geknockt → war zwischendurch revived
        # WICHTIG: Kill-Events NICHT als Beweis fuer aktive Handlung —
        # PUBG attribuiert Bleed-Out-Kills dem Knocker, auch wenn dieser
        # selbst DBNO ist (kein echtes Handeln).
        infer_who = None
        if et == "Knock":
            if actor and actor in currently_knocked_by_squad:
                infer_who = actor
            elif target and target in currently_knocked_by_squad:
                infer_who = target
        if infer_who:
            knock_pos_target = knock_pos_by_target.get(infer_who)
            infer_vx = knock_pos_target[0] if knock_pos_target else None
            infer_vy = knock_pos_target[1] if knock_pos_target else None
            infer_row = _row_skeleton(
                "Revive", ts, None, infer_who, infer_vx, infer_vy)
            infer_row["type"] = "revive_inferred"
            events_out.append(infer_row)
            currently_knocked_by_squad.discard(infer_who)
            last_knock_by_target.pop(infer_who, None)
            knock_pos_by_target.pop(infer_who, None)

        # Scope: Squad-involved ODER chained-enemy (target ist gerade von
        # uns geknockt und noch nicht revived/gekillt).
        in_scope = (
            (actor in sq_set) or (target in sq_set)
            or (target in currently_knocked_by_squad)
        )

        # Knock-State pflegen AUCH wenn nicht in scope (Lobby-Knocks
        # koennen spaeter relevant werden bei stole-the-knock).
        revive_fallback_pos = None
        if et == "Knock":
            last_knock_by_target[target] = e
            knock_pos_by_target[target] = (e["victim_x"], e["victim_y"])
            if actor in sq_set and target and target not in sq_set:
                currently_knocked_by_squad.add(target)
        elif et == "Revive":
            # Position-Fallback fuer Revive (alte Daten ohne victim_x/y):
            # die Position des Knock-Events verwenden.
            revive_fallback_pos = knock_pos_by_target.get(target)
            last_knock_by_target.pop(target, None)
            currently_knocked_by_squad.discard(target)
        elif et == "Kill":
            currently_knocked_by_squad.discard(target)

        if not in_scope:
            continue

        vx = e["victim_x"]
        vy = e["victim_y"]
        if et == "Revive" and vx is None and revive_fallback_pos:
            vx, vy = revive_fallback_pos

        row = _row_skeleton(et, ts, actor, target, vx, vy, weapon,
                             e["distance"],
                             ax=e["actor_x"], ay=e["actor_y"])
        # Attachments (JSON-Array von Item-Class-Names) durchreichen
        _attach_raw = (e["attachments"] if "attachments" in e.keys() else None)
        if _attach_raw:
            try:
                import json as _json_attach
                row["attachments"] = _json_attach.loads(_attach_raw)
            except Exception:
                row["attachments"] = None

        if et == "Knock":
            row["type"] = "knock"
        elif et == "Revive":
            row["type"] = "revive"
        elif et == "Redeploy":
            row["type"] = "redeploy"
        elif et == "Kill":
            knock_ev = last_knock_by_target.get(target)
            dmg_reason = (e["damage_reason"] or "") if "damage_reason" in e.keys() else ""
            wid = weapon or ""
            # TakeDamage-basierte Bleed-/Finisher-Erkennung:
            # Suche letzten Damage von einem ANDEREN Akteur (nicht
            # Selbst-Bleed-Ticks, nicht Fahrzeug-Touch mit damage=0).
            def _is_vehicle_weapon(wid):
                if not wid:
                    return False
                for needle, _ in _VEHICLE_PATTERNS:
                    if needle in wid:
                        return True
                return False

            recent_other_damage = None
            for d in dmg_by_target.get(target, []):
                d_ts = d["timestamp_ms"]
                if d_ts >= ts:
                    break
                if (ts - d_ts) > 2000:
                    continue
                d_actor = d["actor_account"]
                if not d_actor or d_actor == target:
                    continue  # PUBG None oder Selbst-Bleed-Tick
                # Fahrzeug-Touch mit damage=0 ist meist Zufalls-Kollision,
                # nicht der eigentliche Finisher. Skip.
                if ((d["damage"] or 0) <= 0
                        and _is_vehicle_weapon(d["weapon"])):
                    continue
                recent_other_damage = d  # latest non-self damage wins
            # Bleed-Out: wenn vorher ein Knock UND in den letzten 2s
            # KEIN non-self damage → ausgeblutet.
            bled_out = bool(knock_ev) and recent_other_damage is None
            # damage_reason kann es explizit override'n (selten direkt
            # gesetzt von PUBG, aber wenn vorhanden vertrauen).
            if dmg_reason and "BleedOut" in dmg_reason:
                bled_out = True
            # Env-Death-Detection: damage_reason zuerst, dann Waffen-ID.
            # WICHTIG: Damage_BlueZoneGrenade ist eine GRANATE die der
            # Spieler wirft — NICHT die Zone. Damit Bluezone-Detection nur
            # die echte Ring-Damage (Damage_Bluezone) trifft.
            env_type = None
            if dmg_reason in ("Damage_Bluezone", "Damage_BlueZone"):
                env_type = "kill_bluezone"
            elif dmg_reason in ("Damage_BlackZone", "Damage_RedZone"):
                env_type = "kill_redzone"
            elif dmg_reason in ("Damage_Falling", "Damage_Fall"):
                env_type = "kill_fall"
            elif "Drown" in dmg_reason or "Apnea" in dmg_reason:
                env_type = "kill_drown"
            elif dmg_reason in ("Damage_VehicleHit",
                                 "Damage_VehicleCrashHit"):
                env_type = "kill_self_eject"
            # Fallback auf Waffen-ID (alte Daten ohne damage_reason)
            elif "RagdollPhysics" in wid or "Damage_HelpMeGroundFall" in wid:
                env_type = "kill_self_eject"
            elif "Damage_Falling" in wid or "Damage_Instant_Fall" in wid:
                env_type = "kill_fall"
            elif "BattleRoyale" in wid:
                env_type = "kill_bluezone"
            elif "Bluezonebomb" in wid:
                env_type = "kill_redzone"
            elif "Drown" in wid or "Apnea" in wid:
                env_type = "kill_drown"
            if env_type:
                row["type"] = env_type
            elif not actor:
                # Kein Akteur und kein Waffen-Marker — generisches "died".
                row["type"] = "kill_self"
            else:
                # Real-Finisher-Detection: wenn actor==knocker UND es einen
                # non-self Damager in den letzten 2s gab (der NICHT der
                # PUBG-Killer ist) → DER ist der echte Finisher (PUBG zaehlt
                # damage=0 Treffer auf DBNO nicht). Bleed-Outs ueberspringen.
                if (knock_ev and actor == knock_ev["actor_account"]
                        and not bled_out
                        and recent_other_damage
                        and recent_other_damage["actor_account"] != actor):
                    actor = recent_other_damage["actor_account"]
                    row["actorAccount"]   = actor
                    row["actorName"]      = _name_of(actor)
                    row["actorSlot"]      = slot_by_acc.get(actor)
                    row["actorTeamId"]    = team_by_acc.get(actor)
                    row["actorTeamLabel"] = _team_label_for(actor)
                    row["actorIsSquad"]   = actor in sq_set
                    # Echte Waffe + Distanz vom Finisher-TakeDamage uebernehmen
                    rod = recent_other_damage
                    if rod["weapon"]:
                        row["weapon"]     = rod["weapon"]
                        row["weaponName"] = _weapon_label(rod["weapon"])[0]
                    if (rod["actor_x"] is not None
                            and rod["victim_x"] is not None):
                        _dx = (rod["actor_x"] - rod["victim_x"]) / 100.0
                        _dy = (rod["actor_y"] - rod["victim_y"]) / 100.0
                        row["distanceM"] = round(
                            (_dx*_dx + _dy*_dy) ** 0.5, 1)
                # Subtype-Detection
                if knock_ev is None:
                    row["type"] = "kill"
                else:
                    k_actor = knock_ev["actor_account"]
                    if k_actor == actor:
                        # Self-Finish (oder Bleed-Out — PUBG attribuiert
                        # Bleed-Outs dem Knocker)
                        row["type"] = "kill_bleedout" if bled_out else "kill"
                    else:
                        k_team = team_by_acc.get(k_actor)
                        a_team = team_by_acc.get(actor)
                        same_team = (
                            k_team is not None and k_team == a_team)
                        row["type"] = "kill_finish" if same_team else "kill_steal"
                        row["knockerAccount"]    = k_actor
                        row["knockerName"]       = _name_of(k_actor)
                        row["knockerSlot"]       = slot_by_acc.get(k_actor)
                        row["knockerTeamId"]     = k_team
                        row["knockerTeamLabel"]  = _team_label_for(k_actor)
                        row["knockerIsSquad"]    = k_actor in sq_set
                        row["knockerWeapon"]     = knock_ev["weapon"]
                        row["knockerWeaponName"] = (
                            _weapon_label(knock_ev["weapon"])[0]
                            if knock_ev["weapon"] else None)
                        row["knockerDistanceM"]  = (
                            round((knock_ev["distance"] or 0) / 100.0, 1)
                            if knock_ev["distance"] else None)
            if bled_out:
                row["bledOut"] = True
                # Knocker-Info auch bei bleedout setzen (PUBG attribuiert
                # den Kill dem Knocker → actor == knocker, aber wir wollen
                # den Knocker-Kontext fuer den Frontend-Satz)
                if knock_ev and "knockerAccount" not in row:
                    k_actor = knock_ev["actor_account"]
                    row["knockerAccount"]    = k_actor
                    row["knockerName"]       = _name_of(k_actor)
                    row["knockerSlot"]       = slot_by_acc.get(k_actor)
                    row["knockerTeamId"]     = team_by_acc.get(k_actor)
                    row["knockerTeamLabel"]  = _team_label_for(k_actor)
                    row["knockerIsSquad"]    = k_actor in sq_set
                    row["knockerWeapon"]     = knock_ev["weapon"]
                    row["knockerWeaponName"] = (
                        _weapon_label(knock_ev["weapon"])[0]
                        if knock_ev["weapon"] else None)
                    row["knockerDistanceM"]  = (
                        round((knock_ev["distance"] or 0) / 100.0, 1)
                        if knock_ev["distance"] else None)
            last_knock_by_target.pop(target, None)
            knock_pos_by_target.pop(target, None)

        events_out.append(row)

    # Comeback-Drops (RedeployAircraft) ins events_out merge'n. Wir
    # emitten pro Squadmate eine Zeile "X kam mit Comeback-Heli zurueck".
    # Position-Anzeige: Spieler-Landing nach dem Heli-Drop (nicht der
    # Heli-Spawn-Punkt der oft in einer leeren Zone in der Luft liegt).
    member_by_acc = {m["accountId"]: m for m in out_members}
    for cb in comeback_rows:
        acc = cb["actor_account"]
        if acc not in sq_set:
            continue
        # Landing-Position der naechsten Life nach diesem Comeback-Drop.
        loc_x, loc_y = cb["actor_x"], cb["actor_y"]
        mem = member_by_acc.get(acc)
        if mem:
            for life in (mem.get("lives") or []):
                lg = (life or {}).get("landing") or {}
                if lg.get("tsMs") and lg["tsMs"] >= cb["timestamp_ms"]:
                    if lg.get("x") is not None:
                        loc_x, loc_y = lg["x"], lg["y"]
                    break
        cb_row = _row_skeleton("Comeback", cb["timestamp_ms"], acc,
                                None, loc_x, loc_y)
        cb_row["type"] = "comeback"
        events_out.append(cb_row)

    # BlueChip-Tracking. Owner-Bestimmung:
    #   * ItemPickupBox → creatorAccountId direkt (target_account in DB)
    #   * ItemPickup → Heuristik: naechster toter Spieler (lobby-weit) im
    #     Umkreis 5m und letzten 60s vor dem Pickup.
    # Pro Spieler eine FIFO-Queue der gepickten Owners — bei Drop/Upload
    # poppen wir den aeltesten. Dadurch koennen wir bei einem Upload
    # klassifizieren: Squad-Chip → Comeback (toter Mate kommt zurueck),
    # Enemy-Chip → Carepackage-Trigger.
    all_deaths = conn.execute("""
        SELECT timestamp_ms, target_account, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Kill'
          AND target_account IS NOT NULL
          AND victim_x IS NOT NULL
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()

    # Chip-Inventar-Simulation. Jeder Lobby-Teilnehmer bekommt am Match-
    # Start einen Chip mit creator=self. Chips wandern via Pickup/Drop/
    # Upload weiter. Owner bleibt bis Upload erhalten.
    #
    # Datenstrukturen:
    #   inventory[acc] = FIFO-Liste von Chip-Creators die acc gerade traegt
    #   loot_boxes[acc] = FIFO-Liste von Chip-Creators in acc's Death-Box
    #   dropped[i] = (ts, x, y, creator) — manuell auf den Boden geworfen
    #
    # Box-Pickup loest sich SAUBER ueber die Box auf (FIFO), kein Distanz-
    # Matching. Nur lose Pickups (ohne Box-Pendant) brauchen Distanz zu
    # einem dropped-Chip.
    inventory = {}
    loot_boxes = {}
    dropped = []
    all_participants = conn.execute(
        "SELECT DISTINCT account_id FROM match_team_mapping "
        "WHERE match_id = ?",
        (match_id,)).fetchall()
    all_acc_set = {p["account_id"] for p in all_participants}
    # KEINE Init mit Personal-Chip im Inventar — sonst weicht chip_inv
    # vom chip_queue ab. Personal-Chip (creator=self) wird beim Tod
    # in die loot_box gelegt (Kill-Handler).
    for p in all_participants:
        inventory[p["account_id"]] = []

    chip_state_rows = list(conn.execute("""
        SELECT event_type, timestamp_ms, actor_account, target_account,
               actor_x, actor_y, victim_x, victim_y, weapon
        FROM telemetry_events
        WHERE match_id = ?
          AND ((event_type = 'Kill' AND target_account IS NOT NULL)
            OR (event_type IN ('ItemPickup','ItemPickupBox','ItemDrop','ItemUse')
                AND weapon = 'Item_Bluechip_C'))
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall())

    # PUBG feuert LogItemUse fuer BlueChip nicht in allen Matches. Wenn
    # ein Spieler 2 Chips am Tower hochlaedt aber kein LogItemUse-Event
    # ankommt, weiss die Inventar-Simulation nichts vom Verbrauch — alle
    # spaeteren Drops/Pickups bekommen falsche Creators (= aelteste Chips
    # statt verbleibender). Wir generieren virtuelle ItemUse-Events aus
    # erkannten stationaeren Tower-Phasen (Position kaum veraendert nach
    # dem letzten Pickup).
    _stationary_pos_rows = list(conn.execute("""
        SELECT actor_account, timestamp_ms, actor_x, actor_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Position'
          AND actor_account IS NOT NULL AND actor_x IS NOT NULL
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall())
    _pos_by_acc_pre = {}
    for r in _stationary_pos_rows:
        _pos_by_acc_pre.setdefault(r["actor_account"], []).append(
            (r["timestamp_ms"], r["actor_x"], r["actor_y"]))
    _last_pickup_pre = {}
    for cp in chip_pickup_rows:
        a = cp["actor_account"]
        ts_ = cp["timestamp_ms"]
        _last_pickup_pre[a] = max(_last_pickup_pre.get(a, 0), ts_)
    _has_logitemuse_per_acc = set()
    for r in chip_state_rows:
        if r["event_type"] == "ItemUse":
            _has_logitemuse_per_acc.add(r["actor_account"])
    def _stat_periods_simple(positions, after_ts,
                               max_dist_cm=1500, min_dur_ms=15_000):
        if after_ts is None: return []
        seq = [p for p in positions if p[0] >= after_ts]
        if not seq: return []
        out = []; i = 0
        while i < len(seq):
            anchor_ts, ax, ay = seq[i]
            j = i + 1
            while j < len(seq):
                _t, x, y = seq[j]
                if (x-ax)**2 + (y-ay)**2 > max_dist_cm*max_dist_cm:
                    break
                j += 1
            last_in = j - 1
            if last_in > i and seq[last_in][0] - anchor_ts >= min_dur_ms:
                out.append(anchor_ts)
                i = last_in + 1
            else:
                i += 1
        return out
    _pickups_pre = {}; _drops_pre = {}
    for cp in chip_pickup_rows:
        _pickups_pre[cp["actor_account"]] = _pickups_pre.get(cp["actor_account"], 0) + 1
    for dr in chip_drop_rows:
        _drops_pre[dr["actor_account"]] = _drops_pre.get(dr["actor_account"], 0) + 1
    # WICHTIG: Box+loose Pickups feuern oft als Paar → tatsaechliche
    # Pickup-Anzahl ist (ItemPickupBox-Count) wenn vorhanden, sonst halbiert.
    # Wir nehmen einfach (alle Pickup-Events // 2) wenn beide event_types
    # vorkommen — sonst der direkte Count.
    _picks_box_pre = {}; _picks_loose_pre = {}
    for cp in chip_pickup_rows:
        a = cp["actor_account"]
        if cp["event_type"] == "ItemPickupBox":
            _picks_box_pre[a] = _picks_box_pre.get(a, 0) + 1
        else:
            _picks_loose_pre[a] = _picks_loose_pre.get(a, 0) + 1
    def _effective_picks(a):
        # PUBG paaring: wenn box+loose etwa gleich → dedup. Sonst max.
        return max(_picks_box_pre.get(a, 0), _picks_loose_pre.get(a, 0))
    # Per Squad-Member: virtuelle ItemUse-Events fuer max_carepkgs
    # erste stationaere Phasen NACH letzter Pickup-ts.
    for acc in sq_set:
        if acc in _has_logitemuse_per_acc:
            continue  # echte LogItemUse-Events sind da, brauchen kein Stub
        last_p = _last_pickup_pre.get(acc)
        if last_p is None: continue
        picks_eff = _effective_picks(acc)
        drops_eff = _drops_pre.get(acc, 0)
        max_uploads_2chip = max(0, (picks_eff - drops_eff) // 2)
        if max_uploads_2chip == 0: continue
        periods = _stat_periods_simple(_pos_by_acc_pre.get(acc, []), last_p)
        for start_ts in periods[:max_uploads_2chip]:
            # Zwei virtuelle ItemUse pro Tower-Stop (Carepackage = 2 chips).
            for _ in range(2):
                chip_state_rows.append({
                    "event_type": "ItemUse",
                    "timestamp_ms": start_ts,
                    "actor_account": acc,
                    "target_account": None,
                    "actor_x": None, "actor_y": None,
                    "victim_x": None, "victim_y": None,
                    "weapon": "Item_Bluechip_C",
                })
    chip_state_rows.sort(key=lambda r: r["timestamp_ms"])

    # Dedup-Helper: PUBG feuert pro physischen Pickup BEIDE Events
    # (ItemPickup + ItemPickupBox) im selben 100ms-Bucket. Wir
    # verarbeiten in der Simulation nur Box (autoritativ via box-owner);
    # lose ItemPickups verarbeiten wir nur wenn KEIN Box-Pendant da war.
    from collections import defaultdict as _defaultdict
    pair_buckets = _defaultdict(dict)  # (actor, ts//100) → {ItemPickup: row, ItemPickupBox: row}
    for ev in chip_state_rows:
        if ev["event_type"] in ("ItemPickup", "ItemPickupBox"):
            pair_buckets[(ev["actor_account"], ev["timestamp_ms"] // 100)][
                ev["event_type"]] = ev

    pickup_resolved = {}  # (ts, actor) → resolved_creator
    processed_pickups = set()  # buckets we already handled

    for ev in chip_state_rows:
        et = ev["event_type"]
        ts = ev["timestamp_ms"]
        actor = ev["actor_account"]
        if et == "Kill":
            target = ev["target_account"]
            # Inventar des Toten + sein Personal-Chip (Item_Special_Bluechip_C
            # mit creator=self) landen in seiner Death-Box (FIFO).
            personal = [target] if target in all_acc_set else []
            loot_boxes[target] = personal + inventory.get(target, []) + loot_boxes.get(target, [])
            inventory[target] = []
        elif et == "ItemDrop":
            inv = inventory.setdefault(actor, [])
            if inv:
                creator = inv.pop(0)
                dropped.append((ts, ev["actor_x"], ev["actor_y"], creator))
        elif et == "ItemUse":
            inv = inventory.setdefault(actor, [])
            if inv:
                inv.pop(0)
        elif et in ("ItemPickup", "ItemPickupBox"):
            bucket = (actor, ts // 100)
            if bucket in processed_pickups:
                continue
            processed_pickups.add(bucket)
            pair = pair_buckets.get(bucket, {})
            def _match_dropped(px, py):
                if px is None: return None, None
                best_idx, best_d2 = None, 1000*1000  # 10m max
                for i, (_t, dx, dy, _c) in enumerate(dropped):
                    if dx is None: continue
                    d2 = (dx-px)**2 + (dy-py)**2
                    if d2 < best_d2:
                        best_d2 = d2; best_idx = i
                if best_idx is None:
                    return None, None
                return best_idx, dropped[best_idx][3]
            if "ItemPickupBox" in pair:
                # Box-Pickup. Erst loot_boxes[box_owner] versuchen
                # (= Body-Loot eines toten Spielers, autoritativ). Sonst:
                # dropped-Pickup — lebender Spieler hat Chip weggeworfen
                # und PUBG feuerte box-Event mit creator=dropper. Der
                # Dropper ist NICHT der Original-Creator des Chips!
                box_owner = pair["ItemPickupBox"]["target_account"]
                box = loot_boxes.get(box_owner) or []
                ev_box = pair["ItemPickupBox"]
                if box:
                    creator = box.pop(0)
                else:
                    idx, found = _match_dropped(ev_box["actor_x"], ev_box["actor_y"])
                    if idx is not None:
                        dropped.pop(idx)
                        creator = found
                    else:
                        creator = box_owner  # ultimate fallback
            else:
                # Lose Pickup: matche zum naechsten dropped chip via Distanz.
                idx, found = _match_dropped(ev["actor_x"], ev["actor_y"])
                if idx is not None:
                    dropped.pop(idx)
                    creator = found
                else:
                    creator = None
            inventory.setdefault(actor, []).append(creator)
            # Key per (actor, ts // 100ms) — ItemPickup und ItemPickupBox
            # haben oft 1ms Abstand. Lookup spaeter mit demselben Bucket.
            pickup_resolved[bucket] = creator

    # Alle chip-events (pickup, drop, upload) zeitlich gemischt verarbeiten
    # damit die FIFO-Queue konsistent ist.
    # PUBG-Quirk: pro physischen Bluechip-Pickup feuern BEIDE Events
    # mit gleicher ts: LogItemPickup (target_account=NULL) UND
    # LogItemPickupFromLootBox (target_account=Owner). Erst Bucket-
    # weise dedupen: wenn fuer (actor, ts) ein Box-Event existiert,
    # die losen Pickups droppen (sonst doppelte Timeline-Rows).
    # Bucket = (actor, ts // 100) — PUBG feuert die Doubletten manchmal
    # mit 1ms-Versatz, exakter ms-Match wuerde die nicht erwischen.
    from collections import defaultdict
    by_bucket = defaultdict(list)
    for cp in chip_pickup_rows:
        by_bucket[(cp["actor_account"], cp["timestamp_ms"] // 100)].append(cp)
    deduped_picks = []
    for evs in by_bucket.values():
        has_box = any(e["event_type"] == "ItemPickupBox" for e in evs)
        for e in evs:
            if has_box and e["event_type"] == "ItemPickup":
                continue
            deduped_picks.append(e)

    chip_events_mixed = []
    for cp in deduped_picks:
        # Owner aus Inventar-Simulation (autoritativ, kennt true creator
        # nach Multi-Hop-Transfers). Fallback auf creator aus Box-Event
        # falls Simulation kein Match hatte. Key = 100ms-Bucket.
        cp_owner = pickup_resolved.get(
            (cp["actor_account"], cp["timestamp_ms"] // 100),
            cp["target_account"])
        chip_events_mixed.append(
            ("pickup", cp["timestamp_ms"], cp["actor_account"],
             cp_owner, cp["actor_x"], cp["actor_y"], None))
    for dr in chip_drop_rows:
        chip_events_mixed.append(
            ("drop", dr["timestamp_ms"], dr["actor_account"],
             None, dr["actor_x"], dr["actor_y"], None))
    for up in chip_upload_rows:
        chip_events_mixed.append(
            ("upload", up["timestamp_ms"], up["actor_account"],
             None, up["actor_x"], up["actor_y"], None))
    # Carepackage-Spawn (BlueChip-Variante) = irgendein Spieler hat
    # 2 enemy-chips an einem Tower hochgeladen. PUBG fired LogItemUse
    # nicht zuverlaessig — wir attribuieren via Position-Lookup auf
    # den naechsten Squadmate in den 90s davor.
    cp_pos_rows = conn.execute("""
        SELECT actor_account, timestamp_ms, actor_x, actor_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Position'
          AND actor_account IS NOT NULL
          AND actor_x IS NOT NULL
          AND timestamp_ms IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    # Group positions by account fuer schnellen Lookup
    pos_by_acc = {}
    for r in cp_pos_rows:
        pos_by_acc.setdefault(r["actor_account"], []).append(
            (r["timestamp_ms"], r["actor_x"], r["actor_y"]))

    # Upload-Detection via stationaere Phasen nach den Pickups. Spieler
    # muss am Tower stehen → Position bleibt fuer 15+ Sekunden in einem
    # Radius von 5m. Per Squad-Member nur ihre N=max_carepkgs ersten
    # stationaeren Phasen nach dem letzten Chip-Pickup verwerten.
    last_pickup_ts_by_acc = {}
    for cp in chip_pickup_rows:
        a = cp["actor_account"]
        ts_ = cp["timestamp_ms"]
        last_pickup_ts_by_acc[a] = max(last_pickup_ts_by_acc.get(a, 0), ts_)

    def _stationary_periods(positions, after_ts,
                              max_dist_cm=1500, min_dur_ms=15_000):
        """Findet stationaere Phasen (Position kaum veraendert) ab after_ts."""
        if after_ts is None:
            return []
        seq = [p for p in positions if p[0] >= after_ts]
        if not seq:
            return []
        out = []
        i = 0
        while i < len(seq):
            anchor_ts, ax, ay = seq[i]
            j = i + 1
            while j < len(seq):
                _t, x, y = seq[j]
                dx, dy = x - ax, y - ay
                if dx*dx + dy*dy > max_dist_cm*max_dist_cm:
                    break
                j += 1
            last_in = j - 1
            if last_in > i and seq[last_in][0] - anchor_ts >= min_dur_ms:
                # Center = avg
                xs = [p[1] for p in seq[i:last_in+1]]
                ys = [p[2] for p in seq[i:last_in+1]]
                out.append((anchor_ts, seq[last_in][0],
                             sum(xs)/len(xs), sum(ys)/len(ys)))
                i = last_in + 1
            else:
                i += 1
        return out

    # Budget pro Squad-Member: max # Carepackage-Uploads = (pickups -
    # drops) // 2. Verhindert dass mehr Uploads attribuiert werden als
    # der Spieler ueberhaupt machen konnte.
    pickups_by_acc = _defaultdict(int)
    drops_by_acc = _defaultdict(int)
    for ev in chip_events_mixed:
        if ev[0] == "pickup":
            pickups_by_acc[ev[2]] += 1
        elif ev[0] == "drop":
            drops_by_acc[ev[2]] += 1
    max_carepkgs_by_acc = {a: max(0, (pickups_by_acc[a] - drops_by_acc[a]) // 2)
                            for a in sq_set}

    # Pro Squad-Member: stationaere Tower-Phasen finden + Bluechip-
    # Carepackages dazu matchen fuer Item-Info.
    for acc in sq_set:
        budget = max_carepkgs_by_acc.get(acc, 0)
        if budget == 0:
            continue
        last_p = last_pickup_ts_by_acc.get(acc)
        if last_p is None:
            continue
        positions = pos_by_acc.get(acc, [])
        periods = _stationary_periods(positions, last_p)
        for period in periods[:budget]:
            start_ts, end_ts, avg_x, avg_y = period
            # Suche zugehoeriges Bluechip-Carepackage (fuer Item-Anzeige)
            matched_items = None
            for cp in carepkg_rows:
                cp_ts = cp["timestamp_ms"]
                if start_ts - 30_000 <= cp_ts <= end_ts + 180_000:
                    matched_items = cp["attachments"]
                    break
            chip_events_mixed.append(
                ("carepkg", start_ts, acc, None, avg_x, avg_y,
                 matched_items))
    chip_events_mixed.sort(key=lambda x: x[1])

    chip_queue = {}  # account → [owner_acc, ...] FIFO
    matched_comebacks = set()  # bereits an Upload zugewiesene Comeback-Accounts
    last_pickup_by_acc = {}  # account → (idx_in_events_out, ts) — fuer Gruppierung
    carepkg_count_by_acc = _defaultdict(int)
    for kind, ts, acc, owner, px, py, extra in chip_events_mixed:
        if kind == "pickup":
            chip_queue.setdefault(acc, []).append(owner)
            if acc not in sq_set:
                continue  # Enemy-Pickups: queue tracken aber nicht emitten
            # Gruppieren mit vorherigem Pickup desselben Spielers fuer
            # denselben Owner innerhalb 5s — wenn der Vorbesitzer mehrere
            # Chips bei sich hatte (PUBG: alle bekommen creatorAccountId =
            # der Tote, auch wenn ihre originalen Owner unterschiedlich
            # waren).
            last = last_pickup_by_acc.get(acc)
            if last and (ts - last[1]) <= 5000:
                prev = events_out[last[0]]
                if (prev.get("type") == "chip_pickup"
                        and prev.get("targetAccount") == owner):
                    prev["chipCount"] = (prev.get("chipCount") or 1) + 1
                    last_pickup_by_acc[acc] = (last[0], ts)
                    continue
            cr = _row_skeleton("BluechipPickup", ts, acc, owner, px, py)
            cr["type"] = "chip_pickup"
            cr["chipCount"] = 1
            events_out.append(cr)
            last_pickup_by_acc[acc] = (len(events_out) - 1, ts)
        elif kind == "drop":
            q = chip_queue.get(acc) or []
            owner = q.pop(0) if q else None
            if acc not in sq_set:
                continue
            cr = _row_skeleton("BluechipDrop", ts, acc, owner, px, py)
            cr["type"] = "chip_drop"
            events_out.append(cr)
        elif kind == "carepkg":
            # Synthetisches Upload-Event aus Carepackage-Spawn. Attribution
            # nur valide wenn ein Squad-Member tatsaechlich >=2 Chips im
            # Inventar hat UND sein max_carepkgs-Budget noch nicht
            # ausgeschoepft ist.
            candidates = [a for a in sq_set
                          if len(chip_queue.get(a) or []) >= 2
                          and carepkg_count_by_acc[a] < max_carepkgs_by_acc.get(a, 0)]
            if not candidates:
                continue  # niemand im Squad konnte das gewesen sein
            if acc in candidates:
                uploader = acc
            else:
                uploader = max(candidates, key=lambda a: len(chip_queue[a]))
            carepkg_count_by_acc[uploader] += 1
            q = chip_queue[uploader]
            owner1 = q.pop(0)
            owner2 = q.pop(0)
            # px, py kommt vom stationaeren Tower-Stop (= wo der Spieler
            # beim Upload tatsaechlich stand, nicht wo das Carepackage
            # spaeter landet).
            cr = _row_skeleton("BluechipUpload", ts, uploader, None, px, py)
            cr["type"] = "chip_upload_carepackage"
            cr["chipCount"] = 2
            cr["chipOwners"] = [owner1, owner2]
            # Carepackage-Inhalt (Item-IDs als JSON-Liste in extra)
            if extra:
                try:
                    import json as _json
                    cr["packageItems"] = _json.loads(extra)
                except Exception:
                    pass
            events_out.append(cr)
        elif kind == "upload":
            # Owner-Bestimmung WAHR: Wenn innerhalb der naechsten 5min
            # ein Comeback-Drop eines toten Squadmates passiert, war
            # genau DIESER Upload sein Chip. Sonst Enemy-Chip
            # (Carepackage-Trigger).
            #
            # Wir halten die FIFO-Queue konsistent (pop), aber die
            # Klassifikation kommt aus dem Match-mit-Comeback und nicht
            # aus der Queue.
            q = chip_queue.get(acc) or []
            queue_owner = q.pop(0) if q else None
            if acc not in sq_set:
                continue
            # Suche Squad-Comeback innerhalb 5min nach diesem Upload,
            # der noch nicht zugeordnet ist. Same-account comebacks
            # zaehlen einzeln (matched_comebacks ist Set von (acc, ts)),
            # damit Mehrfach-Comebacks korrekt gematched werden. Skip
            # comebacks wo cb_acc == upload-actor (tot kann nicht
            # uploaden — physikalisch unmoeglich).
            matched_owner = None
            for cb in comeback_rows:
                cb_acc = cb["actor_account"]
                cb_ts = cb["timestamp_ms"]
                if cb_acc not in sq_set:
                    continue
                if cb_acc == acc:
                    continue
                dt = cb_ts - ts
                if dt < 0 or dt > 5 * 60 * 1000:
                    continue
                if (cb_acc, cb_ts) in matched_comebacks:
                    continue
                matched_owner = cb_acc
                matched_comebacks.add((cb_acc, cb_ts))
                break
            owner = matched_owner or queue_owner
            cr = _row_skeleton("BluechipUpload", ts, acc, owner, px, py)
            if matched_owner:
                cr["type"] = "chip_upload_comeback"
            elif owner is not None and owner in sq_set:
                cr["type"] = "chip_upload_comeback"
            elif owner is not None:
                cr["type"] = "chip_upload_carepackage"
            else:
                cr["type"] = "chip_upload"
            events_out.append(cr)

    events_out.sort(key=lambda x: x["tsMs"] or 0)

    return {
        "matchId":      match_id,
        "mapName":      map_name,
        "matchStartMs": match_start_ms,
        "takeoffMs":    takeoff_ms,
        "members":      out_members,
        "events":       events_out,
    }


def compute_vehicle_stats(conn, tenant_id: int, my_account_id, range_key="session",
                           from_iso=None, to_iso=None):
    """Pro Squad-Member (inkl. self) Vehicle-Action-Counter ueber alle
    BR-Matches in der Range.

    Pro Eintrag:
      accountId, name, isSelf, matches,
      knocksFromVehicle  — du knockst andere aus dem Fahrzeug heraus
      killsFromVehicle   — du killst andere aus dem Fahrzeug heraus
      knockedInVehicle   — du wirst geknockt waehrend du im Fahrzeug bist
      killedInVehicle    — du wirst getoetet waehrend du im Fahrzeug bist
      knockedInVehicleThenDied — knocked-in-vehicle + danach gestorben
                                 ohne Revive dazwischen

    'Im Fahrzeug' = Timestamp innerhalb eines VehicleEnter..VehicleLeave-
    Intervalls fuer diesen Spieler. Letzter VehicleEnter ohne Leave gilt
    bis Match-Ende.
    """
    if from_iso:
        cutoff = from_iso
        end_filter = " AND m.played_at <= ?" if to_iso else ""
        params = [tenant_id, my_account_id, cutoff]
        if to_iso:
            params.append(to_iso)
    else:
        cutoff = (_range_filter(conn, tenant_id, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        end_filter = ""
        params = [tenant_id, my_account_id, cutoff]
    br_where, br_params = _br_filter("m")
    params += br_params

    # 1) Range-Matches + mein Team + map_name pro Match
    match_rows = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.played_at,
               mtm.team_id AS my_team
        FROM matches m
        JOIN match_team_mapping mtm ON mtm.match_id = m.match_id AND mtm.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND mtm.account_id = ? AND m.played_at >= ?{end_filter}
          AND {br_where}
    """, params).fetchall()
    if not match_rows:
        return []
    match_team = {r["match_id"]: r["my_team"] for r in match_rows}
    match_meta = {r["match_id"]: {"map": r["map_name"],
                                     "playedAt": r["played_at"]}
                  for r in match_rows}
    match_ids = list(match_team.keys())
    ph = ",".join("?" * len(match_ids))

    # 2) Squad-Members pro Match (= alle aus meinem team_id)
    member_rows = conn.execute(f"""
        SELECT mtm.match_id, mtm.account_id, mtm.team_id,
               p.name AS player_name
        FROM match_team_mapping mtm
        LEFT JOIN players p ON p.account_id = mtm.account_id AND p.tenant_id = mtm.tenant_id
        WHERE mtm.tenant_id = ? AND mtm.match_id IN ({ph})
    """, [tenant_id] + match_ids).fetchall()
    # match_id -> set(account_id) (gefiltert auf my_team)
    squad_per_match = {}
    name_by_acc = {}
    for r in member_rows:
        mid = r["match_id"]
        if r["team_id"] != match_team.get(mid):
            continue
        acc = r["account_id"]
        if not acc:
            continue
        squad_per_match.setdefault(mid, set()).add(acc)
        if r["player_name"]:
            name_by_acc[acc] = r["player_name"]

    # 3) Alle relevanten Events fuer diese Matches in einem Schwung
    ev_rows = conn.execute(f"""
        SELECT match_id, event_type, timestamp_ms,
               actor_account, target_account,
               actor_x, actor_y, victim_x, victim_y, weapon
        FROM telemetry_events
        WHERE match_id IN ({ph})
          AND event_type IN ('VehicleEnter','VehicleLeave',
                              'Knock','Kill','Revive')
        ORDER BY match_id, timestamp_ms ASC
    """, match_ids).fetchall()
    # match_id -> list of event dicts
    events_per_match = {}
    match_start_by = {}  # match_id -> earliest ts seen (fuer relative Zeit)
    for r in ev_rows:
        ts = r["timestamp_ms"]
        if ts and (r["match_id"] not in match_start_by
                   or ts < match_start_by[r["match_id"]]):
            match_start_by[r["match_id"]] = ts
        events_per_match.setdefault(r["match_id"], []).append({
            "type": r["event_type"], "ts": ts,
            "actor": r["actor_account"], "target": r["target_account"],
            "ax": r["actor_x"],  "ay": r["actor_y"],
            "vx": r["victim_x"], "vy": r["victim_y"],
            "weapon": r["weapon"],
        })

    # Opponent-Name-Cache fuer Pretty-Print im Detail
    opp_name_cache = {}
    def _opp_name(acc):
        if not acc: return None
        if acc in opp_name_cache: return opp_name_cache[acc]
        r = conn.execute(
            "SELECT name FROM players WHERE tenant_id = ? AND account_id = ?",
            (tenant_id, acc,)).fetchone()
        n = r["name"] if r else None
        opp_name_cache[acc] = n
        return n

    # 4) Pro Match + Squad-Member die Counter aufsummieren
    INF = 10**15
    # account_id -> dict mit den 5 Countern + matches
    stats = {}

    def _ensure(acc):
        if acc not in stats:
            stats[acc] = {
                "accountId": acc,
                "name": name_by_acc.get(acc) or acc[:8],
                "isSelf": acc == my_account_id,
                "matches": 0,
                "evictionsDealt": 0,
                "evictionsTaken": 0,
                # Detail-Listen: pro Eviction-Event ein Dict mit
                # matchId, mapName, tsMs (relativ), x, y, vehicle, name, type
                "eventsDealt": [],
                "eventsTaken": [],
            }
        return stats[acc]

    def _add_event(acc, bucket, kind, mid, e, opponent_acc, vehicle_class):
        """Detail-Event ans bucket (eventsDealt/eventsTaken) anhaengen."""
        meta = match_meta.get(mid) or {}
        ts0 = match_start_by.get(mid) or 0
        stats[acc][bucket].append({
            "matchId":   mid,
            "mapName":   meta.get("map"),
            "playedAt":  meta.get("playedAt"),
            "tsMs":      (e["ts"] - ts0) if e.get("ts") and ts0 else None,
            "kind":      kind,          # 'kill' oder 'knock_died'
            "x":         e.get("vx"),
            "y":         e.get("vy"),
            "vehicle":   vehicle_class,
            "opponent":  _opp_name(opponent_acc),
        })

    def _in_intervals(ts, intervals):
        for ival in intervals:
            a, b = ival[0], ival[1]
            if a <= ts <= b:
                return True
        return False

    def _build_intervals(events, acc):
        """Returns list of (start_ts, end_ts, vehicle_class)."""
        cur = None
        cur_veh = None
        ivals = []
        for e in events:
            if e["actor"] != acc:
                continue
            if e["type"] == "VehicleEnter":
                cur = e["ts"]
                cur_veh = e.get("weapon")  # vehicleId
            elif e["type"] == "VehicleLeave" and cur is not None:
                ivals.append((cur, e["ts"], cur_veh))
                cur = None
                cur_veh = None
        if cur is not None:
            ivals.append((cur, INF, cur_veh))
        return ivals

    def _vehicle_in_intervals(ts, intervals):
        """Returns vehicle class if ts inside an interval, else None."""
        for a, b, veh in intervals:
            if a <= ts <= b:
                return veh
        return None

    for mid, squad in squad_per_match.items():
        events = events_per_match.get(mid, [])
        # Vehicle-Intervalle pro Squad-Member (fuer 'taken')
        intervals_by = {}
        for acc in squad:
            intervals_by[acc] = _build_intervals(events, acc)
            _ensure(acc)["matches"] += 1
        # Vehicle-Intervalle pro Gegner — nur fuer Accounts mit Enter
        # im Match, on-demand. (Caching ueber das Match-Loop hinweg
        # waere overkill — Squad-Matches haben ~20 Vehicle-Accounts max.)
        opp_intervals = {}
        for e in events:
            if e["type"] == "VehicleEnter" and e["actor"] and e["actor"] not in squad:
                opp_intervals.setdefault(e["actor"], None)
        for acc in list(opp_intervals.keys()):
            opp_intervals[acc] = _build_intervals(events, acc)

        # Helper: was zwischen ts und einem zukuenftigen Kill-Event,
        # gabs ein Revive fuer das Target?
        def _knock_leads_to_death(after_ts, target):
            for later in events:
                if later["ts"] is None or later["ts"] <= after_ts:
                    continue
                if later["type"] == "Revive" and later["target"] == target:
                    return False
                if later["type"] == "Kill" and later["target"] == target:
                    return True
            return False

        for e in events:
            t  = e["type"]; ts = e["ts"]
            if ts is None: continue
            actor = e["actor"]; target = e["target"]
            # === DEALT: actor=squad-member, target im vehicle ===
            if actor in squad and target:
                target_ivals = (intervals_by.get(target)
                                if target in squad
                                else opp_intervals.get(target, []))
                veh = _vehicle_in_intervals(ts, target_ivals)
                if t == "Kill" and veh is not None:
                    _ensure(actor)["evictionsDealt"] += 1
                    _add_event(actor, "eventsDealt", "kill",
                                mid, e, target, veh)
                elif t == "Knock" and veh is not None:
                    if _knock_leads_to_death(ts, target):
                        kill_in_veh = False
                        for later in events:
                            if (later["type"] == "Kill" and later["target"] == target
                                    and later["ts"] and later["ts"] > ts):
                                kill_in_veh = _in_intervals(
                                    later["ts"], target_ivals)
                                break
                        if not kill_in_veh:
                            _ensure(actor)["evictionsDealt"] += 1
                            _add_event(actor, "eventsDealt", "knock_died",
                                        mid, e, target, veh)

            # === TAKEN: target=squad-member, member im vehicle ===
            if target in squad:
                m_ivals = intervals_by[target]
                veh = _vehicle_in_intervals(ts, m_ivals)
                if t == "Kill" and veh is not None:
                    _ensure(target)["evictionsTaken"] += 1
                    _add_event(target, "eventsTaken", "kill",
                                mid, e, actor, veh)
                elif t == "Knock" and veh is not None:
                    if _knock_leads_to_death(ts, target):
                        kill_in_veh = False
                        for later in events:
                            if (later["type"] == "Kill" and later["target"] == target
                                    and later["ts"] and later["ts"] > ts):
                                kill_in_veh = _in_intervals(
                                    later["ts"], m_ivals)
                                break
                        if not kill_in_veh:
                            _ensure(target)["evictionsTaken"] += 1
                            _add_event(target, "eventsTaken", "knock_died",
                                        mid, e, actor, veh)

    # Detail-Listen pro Member chronologisch sortieren
    for s in stats.values():
        s["eventsDealt"].sort(key=lambda x: (x.get("playedAt") or "",
                                              x.get("tsMs") or 0))
        s["eventsTaken"].sort(key=lambda x: (x.get("playedAt") or "",
                                              x.get("tsMs") or 0))

    # Nur Mitglieder mit irgendeinem Eintrag liefern — saubere Liste
    out = [s for s in stats.values()
           if s["evictionsDealt"] > 0 or s["evictionsTaken"] > 0]
    out.sort(key=lambda s: (
        0 if s["isSelf"] else 1,
        -(s["evictionsDealt"] + s["evictionsTaken"]),
    ))
    return out


def compute_lobby_avg_kd(conn, tenant_id: int, my_account_id, range_key="session"):
    """Pro Match: Ø K/D aller ~60-100 Spieler in der Lobby.
    Plus Aggregat über Range. Idee: Lobby-Schwierigkeit messen.

    Lobby-K/D pro Match = SUM(kills) / max(SUM(deaths_proxy), 1)
    deaths_proxy: alle Teilnehmer minus Wins (#1) sind irgendwann gestorben,
    eine grobe Annäherung. Im Squad-Modus ist das nicht exakt, aber für
    Trend-Vergleiche zwischen Lobbys ausreichend.

    Liefert: {avg, my_kd, diff, perMatch: [{matchId, playedAt, lobbyKd, myKd}]}
    """
    cutoff = (_range_filter(conn, tenant_id, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")

    # Lobby-weite Aggregation aus match_team_mapping (alle ~96 Lobby-
    # Members + 4 Squad). Fallback: participants (squad-only) für Matches
    # vor match_schema=3, deren Lobby-Mapping noch keine kills+place hat.
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT m.match_id, m.played_at,
               SUM(COALESCE(mtm.kills, 0)) AS lobby_kills,
               COUNT(mtm.account_id)        AS lobby_n,
               SUM(CASE WHEN mtm.place=1 THEN 1 ELSE 0 END) AS lobby_wins
        FROM matches m
        JOIN match_team_mapping mtm ON mtm.match_id = m.match_id AND mtm.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.match_id IN (
          SELECT match_id FROM participants WHERE tenant_id = ? AND account_id = ?
        ) AND m.played_at >= ?
          AND mtm.kills IS NOT NULL
          AND {br_where}
        GROUP BY m.match_id
        HAVING COUNT(mtm.account_id) > 4   -- nur Matches mit echtem Lobby-Mapping
        ORDER BY m.played_at ASC
    """, (tenant_id, tenant_id, my_account_id, cutoff, *br_params)).fetchall()

    per_match = []
    sum_lobby_kd = 0.0
    n = 0
    for r in rows:
        kills = r["lobby_kills"] or 0
        ln = r["lobby_n"] or 0
        wins = r["lobby_wins"] or 0
        deaths_proxy = max(ln - wins, 1)
        lobby_kd = kills / deaths_proxy
        my = conn.execute(
            "SELECT kills, place FROM participants "
            "WHERE tenant_id = ? AND match_id = ? AND account_id = ?",
            (tenant_id, r["match_id"], my_account_id),
        ).fetchone()
        my_kills = my["kills"] if my else 0
        my_kd = my_kills if (my and my["place"] == 1) else my_kills
        # my_kd vereinfacht: kills im Match. Echte K/D pro Match ist undefiniert
        # (1 Death max), darum führen wir hier "my kills in match" als Proxy.
        per_match.append({
            "matchId": r["match_id"],
            "playedAt": r["played_at"],
            "lobbyKd": lobby_kd,
            "myKills": my_kills,
        })
        sum_lobby_kd += lobby_kd
        n += 1

    avg_lobby_kd = (sum_lobby_kd / n) if n else 0
    # Eigene Session-K/D aus existierender Aggregation berechnen
    my_session = conn.execute("""
        SELECT SUM(p.kills) AS k, COUNT(*) AS n,
               SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w
        FROM participants p JOIN matches m ON m.match_id = p.match_id AND m.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.account_id = ? AND m.played_at >= ?
    """, (tenant_id, my_account_id, cutoff)).fetchone()
    my_k = (my_session and my_session["k"]) or 0
    my_n = (my_session and my_session["n"]) or 0
    my_w = (my_session and my_session["w"]) or 0
    my_kd_session = my_k / max(my_n - my_w, 1)

    return {
        "avg": avg_lobby_kd,
        "myKd": my_kd_session,
        "diff": my_kd_session - avg_lobby_kd,
        "matches": n,
        "perMatch": per_match,
    }


def compute_squad_kd(conn, tenant_id: int, my_account_id, range_key="session"):
    """Squad-K/D über einen Zeitraum (session/week/all).
    Squad = pro Match alle match_team_mapping-Einträge mit my_team_id.
    K/D = SUM(squad_kills) / max(matches - squad_wins, 1).

    Liefert: {squadKd, myKd, diff, matches, kills, wins, kpm, perMatch}
    """
    cutoff = (_range_filter(conn, tenant_id, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")

    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        WITH my_teams AS (
          SELECT mtm.match_id, mtm.team_id
          FROM match_team_mapping mtm
          JOIN matches m ON m.match_id = mtm.match_id AND m.tenant_id = mtm.tenant_id
          WHERE mtm.tenant_id = ? AND mtm.account_id = ? AND m.played_at >= ?
            AND {br_where}
        )
        SELECT m.match_id, m.played_at, m.duration_secs,
               SUM(COALESCE(mtm.kills, 0)) AS sq_kills,
               COUNT(*)                     AS team_size,
               SUM(CASE WHEN mtm.time_survived IS NOT NULL
                          AND mtm.time_survived < m.duration_secs - 5
                        THEN 1 ELSE 0 END)  AS sq_deaths_real,
               SUM(CASE WHEN mtm.time_survived IS NULL THEN 1 ELSE 0 END)
                                            AS sq_no_surv,
               MAX(CASE WHEN mtm.place=1 THEN 1 ELSE 0 END) AS sq_won
        FROM matches m
        JOIN my_teams mt ON mt.match_id = m.match_id
        JOIN match_team_mapping mtm ON mtm.match_id = m.match_id
                                    AND mtm.tenant_id = m.tenant_id
                                    AND mtm.team_id = mt.team_id
        WHERE m.tenant_id = ? AND mtm.kills IS NOT NULL
        GROUP BY m.match_id, m.played_at, m.duration_secs
        ORDER BY m.played_at ASC
    """, (tenant_id, my_account_id, cutoff, *br_params, tenant_id)).fetchall()

    per_match = []
    total_kills = 0
    total_wins = 0
    total_deaths = 0
    for r in rows:
        kills = r["sq_kills"] or 0
        team_size = r["team_size"] or 0
        won = r["sq_won"] or 0
        # Death pro Mate via time_survived. Fallback (Schema 3): alle
        # team_size tot wenn Match verloren.
        if r["sq_no_surv"]:
            deaths = 0 if won else team_size
        else:
            deaths = r["sq_deaths_real"] or 0
        per_match.append({
            "matchId": r["match_id"],
            "playedAt": r["played_at"],
            "squadKills": kills,
            "teamSize": team_size,
            "deaths": deaths,
            "won": bool(won),
        })
        total_kills += kills
        total_wins += won
        total_deaths += deaths

    n = len(per_match)
    squad_kd = (total_kills / max(total_deaths, 1)) if n else 0
    kpm = (total_kills / n) if n else 0

    # Eigene K/D aus participants über denselben Zeitraum als Vergleich
    my = conn.execute("""
        SELECT SUM(p.kills) AS k, COUNT(*) AS n,
               SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w
        FROM participants p JOIN matches m ON m.match_id = p.match_id AND m.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.account_id = ? AND m.played_at >= ?
    """, (tenant_id, my_account_id, cutoff)).fetchone()
    my_k = (my and my["k"]) or 0
    my_n = (my and my["n"]) or 0
    my_w = (my and my["w"]) or 0
    my_kd = my_k / max(my_n - my_w, 1) if my_n else 0

    return {
        "squadKd": squad_kd,
        "myKd": my_kd,
        "diff": squad_kd - my_kd,
        "matches": n,
        "kills": total_kills,
        "wins": total_wins,
        "kpm": kpm,
        "perMatch": per_match,
    }


def compute_streaks(conn, tenant_id: int, my_account_id, range_key="session"):
    """Streaks pro Typ (chicken/top10/kd1) über einen Range.
    Liefert pro Typ: current (am Ende laufender Streak), best (höchster
    Streak im Range), bestEndedAt (wann der best-Streak endete).

    Liefert: {chicken: {...}, top10: {...}, kd1: {...}, range, matches}
    """
    cutoff = (_range_filter(conn, tenant_id, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")

    # Matches chronologisch (ASC) damit wir die best-Streaks korrekt finden,
    # current = letzter laufender Streak am Ende.
    # Event-Modes (TDM, PAYDAY etc.) sind ausgenommen — Place=1 in Events
    # bedeutet nicht Chicken-Win.
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT m.match_id, m.played_at, p.place, p.kills
        FROM matches m
        JOIN participants p ON p.match_id = m.match_id AND p.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND p.account_id = ? AND m.played_at >= ?
          AND {br_where}
        ORDER BY m.played_at ASC
    """, (tenant_id, my_account_id, cutoff, *br_params)).fetchall()

    tests = {
        "chicken": lambda r: (r["place"] or 99) == 1,
        "top10":   lambda r: (r["place"] or 99) <= 10,
        "kd1":     lambda r: (r["kills"] or 0) >= 1,
        "kd2":     lambda r: (r["kills"] or 0) >= 2,
    }

    out = {}
    for key, test in tests.items():
        run = 0
        best = 0
        best_ended_at = None
        last_ended_at = None
        for r in rows:
            if test(r):
                run += 1
                last_ended_at = r["played_at"]
                if run > best:
                    best = run
                    best_ended_at = r["played_at"]
            else:
                run = 0
                last_ended_at = None
        out[key] = {
            "current": run,
            "best": best,
            "bestEndedAt": best_ended_at,
        }

    return {
        "range": range_key,
        "matches": len(rows),
        **out,
    }


def compute_lobby_top3_kd(conn, tenant_id: int, my_account_id, range_key="session",
                            match_ids=None):
    """Lobby-Skill-Indikator via Top-3-Fragger pro Match.
    Pro Match: Top-3 nach Kills in der Lobby, ihre Round-K/D nehmen
    (kills/max(deaths,1)) und mitteln. Über alle Matches der Range
    nochmal mitteln. Plus Top-3-Avg-Kills als Vergleichswert.

    Hohe Zahl = harte Lobby (Top-Fragger schreddern). Braucht nur
    match_team_mapping (kein Career-Fetch).

    `match_ids` optional: wenn gesetzt, range_key wird ignoriert.

    Liefert: {top3Kd, top3Kills, matches, perMatch}
    """
    if match_ids is None:
        cutoff = (_range_filter(conn, tenant_id, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        matches = conn.execute("""
            SELECT m.match_id, m.played_at, m.duration_secs
            FROM matches m
            WHERE m.tenant_id = ? AND m.match_id IN (
                SELECT match_id FROM participants WHERE tenant_id = ? AND account_id = ?
            ) AND m.played_at >= ?
            ORDER BY m.played_at ASC
        """, (tenant_id, tenant_id, my_account_id, cutoff)).fetchall()
    else:
        if not match_ids:
            return {"top3Kd": 0, "top3Kills": 0, "matches": 0, "perMatch": []}
        ph = ",".join("?" * len(match_ids))
        matches = conn.execute(
            f"SELECT match_id, played_at, duration_secs FROM matches "
            f"WHERE tenant_id = ? AND match_id IN ({ph}) ORDER BY played_at ASC",
            [tenant_id] + match_ids,
        ).fetchall()

    per_match = []
    sum_kd = 0.0
    sum_kills = 0.0
    n = 0
    for m in matches:
        top3 = conn.execute("""
            SELECT kills, place, time_survived
            FROM match_team_mapping
            WHERE tenant_id = ? AND match_id = ? AND kills IS NOT NULL
            ORDER BY kills DESC
            LIMIT 3
        """, (tenant_id, m["match_id"],)).fetchall()
        if len(top3) < 3:
            continue
        dur = m["duration_secs"] or 0
        kds = []
        for r in top3:
            k = r["kills"] or 0
            if r["time_survived"] is not None and dur:
                died = r["time_survived"] < dur - 5
            else:
                died = (r["place"] or 99) != 1
            # K/D = kills/deaths. Tot=1 Death, lebt=keine Deaths → K/D = k
            # (in beiden Fällen mathematisch k, aber als K/D-Semantik klar)
            kds.append(k / max(1 if died else 0, 1) if died else k)
        match_kd = sum(kds) / 3
        match_kills = sum(r["kills"] or 0 for r in top3) / 3
        per_match.append({
            "matchId": m["match_id"],
            "playedAt": m["played_at"],
            "top3Kd": match_kd,
            "top3Kills": match_kills,
        })
        sum_kd += match_kd
        sum_kills += match_kills
        n += 1

    return {
        "top3Kd": (sum_kd / n) if n else 0,
        "top3Kills": (sum_kills / n) if n else 0,
        "matches": n,
        "perMatch": per_match,
    }


def compute_trend_deltas(conn, tenant_id: int, my_account_id, from_iso=None, to_iso=None,
                          gap_hours=4):
    """Vergleich gewählte Session vs. die direkt davor liegende Session.
    Wenn from_iso/to_iso None: aktuelle (= jüngste) Session.
    Sonst: Session deren [from,to]-Range from_iso enthält.

    Liefert Deltas für K/D, Wins, Avg-DMG, Matches.
    """
    sessions = compute_sessions_index(conn, tenant_id, my_account_id, gap_hours=gap_hours)
    if not sessions:
        return {"current": None, "previous": None, "deltas": None}

    def _agg(start, end):
        br_where, br_params = _br_filter("m")
        sql = f"""
            SELECT SUM(p.kills) AS k, COUNT(*) AS n,
                   SUM(CASE WHEN p.place=1 THEN 1 ELSE 0 END) AS w,
                   AVG(p.damage_dealt) AS avg_dmg
            FROM participants p JOIN matches m ON m.match_id = p.match_id AND m.tenant_id = p.tenant_id
            WHERE p.tenant_id = ? AND p.account_id = ? AND m.played_at >= ?
              AND {br_where}
        """
        params = [tenant_id, my_account_id, start, *br_params]
        if end:
            sql += " AND m.played_at <= ?"
            params.append(end)
        r = conn.execute(sql, params).fetchone()
        n = (r and r["n"]) or 0
        w = (r and r["w"]) or 0
        k = (r and r["k"]) or 0
        return {
            "matches": n,
            "wins": w,
            "kd": k / max(n - w, 1),
            "avgDmg": (r and r["avg_dmg"]) or 0,
        }

    # Index der aktuellen Session in der Liste (sortiert: jüngste zuerst)
    cur_idx = 0
    if from_iso:
        # finde Session deren Range from_iso enthält
        for i, s in enumerate(sessions):
            if s["from"] <= from_iso <= s["to"]:
                cur_idx = i
                break
            if s["from"] == from_iso:
                cur_idx = i
                break
        else:
            # exakte Übereinstimmung von from_iso mit s["from"]
            for i, s in enumerate(sessions):
                if s["from"].startswith(from_iso[:19]):
                    cur_idx = i
                    break

    cur_session = sessions[cur_idx]
    cur_to = cur_session["to"] if cur_idx > 0 else None
    cur = _agg(cur_session["from"], cur_to)

    prev = None
    if cur_idx + 1 < len(sessions):
        prev_session = sessions[cur_idx + 1]
        prev = _agg(prev_session["from"], prev_session["to"])

    deltas = None
    if prev:
        deltas = {
            "kd":      cur["kd"] - prev["kd"],
            "wins":    cur["wins"] - prev["wins"],
            "avgDmg":  cur["avgDmg"] - prev["avgDmg"],
            "matches": cur["matches"] - prev["matches"],
        }
    return {"current": cur, "previous": prev, "deltas": deltas}


# PAYDAY/Heist-Item-Klassifizierung. Mapping ItemId -> Display-Kategorie.
# Items die nicht hier auftauchen werden als 'other' gruppiert.
PAYDAY_LOOT_LABELS = {
    "Item_MoneyBagged":             ("Money Bag",     "💰"),
    "Item_GoldBricks_0":            ("Gold Brick",    "🟨"),
    "Item_JewelryBox_01":           ("Jewelry Box",   "💎"),
    "Item_Neon_Coin_HR_C":          ("Neon Coin",     "🪙"),
    "Item_KeyCard_01_B":            ("Keycard",       "🗝️"),
    "Item_Breaching_C4_0":          ("Breaching C4",  "💣"),
    "Item_Breaching_Fuel_Oxygen_0": ("Oxygen Tank",   "🧪"),
    "Item_Thermal_Lance_Bag_0":     ("Thermal Lance", "🔥"),
    "Item_Bodybag_HR":              ("Bodybag",       "🧳"),
    "Item_Weapon_Crowbar_HR_C":     ("Crowbar",       "🔧"),
}


def compute_payday_stats(conn, tenant_id: int, my_account_id, range_key="all",
                         from_iso=None, to_iso=None):
    """Pro PAYDAY/Event-Match: echte Stats aus Telemetry rekonstruieren
    (PUBG-Match-Summary liefert 0/0/win, ist Schrott).

    Returns dict { matches: [{matchId, playedAt, mapName, gameMode,
        myKills, myDamage, squadKills, squadDamage,
        loot: {itemId: count, ...}, lootTotal,
        windows, doors, ...}], totals: {...} }
    """
    cutoff = (_range_filter(conn, tenant_id, range_key)
              if range_key != "all" else "1970-01-01T00:00:00Z")
    if from_iso: cutoff = from_iso
    end_filter = " AND m.played_at <= ?" if to_iso else ""
    params = [tenant_id, my_account_id, cutoff]
    if to_iso: params.append(to_iso)

    # Alle Event-Matches (= nicht BR) in der Range
    br_where, br_params = _br_filter("m")
    matches = conn.execute(f"""
        SELECT m.match_id, m.played_at, m.map_name, m.game_mode,
               pa.team_id
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?{end_filter}
          AND NOT {br_where}
        ORDER BY m.played_at DESC
    """, params + br_params).fetchall()
    if not matches:
        return {"matches": [], "totals": {}}

    out_matches = []
    for m in matches:
        mid = m["match_id"]
        team = m["team_id"]
        # Squad-Account-IDs in dem Match
        squad = [r["account_id"] for r in conn.execute(
            "SELECT account_id FROM participants WHERE tenant_id=? AND match_id=? AND team_id=?",
            (tenant_id, mid, team)).fetchall()]
        if not squad:
            continue
        ph = ",".join("?" * len(squad))

        # Eigene Kills aus Telemetry
        my_kills = (conn.execute(
            f"SELECT COUNT(*) AS c FROM telemetry_events "
            f"WHERE match_id = ? AND event_type='Kill' AND actor_account=?",
            (mid, my_account_id)).fetchone() or {}).get("c", 0)
        # Eigener Damage (Sum von TakeDamage als attacker)
        my_dmg = (conn.execute(
            "SELECT COALESCE(SUM(damage), 0) AS s FROM telemetry_events "
            "WHERE match_id = ? AND event_type='TakeDamage' AND actor_account=?",
            (mid, my_account_id)).fetchone() or {}).get("s", 0) or 0
        # Squad-Aggregat (incl. self)
        sq_kills = (conn.execute(
            f"SELECT COUNT(*) AS c FROM telemetry_events "
            f"WHERE match_id = ? AND event_type='Kill' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone() or {}).get("c", 0)
        sq_dmg = (conn.execute(
            f"SELECT COALESCE(SUM(damage), 0) AS s FROM telemetry_events "
            f"WHERE match_id = ? AND event_type='TakeDamage' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone() or {}).get("s", 0) or 0

        # Per-Mate-Breakdown: Kills + DMG pro Squad-Member.
        # PUBG-API liefert in Events keine Player-Stats → wir
        # rekonstruieren das aus Telemetry. Name kommt aus players-
        # Tabelle (account_id -> name), Fallback name=account_id.
        mate_kills = {r["actor_account"]: r["k"] for r in conn.execute(
            f"SELECT actor_account, COUNT(*) AS k FROM telemetry_events "
            f"WHERE match_id = ? AND event_type='Kill' "
            f"AND actor_account IN ({ph}) GROUP BY actor_account",
            [mid, *squad]).fetchall()}
        mate_dmg = {r["actor_account"]: float(r["d"] or 0) for r in conn.execute(
            f"SELECT actor_account, COALESCE(SUM(damage),0) AS d "
            f"FROM telemetry_events "
            f"WHERE match_id = ? AND event_type='TakeDamage' "
            f"AND actor_account IN ({ph}) GROUP BY actor_account",
            [mid, *squad]).fetchall()}
        mate_loot = {}
        for r in conn.execute(
            f"SELECT actor_account, COUNT(*) AS c FROM telemetry_events "
            f"WHERE match_id = ? AND event_type='ItemPickup' "
            f"AND actor_account IN ({ph}) AND weapon IS NOT NULL "
            f"GROUP BY actor_account", [mid, *squad]).fetchall():
            mate_loot[r["actor_account"]] = r["c"]
        # Account-ID -> Name. Fallback Account-ID-Kuerzung.
        names = {r["account_id"]: r["name"] for r in conn.execute(
            f"SELECT account_id, name FROM players "
            f"WHERE account_id IN ({ph})", [tenant_id] + squad).fetchall()}
        mates = []
        for acc in squad:
            mates.append({
                "name":   names.get(acc, acc[:12]),
                "isSelf": acc == my_account_id,
                "kills":  mate_kills.get(acc, 0),
                "damage": mate_dmg.get(acc, 0.0),
                "loot":   mate_loot.get(acc, 0),
            })
        # Self oben, Rest nach DMG absteigend.
        mates.sort(key=lambda x: (not x["isSelf"], -x["damage"]))

        # Loot-Pickups (Squad) — gruppiert nach itemId
        loot = {}
        for r in conn.execute(
            f"SELECT weapon AS item_id, COUNT(*) AS c "
            f"FROM telemetry_events WHERE match_id=? "
            f"AND event_type='ItemPickup' AND actor_account IN ({ph}) "
            f"AND weapon IS NOT NULL GROUP BY weapon",
            [mid, *squad]).fetchall():
            loot[r["item_id"]] = r["c"]

        # Objects (Window destroy, Door open) Squad
        windows = (conn.execute(
            f"SELECT COUNT(*) AS c FROM telemetry_events WHERE match_id=? "
            f"AND event_type='ObjectDestroy' AND weapon='Window' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone() or {}).get("c", 0)
        doors_opened = (conn.execute(
            f"SELECT COUNT(*) AS c FROM telemetry_events WHERE match_id=? "
            f"AND event_type='ObjectInteraction' AND weapon='Door:Opening' "
            f"AND actor_account IN ({ph})",
            [mid, *squad]).fetchone() or {}).get("c", 0)

        out_matches.append({
            "matchId":    mid,
            "playedAt":   m["played_at"],
            "mapName":    m["map_name"],
            "gameMode":   m["game_mode"],
            "myKills":    my_kills,
            "myDamage":   float(my_dmg),
            "squadKills": sq_kills,
            "squadDamage": float(sq_dmg),
            "mates":      mates,
            "loot":       loot,
            "lootTotal":  sum(loot.values()),
            "windows":    windows,
            "doors":      doors_opened,
        })

    # Totals ueber alle Event-Matches
    tot = {
        "matches":     len(out_matches),
        "myKills":     sum(m["myKills"] for m in out_matches),
        "myDamage":    sum(m["myDamage"] for m in out_matches),
        "squadKills":  sum(m["squadKills"] for m in out_matches),
        "squadDamage": sum(m["squadDamage"] for m in out_matches),
        "windows":     sum(m["windows"] for m in out_matches),
        "doors":       sum(m["doors"] for m in out_matches),
        "loot":        {},
    }
    for m in out_matches:
        for k, v in m["loot"].items():
            tot["loot"][k] = tot["loot"].get(k, 0) + v
    tot["lootTotal"] = sum(tot["loot"].values())
    return {"matches": out_matches, "totals": tot,
            "labels": PAYDAY_LOOT_LABELS}


def compute_map_performance(conn, tenant_id: int, my_account_id, range_key="all"):
    """Pro Map: Matches, Wins, K/D, Ø Kills/DMG/Place/Surv.
    range_key: 'session' | 'day' | 'week' | 'all'."""
    cutoff = _range_filter(conn, tenant_id, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT m.map_name,
               COUNT(*) AS matches,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               SUM(pa.kills) AS kills,
               SUM(pa.damage_dealt) AS damage,
               AVG(pa.place) AS avg_place,
               AVG(pa.time_survived) AS avg_surv,
               MAX(pa.longest_kill) AS longest_kill
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?
          AND {br_where}
        GROUP BY m.map_name
        ORDER BY matches DESC
    """, (tenant_id, my_account_id, cutoff, *br_params)).fetchall()
    out = []
    for r in rows:
        n = r["matches"] or 0
        wins = r["wins"] or 0
        kills = r["kills"] or 0
        damage = r["damage"] or 0
        out.append({
            "map": r["map_name"],
            "matches": n,
            "wins": wins,
            "kills": kills,
            "damage": damage,
            "avgKills": (kills / n) if n else 0,
            "avgDamage": (damage / n) if n else 0,
            "avgPlace": r["avg_place"] or 0,
            "avgSurvivedSec": r["avg_surv"] or 0,
            "kd": kills / max(n - wins, 1),
            "winRate": (wins / n * 100) if n else 0,
            "longestKill": r["longest_kill"] or 0,
        })
    return out


def _ms_to_iso(ms):
    """Epoch-ms (von Telemetry) → ISO-Z-String."""
    if not ms:
        return None
    return datetime.datetime.fromtimestamp(
        ms / 1000, datetime.timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


def _compute_top10_reached_at(conn, tenant_id: int, match_id, my_account_id):
    """Liefert ISO-Timestamp (UTC), wann das Match Top-10 erreicht hat
    (= 10. Squad eliminiert wurde, also nur noch 10 Squads im Spiel).
    Falls Telemetry fehlt oder Match < 11 Squads: None.
    """
    parts = conn.execute("""
        SELECT account_id, team_id FROM participants WHERE tenant_id = ? AND match_id = ?
    """, (tenant_id, match_id,)).fetchall()
    if not parts:
        return None
    acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
    teams_alive = {}
    for p in parts:
        teams_alive.setdefault(p["team_id"], set()).add(p["account_id"])
    n_teams = len(teams_alive)
    if n_teams <= 10:
        return None
    threshold = n_teams - 10  # so viele Squads müssen tot sein

    events = conn.execute("""
        SELECT timestamp_ms, target_account FROM telemetry_events
        WHERE match_id = ? AND event_type = 'Kill'
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    if not events:
        return None

    eliminated_teams = 0
    for e in events:
        victim = e["target_account"]
        team_id = acc_to_team.get(victim)
        if team_id is None:
            continue
        members = teams_alive.get(team_id)
        if not members:
            continue
        members.discard(victim)
        if not members:
            eliminated_teams += 1
            if eliminated_teams >= threshold:
                return _ms_to_iso(e["timestamp_ms"])
    return None


# Kill-Match-Tiers: jeder Tier den ein Match erreicht wird emittiert
# (kumulativ), aber im Popup feuert nur der hoechste. Das gibt dem
# Browser saubere 'Sessions die mind. ≥N Kills hatten'-Pcts, ohne
# Popup-Spam.
KILL_TIERS = [
    (20, "kills_20", "20-Bomb"),
    (15, "kills_15", "Annihilation"),
    (10, "kills_10", "Massacre"),
    (7,  "kills_7",  "Slaughterhouse"),
    (5,  "kills_5",  "Killing Survivor"),
]
DAMAGE_TIERS = [
    (3000, "damage_3000", "GODLIKE"),
    (2500, "damage_2500", "Damage Lord"),
    (2000, "damage_2000", "Damage Demon"),
    (1500, "damage_1500", "Big Damage"),
    (1000, "damage_1000", "Damage Dealer"),
    (500,  "damage_500",  "Heavy Hitter"),
]
LONGEST_KILL_TIERS = [
    (1000, "longest_kill_1000", "Kilometer Kill"),
    (800,  "longest_kill_800",  "Cross-Map Connection"),
    (600,  "longest_kill_600",  "Sniper Elite"),
    (400,  "longest_kill_400",  "Long-Range Ranger"),
]


def _emit_tier_cascade(out, seen, tiers, value, value_label_fn,
                       match_id, played):
    """Emittiert ALLE erreichten Tiers fuer einen Wert (Kills, DMG,
    Longest-Kill). tiers ist DESC sortiert.

    Per-Match-Emission: jeder Match der einen Tier erreicht bekommt
    seine eigenen Rows in pubg_achievements_seen. Popup-Suppression:
    - innerhalb desselben Matches poppt nur der hoechste Tier
    - ueber die Session hinweg poppt jeder Tier nur einmal (erste
      Match-Vorkommen); die seen-Liste merkt sich was schon gepoppt
      ist und markiert spaetere Vorkommen als suppressPopup=True.

    So sieht der Browser/Report fuer Match #17 mit 600 DMG auch
    'Heavy Hitter' — auch wenn der Popup-Stream das schon bei Match
    #5 gepoppt hat."""
    qualifying = [(t, aid, name) for t, aid, name in tiers if value >= t]
    if not qualifying:
        return
    for i, (threshold, aid, name) in enumerate(qualifying):
        # i=0 → hoechster erreichter Tier dieses Matches. Suppressed
        # wenn er in der Session schon gepoppt wurde.
        already_popped = aid in seen
        out.append({
            "id": aid,
            "label": f"{name} · {value_label_fn(value)}",
            "icon": "🔥",
            "matchId": match_id,
            "playedAt": played,
            "suppressPopup": i > 0 or already_popped,
        })
        seen.add(aid)


def _career_win_number(conn, tenant_id: int, my_account_id, match_id, played_at):
    """Wie viele BR-Chicken-Wins (career-weit) hat der Spieler bis
    inkl. diesem Match? Authoritative Quelle: player_lifetime.wins
    (PUBG-API, mode='all'). Local-count waere unzuverlaessig wenn die
    Match-DB historisch luecken hat (PUBG-API liefert nur 14d).

    Berechnung:
      offset = lifetime.wins - SUM(local_wins_in_DB)
      result = local_wins_bis_match_X + offset

    offset deckt alte Wins ab, die nicht in der Match-DB sind. Wenn
    lifetime nicht verfuegbar → Fallback auf rein lokale Zaehlung.
    Tiebreaker bei gleichem played_at: match_id, damit deterministisch.
    """
    ph = ",".join("?" * len(BATTLE_ROYALE_MODES))
    # 1) Lokale Wins bis inkl. diesem Match
    row = conn.execute(f"""
        SELECT COUNT(*) AS n
        FROM participants p
        JOIN matches m ON m.match_id = p.match_id AND m.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.account_id = ?
          AND p.place = 1
          AND m.game_mode IN ({ph})
          AND (m.played_at < ?
               OR (m.played_at = ? AND m.match_id <= ?))
    """, [tenant_id, my_account_id] + list(BATTLE_ROYALE_MODES)
         + [played_at, played_at, match_id]).fetchone()
    local_at = (row["n"] if row else 0) or 0

    # 2) Lifetime-Total + lokale Total → Offset
    lr = conn.execute(
        "SELECT wins FROM player_lifetime "
        "WHERE tenant_id = ? AND account_id = ? AND mode = 'all'",
        (tenant_id, my_account_id,)).fetchone()
    if not lr or lr["wins"] is None:
        return local_at  # Fallback wenn lifetime fehlt
    lifetime_wins = int(lr["wins"])
    tr = conn.execute(f"""
        SELECT COUNT(*) AS n
        FROM participants p
        JOIN matches m ON m.match_id = p.match_id AND m.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.account_id = ?
          AND p.place = 1
          AND m.game_mode IN ({ph})
    """, [tenant_id, my_account_id] + list(BATTLE_ROYALE_MODES)).fetchone()
    local_total = (tr["n"] if tr else 0) or 0
    offset = lifetime_wins - local_total
    # Negativer Offset (lokal > lifetime) sollte nicht passieren — kann
    # nur bei Stale-Lifetime auftreten. In dem Fall ignorieren, sonst
    # wuerden wir Milestones zurueckdatieren.
    if offset < 0:
        offset = 0
    return local_at + offset


def compute_session_achievements(conn, tenant_id: int, my_account_id, from_iso=None, to_iso=None):
    """Detected Achievements der aktuellen oder einer historischen Session.
    from_iso/to_iso optional — sonst aktuelle Session.

    Achievements (max. 1 pro Typ pro Session ausser Tier-Cascades und
    Streaks/Counters):
      - first_chicken / first_top10 / session_opener_*: jeweils einmal
      - beast_chicken: place==1 + kills>=5, mehrfach
      - phoenix_chicken: erster Hot-Drop-Chicken-Win der Session
      - Kill-Tiers   : kills_5/_7/_10/_15/_20 (kumulativ; nur hoechster
                       NEUER Tier poppt, Rest mit suppressPopup in DB)
      - DMG-Tiers    : damage_500/.../damage_3000 (gleiche Logik)
      - Longest-Kill : longest_kill_400/_600/_800/_1000 (gleiche Logik)
      - hot_drop_match / hot_drop_match_survived: x-N-Counter
      - top3_streak / top10_streak / chicken_streak: ab x2, mehrfach

    Returns Liste { id, label, icon, matchId, playedAt } sortiert
    nach playedAt ASC (Reihenfolge des Erreichens).
    """
    # Event-Modes (TDM, PAYDAY etc.) werden hart gefiltert — keine
    # Achievements/Milestones aus Event-Matches.
    matches_desc = compute_session_matches(
        conn, tenant_id, my_account_id, "session",
        from_iso=from_iso, to_iso=to_iso,
        include_events=False)
    matches = list(reversed(matches_desc))  # ASC für Achievement-Reihenfolge

    out = []
    seen = set()
    win_seen = False
    top10_seen = False

    # Session-Opener: erster Match der Session war direkt ein Top-10
    # oder sogar ein Chicken. Mutual exclusive — Chicken trumps Top-10,
    # damit kein redundantes Popup kommt (Chicken ist inherently Top-10).
    if matches:
        first_m = matches[0]
        first_place = first_m["place"] or 99
        if first_place == 1:
            out.append({
                "id": "session_opener_chicken",
                "label": "Cold Start Chicken",
                "icon": "🔥",
                "matchId": first_m["matchId"],
                "playedAt": first_m["playedAt"],
            })
        elif first_place <= 10:
            out.append({
                "id": "session_opener_top10",
                "label": f"Pretty Good Start · #{first_place}",
                "icon": "🏆",
                "matchId": first_m["matchId"],
                "playedAt": first_m["playedAt"],
            })
    # Streaks: laufende Laenge tracken, bei jedem neuen Peak (≥2)
    # ein Achievement emitten. Bei Break (Match ausserhalb Bedingung)
    # auf 0 zuruecksetzen. Pro Streak-Run koennen mehrere Peaks emitten
    # (x2, x3, x4, ...) — Browser-Aggregat klappt sie zusammen.
    top3_streak = 0
    top10_streak = 0
    chicken_streak = 0
    for m in matches:
        place = m["place"] or 99
        kills = m["kills"] or 0
        damage = m["damage"] or 0
        longest = m["longestKill"] or 0
        played = m["playedAt"]

        # 100 Einheiten = 1 Meter (Telemetry/PUBG-Welt)
        longest_m = longest if longest < 50 else longest / 100  # Fallback

        # Jedes Chicken bekommt einen eigenen Milestone — jeder Win ist
        # das Highlight der Runde. PK (achievement_id, match_id) stellt
        # Eindeutigkeit sicher. win_seen bleibt fuer Streak-Logik aktiv.
        if place == 1:
            out.append({
                "id": "chicken",
                "label": "Dinner Served",
                "icon": "",
                "matchId": m["matchId"], "playedAt": played,
            })
            win_seen = True

        # Career-Wins-Milestone: bei jedem Chicken-Win die kumulative
        # Career-Win-Number bis zu diesem Match berechnen — wenn glatte
        # 100er-Marke, emit ein Milestone-Achievement. Tiers:
        #   N % 1000 == 0 → 'GRAND' (legendary via session_pct snapshot)
        #   N %  500 == 0 → 'Half-Grand' (mythic-ish)
        #   N %  100 == 0 → Standard-Milestone (rare)
        if place == 1:
            cwn = _career_win_number(conn, tenant_id, my_account_id, m["matchId"], played)
            if cwn and cwn >= 100 and cwn % 100 == 0:
                aid = f"wins_milestone_{cwn}"
                # Global einmalig: nur anlegen wenn noch kein Eintrag
                # fuer diesen Milestone existiert (egal welcher Match).
                # Verhindert dass ein fehlerhafter cwn-Wert bei jeder
                # Session einen neuen Popup-Eintrag produziert.
                already = conn.execute(
                    "SELECT 1 FROM pubg_achievements_seen "
                    "WHERE tenant_id = ? AND achievement_id = ? LIMIT 1",
                    (tenant_id, aid,)).fetchone()
                if not already:
                    if cwn % 1000 == 0:
                        label_prefix = "GRAND CHICKEN"
                        icon = "👑"
                    elif cwn % 500 == 0:
                        label_prefix = "Half-Grand Chicken"
                        icon = "🏆"
                    else:
                        label_prefix = "Career Milestone"
                        icon = "🏆"
                    out.append({
                        "id":      aid,
                        "label":   f"{label_prefix} · {cwn} Career Wins",
                        "icon":    icon,
                        "matchId": m["matchId"],
                        "playedAt": played,
                        "isRare":  (cwn % 500 == 0),
                    })

        if not top10_seen and place <= 10:
            # playedAt = Zeitpunkt wo das Team Top-10 erreicht hat (10.
            # Squad eliminiert), nicht Match-Ende. Fallback auf Match-
            # Ende wenn Telemetry fehlt.
            top10_ts = _compute_top10_reached_at(conn, tenant_id, m["matchId"], my_account_id)
            out.append({
                "id": "first_top10",
                "label": "Endgame Initiate",
                "icon": "🏆",
                "matchId": m["matchId"], "playedAt": top10_ts or played,
            })
            top10_seen = True
            seen.add("first_top10")

        # Longest-Kill-Tier-Cascade: jeder erreichte Tier (400/600/800/
        # 1000m) wird einmal pro Session emittiert. Nur der hoechste
        # NEUE Tier poppt; die anderen landen mit suppressPopup in DB
        # damit '% mit ≥400m'-Stat korrekt bleibt.
        _emit_tier_cascade(
            out, seen, LONGEST_KILL_TIERS, int(longest_m),
            lambda v: f"{v}m", m["matchId"], played)

        # Kill-Tier-Cascade: 5/7/10/15/20+
        _emit_tier_cascade(
            out, seen, KILL_TIERS, int(kills),
            lambda v: f"{v} Kills", m["matchId"], played)

        # Damage-Tier-Cascade: 500..3000+.
        # round() statt int() weil PUBG-API float-Damage liefert: ein
        # In-Game-510 kann als 509.84 ankommen — int() haette 'Heavy
        # Hitter' (≥500) verfehlt obwohl 510 angezeigt wird.
        _emit_tier_cascade(
            out, seen, DAMAGE_TIERS, round(damage),
            lambda v: f"{v} DMG", m["matchId"], played)

        if place == 1 and kills >= 5:
            # Chicken-Tier-Cascade: alle erreichten Tiers in DB, nur
            # hoechster poppt. Tiers: beast (5+), ultra (10+), god (15+).
            # Mehrfach pro Session moeglich — PK (achievement_id, match_id)
            # garantiert Eindeutigkeit.
            tiers = []
            if kills >= 15:
                tiers.append(("god_mode_chicken", "God Mode Chicken"))
            if kills >= 10:
                tiers.append(("ultra_chicken", "Ultra Chicken"))
            tiers.append(("beast_chicken", "Beast Chicken"))
            # Sortierung: hoechster zuerst (poppt), Rest mit suppressPopup
            for i, (aid, name) in enumerate(tiers):
                out.append({
                    "id": aid,
                    "label": f"{name} · {kills} Kills",
                    "icon": "🔥",
                    "matchId": m["matchId"], "playedAt": played,
                    "suppressPopup": i > 0,
                })

        # Top-10-Streak: pro Match-Peak ab x2 ein eigenes Achievement.
        # Match-ID kommt aus dem PEAK-Match (also dem der die Streak
        # auf die jeweilige Laenge gebracht hat). PK (achievement_id,
        # match_id) verhindert Duplikate; bei jedem neuen Peak wird
        # eine neue Zeile angelegt.
        if place <= 10:
            top10_streak += 1
            if top10_streak >= 2:
                out.append({
                    "id": "top10_streak",
                    "label": f"Endgame Streak ×{top10_streak}",
                    "icon": "🔥",
                    "matchId": m["matchId"],
                    "playedAt": played,
                })
        else:
            top10_streak = 0

        # Top-3-Streak: gleiche Logik, Schwelle ab x2.
        if place <= 3:
            top3_streak += 1
            if top3_streak >= 2:
                out.append({
                    "id": "top3_streak",
                    "label": f"Podium Streak ×{top3_streak}",
                    "icon": "🔥",
                    "matchId": m["matchId"],
                    "playedAt": played,
                })
        else:
            top3_streak = 0

        # Chicken-Streak: gleiche Logik, Schwelle ab x2.
        if place == 1:
            chicken_streak += 1
            if chicken_streak >= 2:
                out.append({
                    "id": "chicken_streak",
                    "label": f"Dinner Streak ×{chicken_streak}",
                    "icon": "🔥",
                    "matchId": m["matchId"],
                    "playedAt": played,
                })
        else:
            chicken_streak = 0

    # PAYDAY/Event-Achievements ueber alle Event-Matches in der Range.
    # Skala deutlich hoeher als BR — typische Heist-Matches gehen
    # 25-100+ Kills + 5k-20k DMG. Plus Stealth-Milestones.
    HEIST_KILL_TIERS = [
        # 25 war zu trivial in PAYDAY — NPC-Mob spawnt staendig nach.
        (100, "heist_kills_100", "Heist God"),
        ( 75, "heist_kills_75",  "Heist Annihilation"),
        ( 50, "heist_kills_50",  "Heist Massacre"),
    ]
    HEIST_DAMAGE_TIERS = [
        # 5k war zu trivial — schon 30 NPCs auf Body-Shots reichen.
        # Untergrenze auf 8k angehoben, Tiers entsprechend skaliert.
        (25000, "heist_dmg_25k", "Heist GODLIKE"),
        (20000, "heist_dmg_20k", "Heist Damage Lord"),
        (15000, "heist_dmg_15k", "Heist Damage Demon"),
        ( 8000, "heist_dmg_8k",  "Heist Heavy"),
    ]
    HEIST_LOOT_TIERS = [
        # Thresholds rescaled — 10/25/40 wurden in jedem Heist erreicht.
        # Neue Skala: 25 (solide Mitnahme), 60 (richtig fett), 120 (Beute-Boss).
        (120, "heist_loot_120", "Mega Heist"),
        ( 60, "heist_loot_60",  "Big Heist"),
        ( 25, "heist_loot_25",  "Solid Heist"),
    ]
    try:
        payday = compute_payday_stats(
            conn, tenant_id, my_account_id, "session",
            from_iso=from_iso, to_iso=to_iso)
        for pm in reversed(payday.get("matches") or []):
            mid = pm["matchId"]; played = pm["playedAt"]
            kills, dmg, loot_total = pm["myKills"], pm["myDamage"], pm["lootTotal"]

            # Kill-Tier-Cascade: alle erreichten in DB, nur hoechster popt
            kt = [(t, aid, name) for t, aid, name in HEIST_KILL_TIERS if kills >= t]
            for i, (_, aid, name) in enumerate(kt):
                out.append({
                    "id": aid,
                    "label": f"{name} · {kills} Kills",
                    "icon": "🔥",
                    "matchId": mid, "playedAt": played,
                    "suppressPopup": i > 0,
                })

            # Damage-Tier-Cascade
            dt = [(t, aid, name) for t, aid, name in HEIST_DAMAGE_TIERS if dmg >= t]
            for i, (_, aid, name) in enumerate(dt):
                out.append({
                    "id": aid,
                    "label": f"{name} · {int(dmg)} DMG",
                    "icon": "🔥",
                    "matchId": mid, "playedAt": played,
                    "suppressPopup": i > 0,
                })

            # Loot-Tier-Cascade
            lt = [(t, aid, name) for t, aid, name in HEIST_LOOT_TIERS if loot_total >= t]
            for i, (_, aid, name) in enumerate(lt):
                out.append({
                    "id": aid,
                    "label": f"{name} · {loot_total} Items",
                    "icon": "💎",
                    "matchId": mid, "playedAt": played,
                    "suppressPopup": i > 0,
                })

            # Spezifische Loot-Items (nur einmal pro Match)
            if pm["loot"].get("Item_GoldBricks_0", 0) >= 1:
                gold_n = pm["loot"]["Item_GoldBricks_0"]
                out.append({
                    "id": "gold_brick_grab",
                    "label": f"Gold Brick Heist · {gold_n}× Gold",
                    "icon": "🟨",
                    "matchId": mid, "playedAt": played,
                })
            if pm["loot"].get("Item_MoneyBagged", 0) >= 1:
                bag_n = pm["loot"]["Item_MoneyBagged"]
                out.append({
                    "id": "money_bag_run",
                    "label": f"Money Bag Run · {bag_n}× Bag",
                    "icon": "💰",
                    "matchId": mid, "playedAt": played,
                })

            # Stealth-Milestones — 0 Kills im Heist (= kein Schuss gemacht).
            # "No Alarm" proxy: keine Telemetrie zur Alarm-Erkennung in PUBG
            # API verfuegbar, also nutzen wir 0-kills als Annaeherung.
            if kills == 0 and loot_total >= 1:
                out.append({
                    "id": "silent_heist",
                    "label": f"Silent Heist · {loot_total} Loot, 0 Kills",
                    "icon": "🤫",
                    "matchId": mid, "playedAt": played,
                })
            if kills == 0 and dmg == 0 and loot_total >= 10:
                out.append({
                    "id": "ghost_operative",
                    "label": f"Ghost Operative · {loot_total} Loot, 0 DMG",
                    "icon": "👻",
                    "matchId": mid, "playedAt": played,
                })
            # Window Smasher: 30+ Fenster (war 20+)
            if pm["windows"] >= 30:
                out.append({
                    "id": "window_smasher",
                    "label": f"Window Smasher · {pm['windows']} Windows",
                    "icon": "🪟",
                    "matchId": mid, "playedAt": played,
                })
    except Exception:
        pass

    # Hot-Drop-Achievements: Inferno Begins + Inferno Survivor sind
    # STREAK-Counter (nicht Session-Total). Cold-Drop bricht beide.
    # Inferno Survivor bricht zusaetzlich wenn der Spieler den Hot-Drop
    # nicht ueberlebt.
    # Phoenix Chicken: Chicken-Win aus einem Hot-Drop heraus — super rar.
    # perMatch ist DESC sortiert → reversed für ASC = ältestes zuerst.
    try:
        hd = compute_hot_drop(conn, tenant_id, my_account_id, "session",
                               from_iso=from_iso, to_iso=to_iso)
        hot_drop_streak = 0
        hot_drop_survived_streak = 0
        phoenix_seen = False
        for pm in reversed(hd.get("perMatch") or []):
            if not pm.get("hotDrop"):
                # Cold-Drop bricht BEIDE Streaks
                hot_drop_streak = 0
                hot_drop_survived_streak = 0
                continue
            hot_drop_streak += 1
            # Burning Hell uebersteuert Inferno Begins als Hot-Drop-
            # Hauptmeldung — wenn 5+ Teams im Radius, popt nur Burning
            # Hell. Inferno bleibt in DB als suppressed Eintrag.
            teams_in_radius = pm.get("teamsInRadius") or 0
            is_burning = teams_in_radius >= 5
            out.append({
                "id": "hot_drop_match",
                "label": f"Inferno Begins ×{hot_drop_streak}",
                "icon": "🔥",
                "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                "suppressPopup": is_burning,
            })
            if is_burning:
                out.append({
                    "id": "burning_hell",
                    "label": f"Burning Hell · {teams_in_radius} Teams",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
            if pm.get("soloSurvived"):
                hot_drop_survived_streak += 1
                # Burning Hell Survivor uebersteuert Inferno Survivor
                # als Survival-Hauptmeldung — analog zu Burning Hell
                # vs Inferno Begins. Streak laeuft trotzdem weiter.
                if is_burning:
                    out.append({
                        "id": "burning_hell_survivor",
                        "label": f"Burning Hell Survivor · {teams_in_radius} Teams",
                        "icon": "🔥",
                        "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                    })
                out.append({
                    "id": "hot_drop_match_survived",
                    "label": f"Inferno Survivor ×{hot_drop_survived_streak}",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                    "suppressPopup": is_burning,
                })
            else:
                # Hot-Drop nicht ueberlebt → Survived-Streak bricht
                # (Inferno-Streak laeuft weiter — du WARST ja drin).
                hot_drop_survived_streak = 0
            if not phoenix_seen and pm.get("place") == 1:
                out.append({
                    "id": "phoenix_chicken",
                    "label": "Phoenix Chicken",
                    "icon": "🔥",
                    "matchId": pm["matchId"], "playedAt": pm["playedAt"],
                })
                phoenix_seen = True
    except Exception:
        pass

    # ── Spezial-Milestones: Red Zone, Fahrzeug-Kill, Fahrzeug-Tod ──
    # Nur fuer mich (my_account_id). Mates werden separat gezaehlt
    # (compute_session_report per-match squad-detail).
    # Telemetrie erforderlich — ohne Landing-Events etc. kein Fund.
    try:
        all_ms = matches_desc  # DESC sorted, reversed = ASC
        for m in reversed(all_ms):
            mid   = m["matchId"]
            played = m["playedAt"]

            # --- Killed by Red Zone ---
            # LogPlayerKillV2 mit weapon LIKE '%RedZone%' oder '%Bomb%'
            # und actor_account IS NULL (kein echter Killer-Account)
            rz = (conn.execute("""
                SELECT COUNT(*) AS c FROM telemetry_events
                WHERE match_id=? AND event_type='Kill'
                  AND target_account=?
                  AND (actor_account IS NULL OR actor_account='')
                  AND (weapon LIKE '%RedZone%'
                       OR weapon LIKE '%Bomb%'
                       OR weapon LIKE '%bomb%')
            """, (mid, my_account_id)).fetchone() or {}).get("c", 0)
            if rz > 0:
                out.append({
                    "id": "redzone_death",
                    "label": "Red Zone Victim",
                    "icon": "💥",
                    "matchId": mid, "playedAt": played,
                })

            # --- Killed a player WITH a vehicle (run over) ---
            # damageCauserName = Fahrzeug-Klasse (BP_Buggy_C etc.)
            vkill = (conn.execute("""
                SELECT COUNT(*) AS c FROM telemetry_events
                WHERE match_id=? AND event_type='Kill'
                  AND actor_account=?
                  AND weapon LIKE 'BP_%'
            """, (mid, my_account_id)).fetchone() or {}).get("c", 0)
            if vkill > 0:
                out.append({
                    "id": "vehicle_kill",
                    "label": f"Road Rage · {vkill}×",
                    "icon": "🚗",
                    "matchId": mid, "playedAt": played,
                })

            # --- Got killed by a vehicle ---
            vdeath = (conn.execute("""
                SELECT COUNT(*) AS c FROM telemetry_events
                WHERE match_id=? AND event_type='Kill'
                  AND target_account=?
                  AND weapon LIKE 'BP_%'
            """, (mid, my_account_id)).fetchone() or {}).get("c", 0)
            if vdeath > 0:
                out.append({
                    "id": "vehicle_death",
                    "label": "Speed Bump",
                    "icon": "🚗",
                    "matchId": mid, "playedAt": played,
                })

            # --- Kill while driving (shooting from vehicle) ---
            # VehicleEnter/Leave Intervalle bauen, dann Kill-Events pruefen
            ve_events = conn.execute("""
                SELECT event_type, timestamp_ms FROM telemetry_events
                WHERE match_id=? AND actor_account=?
                  AND event_type IN ('VehicleEnter', 'VehicleLeave')
                ORDER BY timestamp_ms ASC
            """, (mid, my_account_id)).fetchall()
            if ve_events:
                # Baue Intervalle: (enter_ms, leave_ms)
                intervals = []
                enter_ms = None
                for e in ve_events:
                    if e["event_type"] == "VehicleEnter":
                        enter_ms = e["timestamp_ms"]
                    elif e["event_type"] == "VehicleLeave" and enter_ms:
                        intervals.append((enter_ms, e["timestamp_ms"]))
                        enter_ms = None
                if enter_ms:
                    intervals.append((enter_ms, 10**15))
                if intervals:
                    my_kills = conn.execute("""
                        SELECT timestamp_ms FROM telemetry_events
                        WHERE match_id=? AND event_type='Kill'
                          AND actor_account=?
                    """, (mid, my_account_id)).fetchall()
                    driveby_n = sum(
                        1 for k in my_kills
                        if k["timestamp_ms"] and
                           any(a <= k["timestamp_ms"] <= b
                               for a, b in intervals))
                    if driveby_n > 0:
                        out.append({
                            "id": "vehicle_gunkill",
                            "label": f"Drive-By · {driveby_n}×",
                            "icon": "🔫",
                            "matchId": mid, "playedAt": played,
                        })
    except Exception:
        pass

    out.sort(key=lambda a: a.get("playedAt") or "")
    return out


# Welche Achievement-IDs als 'rare' im Popup zaehlen (gold-glow + biglvlup.wav).
# Konservativ — die Kandidaten die wirklich krass sind:
PUBG_RARE_ACHIEVEMENTS = {
    "beast_chicken",                 # Chicken + ≥5 Kills
    "ultra_chicken",                 # Chicken + ≥10 Kills
    "god_mode_chicken",              # Chicken + ≥15 Kills
    "burning_hell",                  # Hot-Drop mit 5+ Teams im Radius
    "burning_hell_survivor",         # ueberlebt mit 5+ Teams im Radius
    "gold_brick_grab",               # Squad-Loot: Goldbarren
    "heist_kills_75", "heist_kills_100",  # sehr hohe Heist-Kill-Tiers
    "heist_dmg_20k", "heist_dmg_25k",     # sehr hohes Heist-DMG
    "heist_loot_60", "heist_loot_120",    # Big/Mega-Heist (Top-Tiers rare)
    "silent_heist", "ghost_operative",    # Stealth
    "window_smasher",                # 30+ Fenster im Heist
    "session_opener_chicken",        # Session startet direkt mit Chicken
    "phoenix_chicken",               # Chicken-Win nach Hot-Drop
    "kills_15",                      # 15+ Kills
    "kills_20",                      # 20+ Kills (20-Bomb)
    "damage_2500",                   # 2500+ DMG
    "damage_3000",                   # GODLIKE-DMG
    "longest_kill_800",              # 800m+ Snipe
    "longest_kill_1000",             # Kilometer-Kill
    "hot_drop_match_survived",       # ueberlebtes Hot-Drop (jedes)
    "first_hot_drop_survived",       # legacy alias (Pre-Counter-Migration)
    "longest_kill_400",              # ≥400m
    "chicken_streak",                # ≥2 Chickens in Folge
}


def detect_and_store_session_achievements(conn, tenant_id: int, my_account_id):
    """Nach jedem neuen Match aufrufen. Berechnet die aktuellen Session-
    Achievements und schreibt neue (achievement_id, match_id)-Kombis in
    pubg_achievements_seen mit displayed_at=NULL. Returns Anzahl neu
    eingefuegter."""
    achievements = compute_session_achievements(conn, tenant_id, my_account_id)
    n = _insert_achievements(conn, tenant_id, achievements, suppress_popup=False)
    conn.commit()
    return n


# Event-Achievements (fuer separaten Pool bei Pct-Berechnung)
_EVENT_ACHIEVEMENT_IDS = {
    "heist_kills_50", "heist_kills_75", "heist_kills_100",
    "heist_dmg_8k", "heist_dmg_15k", "heist_dmg_20k", "heist_dmg_25k",
    "heist_loot_25", "heist_loot_60", "heist_loot_120",
    "silent_heist", "ghost_operative", "gold_brick_grab",
    "money_bag_run", "window_smasher",
}

# Tiered-IDs (x-N in Label) fuer Snapshot-Pct
_TIERED_ACHIEVEMENT_IDS = {
    "top3_streak", "top10_streak", "chicken_streak",
    "hot_drop_match", "hot_drop_match_survived",
}


def _compute_snapshot_pcts(conn, tenant_id: int, aid, played_at, label):
    """Berechnet sessionPct + matchPct zum Zeitpunkt 'played_at'.
    Einmal beim Insert aufrufen — danach persistent in der DB.

    sessionPct = Anteil der Session-Tage (bis played_at) an denen
                 dieses Milestone (mit >= aktuellem Tier) aufgetaucht ist.
    matchPct   = Anteil der Matches (bis played_at) mit diesem Milestone.
    """
    import re as _re
    if not played_at:
        return None, None
    date_str = played_at[:10]
    is_event = aid in _EVENT_ACHIEVEMENT_IDS
    # BR-Achievements gegen BR-Sessions/Matches verrechnen,
    # Event-Achievements gegen Event-Matches.
    game_mode_filter = "IN" if not is_event else "NOT IN"
    br_modes = list(BATTLE_ROYALE_MODES)
    ph = ",".join("?" * len(br_modes))

    # Tier aus Label extrahieren (×N)
    tier_match = _re.search(r"×\s*(\d+)", label or "")
    tier = int(tier_match.group(1)) if tier_match else None
    is_tiered = aid in _TIERED_ACHIEVEMENT_IDS

    # Gesamt-Sessions-Tage (= distinct Tage mit Matches des passenden Typs)
    # PG: date(text) -> substr(played_at, 1, 10) (ISO 'YYYY-MM-DD...')
    total_days = (conn.execute(
        f"SELECT COUNT(DISTINCT substr(played_at, 1, 10)) AS c FROM matches "
        f"WHERE tenant_id = ? AND played_at IS NOT NULL AND played_at <= ? "
        f"  AND game_mode {game_mode_filter} ({ph})",
        [tenant_id, played_at] + br_modes).fetchone() or {}).get("c", 0)
    # Gesamt-Matches
    total_matches = (conn.execute(
        f"SELECT COUNT(*) AS c FROM matches "
        f"WHERE tenant_id = ? AND played_at IS NOT NULL AND played_at <= ? "
        f"  AND game_mode {game_mode_filter} ({ph})",
        [tenant_id, played_at] + br_modes).fetchone() or {}).get("c", 0)
    if not total_days or not total_matches:
        return None, None

    # Bisherige Vorkommen dieses Milestones (<= played_at, Tier-aware)
    # Wichtig: nur Eintraege zaehlen die schon in DB sind (played_at < ?)
    # Historischer Snapshot — "wie selten war das ZU DEM ZEITPUNKT?"
    # backfill_session_achievements() liefert chronologisch ASC, daher
    # sind alle frueheren Eintraege bereits in der DB beim _compute-Call.
    if is_tiered and tier is not None:
        # Tier in Python parsen (SQL CAST 'Inferno Begins 3' → 0 ist nutzlos)
        prior = conn.execute(
            "SELECT played_at, label FROM pubg_achievements_seen "
            "WHERE tenant_id = ? AND achievement_id = ? AND played_at < ?",
            (tenant_id, aid, played_at)).fetchall()
        matching_dates = set()
        ach_matches = 0
        for r in prior:
            m = _re.search(r"×\s*(\d+)", r["label"] or "")
            t_prior = int(m.group(1)) if m else 0
            if t_prior >= tier:
                ach_matches += 1
                matching_dates.add((r["played_at"] or "")[:10])
        ach_days = len(matching_dates)
    else:
        ach_days = (conn.execute(
            "SELECT COUNT(DISTINCT substr(played_at, 1, 10)) AS c FROM pubg_achievements_seen "
            "WHERE tenant_id = ? AND achievement_id = ? AND played_at < ?",
            (tenant_id, aid, played_at)).fetchone() or {}).get("c", 0)
        ach_matches = (conn.execute(
            "SELECT COUNT(*) AS c FROM pubg_achievements_seen "
            "WHERE tenant_id = ? AND achievement_id = ? AND played_at < ?",
            (tenant_id, aid, played_at)).fetchone() or {}).get("c", 0)

    # +1 weil der aktuelle Insert noch nicht in der DB ist (compute laeuft
    # VOR dem INSERT). Damit das aktuelle Vorkommen mitgezaehlt wird.
    # min(..., total) schuetzt falls mehrere Achievements pro Match
    # (z.B. Tier-Cascade) hintereinander rein gehen.
    ach_days = min(ach_days + 1, total_days)
    ach_matches = min(ach_matches + 1, total_matches)
    sess_pct = round(ach_days / total_days * 100, 1) if total_days else None
    match_pct = round(ach_matches / total_matches * 100, 2) if total_matches else None
    return sess_pct, match_pct


def _insert_achievements(conn, tenant_id: int, achievements, suppress_popup=False):
    """Helper: inserted Liste von compute_session_achievements-Resultaten
    in pubg_achievements_seen. INSERT OR IGNORE filtert Duplikate.
    suppress_popup=True markiert direkt als displayed_at=NOW damit's
    nicht popupt (fuer Backfill).
    Per-row flag 'suppressPopup' (camelCase) ueberschreibt das fuer
    einzelne Eintraege — z.B. wenn eine 900m-Kill alle drei Tiers
    (400/600/800) in die DB schreibt, aber nur das hoechste poppen
    soll."""
    import time as _t
    new_count = 0
    now_ts = int(_t.time())
    for a in achievements:
        aid = a.get("id")
        mid = a.get("matchId")
        if not aid or not mid:
            continue
        row_suppress = suppress_popup or bool(a.get("suppressPopup"))
        displayed_at = now_ts if row_suppress else None
        played_at = a.get("playedAt")
        label = a.get("label")
        # Snapshot-Pcts zum Zeitpunkt des Inserts berechnen
        try:
            sess_pct, match_pct = _compute_snapshot_pcts(
                conn, tenant_id, aid, played_at, label)
        except Exception:
            sess_pct = match_pct = None
        # Rare-Flag: statisches Set ODER per-row Override 'isRare'.
        # Letzteres fuer dynamisch generierte IDs (z.B. wins_milestone_N
        # wo N variabel ist und nicht ins Set passt).
        rare = (aid in PUBG_RARE_ACHIEVEMENTS) or bool(a.get("isRare"))
        cur = conn.execute("""
            INSERT INTO pubg_achievements_seen
              (tenant_id, achievement_id, match_id, label, icon, played_at,
               detected_at, is_rare, displayed_at, session_pct, match_pct,
               suppress_popup)
            VALUES (?, ?, ?, ?, ?, ?, EXTRACT(EPOCH FROM NOW())::BIGINT, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, achievement_id, match_id) DO NOTHING
        """, (tenant_id, aid, mid, label, a.get("icon"),
              played_at,
              1 if rare else 0,
              displayed_at, sess_pct, match_pct,
              # suppress_popup unterscheidet 'als suppressed detected'
              # von Backfill (wo wir nachtraeglich alles displayed_at
              # markieren). Der per-row-Flag aus dem detector ist
              # dafuer authoritativ, NICHT der suppress_popup-Param.
              1 if bool(a.get("suppressPopup")) else 0))
        if cur.rowcount > 0:
            new_count += 1
    return new_count


def _migrate_legacy_achievement_ids(conn, tenant_id: int):
    """Rename alte Achievement-IDs auf die neuen Tier-IDs. Idempotent.
    Migration:
      - five_kill_match -> kills_5
      - first_hot_drop -> hot_drop_match (label wird auf 'Inferno Begins ×1' geupdated)
      - first_hot_drop_survived -> hot_drop_match_survived (label 'Inferno Survivor ×1')
    Bei Konflikt (neue ID existiert bereits fuer diesen Match) wird der
    alte Eintrag geloescht."""
    # PG hat kein UPDATE OR IGNORE — wir loeschen Konflikt-Eintraege
    # ZUERST (DELETE WHERE EXISTS Zielkollision), dann UPDATE.
    # Bei Backfill-Migration ist Toleranz ggue. Race-Conditions egal.
    def _del_conflicts(old_id, new_id):
        conn.execute("""
            DELETE FROM pubg_achievements_seen old
            WHERE old.tenant_id = ? AND old.achievement_id = ?
              AND EXISTS (
                SELECT 1 FROM pubg_achievements_seen new
                WHERE new.tenant_id = old.tenant_id
                  AND new.match_id = old.match_id
                  AND new.achievement_id = ?
              )
        """, (tenant_id, old_id, new_id))

    # 1) five_kill_match -> kills_5
    _del_conflicts("five_kill_match", "kills_5")
    conn.execute("""
        UPDATE pubg_achievements_seen
        SET achievement_id = 'kills_5'
        WHERE tenant_id = ? AND achievement_id = 'five_kill_match'
    """, (tenant_id,))
    # 2) first_hot_drop -> hot_drop_match (×1)
    _del_conflicts("first_hot_drop", "hot_drop_match")
    conn.execute("""
        UPDATE pubg_achievements_seen
        SET achievement_id = 'hot_drop_match',
            label = 'Inferno Begins ×1'
        WHERE tenant_id = ? AND achievement_id = 'first_hot_drop'
    """, (tenant_id,))
    # 3) first_hot_drop_survived -> hot_drop_match_survived (×1)
    _del_conflicts("first_hot_drop_survived", "hot_drop_match_survived")
    conn.execute("""
        UPDATE pubg_achievements_seen
        SET achievement_id = 'hot_drop_match_survived',
            label = 'Inferno Survivor ×1'
        WHERE tenant_id = ? AND achievement_id = 'first_hot_drop_survived'
    """, (tenant_id,))
    # 4) first_chicken -> chicken (jedes Chicken bekommt Milestone)
    _del_conflicts("first_chicken", "chicken")
    conn.execute("""
        UPDATE pubg_achievements_seen
        SET achievement_id = 'chicken'
        WHERE tenant_id = ? AND achievement_id = 'first_chicken'
    """, (tenant_id,))
    conn.commit()


def backfill_session_achievements(conn, tenant_id: int, my_account_id,
                                    gap_hours=6, suppress_popup=True):
    """Historischer Backfill: walkt durch ALLE Matches in der DB
    chronologisch, splittet in Sessions per Time-Gap, laeuft
    compute_session_achievements pro Session, inserted Milestones
    in pubg_achievements_seen.

    gap_hours: Lueckenzeit zwischen Matches die als 'neue Session'
               zaehlt (Default 6h — Stream-Pause).
    suppress_popup: True (Default) markiert direkt als displayed_at=NOW
                    damit der Backfill nicht 100+ Popups feuert.

    Returns dict { sessions, inserted, errors }.
    """
    import datetime as _dt
    # Erst Legacy-IDs migrieren (idempotent), dann normal weiter
    _migrate_legacy_achievement_ids(conn, tenant_id)
    # Alle Matches chronologisch (ASC)
    matches = compute_session_matches(conn, tenant_id, my_account_id, "all")
    matches = list(reversed(matches))  # ASC
    if not matches:
        return {"sessions": 0, "inserted": 0, "errors": []}

    def _parse(iso):
        try:
            return _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        except (TypeError, ValueError, AttributeError):
            return None

    # Sessions per Gap detecten
    gap_secs = gap_hours * 3600
    sessions = []
    cur_start = matches[0]["playedAt"]
    cur_last  = matches[0]["playedAt"]
    last_t    = _parse(matches[0]["playedAt"])
    for m in matches[1:]:
        t = _parse(m["playedAt"])
        if t and last_t and (t - last_t).total_seconds() > gap_secs:
            sessions.append((cur_start, cur_last))
            cur_start = m["playedAt"]
        cur_last = m["playedAt"]
        if t:
            last_t = t
    sessions.append((cur_start, cur_last))

    # Detection pro Session
    total_new = 0
    errors = []
    for from_iso, to_iso in sessions:
        try:
            achievements = compute_session_achievements(
                conn, tenant_id, my_account_id, from_iso=from_iso, to_iso=to_iso)
            total_new += _insert_achievements(
                conn, tenant_id, achievements, suppress_popup=suppress_popup)
        except Exception as e:
            errors.append(f"{from_iso}: {type(e).__name__}: {e}")
    # SQLite ist nicht autocommit hier — ohne explizites commit gehen
    # die INSERTs verloren wenn der Connection geschlossen wird.
    conn.commit()
    return {
        "sessions": len(sessions),
        "inserted": total_new,
        "errors": errors,
    }


def compute_hot_drop(conn, tenant_id: int, my_account_id, range_key="session",
                     window_secs=180, from_iso=None, to_iso=None):
    """Hot-Drop-Stats über die Range.

    Definition Hot-Drop = im Match gab es ein Kill/Knock-Event innerhalb
    der ersten window_secs (Default 120s = 2 Min) NACH der Landung des
    Squads, zwischen verschiedenen Teams, wo das Squad als Attacker oder
    Victim beteiligt war. Landung = echte LogParachuteLanding-Events aus
    Telemetry, NICHT geschätzt.

    Pro Match Markierung:
      - hotDrop: ja/nein (Fight in window_secs nach Landung mit Squad-
        Beteiligung)
      - soloSurvived: ja, wenn ich window_secs nach der Squad-Landung
        noch lebe (time_survived >= squad_landing_offset + window_secs)
      - teamSurvived: ja, wenn mindestens ein Squad-Member window_secs
        nach Landung noch lebt

    Aggregat:
      - rate: % der Matches mit Hot-Drop
      - soloSurvivalRate: von Hot-Drops, % wo ich überlebt habe
      - teamSurvivalRate: von Hot-Drops, % wo Team überlebt hat
      - streak: aktuelle Streak überlebter Hot-Drops (von neuestem Match
        rückwärts; Solo-Survival als Kriterium)
      - perMatch: Liste mit Match-Markern für Sparklines
    """
    # from_iso/to_iso überschreiben range_key (für historische Sessions
    # via session-report). Sonst range_key auflösen.
    if from_iso:
        cutoff = from_iso
        end_filter = " AND m.played_at <= ?" if to_iso else ""
        params = [tenant_id, my_account_id, cutoff]
        if to_iso:
            params.append(to_iso)
    else:
        cutoff = (_range_filter(conn, tenant_id, range_key)
                  if range_key != "all" else "1970-01-01T00:00:00Z")
        end_filter = ""
        params = [tenant_id, my_account_id, cutoff]
    window_ms = window_secs * 1000
    # Event-Modes raus — in TDM/PAYDAY gibt es keinen Parachute-Hot-Drop.
    br_where, br_params = _br_filter("m")
    matches = conn.execute(f"""
        SELECT m.match_id, m.played_at, m.map_name, m.game_mode,
               m.duration_secs, pa.place, pa.kills, pa.damage_dealt,
               pa.time_survived
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?{end_filter}
          AND {br_where}
        ORDER BY m.played_at DESC
    """, params + br_params).fetchall()

    per_match = []
    hot = 0
    solo_surv = 0
    team_surv = 0
    teams_per_hot = []
    teams_in_radius_per_hot = []
    for m in matches:
        result = _detect_hot_drop(conn, tenant_id, m["match_id"], my_account_id,
                                  window_ms, window_secs)
        per_match.append({
            "matchId":        m["match_id"],
            "playedAt":       m["played_at"],
            "mapName":        m["map_name"],
            "gameMode":       m["game_mode"],
            "durationSec":    m["duration_secs"],
            "place":          m["place"],
            "kills":          m["kills"],
            "damage":         m["damage_dealt"],
            "timeSurvived":   m["time_survived"],
            "hotDrop":        result["hotDrop"],
            "soloSurvived":   result["soloSurvived"],
            "teamSurvived":   result["teamSurvived"],
            "teamsInFight":   result.get("teamsInFight", 0),
            "teamsInRadius":  result.get("teamsInRadius", 0),
            "landingX":       result.get("landingX"),
            "landingY":       result.get("landingY"),
            "landingOffsetSec": result.get("landingOffsetSec"),
            "firstFightAfterLandingSec": result.get("firstFightAfterLandingSec"),
        })
        if result["hotDrop"]:
            hot += 1
            teams_per_hot.append(result.get("teamsInFight", 0))
            teams_in_radius_per_hot.append(result.get("teamsInRadius", 0))
            if result["soloSurvived"]:
                solo_surv += 1
            if result["teamSurvived"]:
                team_surv += 1

    # Streak: vom neuesten Match rückwärts. Identische Logik wie das
    # Inferno-Survivor-Milestone (siehe compute_session_achievements):
    # Cold-Drop bricht den Streak, Hot-Drop-Tod bricht den Streak.
    # Nur konsekutive Hot-Drops mit Survival zaehlen.
    streak = 0
    for pm in per_match:
        if not pm["hotDrop"]:
            # Cold-Drop bricht den Survived-Streak
            break
        if pm["soloSurvived"]:
            streak += 1
        else:
            break

    n = len(matches)
    avg_teams = (sum(teams_per_hot) / len(teams_per_hot)) if teams_per_hot else 0
    max_teams = max(teams_per_hot) if teams_per_hot else 0
    avg_radius_teams = (sum(teams_in_radius_per_hot) / len(teams_in_radius_per_hot)
                         if teams_in_radius_per_hot else 0)
    max_radius_teams = max(teams_in_radius_per_hot) if teams_in_radius_per_hot else 0
    return {
        "matches":            n,
        "hotDrops":           hot,
        "rate":               (hot / n * 100) if n else 0,
        "soloSurvived":       solo_surv,
        "teamSurvived":       team_surv,
        "soloSurvivalRate":   (solo_surv / hot * 100) if hot else 0,
        "teamSurvivalRate":   (team_surv / hot * 100) if hot else 0,
        "streak":             streak,
        "avgTeamsInFight":    round(avg_teams, 2),
        "maxTeamsInFight":    max_teams,
        "avgTeamsInRadius":   round(avg_radius_teams, 2),
        "maxTeamsInRadius":   max_radius_teams,
        "radiusMeters":       300,
        "perMatch":           per_match,
    }


# Map-Groessen in km — bestimmt den Hot-Drop-Radius. Kleine Maps
# (Karakin 2km, Haven 1km, Range 2km) haben drastisch andere Skalen
# als Erangel/Miramar/Vikendi (8km). Ein 500m-Radius auf Karakin
# deckt ~20% der Karte ab und produziert false-positives.
MAP_SIZE_KM = {
    "Baltic_Main":      8, "Erangel_Main":   8,
    "Desert_Main":      8, "Savage_Main":    4,
    "DihorOtok_Main":   8, "Tiger_Main":     8,
    "Kiki_Main":        8, "Neon_Main":      8,
    "Chimera_Main":     3, "Summerland_Main": 2,
    "Heaven_Main":      1, "Range_Main":     2,
}
# Hot-Drop-Radius proportional zur Map-Kantenlaenge. 8km → 300m,
# 4km → 150m, 3km → ~115m, 2km → 75m, 1km → ~38m.
# Faktor 37.5 (gerundet 38): auf 8km-Maps (Erangel, Miramar, Vikendi)
# entspricht das einer typischen Stadt-Innengrenze. Vorher 60 war zu
# grosszuegig — auf Vikendi z.B. 480m, viel zu loose.
HOT_DROP_RADIUS_PER_KM_M = 38


def _hot_drop_radius_cm(map_name):
    map_km = MAP_SIZE_KM.get(map_name, 8)  # default 8km bei unbekannt
    return int(map_km * HOT_DROP_RADIUS_PER_KM_M) * 100


def _detect_hot_drop(conn, tenant_id: int, match_id, my_account_id, window_ms, window_secs):
    """Pro Match: Hot-Drop ja/nein + Survival-Marker.

    Bezugspunkt = ECHTE Squad-Landung aus LogParachuteLanding-Events
    (NICHT geschätzt, NICHT Match-Start). Window = erste window_ms ab
    Squad-Landung. Wenn keine Landing-Events vorhanden (Telemetry
    fehlt/abgelaufen) → kein Hot-Drop ermittelbar.

    Der Hot-Drop-Radius skaliert mit Map-Groesse (siehe MAP_SIZE_KM).
    """
    parts = conn.execute("""
        SELECT account_id, team_id, time_survived
        FROM participants WHERE tenant_id = ? AND match_id = ?
    """, (tenant_id, match_id,)).fetchall()
    if not parts:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}
    acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
    my_team_id = acc_to_team.get(my_account_id)
    if my_team_id is None:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}

    # Map fuer Radius-Skalierung
    map_row = conn.execute(
        "SELECT map_name FROM matches WHERE tenant_id = ? AND match_id = ?",
        (tenant_id, match_id,)).fetchone()
    map_name = map_row["map_name"] if map_row else None

    squad_ids = {a for a, t in acc_to_team.items() if t == my_team_id}

    # ALLE Squad-Landungen mit Position holen — für Radius-Detection
    # vergleichen wir jedes Lobby-Landing gegen jede Squad-Landung,
    # nicht nur gegen den ersten Lander. Dadurch gelten Teams als
    # "in der Drop-Area" wenn sie nahe IRGENDEINEM Squad-Member gelandet
    # sind (z.B. bei split-Drops über zwei Compounds).
    placeholders = ",".join("?" * len(squad_ids))
    squad_landings = conn.execute(f"""
        SELECT actor_account, actor_x, actor_y, timestamp_ms
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Landing'
          AND actor_account IN ({placeholders})
        ORDER BY timestamp_ms ASC
    """, [match_id] + list(squad_ids)).fetchall()
    if not squad_landings:
        return {"hotDrop": False, "soloSurvived": False, "teamSurvived": False}

    # Erste Squad-Landung = Anker für Fight-Window (= "Boots on ground")
    first_landing = squad_landings[0]
    landing_ms = first_landing["timestamp_ms"]
    fight_cutoff_ms = landing_ms + window_ms

    # Map-skalierter Radius (in cm).
    radius_cm = _hot_drop_radius_cm(map_name)
    radius_sq = radius_cm * radius_cm
    # Squad-Landing-Positionen fuer Spatial-Filter
    squad_pos = [(s["actor_x"], s["actor_y"]) for s in squad_landings
                  if s["actor_x"] is not None and s["actor_y"] is not None]

    def _in_hd_zone(x, y):
        if x is None or y is None or not squad_pos:
            return False
        for sx, sy in squad_pos:
            dx, dy = x - sx, y - sy
            if dx * dx + dy * dy <= radius_sq:
                return True
        return False

    # Combat-Events ab Squad-Landung bis +window_ms. TakeDamage zaehlt
    # mit, sonst werden Drop-Fights wo NUR Bullets fliegen aber niemand
    # stirbt/knocked verpasst. Positionen werden mitgezogen — nur Events
    # INNERHALB der Hot-Drop-Zone (Radius zur Squad-Landung) zaehlen.
    events = conn.execute("""
        SELECT actor_account, target_account, timestamp_ms, event_type,
               actor_x, actor_y, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ?
          AND event_type IN ('Kill', 'Knock', 'TakeDamage')
          AND timestamp_ms >= ?
          AND timestamp_ms <= ?
        ORDER BY timestamp_ms ASC
    """, (match_id, landing_ms, fight_cutoff_ms)).fetchall()

    # Lobby-weites team_id-Mapping (falls match_schema >= 2)
    # PG: dict(rows) klappt nicht direkt mit RealDictRow — manuell mappen.
    lobby_team_map = {r["account_id"]: r["team_id"] for r in conn.execute("""
        SELECT account_id, team_id FROM match_team_mapping
        WHERE tenant_id = ? AND match_id = ?
    """, (tenant_id, match_id,)).fetchall()}
    # Falls leer (alte Matches ohne re-ingest): fallback auf acc_to_team
    # (squad-only) — Team-Count wird dann underestimiert.
    full_team_map = lobby_team_map if lobby_team_map else acc_to_team

    # ERST nearby-teams ermitteln (Landings im Radius), DANN Combat
    # nur mit denen zaehlen. Damit "Hot-Drop = Fight mit dem Team, das
    # in deiner Zone gelandet ist", nicht "Fight irgendwo + Gegner war
    # zufaellig in der Naehe gelandet".
    teams_in_radius = set()
    nearby_enemy_accs = set()
    if squad_pos:
        all_landings = conn.execute("""
            SELECT actor_account, actor_x, actor_y
            FROM telemetry_events
            WHERE match_id = ?
              AND event_type = 'Landing'
              AND actor_x IS NOT NULL AND actor_y IS NOT NULL
        """, (match_id,)).fetchall()
        for ld in all_landings:
            if ld["actor_account"] in squad_ids:
                continue
            for sx, sy in squad_pos:
                dx = ld["actor_x"] - sx
                dy = ld["actor_y"] - sy
                if dx * dx + dy * dy <= radius_sq:
                    t = full_team_map.get(ld["actor_account"])
                    if t is not None and t != my_team_id:
                        teams_in_radius.add(t)
                        nearby_enemy_accs.add(ld["actor_account"])
                    break

    # Alle Member der nearby-Teams (auch wenn nur 1 von 4 in Radius
    # gelandet ist — beim Re-Engage kommen die anderen aus dem Team
    # nachgerueckt; deren Combat zaehlt als Hot-Drop-Fight)
    nearby_team_accs = {a for a, t in full_team_map.items()
                        if t in teams_in_radius}

    # Hot-Drop-Combat: Squad vs nearby-Team innerhalb window_secs.
    # Schusswechsel mit nicht-nearby Teams (Rotation, drittes Team) zaehlt
    # NICHT als Hot-Drop-Fight. Spatial-Filter zusaetzlich — manchmal
    # vermisst PUBG-Telemetry Landing-Events (Bot-Spawn etc.) und das
    # 'nearby' set ist unterspezifiziert; der HD-Zone-Check faengt das ab.
    hot_drop = False
    teams_in_fight = set()
    first_fight_ts = None  # timestamp_ms des ersten HD-Combat-Events
    for e in events:
        a, v = e["actor_account"], e["target_account"]
        a_in_squad = a in squad_ids
        v_in_squad = v in squad_ids
        if a_in_squad and v_in_squad:
            continue  # Friendly fire — nicht zaehlen
        if not (a_in_squad or v_in_squad):
            continue  # Drittes-Team-Fight — uns egal
        opponent = v if a_in_squad else a
        if opponent not in nearby_team_accs:
            continue  # Combat mit Team das NICHT in deiner HD-Zone landete
        # Spatial-Check: Event muss raeumlich in der HD-Zone passieren
        if not (_in_hd_zone(e["actor_x"], e["actor_y"])
                or _in_hd_zone(e["victim_x"], e["victim_y"])):
            continue
        hot_drop = True
        if first_fight_ts is None:
            first_fight_ts = e["timestamp_ms"]
        opp_team = full_team_map.get(opponent)
        if opp_team is not None and opp_team != my_team_id:
            teams_in_fight.add(opp_team)

    # Survival: direkter Death-Event-Check im Hot-Drop-Fenster.
    # Definition: Hot-Drop ueberlebt = kein Kill-Event mit target=me
    # innerhalb der ersten HD_SURVIVAL_WINDOW_MIN Minuten nach Landung.
    # (Vorher cluster-basiert mit 3-min-Stille-Logik; war zu brueckig —
    # Fights die 2+ Minuten nach Landing weitergehen wurden faelsch-
    # licherweise NICHT mehr als 'Hot-Drop-Death' gezaehlt.)
    HD_SURVIVAL_WINDOW_MIN = 5
    survival_cutoff_ms = landing_ms + HD_SURVIVAL_WINDOW_MIN * 60 * 1000
    killed_in_window = {r["target_account"] for r in conn.execute(f"""
        SELECT target_account FROM telemetry_events
        WHERE match_id = ?
          AND event_type = 'Kill'
          AND target_account IN ({placeholders})
          AND timestamp_ms >= ?
          AND timestamp_ms <= ?
    """, [match_id] + list(squad_ids) + [landing_ms, survival_cutoff_ms])
                          .fetchall()}
    solo_alive = my_account_id not in killed_in_window
    team_alive = bool(squad_ids - killed_in_window)
    # Hot-Drop = mind. 1 Gegner-Team im Radius beim Landing UND
    # Schusswechsel zwischen Squad und genau diesem Team innerhalb
    # der ersten window_secs. teams_in_radius / nearby_team_accs wurden
    # oben schon ermittelt; hot_drop flag wurde im Combat-Loop gesetzt
    # nur wenn die Gegner aus den nearby-Teams kommen.
    is_hot_drop = bool(teams_in_radius) and hot_drop
    # Anker-Landing = erste Squad-Landung (used als Fight-Window-Start).
    # Coords als Tooltip-Info zurueckliefern.
    anchor_x = first_landing["actor_x"] if first_landing else None
    anchor_y = first_landing["actor_y"] if first_landing else None
    # Match-Start-ms: played_at IST der Match-Start (PUBG-API
    # createdAt), nicht das Match-Ende. Nicht subtrahieren!
    match_start_ms = None
    landing_offset_sec = None
    first_fight_after_landing_sec = None
    m_row = conn.execute(
        "SELECT played_at FROM matches WHERE tenant_id = ? AND match_id = ?",
        (tenant_id, match_id,)).fetchone()
    if m_row and m_row["played_at"]:
        start_dt = _parse_iso(m_row["played_at"])
        if start_dt:
            match_start_ms = int(start_dt.timestamp() * 1000)
            landing_offset_sec = int(
                max(0, (landing_ms - match_start_ms) / 1000))
    if first_fight_ts:
        first_fight_after_landing_sec = int(
            max(0, (first_fight_ts - landing_ms) / 1000))
    return {
        "hotDrop":         is_hot_drop,
        "soloSurvived":    solo_alive,
        "teamSurvived":    team_alive,
        "teamsInFight":    len(teams_in_fight),
        "teamsInRadius":   len(teams_in_radius),
        "landingX":        anchor_x,
        "landingY":        anchor_y,
        "landingOffsetSec": landing_offset_sec,
        "firstFightAfterLandingSec": first_fight_after_landing_sec,
    }


def compute_first_fight_rate(conn, tenant_id: int, my_account_id, range_key="session",
                              cluster_secs=30, cluster_radius_m=200,
                              exclude_hot_drop=False,
                              hot_drop_window_secs=120):
    """First Fight Win Rate — DEFINITION (echtes Fight-Win, nicht First-Engage):
    Pro Match: das ERSTE Gefecht zwischen Squads.

    Fight-Cluster:
    - Start: erstes Kill/Knock-Event mit Squad-Beteiligung (Squad als Attacker
      oder Victim).
    - Erweiterung: alle weiteren Kill/Knock-Events innerhalb von `cluster_secs`
      Sekunden zum letzten Cluster-Event UND `cluster_radius_m` Meter Radius
      werden hinzugefügt — auch enemy-vs-enemy Events. Damit erfassen wir
      Multi-Team-Gefechte.
    - Ende: kein neues Kill/Knock-Event mehr passt → Cluster geschlossen.

    Beteiligte Teams: alle team_ids von attackern und victims im Cluster.
    Win/Loss:
    - WIN  = unser Team hat am Fight-Ende noch lebende Member (time_survived
      > Fight-End-Zeit oder besser).
    - LOSS = alle unsere Squad-Member wurden im/vor Fight-Ende ausgeschaltet.

    Returns: rate, survived, total, sparkline, avgTeams, maxTeams.
    """
    # PUBG-Welt: Distanzen in cm. 1 Meter = 100 Einheiten.
    cluster_radius_cm = cluster_radius_m * 100
    cluster_ms = cluster_secs * 1000
    cutoff = _range_filter(conn, tenant_id, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    matches = conn.execute("""
        SELECT m.match_id, m.duration_secs, m.played_at, m.map_name,
               m.game_mode, pa.place, pa.kills, pa.damage_dealt,
               pa.time_survived
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (tenant_id, my_account_id, cutoff)).fetchall()

    total = 0
    engaged_total = 0      # Matches mit events_count >= 2 (echter Fight)
    fled_total = 0         # Matches mit events_count == 1 (Disengage)
    solo_survived_n = 0    # ueber ALLE detected matches (inkl. fled)
    team_survived_n = 0    # ueber ALLE detected matches (inkl. fled)
    excluded_hot = 0
    sparkline = []
    per_match = []
    teams_per_fight = []
    hot_drop_window_ms = hot_drop_window_secs * 1000

    def _squad_landing_xy(mid):
        """Erste Squad-Landungs-Position fuer Map/POI-Lookup. Robust
        gegen fehlende Daten/Telemetry."""
        try:
            r = conn.execute("""
                SELECT te.actor_x, te.actor_y FROM telemetry_events te
                JOIN participants pa ON pa.match_id = te.match_id
                  AND pa.tenant_id = ?
                  AND pa.account_id = te.actor_account
                WHERE te.match_id = ? AND te.event_type = 'Landing'
                  AND pa.team_id = (SELECT team_id FROM participants
                                     WHERE tenant_id = ? AND match_id = ? AND account_id = ?)
                  AND te.actor_x IS NOT NULL AND te.actor_y IS NOT NULL
                ORDER BY te.timestamp_ms ASC LIMIT 1
            """, (tenant_id, mid, tenant_id, mid, my_account_id)).fetchone()
            if not r:
                return (None, None)
            # Robust gegen Tupel- oder Row-Resultate
            if hasattr(r, "keys"):
                return (r["actor_x"], r["actor_y"])
            return (r[0], r[1])
        except Exception:
            return (None, None)

    for m in matches:
        # Hot-Drop-Matches überspringen wenn excluded
        if exclude_hot_drop:
            hd = _detect_hot_drop(conn, tenant_id, m["match_id"], my_account_id,
                                   hot_drop_window_ms, hot_drop_window_secs)
            if hd["hotDrop"]:
                excluded_hot += 1
                continue
        result = _detect_first_fight(conn, tenant_id, m["match_id"], my_account_id,
                                       cluster_ms, cluster_radius_cm)
        if result is None:
            # Backend findet keine Squad-Combat-Events. Praktisch nie —
            # falls doch, als 'fled' (nicht detektierbar) behandeln.
            total += 1
            fled_total += 1
            sparkline.append(0)
            lx, ly = _squad_landing_xy(m["match_id"])
            per_match.append({
                "matchId": m["match_id"],
                "playedAt": m["played_at"],
                "mapName": m["map_name"],
                "gameMode": m["game_mode"],
                "durationSec": m["duration_secs"],
                "place": m["place"],
                "kills": m["kills"],
                "damage": m["damage_dealt"],
                "timeSurvived": m["time_survived"],
                "hadFight": False,
                "engaged": False,
                "soloSurvived": False,
                "teamSurvived": False,
                "landingX": lx, "landingY": ly,
                "fightX": None, "fightY": None,
            })
            continue
        total += 1
        # 'engaged' = im Cluster ist mindestens 1 Kill passiert
        # (egal welche Seite). Damit gilt:
        #   - Squad hat enemy gekillt -> Win
        #   - Enemy hat Squad-Member gekillt -> Loss / team-saved
        #   - Schiesserei mit Damage/Knocks aber niemand stirbt -> fled
        #     (Stalemate / Disengage, kein definitiver Outcome)
        engaged = bool(result.get("has_kill"))
        if engaged:
            engaged_total += 1
            teams_per_fight.append(result["teams_count"])
        else:
            fled_total += 1
        # Solo/Team counts ueber ALLE detected matches — wenn Squad
        # nach Disengage uebellebt, zaehlt das als Win (User-Sicht).
        if result["soloSurvived"]:
            solo_survived_n += 1
        if result["teamSurvived"]:
            team_survived_n += 1
        sparkline.append(1 if result["teamSurvived"] else 0)
        lx, ly = _squad_landing_xy(m["match_id"])
        per_match.append({
            "matchId": m["match_id"],
            "playedAt": m["played_at"],
            "mapName": m["map_name"],
            "gameMode": m["game_mode"],
            "durationSec": m["duration_secs"],
            "place": m["place"],
            "kills": m["kills"],
            "damage": m["damage_dealt"],
            "timeSurvived": m["time_survived"],
            "hadFight": True,
            "engaged": engaged,
            "soloSurvived": result["soloSurvived"],
            "teamSurvived": result["teamSurvived"],
            "teamsCount": result.get("teams_count", 0),
            "fightStartAfterMatchStartSec":
                result.get("fightStartAfterMatchStartSec"),
            "landingX": lx, "landingY": ly,
            "fightX": result.get("fightX"),
            "fightY": result.get("fightY"),
        })

    avg_teams = (sum(teams_per_fight) / len(teams_per_fight)) if teams_per_fight else 0
    max_teams = max(teams_per_fight) if teams_per_fight else 0
    # Headline-Rate ist Team-Sicht (User wollte 'Won X of Y' team).
    team_rate = (team_survived_n / total * 100) if total else 0
    solo_rate = (solo_survived_n / total * 100) if total else 0
    return {
        # Legacy-Felder — 'rate'/'survived' jetzt Team-basiert.
        "rate": team_rate,
        "survived": team_survived_n,
        "total": total,
        "sparkline": sparkline[-20:],
        # Getrennte Solo/Team-Sicht
        "soloSurvived": solo_survived_n,
        "teamSurvived": team_survived_n,
        "soloSurvivalRate": solo_rate,
        "teamSurvivalRate": team_rate,
        "engagedTotal": engaged_total,
        "fledTotal": fled_total,
        "perMatch": per_match[-20:],
        "avgTeams": round(avg_teams, 2),
        "maxTeams": max_teams,
        "excludedHotDrop": excluded_hot,
    }


def _detect_first_fight(conn, tenant_id: int, match_id, my_account_id,
                         cluster_ms, cluster_radius_cm):
    """Findet den ersten Squad-Fight in einem Match und bewertet Win/Loss.
    Returns dict {won, teams_count, ...} oder None wenn kein Fight.
    """
    # Squad und Team-Mapping aus participants
    parts = conn.execute("""
        SELECT account_id, team_id, time_survived
        FROM participants WHERE tenant_id = ? AND match_id = ?
    """, (tenant_id, match_id,)).fetchall()
    if not parts:
        return None
    acc_to_team = {p["account_id"]: p["team_id"] for p in parts}
    acc_to_survived = {p["account_id"]: p["time_survived"] for p in parts}
    # Mein Squad = mein team_id im Match
    my_team_id = acc_to_team.get(my_account_id)
    if my_team_id is None:
        return None
    squad_ids = {a for a, t in acc_to_team.items() if t == my_team_id}

    # Alle Combat-Events des Matches, sortiert nach Zeit. Damage zaehlt
    # auch als Engagement (Long-Range-Schiesserei ohne Knock ist genau
    # so 'erster Squad-Combat' wie ein Knock). actor_account muss != NULL
    # sein - filtert Storm/Vehicle/Fall-Damage raus, die haben keinen
    # Attacker.
    events = conn.execute("""
        SELECT event_type, actor_account, target_account, timestamp_ms,
               actor_x, actor_y, victim_x, victim_y
        FROM telemetry_events
        WHERE match_id = ? AND event_type IN ('Kill', 'Knock', 'TakeDamage')
          AND actor_account IS NOT NULL
        ORDER BY timestamp_ms ASC
    """, (match_id,)).fetchall()
    if not events:
        return None

    # Erstes Squad-beteiligtes Event = Fight-Start
    first_idx = None
    for i, e in enumerate(events):
        if e["actor_account"] in squad_ids or e["target_account"] in squad_ids:
            first_idx = i
            break
    if first_idx is None:
        return None

    cluster = [events[first_idx]]
    cluster_acc_ids = set()
    for e in cluster:
        if e["actor_account"]: cluster_acc_ids.add(e["actor_account"])
        if e["target_account"]: cluster_acc_ids.add(e["target_account"])

    # Cluster erweitern: nachfolgende Events die zeitlich + räumlich nah sind
    last_event_ts = cluster[-1]["timestamp_ms"]
    for e in events[first_idx + 1:]:
        ts = e["timestamp_ms"]
        if ts is None or ts - last_event_ts > cluster_ms:
            break  # zu weit weg in Zeit
        # Räumlich: ist mind. eine der Event-Positions nahe genug an einem
        # bisherigen Cluster-Event?
        if not _event_near_cluster(e, cluster, cluster_radius_cm):
            continue
        cluster.append(e)
        last_event_ts = ts
        if e["actor_account"]: cluster_acc_ids.add(e["actor_account"])
        if e["target_account"]: cluster_acc_ids.add(e["target_account"])

    # Beteiligte Teams: nur Teams die DIREKT mit dem Squad gekämpft
    # haben (= Squad ist Attacker oder Victim im Event). Vorher zählten
    # auch 3rd-party-Teams die zufällig im Cluster-Radius kämpften ohne
    # uns zu touchen — das hat avgTeams künstlich aufgebläht (Max 15).
    lobby_team_map = {r["account_id"]: r["team_id"] for r in conn.execute("""
        SELECT account_id, team_id FROM match_team_mapping
        WHERE tenant_id = ? AND match_id = ?
    """, (tenant_id, match_id,)).fetchall()}
    full_team_map = lobby_team_map if lobby_team_map else acc_to_team
    teams = set()
    for e in cluster:
        a, v = e["actor_account"], e["target_account"]
        a_in_squad = a in squad_ids
        v_in_squad = v in squad_ids
        if a_in_squad and v_in_squad:
            continue  # Friendly fire intern — kein Gegner-Team
        if not (a_in_squad or v_in_squad):
            continue  # 3rd-party-Fight ohne uns
        opponent = v if a_in_squad else a
        opp_team = full_team_map.get(opponent)
        if opp_team is not None and opp_team != my_team_id:
            teams.add(opp_team)

    # Win-Bedingung: Hat mein Squad noch lebende Member zum Fight-Ende?
    # time_survived ist in Sekunden ab Match-Start. Kill-Events haben
    # timestamp_ms (ms ab Match-Start oder absolut?).
    # Praktisch: wenn ein Squad-Member noch nach Fight-Ende lebt → WIN.
    # Match-Start aus erstem Kill/Knock geschätzt = nicht zuverlässig.
    # Wir nehmen einen pragmatischen Ansatz: Wenn mind. 1 Squad-Member
    # nicht im Fight-Cluster als victim auftaucht UND insgesamt länger
    # überlebt als der Fight dauert → WIN.
    fight_end_ts = last_event_ts
    fight_start_ts = cluster[0]["timestamp_ms"]
    fight_duration_s = (fight_end_ts - fight_start_ts) / 1000.0

    # Squad-Members die im Cluster als Victim auftauchen → tot/down
    squad_down_in_fight = {
        e["target_account"] for e in cluster
        if e["target_account"] in squad_ids and e["event_type"] == "Kill"
    }
    squad_alive_after = squad_ids - squad_down_in_fight

    # WIN = unser Squad hat am Fight-Ende noch lebende Members
    won = bool(squad_alive_after)
    # Solo: bin ICH (my_account_id) im Cluster als Kill-Victim?
    solo_survived = my_account_id not in squad_down_in_fight
    first_event = cluster[0]
    # 'has_kill' = irgendein Kill im Cluster (egal welche Seite). Ohne
    # Kill ist der Fight nicht entschieden -> Disengage/Stalemate.
    has_kill = any(e["event_type"] == "Kill" for e in cluster)
    # Match-Start: played_at IST der Match-Start (PUBG-API createdAt).
    fight_start_after_match_start_sec = None
    m_row = conn.execute(
        "SELECT played_at FROM matches WHERE tenant_id = ? AND match_id = ?",
        (tenant_id, match_id,)).fetchone()
    if m_row and m_row["played_at"]:
        m_start = _parse_iso(m_row["played_at"])
        if m_start:
            m_start_ms = int(m_start.timestamp() * 1000)
            fight_start_after_match_start_sec = int(
                max(0, (fight_start_ts - m_start_ms) / 1000))
    # Fight-Position: actor_x/y des ersten Event-Akteurs ist die beste
    # Schaetzung wo der Fight stattfand. Notfalls victim_x/y.
    # sqlite3.Row hat kein .get() — bracket-access mit KeyError-Fallback.
    def _rget(row, key):
        try:
            v = row[key]
            return v
        except (IndexError, KeyError):
            return None
    fight_x = _rget(first_event, "actor_x") or _rget(first_event, "victim_x")
    fight_y = _rget(first_event, "actor_y") or _rget(first_event, "victim_y")
    return {
        "won": won,
        "soloSurvived": solo_survived,
        "teamSurvived": won,
        "teams_count": len(teams),
        "fight_duration_s": fight_duration_s,
        "events_count": len(cluster),
        "has_kill": has_kill,
        "squad_killed_in_fight": len(squad_down_in_fight),
        "first_event_type": first_event["event_type"],
        "first_actor_is_squad": first_event["actor_account"] in squad_ids,
        "first_target_is_squad": first_event["target_account"] in squad_ids,
        "fightStartAfterMatchStartSec": fight_start_after_match_start_sec,
        "fightX": fight_x,
        "fightY": fight_y,
    }


def _event_near_cluster(event, cluster, radius_cm):
    """True wenn Event räumlich nahe an mind. einem Cluster-Event ist.
    Nahe = victim_xy oder actor_xy < radius_cm zu mind. einem
    Cluster-Event (egal welche Position dort)."""
    e_pts = []
    if event["actor_x"] is not None and event["actor_y"] is not None:
        e_pts.append((event["actor_x"], event["actor_y"]))
    if event["victim_x"] is not None and event["victim_y"] is not None:
        e_pts.append((event["victim_x"], event["victim_y"]))
    if not e_pts:
        return True   # ohne Position: konservativ inkludieren
    radius_sq = radius_cm * radius_cm
    for c in cluster:
        c_pts = []
        if c["actor_x"] is not None and c["actor_y"] is not None:
            c_pts.append((c["actor_x"], c["actor_y"]))
        if c["victim_x"] is not None and c["victim_y"] is not None:
            c_pts.append((c["victim_x"], c["victim_y"]))
        for ex, ey in e_pts:
            for cx, cy in c_pts:
                dx, dy = ex - cx, ey - cy
                if dx * dx + dy * dy <= radius_sq:
                    return True
    return False


def compute_sessions_index(conn, tenant_id: int, my_account_id, gap_hours=4):
    """Liste aller erkennbaren Sessions in der DB, basierend auf 4h-Lücken.
    Returns Sessions sortiert vom neuesten zum ältesten."""
    rows = conn.execute("""
        SELECT m.match_id, m.played_at, m.duration_secs, m.map_name,
               m.game_mode,
               pa.kills, pa.damage_dealt, pa.place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ?
        ORDER BY m.played_at ASC
    """, (tenant_id, my_account_id,)).fetchall()

    if not rows:
        return []

    # Sessions identifizieren via Gap zwischen aufeinanderfolgenden played_at
    sessions = []
    cur = []
    prev_ts = None
    for r in rows:
        ts = _parse_iso(r["played_at"])
        if prev_ts is not None and (ts - prev_ts).total_seconds() / 3600 > gap_hours:
            sessions.append(cur)
            cur = []
        cur.append(r)
        prev_ts = ts
    if cur:
        sessions.append(cur)

    out = []
    for ms in sessions:
        # Sessions-Index zeigt total matches inkl Events, aber Wins nur BR
        n = len(ms)
        # game_mode steht hier in den row-Daten als Spalte
        wins = sum(1 for x in ms
                   if (x["place"] or 99) == 1 and is_br_mode(x["game_mode"]))
        first_end = _parse_iso(ms[0]["played_at"])
        first_start = first_end - datetime.timedelta(
            seconds=ms[0]["duration_secs"] or 0)
        last_end = ms[-1]["played_at"]
        from_iso = first_start.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Top-Mate der Session (häufigster Squad-Member, nicht self)
        match_ids = [x["match_id"] for x in ms]
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            mate_rows = conn.execute(f"""
                SELECT name, COUNT(*) AS c FROM participants
                WHERE tenant_id = ? AND match_id IN ({placeholders}) AND account_id != ?
                GROUP BY name ORDER BY c DESC LIMIT 1
            """, [tenant_id] + list(match_ids) + [my_account_id]).fetchall()
            top_mate = mate_rows[0]["name"] if mate_rows else None
            top_mate_count = mate_rows[0]["c"] if mate_rows else 0
        else:
            top_mate, top_mate_count = None, 0

        out.append({
            "from": from_iso,
            "to": last_end,
            "matches": n,
            "wins": wins,
            "kills": sum(x["kills"] or 0 for x in ms),
            "damage": sum(x["damage_dealt"] or 0 for x in ms),
            "topMate": top_mate,
            "topMateCount": top_mate_count,
        })
    # Sortiert: jüngste Session zuerst
    return list(reversed(out))


def compute_session_report(conn, tenant_id: int, my_account_id, range_from=None, range_to=None):
    """Erzeugt einen After-Session-Report mit Phasen-Aufteilung.
    - Default: aktuelle Session via _session_filter
    - Mit range_from/range_to (ISO): genauer Zeitraum"""
    if range_from:
        started = range_from
    else:
        started = _session_filter(conn, tenant_id)

    end_filter = "AND m.played_at <= ?" if range_to else ""
    params = [my_account_id, started]
    if range_to:
        params.append(range_to)

    # Session-Report listet auch Events (sichtbar im Match-List) aber die
    # Aggregat-Totals werden nur fuer BR-Matches gerechnet (siehe unten).
    matches = conn.execute(f"""
        SELECT m.match_id, m.map_name, m.game_mode, m.played_at,
               m.duration_secs,
               pa.kills, pa.headshot_kills, pa.assists, pa.dbnos,
               pa.damage_dealt, pa.place, pa.time_survived,
               pa.longest_kill
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ? AND m.played_at >= ? {end_filter}
        ORDER BY m.played_at ASC
    """, [tenant_id] + params).fetchall()

    if not matches:
        return {"sessionStartedAt": started, "rangeTo": range_to,
                "totalMatches": 0,
                "phases": [], "totals": None, "highlights": []}

    # Squad-Members pro Match (ohne dich selbst, sortiert)
    def _squad(match_id):
        rows = conn.execute("""
            SELECT name, kills, headshot_kills, assists, dbnos,
                   damage_dealt, place, time_survived
            FROM participants WHERE tenant_id=? AND match_id=? AND account_id != ?
            ORDER BY name
        """, (tenant_id, match_id, my_account_id)).fetchall()
        return [dict(r) for r in rows]

    self_name_row = conn.execute(
        "SELECT name FROM players WHERE tenant_id = ? AND account_id = ?",
        (tenant_id, my_account_id,)
    ).fetchone()
    my_name = self_name_row["name"] if self_name_row else "Self"

    # Längste time_survived im Squad (du + Mates) — wann der LETZTE Squadmember
    # raus war. Bei Win = Match-Dauer.
    def _squad_last_survived(match_id):
        row = conn.execute("""
            SELECT MAX(time_survived) AS max_surv FROM participants
            WHERE tenant_id=? AND match_id=?
        """, (tenant_id, match_id,)).fetchone()
        return row["max_surv"] or 0

    enriched = []
    for m in matches:
        d = dict(m)
        d["squad"] = _squad(m["match_id"])
        d["squadSet"] = frozenset(s["name"] for s in d["squad"])
        d["squadTimeSurvived"] = _squad_last_survived(m["match_id"])
        enriched.append(d)

    # Event-Matches: PUBG-API liefert participants.kills/damage_dealt = 0
    # weil ihr System in Event-Modi keine Player-Stats trackt. Wir holen
    # echte Kills + Damage aus telemetry_events und packen sie in
    # SEPARATE Felder (effective_kills / effective_damage). Map-Performance
    # und die Match-Liste benutzen die effective_*-Werte; Top-Totals + K/D
    # bleiben unverpestet (Events zaehlen dort 0).
    event_match_ids = [x["match_id"] for x in enriched
                        if not is_br_mode(x.get("game_mode"))]
    kills_by_match = {}
    dmg_by_match = {}
    if event_match_ids:
        ph = ",".join("?" * len(event_match_ids))
        # telemetry_events ist global (kein tenant_id) — nur my_account_id
        # + match-IDs als Parameter.
        kills_by_match = {r["match_id"]: r["k"] for r in conn.execute(
            f"SELECT match_id, COUNT(*) AS k FROM telemetry_events "
            f"WHERE event_type='Kill' AND actor_account=? "
            f"AND match_id IN ({ph}) GROUP BY match_id",
            [my_account_id, *event_match_ids]).fetchall()}
        dmg_by_match = {r["match_id"]: float(r["d"] or 0) for r in conn.execute(
            f"SELECT match_id, COALESCE(SUM(damage), 0) AS d "
            f"FROM telemetry_events "
            f"WHERE event_type='TakeDamage' AND actor_account=? "
            f"AND match_id IN ({ph}) GROUP BY match_id",
            [my_account_id, *event_match_ids]).fetchall()}
    for x in enriched:
        if not is_br_mode(x.get("game_mode")):
            x["effective_kills"]  = kills_by_match.get(x["match_id"], 0)
            x["effective_damage"] = dmg_by_match.get(x["match_id"], 0.0)
        else:
            x["effective_kills"]  = x["kills"] or 0
            x["effective_damage"] = x["damage_dealt"] or 0

    # Phase = aufeinanderfolgende Matches deren Squad-Sets sich überlappen.
    # Der "Stamm" der Phase ist die Schnittmenge aller Squads in der Phase
    # (die Mates die in JEDEM Match dieser Phase dabei waren).
    # Random-Filler die nur in einzelnen Matches mitliefen werden separat geführt.
    phases = []
    cur_phase = None
    for m in enriched:
        cur_set = m["squadSet"]
        if cur_phase is None:
            cur_phase = {"core": set(cur_set),
                          "allMembers": set(cur_set),
                          "matches": []}
            phases.append(cur_phase)
        else:
            new_core = cur_phase["core"] & cur_set
            if not new_core and cur_set:
                # Stamm-Crew komplett weg → neue Phase
                cur_phase = {"core": set(cur_set),
                              "allMembers": set(cur_set),
                              "matches": []}
                phases.append(cur_phase)
            elif not cur_set:
                # Solo-Match — bricht Phase nur wenn vorher Squad da war
                if cur_phase["core"]:
                    cur_phase = {"core": set(),
                                  "allMembers": set(),
                                  "matches": []}
                    phases.append(cur_phase)
            else:
                cur_phase["core"] = new_core
                cur_phase["allMembers"] |= cur_set
        cur_phase["matches"].append(m)

    # Pro Phase Aggregate
    import datetime as _dt
    def _match_start(m):
        """Match-Start = played_at (Match-End) - duration."""
        end = _dt.datetime.fromisoformat(m["played_at"].replace("Z", "+00:00"))
        return (end - _dt.timedelta(seconds=m["duration_secs"] or 0)) \
            .strftime("%Y-%m-%dT%H:%M:%SZ")

    def _squad_lobby_for(match_ids):
        """Squad-K/D + Lobby-K/D für eine Match-ID-Liste.
        Squad = my_team_id pro Match. Squad-K/D = SUM(team_kills) /
        SUM(team_deaths). Death pro Mate = time_survived < duration-5
        (Toleranz für Rundungs-Unschärfe). Wenn time_survived fehlt
        (Schema 3): Fallback team_size_if_lost.
        Beispiel Duo, beide tot, 9 kills: 9/2 = 4.5. Win mit 1 toten
        Mate: kills/1 statt kills/0."""
        out = {"squadKills": 0, "squadKd": 0, "squadKillsPerMatch": 0,
               "squadMatchesWithMapping": 0,
               "lobbyKd": 0, "lobbyMatchesWithMapping": 0,
               "lobbyTop3Kd": 0, "lobbyTop3Kills": 0,
               "lobbyTop3Matches": 0}
        if not match_ids:
            return out
        # Top-3-Lobby-Indikator (separat vom Squad-Aggregat)
        top3 = compute_lobby_top3_kd(conn, tenant_id, my_account_id, match_ids=match_ids)
        out["lobbyTop3Kd"] = top3["top3Kd"]
        out["lobbyTop3Kills"] = top3["top3Kills"]
        out["lobbyTop3Matches"] = top3["matches"]
        ph_id = ",".join("?" * len(match_ids))
        # Squad-Aggregate (mit time_survived basiertem Death-Count)
        sq_rows = conn.execute(f"""
            WITH my_teams AS (
              SELECT match_id, team_id FROM match_team_mapping
              WHERE tenant_id = ? AND account_id = ? AND match_id IN ({ph_id})
            )
            SELECT mtm.match_id, m.duration_secs,
                   SUM(COALESCE(mtm.kills, 0)) AS sq_kills,
                   COUNT(*)                     AS team_size,
                   SUM(CASE WHEN mtm.time_survived IS NOT NULL
                              AND mtm.time_survived < m.duration_secs - 5
                            THEN 1 ELSE 0 END)  AS sq_deaths_real,
                   SUM(CASE WHEN mtm.time_survived IS NULL THEN 1 ELSE 0 END)
                                                AS sq_no_surv,
                   MAX(CASE WHEN mtm.place=1 THEN 1 ELSE 0 END) AS sq_won
            FROM match_team_mapping mtm
            JOIN my_teams mt ON mt.match_id = mtm.match_id
                              AND mt.team_id = mtm.team_id
            JOIN matches m   ON m.match_id  = mtm.match_id AND m.tenant_id = mtm.tenant_id
            WHERE mtm.tenant_id = ? AND mtm.kills IS NOT NULL
            GROUP BY mtm.match_id, m.duration_secs
        """, [tenant_id, my_account_id] + match_ids + [tenant_id]).fetchall()
        sq_kills = 0
        sq_deaths = 0
        for r in sq_rows:
            sq_kills += r["sq_kills"] or 0
            if r["sq_no_surv"]:
                # Fallback (Schema 3): alle tot wenn nicht gewonnen
                sq_deaths += 0 if r["sq_won"] else (r["team_size"] or 0)
            else:
                sq_deaths += r["sq_deaths_real"] or 0
        sq_n = len(sq_rows)
        out["squadKills"] = sq_kills
        out["squadMatchesWithMapping"] = sq_n
        out["squadKd"] = (sq_kills / max(sq_deaths, 1)) if sq_n else 0
        out["squadKillsPerMatch"] = (sq_kills / sq_n) if sq_n else 0
        # Lobby-Aggregate (wie compute_lobby_avg_kd: Ø lobbyKd pro Match)
        lo_rows = conn.execute(f"""
            SELECT match_id,
                   SUM(COALESCE(kills, 0)) AS l_kills,
                   COUNT(*)                AS l_n,
                   SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS l_wins
            FROM match_team_mapping
            WHERE tenant_id = ? AND match_id IN ({ph_id}) AND kills IS NOT NULL
            GROUP BY match_id
            HAVING COUNT(*) > 4
        """, [tenant_id] + match_ids).fetchall()
        if lo_rows:
            kds = [(r["l_kills"] or 0) / max((r["l_n"] or 0) - (r["l_wins"] or 0), 1)
                   for r in lo_rows]
            out["lobbyKd"] = sum(kds) / len(kds)
            out["lobbyMatchesWithMapping"] = len(kds)
        return out

    for ph in phases:
        ms = ph["matches"]
        # Aggregate-Stats nur ueber BR-Matches. Events bleiben in der
        # Match-Liste (Anzeige), zaehlen aber nicht fuer K/D, Wins etc.
        br_ms = [x for x in ms if is_br_mode(x.get("game_mode"))]
        ev_ms = [x for x in ms if not is_br_mode(x.get("game_mode"))]
        n = len(br_ms)
        wins = sum(1 for x in br_ms if (x["place"] or 99) == 1)
        # Member-Counts: wie oft war jeder dabei in dieser Phase (auch
        # Events zaehlen — du hast ja mit ihm/ihr gespielt)
        ph["memberCounts"] = {}
        for x in ms:
            for name in x["squadSet"]:
                ph["memberCounts"][name] = ph["memberCounts"].get(name, 0) + 1
        total_kills = sum(x["kills"] or 0 for x in br_ms)
        total_damage = sum(x["damage_dealt"] or 0 for x in br_ms)
        total_surv = sum(x["time_survived"] or 0 for x in br_ms)
        squad_lobby = _squad_lobby_for([x["match_id"] for x in br_ms])
        ph["stats"] = {
            "matches": n,
            "eventMatches": len(ev_ms),
            "wins": wins,
            "kills": total_kills,
            "damage": total_damage,
            "avgKills": total_kills / n if n else 0,
            "avgDamage": total_damage / n if n else 0,
            "avgPlace": (sum(x["place"] or 0 for x in br_ms) / n) if n else 0,
            "avgSurvivedSec": total_surv / n if n else 0,
            "kd": total_kills / max(n - wins, 1) if n else 0,
            "totalSurvivedSec": total_surv,
            "startTime": _match_start(ms[0]),
            "endTime": ms[-1]["played_at"],
            **squad_lobby,
        }

    # Total-Aggregate
    n = len(enriched)
    wins = sum(1 for x in enriched if (x["place"] or 99) == 1)
    total_kills = sum(x["kills"] or 0 for x in enriched)
    total_damage = sum(x["damage_dealt"] or 0 for x in enriched)
    total_surv = sum(x["time_survived"] or 0 for x in enriched)
    # Squad+Lobby-Aggregate über alle Matches der Range
    totals_squad_lobby = _squad_lobby_for([x["match_id"] for x in enriched])

    totals = {
        "matches": n,
        "wins": wins,
        "kills": total_kills,
        "damage": total_damage,
        "avgKills": total_kills / n if n else 0,
        "avgDamage": total_damage / n if n else 0,
        "avgPlace": sum(x["place"] or 0 for x in enriched) / n if n else 0,
        "avgSurvivedSec": total_surv / n if n else 0,
        "kd": total_kills / max(n - wins, 1),
        "headshots": sum(x["headshot_kills"] or 0 for x in enriched),
        "assists": sum(x["assists"] or 0 for x in enriched),
        "dbnos": sum(x["dbnos"] or 0 for x in enriched),
        "totalSurvivedSec": total_surv,
        "longestKill": max((x["longest_kill"] or 0 for x in enriched), default=0),
        "startTime": _match_start(enriched[0]),
        "endTime": enriched[-1]["played_at"],
        "uniqueMaps": len({x["map_name"] for x in enriched}),
        # Squad+Lobby-Aggregate (basiert auf match_team_mapping)
        **totals_squad_lobby,
    }

    # Map-Performance: pro Map → Matches, Wins, K/D, Avg DMG, Avg Place
    # Events werden separat markiert. KD ist nur in BR-Modi sinnvoll;
    # Event-Modi haben kein DIED-Event und kein Placement → 'Perfekt'.
    map_stats = {}
    for x in enriched:
        mn = x["map_name"]
        is_event = not is_br_mode(x.get("game_mode"))
        if mn not in map_stats:
            map_stats[mn] = {"map": mn, "matches": 0, "wins": 0,
                              "kills": 0, "damage": 0.0,
                              "totalPlace": 0, "totalSurv": 0,
                              "eventMatches": 0, "brMatches": 0,
                              "deaths": 0}
        ms_ = map_stats[mn]
        ms_["matches"] += 1
        if is_event:
            ms_["eventMatches"] += 1
        else:
            ms_["brMatches"] += 1
            # Death = nicht gewonnen UND time_survived < duration_secs (Toleranz 5s)
            if (x["place"] or 99) != 1:
                dur = x.get("duration_secs") or 0
                surv = x.get("time_survived") or 0
                if dur and surv < dur - 5:
                    ms_["deaths"] += 1
        if (x["place"] or 99) == 1:
            ms_["wins"] += 1
        ms_["kills"] += x.get("effective_kills", x["kills"] or 0)
        ms_["damage"] += x.get("effective_damage", x["damage_dealt"] or 0)
        ms_["totalPlace"] += x["place"] or 0
        ms_["totalSurv"] += x["time_survived"] or 0
    maps_perf = []
    for ms_ in map_stats.values():
        nm = ms_["matches"]
        is_event_only = ms_["brMatches"] == 0 and ms_["eventMatches"] > 0
        maps_perf.append({
            "map": ms_["map"],
            "matches": nm,
            "wins": ms_["wins"],
            "kills": ms_["kills"],
            "damage": ms_["damage"],
            "avgKills": ms_["kills"] / nm if nm else 0,
            "avgDamage": ms_["damage"] / nm if nm else 0,
            "avgPlace": ms_["totalPlace"] / nm if nm else 0,
            "avgSurvivedSec": ms_["totalSurv"] / nm if nm else 0,
            "kd": ms_["kills"] / max(nm - ms_["wins"], 1),
            "isEvent": is_event_only,
            "eventMatches": ms_["eventMatches"],
            "brMatches":    ms_["brMatches"],
            "deaths":       ms_["deaths"],
        })
    maps_perf.sort(key=lambda m: -m["matches"])

    # Highlights — beste Matches nach DMG
    highlights = sorted(enriched, key=lambda x: -(x["damage_dealt"] or 0))[:3]
    # Lowlights — frühe Deaths (kurze time_survived)
    lowlights = sorted([x for x in enriched if (x["place"] or 99) > 20],
                       key=lambda x: x["time_survived"] or 0)[:3]

    def _special_events(match_id, acc_ids):
        """Sonder-Events (Redzone-Tod, Fahrzeug-Kill/-Tod, Drive-By) pro
        Account-ID. Liefert pro Kategorie eine Liste von Detail-Dicts mit
        weapon, weaponName, victim/killer (Name + Acc), Position, Distanz,
        Timestamp — damit das Frontend einzelne Events aufklappen kann.

        Returns dict { account_id: {redzone:[...], vkill:[...],
                                     vdeath:[...], driveby:[...]} }"""
        ph = ",".join("?" * len(acc_ids))
        result = {a: {"redzone": [], "vkill": [], "vdeath": [], "driveby": []}
                  for a in acc_ids}
        try:
            # Helper — Name-Lookup ueber participants + players, cached.
            name_cache = {}
            def _name(acc):
                if not acc: return None
                if acc in name_cache: return name_cache[acc]
                r = conn.execute("""
                    SELECT COALESCE(p.name, pa.name) AS n
                    FROM (SELECT NULL AS dummy) x
                    LEFT JOIN players p ON p.tenant_id = ? AND p.account_id = ?
                    LEFT JOIN participants pa ON pa.tenant_id = ? AND pa.match_id = ?
                          AND pa.account_id = ?
                """, (tenant_id, acc, tenant_id, match_id, acc)).fetchone()
                n = r["n"] if r else None
                name_cache[acc] = n
                return n

            def _vehicle_event(r, is_actor):
                wid = r["weapon"]
                wn, cat = _weapon_label(wid) if wid else (None, "other")
                if cat != "vehicle":
                    return None
                return {
                    "tsMs":       r["timestamp_ms"],
                    "weapon":     wid,
                    "weaponName": wn,
                    "x":          r["victim_x"],
                    "y":          r["victim_y"],
                    "distanceM":  (round((r["distance"] or 0) / 100.0, 1)
                                   if r["distance"] else None),
                    ("victimName" if is_actor else "killerName"):
                        _name(r["target_account"] if is_actor
                              else r["actor_account"]),
                    ("victimAcc" if is_actor else "killerAcc"):
                        r["target_account"] if is_actor else r["actor_account"],
                }

            # Redzone-Tode (Kill ohne actor + Bomb/RedZone-Waffe)
            for r in conn.execute(f"""
                SELECT * FROM telemetry_events
                WHERE match_id=? AND event_type='Kill'
                  AND target_account IN ({ph})
                  AND (actor_account IS NULL OR actor_account='')
                  AND (weapon LIKE '%RedZone%' OR weapon LIKE '%Bomb%'
                       OR weapon LIKE '%bomb%')
            """, [match_id] + list(acc_ids)).fetchall():
                target = r["target_account"]
                if target in result:
                    result[target]["redzone"].append({
                        "tsMs":       r["timestamp_ms"],
                        "weapon":     r["weapon"],
                        "weaponName": _weapon_label(r["weapon"])[0]
                                      if r["weapon"] else "Red Zone",
                        "x":          r["victim_x"],
                        "y":          r["victim_y"],
                    })
            # Vehicle-Kills + Vehicle-Tode — gleiche SQL, separate Buckets
            for r in conn.execute(f"""
                SELECT * FROM telemetry_events
                WHERE match_id=? AND event_type='Kill'
                  AND (actor_account IN ({ph}) OR target_account IN ({ph}))
            """, [match_id] + list(acc_ids) + list(acc_ids)).fetchall():
                actor, target = r["actor_account"], r["target_account"]
                if actor in result:
                    ev = _vehicle_event(r, is_actor=True)
                    if ev: result[actor]["vkill"].append(ev)
                if target in result and target != actor:
                    ev = _vehicle_event(r, is_actor=False)
                    if ev: result[target]["vdeath"].append(ev)
            # Drive-By (Kill waehrend in Fahrzeug)
            for acc in acc_ids:
                ve = conn.execute("""
                    SELECT event_type, timestamp_ms FROM telemetry_events
                    WHERE match_id=? AND actor_account=?
                      AND event_type IN ('VehicleEnter','VehicleLeave')
                    ORDER BY timestamp_ms ASC
                """, (match_id, acc)).fetchall()
                if not ve: continue
                intervals = []
                enter_ms = None
                for e in ve:
                    if e["event_type"] == "VehicleEnter":
                        enter_ms = e["timestamp_ms"]
                    elif e["event_type"] == "VehicleLeave" and enter_ms:
                        intervals.append((enter_ms, e["timestamp_ms"]))
                        enter_ms = None
                if enter_ms:
                    intervals.append((enter_ms, 10**15))
                if not intervals: continue
                for k in conn.execute("""
                    SELECT * FROM telemetry_events
                    WHERE match_id=? AND event_type='Kill'
                      AND actor_account=?
                """, (match_id, acc)).fetchall():
                    ts = k["timestamp_ms"]
                    if not ts: continue
                    if not any(a <= ts <= b for a, b in intervals): continue
                    # Drive-By soll Fahrzeug-Kills NICHT doppeln
                    wn, cat = _weapon_label(k["weapon"]) if k["weapon"] \
                              else (None, "other")
                    if cat == "vehicle": continue
                    result[acc]["driveby"].append({
                        "tsMs":       ts,
                        "weapon":     k["weapon"],
                        "weaponName": wn,
                        "victimName": _name(k["target_account"]),
                        "victimAcc":  k["target_account"],
                        "x":          k["victim_x"],
                        "y":          k["victim_y"],
                        "distanceM":  (round((k["distance"] or 0) / 100.0, 1)
                                       if k["distance"] else None),
                    })
        except Exception:
            pass
        return result

    def _to_payload(m):
        # Eigener Eintrag zusätzlich zu mates-Liste
        # Sonder-Events (Redzone, Fahrzeug) fuer ganzes Squad
        sq_accs = {my_account_id} | {s.get("account_id") or s.get("name")
                                       for s in (m["squad"] or [])
                                       if s.get("account_id")}
        # squad hat aktuell nur Namen, nicht account_ids. Wir holen
        # account_ids aus participants.
        sq_accs_from_db = set(r["account_id"] for r in conn.execute(
            "SELECT account_id FROM participants WHERE tenant_id=? AND match_id=? AND team_id=("
            "  SELECT team_id FROM participants WHERE tenant_id=? AND match_id=? AND account_id=?)",
            (tenant_id, m["match_id"], tenant_id, m["match_id"], my_account_id)).fetchall())
        spec = _special_events(m["match_id"], sq_accs_from_db)
        # Name-Lookup fuer account_ids
        acc_name = {r["account_id"]: r["name"] for r in conn.execute(
            "SELECT account_id, name FROM players WHERE tenant_id=? AND account_id IN ({})".format(
                ",".join("?"*len(sq_accs_from_db))),
            [tenant_id] + list(sq_accs_from_db)).fetchall()} if sq_accs_from_db else {}
        # Knock-Empfang + Wiederbelebungen pro Squadmember aus Telemetrie
        ph = ",".join("?"*len(sq_accs_from_db)) if sq_accs_from_db else "''"
        sq_list = list(sq_accs_from_db)
        knocks_received = {}
        revives_given = {}
        revives_received = {}
        bot_kills = {}
        if sq_list:
            for r in conn.execute(
                f"SELECT target_account, COUNT(*) AS c FROM telemetry_events "
                f"WHERE match_id = ? AND event_type='Knock' "
                f"AND target_account IN ({ph}) GROUP BY target_account",
                    [m["match_id"]] + sq_list).fetchall():
                knocks_received[r["target_account"]] = r["c"]
            for r in conn.execute(
                f"SELECT actor_account, COUNT(*) AS c FROM telemetry_events "
                f"WHERE match_id = ? AND event_type='Revive' "
                f"AND actor_account IN ({ph}) GROUP BY actor_account",
                    [m["match_id"]] + sq_list).fetchall():
                revives_given[r["actor_account"]] = r["c"]
            # Wie oft wurde der Member von Squadmates wiederbelebt?
            # Knocks die im Tod endeten zählen hier NICHT mit (Revive
            # passierte ja nicht). → besseres 'KO'-Maß als knocks_received.
            for r in conn.execute(
                f"SELECT target_account, COUNT(*) AS c FROM telemetry_events "
                f"WHERE match_id = ? AND event_type='Revive' "
                f"AND target_account IN ({ph}) GROUP BY target_account",
                    [m["match_id"]] + sq_list).fetchall():
                revives_received[r["target_account"]] = r["c"]
            # Bot-Kills pro Squadmember: Kill-Events mit target_account=ai.*
            for r in conn.execute(
                f"SELECT actor_account, COUNT(*) AS c FROM telemetry_events "
                f"WHERE match_id = ? AND event_type='Kill' "
                f"AND actor_account IN ({ph}) "
                f"AND target_account LIKE 'ai.%' GROUP BY actor_account",
                    [m["match_id"]] + sq_list).fetchall():
                bot_kills[r["actor_account"]] = r["c"]
        # Bot-Teams (team_id >= 200) und Gesamt-Teams in dieser Lobby
        bot_teams_in_lobby = (conn.execute(
            "SELECT COUNT(DISTINCT team_id) AS c FROM match_team_mapping "
            "WHERE tenant_id = ? AND match_id = ? AND team_id>=200",
            (tenant_id, m["match_id"],)).fetchone() or {}).get("c", 0) or 0
        total_teams_in_lobby = (conn.execute(
            "SELECT COUNT(DISTINCT team_id) AS c FROM match_team_mapping "
            "WHERE tenant_id = ? AND match_id = ?",
            (tenant_id, m["match_id"],)).fetchone() or {}).get("c", 0) or 0
        # Bot-Spieler einzeln (jeder ai.*-account_id zaehlt einmal)
        # und Gesamt-Spieler in der Lobby.
        bot_players_in_lobby = (conn.execute(
            "SELECT COUNT(*) AS c FROM match_team_mapping "
            "WHERE tenant_id = ? AND match_id = ? AND account_id LIKE 'ai.%'",
            (tenant_id, m["match_id"],)).fetchone() or {}).get("c", 0) or 0
        total_players_in_lobby = (conn.execute(
            "SELECT COUNT(*) AS c FROM match_team_mapping "
            "WHERE tenant_id = ? AND match_id = ?",
            (tenant_id, m["match_id"],)).fetchone() or {}).get("c", 0) or 0
        my_special = spec.get(my_account_id, {})
        my_entry = {
            "name": my_name,
            "kills": m.get("effective_kills", m["kills"]),
            "headshot_kills": m["headshot_kills"],
            "assists": m["assists"],
            "dbnos": m["dbnos"],
            "damage_dealt": m.get("effective_damage", m["damage_dealt"]),
            "place": m["place"],
            "time_survived": m["time_survived"],
            "isSelf": True,
            "special": my_special,
            "knocksReceived":  knocks_received.get(my_account_id, 0),
            "revivesGiven":    revives_given.get(my_account_id, 0),
            "revivesReceived": revives_received.get(my_account_id, 0),
            "botKills":        bot_kills.get(my_account_id, 0),
        }
        # Mates-Liste mit special-Events anreichern
        squad_enriched = []
        for s in (m["squad"] or []):
            s2 = dict(s)
            # Versuch account_id via Name zu finden
            acc = next((a for a, n in acc_name.items()
                        if n == s.get("name") and a != my_account_id), None)
            s2["special"] = spec.get(acc, {}) if acc else {}
            s2["knocksReceived"]  = knocks_received.get(acc, 0) if acc else 0
            s2["revivesGiven"]    = revives_given.get(acc, 0) if acc else 0
            s2["revivesReceived"] = revives_received.get(acc, 0) if acc else 0
            s2["botKills"]        = bot_kills.get(acc, 0) if acc else 0
            squad_enriched.append(s2)
        # Gesamt-Sonder-Events fuer Match als Zusammenfassung
        match_special = {
            "redzoneDeaths": sum(len(v.get("redzone",[])) for v in spec.values()),
            "vehicleKills":  sum(len(v.get("vkill",[]))   for v in spec.values()),
            "vehicleDeaths": sum(len(v.get("vdeath",[]))  for v in spec.values()),
            "driveBys":      sum(len(v.get("driveby",[])) for v in spec.values()),
        }
        return {
            "matchId": m["match_id"],
            "map": m["map_name"],
            "mode": m["game_mode"],
            "isEvent": not is_br_mode(m["game_mode"]),
            "matchEnd": m["played_at"],
            "durationSec": m["duration_secs"],
            "place": m["place"],
            "kills": m.get("effective_kills", m["kills"]),
            "damage": m.get("effective_damage", m["damage_dealt"]),
            "timeSurvived": m["time_survived"],
            "squadTimeSurvived": m["squadTimeSurvived"],
            "myStats": my_entry,
            "squad": squad_enriched,
            "matchSpecial": match_special,
            "botTeamsInLobby": bot_teams_in_lobby,
            "totalTeamsInLobby": total_teams_in_lobby,
            "botPlayersInLobby": bot_players_in_lobby,
            "totalPlayersInLobby": total_players_in_lobby,
        }

    return {
        "sessionStartedAt": started,
        "rangeTo": range_to,
        "totalMatches": n,
        "totals": totals,
        "phases": [{
            "coreSquad": sorted(ph["core"]),
            "allMembers": sorted(ph["allMembers"]),
            # Filler mit Count (wie oft war jeder in der Phase dabei) — sortiert
            # nach Count absteigend, dann Name.
            "fillers": [
                {"name": n, "count": ph["memberCounts"].get(n, 0)}
                for n in sorted(
                    ph["allMembers"] - ph["core"],
                    key=lambda nm: (-ph["memberCounts"].get(nm, 0), nm),
                )
            ],
            "phaseMatchCount": len(ph["matches"]),
            "stats": ph["stats"],
            "matches": [_to_payload(m) for m in ph["matches"]],
        } for ph in phases],
        "highlights": [_to_payload(m) for m in highlights],
        "lowlights": [_to_payload(m) for m in lowlights],
        "mapsPerf": maps_perf,
    }


def compute_chickens_together(conn, tenant_id: int, my_account_id, min_wins=1, min_matches=1):
    """Pro Co-Player: gemeinsame Wins (place=1), Match-Anzahl, Win-Rate.
    Sortiert: absolute Wins primär, bei Gleichstand höhere Win-Rate vor."""
    rows = conn.execute("""
        SELECT mate.account_id, mate.name,
               SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) AS wins_together,
               COUNT(*) AS shared_matches,
               (CAST(SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) AS DOUBLE PRECISION)
                / COUNT(*)) * 100 AS win_rate
        FROM participants mate
        JOIN participants me ON me.match_id = mate.match_id AND me.tenant_id = mate.tenant_id AND me.account_id = ?
        WHERE mate.tenant_id = ? AND mate.account_id != ?
        GROUP BY mate.account_id, mate.name
        HAVING SUM(CASE WHEN mate.place = 1 THEN 1 ELSE 0 END) >= ? AND COUNT(*) >= ?
        ORDER BY wins_together DESC, win_rate DESC, shared_matches DESC
    """, (my_account_id, tenant_id, my_account_id, min_wins, min_matches)).fetchall()
    return [{
        "accountId": r["account_id"],
        "name": r["name"],
        "winsTogether": r["wins_together"],
        "sharedMatches": r["shared_matches"],
        "winRate": r["win_rate"],
    } for r in rows]


def compute_squad_compare(conn, tenant_id: int, my_account_id, player_names, last_n=5):
    targets = [n.strip() for n in player_names if n.strip()]
    if not targets:
        return {"players": [], "matchTable": []}

    rows = conn.execute(f"""
        SELECT p.account_id, p.name FROM players p
        WHERE p.tenant_id = ? AND p.name IN ({",".join(["?"]*len(targets))})
    """, [tenant_id] + targets).fetchall()
    name_to_acc = {r["name"]: r["account_id"] for r in rows}

    cutoff_q = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id AND pa.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND pa.account_id = ?
        ORDER BY m.played_at DESC LIMIT ?
    """, (tenant_id, my_account_id, last_n)).fetchall()

    table = []
    for mid_row in cutoff_q:
        cells = {}
        for name in targets:
            acc = name_to_acc.get(name)
            if not acc:
                cells[name] = None
                continue
            p = conn.execute("""
                SELECT kills, damage_dealt, place
                FROM participants WHERE tenant_id = ? AND match_id = ? AND account_id = ?
            """, (tenant_id, mid_row["match_id"], acc)).fetchone()
            cells[name] = dict(p) if p else None
        table.append({"matchId": mid_row["match_id"],
                      "map": mid_row["map_name"],
                      "playedAt": mid_row["played_at"],
                      "cells": cells})
    return {"players": targets, "matchTable": table}


def compute_landing_spots(conn, tenant_id: int, map_name, player_accs, pois_blob=None,
                          route_filter=False):
    """Aggregiert Landings auf einer Map, gefiltert auf Matches in denen
    ALLE player_accs im selben Squad waren (Konstellations-Filter).
    Leere player_accs-Liste → alle Matches der Map.

    pois_blob: {mapKm, regions:[...]} der Map (fuer POI-Zuordnung).
    route_filter: nur Matches wo der Landing-POI <=1.5km Querdistanz zur
                  Flugroute hatte (siehe Task 6 — hier noch ignoriert).

    Returns:
      { "pois": [{name, cx, cy, total, byPlayer:{acc:{name,count,pct}}}],
        "scatterPoints": [{accountId, x, y, matchId}],
        "totalMatches": int }
    """
    from pubg.poi_match import (match_poi, poly_area, perp_distance_to_route,
                                apply_pin_cal)
    player_accs = [a for a in (player_accs or []) if a]

    # 1) Matches der Map bestimmen, die den Konstellations-Filter erfuellen
    match_rows = conn.execute(
        "SELECT match_id FROM matches WHERE tenant_id = ? AND map_name = ?",
        (tenant_id, map_name,)).fetchall()
    match_ids = []
    for mr in match_rows:
        mid = mr["match_id"]
        if not player_accs:
            match_ids.append(mid)
            continue
        # Alle player_accs muessen im selben team_id dieses Matches sein
        rows = conn.execute(
            "SELECT account_id, team_id FROM match_team_mapping "
            "WHERE tenant_id = ? AND match_id = ?", (tenant_id, mid,)).fetchall()
        team_of = {r["account_id"]: r["team_id"] for r in rows}
        teams = {team_of.get(a) for a in player_accs}
        if None in teams or len(teams) != 1:
            continue
        match_ids.append(mid)

    if not match_ids:
        return {"pois": [], "scatterPoints": [], "totalMatches": 0}

    # Flugrouten-Filter: nur Matches behalten wo die Landung des
    # Referenz-Spielers <=1.5km Querdistanz zur Cruise-Route lag.
    # Referenz = erster angegebener Spieler (oder self bei leerer Liste).
    if route_filter and player_accs:
        ref = player_accs[0]
        ROUTE_MAX_CM = 150000  # 1.5km
        kept = []
        for mid in match_ids:
            cruise = conn.execute("""
                SELECT actor_x, actor_y FROM telemetry_events
                WHERE match_id=? AND actor_account=? AND event_type='Position'
                  AND actor_z >= 150000
                ORDER BY timestamp_ms ASC
            """, (mid, ref)).fetchall()
            land = conn.execute("""
                SELECT actor_x, actor_y FROM telemetry_events
                WHERE match_id=? AND actor_account=? AND event_type='Landing'
                  AND actor_x IS NOT NULL
                ORDER BY timestamp_ms ASC LIMIT 1
            """, (mid, ref)).fetchone()
            if len(cruise) < 2 or not land:
                kept.append(mid)  # routeUnknown → einbeziehen
                continue
            ax, ay = cruise[0]["actor_x"], cruise[0]["actor_y"]
            bx, by = cruise[-1]["actor_x"], cruise[-1]["actor_y"]
            d = perp_distance_to_route(land["actor_x"], land["actor_y"],
                                       ax, ay, bx, by)
            if d <= ROUTE_MAX_CM:
                kept.append(mid)
        match_ids = kept

    if not match_ids:
        return {"pois": [], "scatterPoints": [], "totalMatches": 0}

    # 2) Landings dieser Matches fuer die gewuenschten Spieler holen.
    #    Best-Touchdown: fruehestes Landing mit z<80000 + health>0 pro
    #    (match, actor). Vereinfachte Variante der _landings-Heuristik.
    ph = ",".join("?" * len(match_ids))
    acc_clause = ""
    # Telemetrie ist global — keine tenant_id-Filter. Players join filtert
    # auf tenant_id damit der Name aus der eigenen DB kommt.
    params = list(match_ids) + [tenant_id]
    if player_accs:
        acc_ph = ",".join("?" * len(player_accs))
        acc_clause = f"AND te.actor_account IN ({acc_ph})"
        params += player_accs
    rows = conn.execute(f"""
        WITH best AS (
          SELECT match_id, actor_account, MIN(timestamp_ms) AS ts
          FROM telemetry_events
          WHERE event_type='Landing' AND match_id IN ({ph})
            AND actor_x IS NOT NULL AND actor_y IS NOT NULL
            AND (actor_z IS NULL OR actor_z < 80000)
            AND (actor_health IS NULL OR actor_health > 0)
          GROUP BY match_id, actor_account
        )
        SELECT te.match_id, te.actor_account, te.actor_x, te.actor_y,
               p.name AS player_name
        FROM best b
        JOIN telemetry_events te
          ON te.match_id=b.match_id AND te.actor_account=b.actor_account
         AND te.timestamp_ms=b.ts AND te.event_type='Landing'
        LEFT JOIN players p ON p.account_id = te.actor_account AND p.tenant_id = ?
        WHERE 1=1 {acc_clause}
    """, params).fetchall()

    regions = (pois_blob or {}).get("regions") or []
    # POI-Zentren vorberechnen (Vertex-Mittel) + Flaeche fuer Sortier-Stabilitaet
    poi_centroid = {}
    for r in regions:
        nm = r.get("name")
        if not nm:
            continue
        pts = r.get("points") or []
        if pts:
            sx = sum(p[0] for p in pts) / len(pts)
            sy = sum(p[1] for p in pts) / len(pts)
            poi_centroid[nm] = (sx, sy)

    mapKm = (pois_blob or {}).get("mapKm") or 8
    span = mapKm * 100000.0
    # pinCalibration: zieht das Welt-Koord-System auf das Karten-Bild
    # (flip/rotate/scale/offset). POI-Matching bleibt in ROHEN cm
    # (kalibrierungs-unabhaengig); nur Anzeige-Coords werden kalibriert.
    cal = (pois_blob or {}).get("pinCalibration") or {}

    def _disp(x_cm, y_cm):
        ex, ey = apply_pin_cal(x_cm, y_cm, mapKm, cal)
        return (max(0.0, min(1.0, ex / span)),
                max(0.0, min(1.0, ey / span)))

    scatter = []
    poi_acc = {}      # poi_name → {acc → count}
    poi_matches = {}  # poi_name → set of match_ids (für distinct-Match-Zählung)
    for r in rows:
        x, y = r["actor_x"], r["actor_y"]
        acc = r["actor_account"]
        dx, dy = _disp(x, y)
        scatter.append({
            "accountId": acc,
            "x": dx,
            "y": dy,
            "matchId": r["match_id"],
        })
        name = match_poi(x, y, regions) or "—"
        poi_acc.setdefault(name, {})
        poi_acc[name][acc] = poi_acc[name].get(acc, 0) + 1
        poi_matches.setdefault(name, set())
        poi_matches[name].add(r["match_id"])

    # Namens-Lookup
    name_of = {r["actor_account"]: (r["player_name"] or r["actor_account"][:8])
               for r in rows}

    pois_out = []
    for name, accmap in poi_acc.items():
        total = len(poi_matches.get(name, set()))
        cx, cy = poi_centroid.get(name, (None, None))
        dcx, dcy = _disp(cx, cy) if cx is not None else (None, None)
        by = {}
        for acc, cnt in accmap.items():
            by[acc] = {"name": name_of.get(acc, acc[:8]),
                       "count": cnt,
                       "pct": round(cnt / total * 100)}
        pois_out.append({
            "name": name,
            "cx": dcx,
            "cy": dcy,
            "total": total,
            "byPlayer": by,
        })
    pois_out.sort(key=lambda p: p["total"], reverse=True)

    return {"pois": pois_out, "scatterPoints": scatter,
            "totalMatches": len(match_ids)}
