def _index_included(match_payload):
    by_type = {}
    for item in match_payload.get("included", []):
        by_type.setdefault(item["type"], {})[item["id"]] = item
    return by_type


def find_my_team_id(match_payload, my_account_id):
    idx = _index_included(match_payload)
    rosters = idx.get("roster", {})
    parts = idx.get("participant", {})
    for r in rosters.values():
        part_ids = [p["id"] for p in r["relationships"]["participants"]["data"]]
        for pid in part_ids:
            p = parts.get(pid)
            if not p:
                continue
            if p["attributes"]["stats"].get("playerId") == my_account_id:
                return r["attributes"]["stats"].get("teamId")
    return None


def _participant_to_row(p):
    s = p["attributes"]["stats"]
    return {
        "account_id": s.get("playerId"),
        "name": s.get("name"),
        "place": s.get("winPlace"),
        "kills": s.get("kills"),
        "headshot_kills": s.get("headshotKills"),
        "assists": s.get("assists"),
        "dbnos": s.get("DBNOs"),
        "revives": s.get("revives"),
        "damage_dealt": s.get("damageDealt"),
        "longest_kill": s.get("longestKill"),
        "time_survived": s.get("timeSurvived"),
        "walk_distance": s.get("walkDistance"),
        "ride_distance": s.get("rideDistance"),
        "swim_distance": s.get("swimDistance"),
        "weapons_acquired": s.get("weaponsAcquired"),
        "heals": s.get("heals"),
        "boosts": s.get("boosts"),
        "team_kills": s.get("teamKills"),
    }


def parse_match_response(match_payload, my_account_id):
    """Squad-Members mit vollen Stats nach `squad_participants`,
    plus Lightweight (account_id, team_id)-Mapping für ALLE Lobby-
    Members nach `team_mapping` — reicht für Team-Zählung in
    hot-drop/first-fight ohne Stat-Overhead."""
    data = match_payload["data"]
    attrs = data["attributes"]
    idx = _index_included(match_payload)

    my_team_id = find_my_team_id(match_payload, my_account_id)
    rosters = idx.get("roster", {})
    parts = idx.get("participant", {})

    squad = []
    team_mapping = []  # gesamte Lobby: account_id, team_id, kills, place, slot
    for r in rosters.values():
        team_id = r["attributes"]["stats"].get("teamId")
        # Roster-Slot 1..N in API-Reihenfolge = In-Game Slot/Plate-Reihenfolge
        # (PUBG vergibt Plate-Farben slot-fix). Erstes Element = Slot 1.
        for slot_idx, pref in enumerate(
                r["relationships"]["participants"]["data"], start=1):
            p = parts.get(pref["id"])
            if not p:
                continue
            stats = p["attributes"]["stats"]
            acc_id = stats.get("playerId")
            if acc_id:
                team_mapping.append({
                    "account_id": acc_id,
                    "team_id": team_id,
                    "slot": slot_idx,
                    "kills": stats.get("kills"),
                    "place": stats.get("winPlace"),
                    "time_survived": stats.get("timeSurvived"),
                })
            if team_id == my_team_id:
                row = _participant_to_row(p)
                row["team_id"] = my_team_id
                row["slot"] = slot_idx
                squad.append(row)

    telemetry_url = None
    for asset in idx.get("asset", {}).values():
        url = asset.get("attributes", {}).get("URL")
        if url:
            telemetry_url = url
            break

    return {
        "match_id": data["id"],
        "map_name": attrs.get("mapName"),
        "game_mode": attrs.get("gameMode"),
        "duration_secs": attrs.get("duration"),
        "is_ranked": attrs.get("matchType") == "competitive",
        "played_at": attrs.get("createdAt"),
        "telemetry_url": telemetry_url,
        "my_team_id": my_team_id,
        "squad_participants": squad,
        "team_mapping": team_mapping,
    }


def _safe_div(a, b):
    return (a / b) if b else 0.0


