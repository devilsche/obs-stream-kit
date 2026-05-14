import datetime as _dt
import json


def _parse_ts(iso):
    if not iso:
        return None
    return _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _ts_ms(iso):
    t = _parse_ts(iso)
    return int(t.timestamp() * 1000) if t else None


def _loc(p, key):
    """Liest p[key]['location']['x'/'y'] sicher raus. PUBG-World-Units (cm).
    1 km = 100000."""
    obj = (p or {}).get(key) or {}
    loc = obj.get("location") or {}
    return loc.get("x"), loc.get("y")


def _normalize(event):
    """Convert one PUBG telemetry event to flat row schema, or None to skip.
    Deckt alle für unsere Stats relevanten Event-Typen ab."""
    et = event.get("_T", "")
    base = {"event_type": None, "timestamp_ms": _ts_ms(event.get("_D")),
            "actor_account": None, "target_account": None,
            "actor_x": None, "actor_y": None, "actor_z": None,
            "actor_health": None,
            "victim_x": None, "victim_y": None,
            "weapon": None, "distance": None, "damage": None,
            "payload_json": json.dumps(event, separators=(",", ":"))}
    # Helper: extracts z + health for character-events (for landing-pin
    # heuristic; ground-events have z<800 and health>0).
    def _z_health(ev, key):
        ch = ev.get(key) or {}
        z = (ch.get("location") or {}).get("z")
        return z, ch.get("health")

    if et == "LogParachuteLanding":
        base["event_type"] = "Landing"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        # Position der Landung — wichtig für Radius-Detection
        # ("Teams im 300m Umkreis").
        base["actor_x"], base["actor_y"] = _loc(event, "character")
        base["actor_z"], base["actor_health"] = _z_health(event, "character")
    elif et == "LogPlayerPosition":
        # Continuous position-tracking (~alle 10s). Wir brauchen das fuer
        # praezise Ground-Landing-Detection — PUBG-LogParachuteLanding
        # firet manchmal mid-air (z=1000+) statt am Boden. Ein Position-
        # Event kurz nach Landing mit z<800 = echter Bodenkontakt.
        base["event_type"] = "Position"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        base["actor_x"], base["actor_y"] = _loc(event, "character")
        base["actor_z"], base["actor_health"] = _z_health(event, "character")
    elif et in ("LogPlayerKillV2", "LogPlayerKill"):
        base["event_type"] = "Kill"
        base["actor_account"] = (event.get("killer") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        info = event.get("killerDamageInfo") or {}
        base["weapon"] = info.get("damageCauserName") or event.get("damageCauserName")
        base["distance"] = info.get("distance") or event.get("distance")
        base["actor_x"], base["actor_y"] = _loc(event, "killer")
        base["victim_x"], base["victim_y"] = _loc(event, "victim")
    elif et == "LogPlayerMakeGroggy":
        # Knock/DBNO — wichtig für First-Fight: oft kommt der Knock vor Kill
        base["event_type"] = "Knock"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        base["damage"] = event.get("damage")
        base["weapon"] = event.get("damageCauserName")
        base["distance"] = event.get("distance")
        base["actor_x"], base["actor_y"] = _loc(event, "attacker")
        base["victim_x"], base["victim_y"] = _loc(event, "victim")
    elif et == "LogPlayerRevive":
        base["event_type"] = "Revive"
        base["actor_account"] = (event.get("reviver") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
    elif et == "LogPlayerTakeDamage":
        base["event_type"] = "TakeDamage"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        base["damage"] = event.get("damage")
        base["weapon"] = event.get("damageCauserName")
        base["actor_x"], base["actor_y"] = _loc(event, "attacker")
        base["victim_x"], base["victim_y"] = _loc(event, "victim")
    elif et == "LogPlayerAttack":
        base["event_type"] = "Attack"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["weapon"] = (event.get("weapon") or {}).get("itemId")
    elif et == "LogVehicleRide":
        base["event_type"] = "VehicleEnter"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        base["weapon"] = (event.get("vehicle") or {}).get("vehicleId")
    elif et == "LogVehicleLeave":
        base["event_type"] = "VehicleLeave"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        base["distance"] = event.get("rideDistance")
    elif et == "LogVehicleDestroy":
        base["event_type"] = "VehicleDestroy"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
    elif et == "LogSwimStart":
        base["event_type"] = "SwimStart"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
    elif et == "LogSwimEnd":
        base["event_type"] = "SwimEnd"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        base["distance"] = event.get("swimDistance")
    elif et == "LogEmPickupLiftOff":
        base["event_type"] = "EmPickup"
        # rider-Liste hat alle Account-IDs, wir markieren ersten als actor
        riders = event.get("riders") or []
        if riders:
            base["actor_account"] = riders[0].get("accountId")
    elif et == "LogHeal":
        base["event_type"] = "Heal"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        base["damage"] = event.get("healAmount")
    elif et == "LogItemPickup":
        # Wichtig fuer PAYDAY (Loot-Counter: Geldsack, Schmuck, Goldbarren).
        # Auch fuer BR interessant (Waffen-Pickup-Statistiken)
        base["event_type"] = "ItemPickup"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        item = event.get("item") or {}
        base["weapon"] = item.get("itemId")  # = z.B. "Item_MoneyBagged"
        base["actor_x"], base["actor_y"] = _loc(event, "character")
    elif et == "LogObjectInteraction":
        # PAYDAY: Tueren oeffnen/schliessen, Tresore knacken
        base["event_type"] = "ObjectInteraction"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        ot = event.get("objectType") or ""
        st = event.get("objectTypeStatus") or ""
        base["weapon"] = f"{ot}:{st}" if st else ot  # z.B. "Door:Opening"
        base["actor_x"], base["actor_y"] = _loc(event, "character")
    elif et == "LogObjectDestroy":
        # PAYDAY: Fenster eingeschlagen, Wand gesprengt etc.
        base["event_type"] = "ObjectDestroy"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
        base["weapon"] = event.get("objectType")  # z.B. "Window"
        base["actor_x"], base["actor_y"] = _loc(event, "character")
    elif et == "LogArmorDestroy":
        base["event_type"] = "ArmorDestroy"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        base["weapon"] = event.get("damageCauserName")
    elif et == "LogPhaseChange":
        base["event_type"] = "PhaseChange"
    elif et in ("LogMatchStart", "LogMatchEnd"):
        base["event_type"] = et.replace("Log", "")
    else:
        return None
    return base


# Events die wir immer behalten (auch ohne Squad-Beteiligung) — wichtig für
# Fight-Cluster-Detection: enemy-vs-enemy Kills/Knocks zeigen welche anderen
# Teams im selben Fight involviert sind.
ALWAYS_KEEP_EVENTS = {"Kill", "Knock", "Landing"}

# Position-Events fluten die DB (firet alle ~10s pro Spieler). Wir
# behalten sie NUR fuer Squad-Members in den ersten 3 Minuten — reicht
# fuer praezise Landing-Pin-Detection (Touchdown ~50-90s nach Drop).
POSITION_WINDOW_MS = 180_000


def filter_squad_events(events, squad_account_ids):
    match_start_ms = None
    for e in events:
        norm = _normalize(e)
        if not norm:
            continue
        ts = norm.get("timestamp_ms")
        if match_start_ms is None and ts:
            match_start_ms = ts
        if norm["event_type"] == "Position":
            # Position-Events: nur fuer Squad und nur in den ersten 3 min
            if norm["actor_account"] not in squad_account_ids:
                continue
            if not ts or not match_start_ms:
                continue
            if ts - match_start_ms > POSITION_WINDOW_MS:
                continue
            yield norm
            continue
        # PAYDAY-relevante Events: nur Squad behalten, alle Phasen
        if norm["event_type"] in ("ItemPickup", "ObjectInteraction",
                                    "ObjectDestroy"):
            if norm["actor_account"] in squad_account_ids:
                yield norm
            continue
        if norm["event_type"] in ALWAYS_KEEP_EVENTS:
            yield norm
        elif (norm["actor_account"] in squad_account_ids
                or norm["target_account"] in squad_account_ids):
            yield norm


def detect_first_fight(events, my_account_id, landing_window_secs=120):
    """Heuristic: after my landing, was there an engagement within window?
    Returns {"engaged": bool, "survived": bool|None}."""
    landing_ts = None
    first_engagement = None
    fight_window_end = None
    survived_flag = None

    for e in events:
        et = e.get("_T", "")
        ts = _parse_ts(e.get("_D"))
        if not ts:
            continue
        if et == "LogParachuteLanding":
            ch = e.get("character") or {}
            if ch.get("accountId") == my_account_id and landing_ts is None:
                landing_ts = ts
                fight_window_end = ts + _dt.timedelta(seconds=landing_window_secs)
                continue
        if landing_ts is None:
            continue
        if fight_window_end and ts > fight_window_end and first_engagement is None:
            return {"engaged": False, "survived": None}

        attacker = (e.get("attacker") or e.get("killer") or {}).get("accountId")
        victim = (e.get("victim") or {}).get("accountId")

        if first_engagement is None:
            if et in ("LogPlayerTakeDamage", "LogPlayerKillV2"):
                if my_account_id in (attacker, victim):
                    first_engagement = e
                    if et == "LogPlayerKillV2" and victim == my_account_id:
                        return {"engaged": True, "survived": False}
                    if et == "LogPlayerKillV2" and attacker == my_account_id:
                        survived_flag = True
                    fight_window_end = ts + _dt.timedelta(seconds=60)
                    continue
        else:
            if et == "LogPlayerKillV2" and victim == my_account_id:
                return {"engaged": True, "survived": False}
            if et == "LogPlayerKillV2" and attacker == my_account_id:
                survived_flag = True

    if first_engagement is None:
        return {"engaged": False, "survived": None}
    return {"engaged": True, "survived": True if survived_flag else True}
