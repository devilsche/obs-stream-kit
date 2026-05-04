import datetime as _dt
import json


def _parse_ts(iso):
    if not iso:
        return None
    return _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _ts_ms(iso):
    t = _parse_ts(iso)
    return int(t.timestamp() * 1000) if t else None


def _normalize(event):
    """Convert one PUBG telemetry event to flat row schema, or None to skip.
    Deckt alle für unsere Stats relevanten Event-Typen ab."""
    et = event.get("_T", "")
    base = {"event_type": None, "timestamp_ms": _ts_ms(event.get("_D")),
            "actor_account": None, "target_account": None,
            "weapon": None, "distance": None, "damage": None,
            "payload_json": json.dumps(event, separators=(",", ":"))}
    if et == "LogParachuteLanding":
        base["event_type"] = "Landing"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
    elif et in ("LogPlayerKillV2", "LogPlayerKill"):
        base["event_type"] = "Kill"
        base["actor_account"] = (event.get("killer") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        info = event.get("killerDamageInfo") or {}
        base["weapon"] = info.get("damageCauserName") or event.get("damageCauserName")
        base["distance"] = info.get("distance") or event.get("distance")
    elif et == "LogPlayerMakeGroggy":
        # Knock/DBNO — wichtig für First-Fight: oft kommt der Knock vor Kill
        base["event_type"] = "Knock"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        base["damage"] = event.get("damage")
        base["weapon"] = event.get("damageCauserName")
        base["distance"] = event.get("distance")
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


def filter_squad_events(events, squad_account_ids):
    for e in events:
        norm = _normalize(e)
        if not norm:
            continue
        if (norm["actor_account"] in squad_account_ids
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