def _parse_modestats(s: dict) -> dict:
    """Einheitliches Mapping PUBG-API-gameModeStats → unsere DB-Spalten.
    Wird identisch von Lifetime- und Season-Payload genutzt (gleiche Shape).
    Speichert sowohl avg_damage (per round) als auch damage_dealt (total),
    damit Aggregationen exakt stimmen statt aus avg*rounds rückgerechnet
    werden zu müssen.

    K/D verwendet das `losses`-Feld der PUBG-API (Matches-mit-Tod) statt
    `rounds-wins` — sonst zählen Matches doppelt in denen das Team gewann
    aber der Spieler vorher gestorben war. Match mit pubglookup verifiziert."""
    rounds = s.get("roundsPlayed", 0) or 0
    wins = s.get("wins", 0) or 0
    kills = s.get("kills", 0) or 0
    hs = s.get("headshotKills", 0) or 0
    dmg_total = s.get("damageDealt", 0.0) or 0.0
    losses = s.get("losses", 0) or 0
    # losses ist die exakte Death-Zählung, fällt aber bei sehr alten
    # Payloads weg → rounds-wins als Fallback (über-counts in Edge-Cases
    # wo Team gewinnt nachdem Spieler tot war, deckt aber 99% ab).
    deaths_for_kd = losses if losses > 0 else max(rounds - wins, 0)
    return {
        "rounds_played": rounds,
        "wins": wins,
        "top10s": s.get("top10s", 0) or 0,
        "win_rate": _safe_div(wins, rounds) * 100,
        "top10_rate": _safe_div(s.get("top10s", 0) or 0, rounds) * 100,
        "kills": kills,
        "kd_ratio": _safe_div(kills, deaths_for_kd),
        "headshot_kills": hs,
        "headshot_rate": _safe_div(hs, kills) * 100,
        "avg_damage": _safe_div(dmg_total, rounds),
        "longest_kill": s.get("longestKill", 0.0) or 0.0,
        "time_survived_sec": s.get("timeSurvived", 0) or 0,
        "assists": s.get("assists", 0) or 0,
        "damage_dealt": dmg_total,
        # PUBG-API: Field heißt "dBNOs" (lowercase d, capital BNO).
        "dbnos": s.get("dBNOs", 0) or 0,
        "revives": s.get("revives", 0) or 0,
        "team_kills": s.get("teamKills", 0) or 0,
        "losses": losses,
    }


def parse_lifetime_response(payload):
    modes = payload["data"]["attributes"].get("gameModeStats", {})
    return {mode: _parse_modestats(s) for mode, s in modes.items()}


def parse_season_response(payload):
    """Identische Shape wie Lifetime — die PUBG-API liefert
    /players/{id}/seasons/{seasonId} mit demselben gameModeStats-Dict."""
    return parse_lifetime_response(payload)


def _aggregate_modes(modes_dict):
    """Aggregiert mehrere Modes (squad-fpp, duo-fpp, ...) zu einem 'all'.
    Sums werden direkt aufaddiert, Rates aus den Sums neu berechnet —
    nicht gewichtet aus den Mode-Rates, das wäre ungenau."""
    sums = {k: 0 for k in (
        "rounds_played", "wins", "top10s", "kills",
        "headshot_kills", "time_survived_sec",
        "assists", "dbnos", "revives", "team_kills", "losses",
    )}
    dmg_total = 0.0
    longest = 0.0
    for s in modes_dict.values():
        for k in sums:
            sums[k] += s.get(k, 0) or 0
        # damage_dealt ist jetzt Total, nicht Avg — direkt summieren.
        dmg_total += s.get("damage_dealt", 0.0) or 0.0
        longest = max(longest, s.get("longest_kill", 0.0) or 0.0)
    rounds = sums["rounds_played"]
    deaths_for_kd = (sums["losses"] if sums["losses"] > 0
                     else max(rounds - sums["wins"], 0))
    return {
        **sums,
        "win_rate": _safe_div(sums["wins"], rounds) * 100,
        "top10_rate": _safe_div(sums["top10s"], rounds) * 100,
        "kd_ratio": _safe_div(sums["kills"], deaths_for_kd),
        "headshot_rate": _safe_div(sums["headshot_kills"], sums["kills"]) * 100,
        "avg_damage": _safe_div(dmg_total, rounds),
        "damage_dealt": dmg_total,
        "longest_kill": longest,
    }


def aggregate_lifetime_modes(modes_dict):
    return _aggregate_modes(modes_dict)


def aggregate_season_modes(modes_dict):
    return _aggregate_modes(modes_dict)
