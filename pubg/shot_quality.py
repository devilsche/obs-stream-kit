"""Schussqualitaet, Todesbild und Kohorten-Vergleich fuer einen Spieler.

Beantwortet drei Fragen, die die Kill-Statistik offen laesst:

* **Wie gut sitzt jede Kugel?** Trefferquote, Schaden je 100 Schuss und der
  Anteil der Schuesse, die ueberhaupt in einem Gefecht fallen. Der letzte
  Wert ist der unbequemste: Feuer ausserhalb eines Gefechts senkt beide
  anderen Werte gleichzeitig und verraet dabei die Position.
* **Wann, wie und durch wen stirbt man?** Verteilung ueber die Rundenphase,
  Distanz und Waffe des Killers.
* **Wo steht man?** Perzentil gegen zwei Referenzgruppen, siehe unten.

Zwei Referenzgruppen, weil die Datenlage zwei verschiedene Formen hat:

* **squad** — aus `participants`. Enthaelt nur eigene Accounts und Mates
  (Groessenordnung ein paar hundert), dafuer mit vollem Bild: K/D,
  Ueberlebenszeit, Heals, Boosts, Loot. Klein, aber tief.
* **lobby** — aus `match_weapon_stats`. Enthaelt JEDEN Gegner, dem man
  begegnet ist (Groessenordnung Zehntausende), aber nur Schuss-Metriken und
  je Gegner meist sehr wenige Matches. Breit, aber flach.

Wichtig zur Tenant-Trennung: `telemetry_events` hat KEINE `tenant_id`. Jede
Abfrage dort muss ueber `matches` joinen und dort auf den Tenant filtern,
sonst tauchen Events aus fremden Tenants auf. `participants` und
`match_weapon_stats` fuehren die Spalte selbst.

Aufbau wie in pubg/playstyle.py: die Rechenkerne oben kennen keine DB und
sind direkt testbar, das DB-Holen sitzt darunter.
"""
import statistics

from pubg.aggregations import _br_filter, _weapon_label
from pubg.poi_match import point_in_poly

#: Grenzen der Rundenphasen in Sekunden Ueberlebenszeit. Die frueh/mitte-
#: Grenze bei 5 Minuten trennt den Landefight vom Rest, die mitte/spaet-
#: Grenze bei 15 Minuten das Endgame — dort oeffnet sich die Distanz und
#: die Trefferquote fallen typischerweise auseinander.
PHASE_EARLY_SECS = 300
PHASE_LATE_SECS = 900
PHASES = ("early", "mid", "late")

#: Distanzklassen fuer das Todesbild, in Zentimetern (PUBG-Einheit).
DISTANCE_BUCKETS = (
    (1000, "0-10m"),
    (5000, "10-50m"),
    (15000, "50-150m"),
    (None, "150m+"),
)

#: K/D-Baender der Kohorte. Untergrenze inklusive.
KD_BANDS = (
    (1.2, "under_1_2"),
    (1.6, "1_2_to_1_6"),
    (2.2, "1_6_to_2_2"),
    (None, "over_2_2"),
)

#: Ab so vielen Matches zaehlt ein Spieler fuer die Kohorte. Unter 20 wird
#: die Trefferquote vom Zufall einzelner Gefechte dominiert.
MIN_COHORT_MATCHES = 20

#: Die Telemetrie nennt Erangel teils Erangel_Main, die POI-Datei
#: Baltic_Main. Ohne den Abgleich fallen alle Erangel-Landungen durch.
MAP_ALIASES = {"Erangel_Main": "Baltic_Main"}

#: Ab so vielen eigenen Landungen taucht ein POI in der Auswertung auf.
#: Darunter sagt eine Fruehtod-Quote nichts.
MIN_POI_DROPS = 5

#: Fenster nach der eigenen Landung, in dem ein Tod als verlorener
#: Landefight gilt. Bewusst relativ zur Landung und nicht zum Rundenstart:
#: nur so messen die eigene und die Lobby-Quote dasselbe.
LANDING_FIGHT_MS = 300_000

#: Fenstergroessen fuer den Eigen-Trend, in Matches. Jedes Fenster wird
#: gegen die gleich langen Matches davor verglichen.
TREND_WINDOWS = (20, 50, 100)


# ── Rechenkerne ─────────────────────────────────────────────────────────────

def hit_rate(shots, hit_attacks):
    """Trefferquote in Prozent. Ohne Schuesse `None` — 0 % waere eine
    Aussage, "nie geschossen" ist keine."""
    if not shots:
        return None
    return 100.0 * (hit_attacks or 0) / shots


def dmg_per_100(damage, shots):
    """Schaden je 100 Schuss — buendelt Trefferquote und Trefferwucht in
    eine Zahl. Zwei Spieler mit gleicher Quote koennen sich hier deutlich
    unterscheiden, je nach Waffe und Trefferzone."""
    if not shots:
        return None
    return 100.0 * (damage or 0) / shots


def in_fight_share(shots_in_fight, shots):
    """Anteil der Schuesse, die in einem Gefecht fallen."""
    if not shots:
        return None
    return 100.0 * (shots_in_fight or 0) / shots


def head_share(head, hits):
    if not hits:
        return None
    return 100.0 * (head or 0) / hits


def phase_of(time_survived_secs):
    """Rundenphase aus der Ueberlebenszeit."""
    if time_survived_secs is None:
        return None
    if time_survived_secs < PHASE_EARLY_SECS:
        return "early"
    if time_survived_secs < PHASE_LATE_SECS:
        return "mid"
    return "late"


def distance_bucket(distance_cm):
    if distance_cm is None:
        return None
    for limit, label in DISTANCE_BUCKETS:
        if limit is None or distance_cm < limit:
            return label
    return DISTANCE_BUCKETS[-1][1]


def kd(kills, matches, wins):
    """K/D nach op.gg-Konvention: kills / (matches - wins).

    Siehe reference_kd_formeln — der Nutzer prueft gegen op.gg, deshalb hier
    dieselbe Rechnung und nicht die echten Tode."""
    losses = (matches or 0) - (wins or 0)
    if losses <= 0:
        return None
    return (kills or 0) / losses


def band_of(kd_value):
    if kd_value is None:
        return None
    for limit, label in KD_BANDS:
        if limit is None or kd_value < limit:
            return label
    return KD_BANDS[-1][1]


def delta_pct(now, before):
    """Relative Veraenderung in Prozent. Ohne brauchbare Basis `None`."""
    if now is None or not before:
        return None
    return 100.0 * (now - before) / before


def percentile(value, others, lower_is_better=False):
    """Anteil der Vergleichswerte, die schlechter sind als `value`.

    `lower_is_better` fuer Metriken wie die Frueh-Tod-Quote, wo ein
    niedriger Wert der bessere ist."""
    if value is None:
        return None
    peers = [o for o in others if o is not None]
    if not peers:
        return None
    if lower_is_better:
        worse = sum(1 for o in peers if o > value)
    else:
        worse = sum(1 for o in peers if o < value)
    return 100.0 * worse / len(peers)


def weapon_label(weapon_id):
    """Lesbarer Waffenname. Delegiert an die gepflegte Tabelle in
    aggregations, damit Skin-Varianten nicht auseinanderfallen."""
    if not weapon_id or weapon_id == "None":
        return "Unknown"
    return _weapon_label(weapon_id)[0]


def weapon_class(weapon_id):
    """Waffenklasse (ar / smg / dmr / sr / shotgun / envir / …).

    Sagt beim Todesbild mehr als der Waffenname: "ich sterbe an SMGs im
    Nahkampf" ist eine andere Diagnose als "ich werde gesnipert"."""
    if not weapon_id or weapon_id == "None":
        return "unknown"
    return _weapon_label(weapon_id)[1] or "other"


def aggregate_weapon_rows(rows):
    """Summiert Waffenzeilen zu einem Schussprofil.

    Mehrere Zeilen im selben Match sind EIN Match — sonst zaehlt jede
    benutzte Waffe als eigene Runde und Schuesse-pro-Match kippt."""
    shots = sum(r.get("shots") or 0 for r in rows)
    hit_attacks = sum(r.get("hit_attacks") or 0 for r in rows)
    hits = sum(r.get("hits") or 0 for r in rows)
    head = sum(r.get("head") or 0 for r in rows)
    damage = sum(r.get("damage") or 0 for r in rows)
    in_fight = sum(r.get("shots_in_fight") or 0 for r in rows)
    matches = len({r.get("match_id") for r in rows if r.get("match_id")})
    return {
        "matches": matches,
        "shots": shots,
        "hitAttacks": hit_attacks,
        "hits": hits,
        "head": head,
        "damage": damage,
        "shotsInFight": in_fight,
        "hitRate": hit_rate(shots, hit_attacks),
        "dmgPer100": dmg_per_100(damage, shots),
        "inFightShare": in_fight_share(in_fight, shots),
        "headShare": head_share(head, hits),
        "shotsPerMatch": (shots / matches) if matches else None,
    }


def _share_list(counter, total, key_name):
    out = [{key_name: k, "n": n, "share": 100.0 * n / total}
           for k, n in counter.items()]
    out.sort(key=lambda d: (-d["n"], str(d[key_name])))
    return out


def summarise_deaths(deaths):
    """Verdichtet Todeszeilen zu Waffen-, Distanz- und Phasenbild.

    Zeilen ohne Distanz oder ohne Ueberlebenszeit fallen aus der jeweiligen
    Gruppierung heraus, statt eine Kategorie zu erfinden."""
    total = len(deaths)
    if not total:
        return {"total": 0, "byWeapon": [], "byWeaponClass": [],
                "byDistance": [], "byPhase": [],
                "medianSurvivalSecs": None, "medianDistanceM": None}

    weapons, classes, distances, phases = {}, {}, {}, {}
    surv, dists = [], []
    for d in deaths:
        label = weapon_label(d.get("weapon"))
        weapons[label] = weapons.get(label, 0) + 1

        cls = weapon_class(d.get("weapon"))
        classes[cls] = classes.get(cls, 0) + 1

        bucket = distance_bucket(d.get("distance"))
        if bucket:
            distances[bucket] = distances.get(bucket, 0) + 1
            dists.append(d["distance"] / 100.0)

        ph = phase_of(d.get("time_survived"))
        if ph:
            phases[ph] = phases.get(ph, 0) + 1
            surv.append(d["time_survived"])

    by_distance = _share_list(distances, total, "bucket")
    order = {label: i for i, (_, label) in enumerate(DISTANCE_BUCKETS)}
    by_distance.sort(key=lambda d: order.get(d["bucket"], 99))

    by_phase = _share_list(phases, total, "phase")
    by_phase.sort(key=lambda d: PHASES.index(d["phase"]))

    return {
        "total": total,
        "byWeapon": _share_list(weapons, total, "label"),
        "byWeaponClass": _share_list(classes, total, "cls"),
        "byDistance": by_distance,
        "byPhase": by_phase,
        "medianSurvivalSecs": statistics.median(surv) if surv else None,
        "medianDistanceM": statistics.median(dists) if dists else None,
    }


def _avg(values):
    vals = [v for v in values if v is not None]
    return (sum(vals) / len(vals)) if vals else None


#: Metriken, die im Kohorten-Band gemittelt und im Perzentil verglichen
#: werden. `True` = hoeher ist besser.
COHORT_METRICS = {
    "kd": True,
    "hitRate": True,
    "dmgPer100": True,
    "inFightShare": True,
    "headShare": True,
    "shotsPerMatch": True,
    "damagePerMatch": True,
    "survivalMin": True,
    "earlyDeathPct": False,
    "healsPerMatch": True,
    "boostsPerMatch": True,
    "weaponsPerMatch": True,
}


def build_cohort_bands(players):
    """Mittelt die Kohorte je K/D-Band. Leere Baender fallen weg."""
    buckets = {}
    for p in players:
        band = band_of(p.get("kd"))
        if band:
            buckets.setdefault(band, []).append(p)

    out = []
    for _, band in KD_BANDS:
        group = buckets.get(band)
        if not group:
            continue
        entry = {"band": band, "players": len(group)}
        for metric in COHORT_METRICS:
            entry[metric] = _avg(p.get(metric) for p in group)
        out.append(entry)
    return out


def rank_me(me, peers):
    """Perzentil je Metrik. Der eigene Account wird aus dem Vergleich
    genommen — sonst schlaegt man sich selbst."""
    my_id = me.get("accountId")
    others = [p for p in peers if p.get("accountId") != my_id]
    out = {}
    for metric, higher_is_better in COHORT_METRICS.items():
        values = [p.get(metric) for p in others]
        usable = [v for v in values if v is not None]
        out[metric] = {
            "value": me.get(metric),
            "percentile": percentile(me.get(metric), values,
                                     lower_is_better=not higher_is_better),
            "peers": len(usable),
        }
    return out


# ── POI-Geometrie ───────────────────────────────────────────────────────────

def poi_boxes(pois):
    """Baut je Karte eine Liste (Name, x0, x1, y0, y1, Punkte).

    Die Bounding-Box ist ein Vorfilter: ohne sie laeuft jeder Punkt gegen
    jedes Polygon, mit ihr sind 140.000 Landungen in Bruchteilen einer
    Sekunde zugeordnet."""
    out = {}
    for map_name, blob in (pois or {}).items():
        entries = []
        for reg in (blob or {}).get("regions", []):
            pts = reg.get("points") or []
            name = reg.get("name")
            if not name or len(pts) < 3:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            entries.append((name, min(xs), max(xs), min(ys), max(ys), pts))
        out[map_name] = entries
    return out


def poi_at(boxes, map_name, x, y):
    """Name des POI, in dem der Punkt liegt — oder None fuer Gelaende."""
    if x is None or y is None:
        return None
    entries = boxes.get(map_name)
    if entries is None:
        entries = boxes.get(MAP_ALIASES.get(map_name, ""), None)
    if not entries:
        return None
    for name, x0, x1, y0, y1, pts in entries:
        if x0 <= x <= x1 and y0 <= y <= y1 and point_in_poly(x, y, pts):
            return name
    return None


def first_landings(rows):
    """Erste Landung je (Match, Spieler).

    Spaetere Landing-Events sind Umzuege oder Wiedereinstiege; wer sie
    mitzaehlt, verwaescht die Platzwahl."""
    out = {}
    for r in rows:
        key = (r["match_id"], r["actor_account"])
        prev = out.get(key)
        if prev is None or r["timestamp_ms"] < prev["timestamp_ms"]:
            out[key] = r
    return out


def summarise_landings(own, lobby, min_drops=MIN_POI_DROPS):
    """Eigene Landungen je POI, mit der Lobby-Quote am selben Ort.

    `own` sind eigene Landungen mit Matchergebnis, `lobby` ein Dict
    (map, poi) -> {"drops": n, "early": n}."""
    grouped = {}
    for r in own:
        grouped.setdefault((r["map"], r["poi"]), []).append(r)

    out = []
    for (map_name, poi), rows in grouped.items():
        n = len(rows)
        if n < min_drops:
            continue
        early = sum(1 for r in rows if r["earlyDeath"])
        my_pct = 100.0 * early / n
        ref = lobby.get((map_name, poi)) or {}
        lob_drops = ref.get("drops") or 0
        lob_pct = (100.0 * ref["early"] / lob_drops) if lob_drops else None
        out.append({
            "map": map_name,
            "poi": poi,
            "drops": n,
            "earlyDeaths": early,
            "earlyDeathPct": my_pct,
            "lobbyDrops": lob_drops,
            "lobbyEarlyPct": lob_pct,
            "diff": (my_pct - lob_pct) if lob_pct is not None else None,
            "survivalMin": (_avg(r["timeSurvived"] for r in rows) or 0) / 60.0,
            "avgKills": _avg(r["kills"] for r in rows),
            "avgDamage": _avg(r["damage"] for r in rows),
            "avgPlace": _avg(r["place"] for r in rows),
        })
    out.sort(key=lambda d: (-d["drops"], d["poi"]))
    return out


# ── DB-Ebene ────────────────────────────────────────────────────────────────

def _weapon_rows(conn, tenant_id, account_id, cutoff, to_iso=None):
    br_where, br_params = _br_filter("m")
    sql = f"""
        SELECT w.match_id, w.shots, w.hits, w.hit_attacks, w.head,
               w.damage, w.shots_in_fight
        FROM match_weapon_stats w
        JOIN matches m ON m.match_id = w.match_id
                      AND m.tenant_id = w.tenant_id
        WHERE w.tenant_id = ? AND w.account_id = ?
          AND m.played_at >= ? AND {br_where}
    """
    params = [tenant_id, account_id, cutoff, *br_params]
    if to_iso:
        sql += " AND m.played_at <= ?"
        params.append(to_iso)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _participant_rows(conn, tenant_id, account_id, cutoff, to_iso=None):
    br_where, br_params = _br_filter("m")
    sql = f"""
        SELECT pa.match_id, pa.place, pa.kills, pa.damage_dealt,
               pa.time_survived, pa.dbnos, pa.assists, pa.revives,
               pa.heals, pa.boosts, pa.weapons_acquired,
               pa.walk_distance, pa.ride_distance, m.played_at
        FROM participants pa
        JOIN matches m ON m.match_id = pa.match_id
                      AND m.tenant_id = pa.tenant_id
        WHERE pa.tenant_id = ? AND pa.account_id = ?
          AND pa.time_survived > 0
          AND m.played_at >= ? AND {br_where}
    """
    params = [tenant_id, account_id, cutoff, *br_params]
    if to_iso:
        sql += " AND m.played_at <= ?"
        params.append(to_iso)
    sql += " ORDER BY m.played_at DESC"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _profile_from_rows(part_rows, weap_rows):
    """Baut ein Spielerprofil aus Teilnehmer- und Waffenzeilen."""
    prof = aggregate_weapon_rows(weap_rows)
    n = len(part_rows)
    prof["brMatches"] = n
    if n:
        wins = sum(1 for r in part_rows if r.get("place") == 1)
        kills = sum(r.get("kills") or 0 for r in part_rows)
        early = sum(1 for r in part_rows
                    if (r.get("time_survived") or 0) < PHASE_EARLY_SECS)
        prof.update({
            "kills": kills,
            "wins": wins,
            "kd": kd(kills, n, wins),
            "damagePerMatch": _avg(r.get("damage_dealt") for r in part_rows),
            "survivalMin": (_avg(r.get("time_survived") for r in part_rows) or 0) / 60.0,
            "earlyDeathPct": 100.0 * early / n,
            "healsPerMatch": _avg(r.get("heals") for r in part_rows),
            "boostsPerMatch": _avg(r.get("boosts") for r in part_rows),
            "weaponsPerMatch": _avg(r.get("weapons_acquired") for r in part_rows),
            "knocksPerMatch": _avg(r.get("dbnos") for r in part_rows),
            "avgPlace": _avg(r.get("place") for r in part_rows),
        })
    else:
        for key in ("kills", "wins", "kd", "damagePerMatch", "survivalMin",
                    "earlyDeathPct", "healsPerMatch", "boostsPerMatch",
                    "weaponsPerMatch", "knocksPerMatch", "avgPlace"):
            prof[key] = None
    # `matches` kommt aus den Waffenzeilen (nur Matches mit Telemetrie).
    # Fuer die Anzeige zaehlt die BR-Zahl, die Telemetrie-Deckung separat.
    prof["telemetryMatches"] = prof["matches"]
    prof["matches"] = n or prof["matches"]
    return prof


def own_metrics(conn, tenant_id, account_id, cutoff, to_iso=None):
    """Kernprofil des Spielers im Zeitraum."""
    part = _participant_rows(conn, tenant_id, account_id, cutoff, to_iso)
    weap = _weapon_rows(conn, tenant_id, account_id, cutoff, to_iso)
    prof = _profile_from_rows(part, weap)
    prof["accountId"] = account_id
    return prof


def phase_breakdown(conn, tenant_id, account_id, cutoff, to_iso=None):
    """Schussprofil je Rundenphase.

    Die Phase steckt in der Ueberlebenszeit (participants), die Schuesse in
    match_weapon_stats — verbunden ueber die match_id."""
    part = _participant_rows(conn, tenant_id, account_id, cutoff, to_iso)
    phase_by_match = {}
    for r in part:
        ph = phase_of(r.get("time_survived"))
        if ph:
            phase_by_match[r["match_id"]] = ph

    grouped = {}
    for r in _weapon_rows(conn, tenant_id, account_id, cutoff, to_iso):
        ph = phase_by_match.get(r["match_id"])
        if ph:
            grouped.setdefault(ph, []).append(r)

    out = []
    for ph in PHASES:
        rows = grouped.get(ph)
        if not rows:
            continue
        entry = aggregate_weapon_rows(rows)
        entry["phase"] = ph
        out.append(entry)
    return out


def death_rows(conn, tenant_id, account_id, cutoff, to_iso=None):
    """Eigene Tode mit Waffe, Distanz und Ueberlebenszeit.

    Der Tenant-Filter laeuft ueber `matches` — telemetry_events fuehrt keine
    tenant_id, ein direkter Zugriff wuerde fremde Tenants mitziehen."""
    br_where, br_params = _br_filter("m")
    sql = f"""
        SELECT e.weapon, e.distance, e.timestamp_ms, e.damage_reason,
               e.actor_account, pa.time_survived, pa.place, m.match_id,
               m.map_name, m.played_at
        FROM telemetry_events e
        JOIN matches m ON m.match_id = e.match_id
        LEFT JOIN participants pa ON pa.match_id = e.match_id
                                 AND pa.tenant_id = m.tenant_id
                                 AND pa.account_id = e.target_account
        WHERE m.tenant_id = ? AND e.target_account = ?
          AND e.event_type = 'Kill'
          AND m.played_at >= ? AND {br_where}
    """
    params = [tenant_id, account_id, cutoff, *br_params]
    if to_iso:
        sql += " AND m.played_at <= ?"
        params.append(to_iso)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


#: Ab so vielen Toden durch dieselbe Person ist es kein Zufall mehr. An
#: Prod-Daten gemessen erreicht das praktisch niemand: von 1099 Gegnern, die
#: den Nutzer erledigt haben, kamen 1083 auf genau einen Kill und 16 auf zwei.
REPEAT_KILLER_MIN = 3


def repeat_killers(conn, tenant_id, account_id, cutoff, limit=8):
    """Gegner, die einen mehrfach erledigt haben.

    Bewusst mit Untergrenze: eine nach Haeufigkeit sortierte Killer-Liste
    ohne Schwelle liest sich wie "das sind deine Angstgegner", zeigt aber
    nur, welcher Einmal-Killer alphabetisch vorne steht. In einer Lobby
    trifft man denselben Gegner so gut wie nie wieder."""
    br_where, br_params = _br_filter("m")
    sql = f"""
        SELECT COALESCE(pl.name, e.actor_account) AS name,
               COUNT(*) AS n
        FROM telemetry_events e
        JOIN matches m ON m.match_id = e.match_id
        LEFT JOIN players pl ON pl.account_id = e.actor_account
                            AND pl.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND e.target_account = ?
          AND e.event_type = 'Kill' AND e.actor_account IS NOT NULL
          AND m.played_at >= ? AND {br_where}
        GROUP BY 1 HAVING COUNT(*) >= ?
        ORDER BY n DESC, name LIMIT ?
    """
    params = [tenant_id, account_id, cutoff, *br_params,
              REPEAT_KILLER_MIN, limit]
    return [{"name": r["name"], "n": r["n"]}
            for r in conn.execute(sql, params).fetchall()]


def cohort_players(conn, tenant_id, min_matches=MIN_COHORT_MATCHES,
                   cutoff="1970-01-01T00:00:00Z"):
    """Squad-Kohorte: Accounts aus `participants` mit genug BR-Matches.

    Bewusst ueber den ganzen Bestand (nicht den gewaehlten Zeitraum), damit
    die Referenz stabil bleibt und nicht mit jedem Range-Wechsel springt."""
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT pa.account_id, COALESCE(pl.name, pa.name) AS name,
               COUNT(*) AS n,
               SUM(pa.kills) AS kills,
               SUM(CASE WHEN pa.place = 1 THEN 1 ELSE 0 END) AS wins,
               AVG(pa.damage_dealt) AS dmg,
               AVG(pa.time_survived) AS surv,
               AVG(pa.heals) AS heals,
               AVG(pa.boosts) AS boosts,
               AVG(pa.weapons_acquired) AS weapons,
               AVG(pa.place) AS place,
               SUM(CASE WHEN pa.time_survived < ? THEN 1 ELSE 0 END) AS early
        FROM participants pa
        JOIN matches m ON m.match_id = pa.match_id
                      AND m.tenant_id = pa.tenant_id
        LEFT JOIN players pl ON pl.account_id = pa.account_id
                            AND pl.tenant_id = pa.tenant_id
        WHERE pa.tenant_id = ? AND pa.time_survived > 0
          AND m.played_at >= ? AND {br_where}
        GROUP BY pa.account_id, COALESCE(pl.name, pa.name)
        HAVING COUNT(*) >= ?
    """, [PHASE_EARLY_SECS, tenant_id, cutoff, *br_params,
          min_matches]).fetchall()
    if not rows:
        return []

    ids = [r["account_id"] for r in rows]
    shots = _weapon_totals_for(conn, tenant_id, ids, cutoff)

    out = []
    for r in rows:
        n = r["n"]
        prof = shots.get(r["account_id"], {})
        out.append({
            "accountId": r["account_id"],
            "name": r["name"],
            "matches": n,
            "kd": kd(r["kills"], n, r["wins"]),
            "damagePerMatch": float(r["dmg"]) if r["dmg"] is not None else None,
            "survivalMin": (float(r["surv"]) / 60.0) if r["surv"] is not None else None,
            "earlyDeathPct": 100.0 * (r["early"] or 0) / n,
            "healsPerMatch": float(r["heals"]) if r["heals"] is not None else None,
            "boostsPerMatch": float(r["boosts"]) if r["boosts"] is not None else None,
            "weaponsPerMatch": float(r["weapons"]) if r["weapons"] is not None else None,
            "avgPlace": float(r["place"]) if r["place"] is not None else None,
            "hitRate": prof.get("hitRate"),
            "dmgPer100": prof.get("dmgPer100"),
            "inFightShare": prof.get("inFightShare"),
            "headShare": prof.get("headShare"),
            "shotsPerMatch": prof.get("shotsPerMatch"),
        })
    return out


def _weapon_totals_for(conn, tenant_id, account_ids, cutoff):
    """Schussprofil je Account, in einer Abfrage."""
    if not account_ids:
        return {}
    br_where, br_params = _br_filter("m")
    marks = ", ".join("?" for _ in account_ids)
    rows = conn.execute(f"""
        SELECT w.account_id,
               SUM(w.shots) AS shots, SUM(w.hit_attacks) AS hit_attacks,
               SUM(w.hits) AS hits, SUM(w.head) AS head,
               SUM(w.damage) AS damage,
               SUM(w.shots_in_fight) AS in_fight,
               COUNT(DISTINCT w.match_id) AS matches
        FROM match_weapon_stats w
        JOIN matches m ON m.match_id = w.match_id
                      AND m.tenant_id = w.tenant_id
        WHERE w.tenant_id = ? AND w.account_id IN ({marks})
          AND m.played_at >= ? AND {br_where}
        GROUP BY w.account_id
    """, [tenant_id, *account_ids, cutoff, *br_params]).fetchall()

    out = {}
    for r in rows:
        shots, matches = r["shots"] or 0, r["matches"] or 0
        out[r["account_id"]] = {
            "hitRate": hit_rate(shots, r["hit_attacks"]),
            "dmgPer100": dmg_per_100(r["damage"], shots),
            "inFightShare": in_fight_share(r["in_fight"], shots),
            "headShare": head_share(r["head"], r["hits"]),
            "shotsPerMatch": (shots / matches) if matches else None,
        }
    return out


def lobby_reference(conn, tenant_id, min_matches=5, cutoff="1970-01-01T00:00:00Z"):
    """Lobby-Referenz: Schussprofile aller begegneten Gegner.

    Breiter als die Squad-Kohorte (Zehntausende Accounts), dafuer ohne K/D
    und Ueberlebenszeit — `participants` fuehrt Fremde nicht. `min_matches`
    ist hier bewusst niedrig, weil man denselben Gegner selten wiedertrifft."""
    br_where, br_params = _br_filter("m")
    rows = conn.execute(f"""
        SELECT SUM(w.shots) AS shots, SUM(w.hit_attacks) AS hit_attacks,
               SUM(w.hits) AS hits, SUM(w.head) AS head,
               SUM(w.damage) AS damage, SUM(w.shots_in_fight) AS in_fight,
               COUNT(DISTINCT w.match_id) AS matches, w.account_id
        FROM match_weapon_stats w
        JOIN matches m ON m.match_id = w.match_id
                      AND m.tenant_id = w.tenant_id
        WHERE w.tenant_id = ? AND w.is_bot = false
          AND m.played_at >= ? AND {br_where}
        GROUP BY w.account_id
        HAVING COUNT(DISTINCT w.match_id) >= ? AND SUM(w.shots) > 0
    """, [tenant_id, cutoff, *br_params, min_matches]).fetchall()

    profiles = []
    for r in rows:
        shots, matches = r["shots"] or 0, r["matches"] or 0
        profiles.append({
            "accountId": r["account_id"],
            "hitRate": hit_rate(shots, r["hit_attacks"]),
            "dmgPer100": dmg_per_100(r["damage"], shots),
            "inFightShare": in_fight_share(r["in_fight"], shots),
            "headShare": head_share(r["head"], r["hits"]),
            "shotsPerMatch": (shots / matches) if matches else None,
        })
    return profiles


def load_pois(path=None):
    """POI-Geometrie aus data/pubg-pois.json.

    Dieselbe Datei, die der POI-Editor schreibt (tools/poi-editor.html) und
    die landing-heatmap nutzt — bewusst keine zweite Quelle."""
    import json
    import os
    if path is None:
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(os.path.dirname(here), "data", "pubg-pois.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def landing_stats(conn, tenant_id, account_id, cutoff, to_iso=None,
                  pois=None, min_drops=MIN_POI_DROPS):
    """Landeplaetze mit eigenem Ergebnis und der Lobby-Quote am selben POI.

    Der Lobby-Vergleich ist der Punkt der Uebung: eine eigene Fruehtod-Quote
    allein sagt nur, ob der Platz umkaempft ist. Erst die Differenz zur
    Lobby am selben Ort trennt "schwieriger Platz" von "ich verliere hier
    den Landefight".

    Laeuft komplett live — die Bounding-Box-Vorfilterung ordnet die
    Landungen aller Karten eines Tenants in unter einer Sekunde zu, eine
    vorberechnete Tabelle waere unnoetiger Ballast. Kosten stecken im
    Laden der Events, nicht in der Geometrie.

    `telemetry_events` fuehrt keine tenant_id — der Filter laeuft ueber
    matches."""
    boxes = poi_boxes(pois if pois is not None else load_pois())
    if not boxes:
        return {"byPoi": [], "ownDrops": 0, "assigned": 0, "minDrops": min_drops}

    br_where, br_params = _br_filter("m")
    time_filter = " AND m.played_at <= ?" if to_iso else ""
    extra = [to_iso] if to_iso else []

    landings = conn.execute(f"""
        SELECT m.map_name, e.match_id, e.actor_account, e.actor_x, e.actor_y,
               e.timestamp_ms
        FROM telemetry_events e
        JOIN matches m ON m.match_id = e.match_id
        WHERE m.tenant_id = ? AND e.event_type = 'Landing'
          AND e.actor_x IS NOT NULL
          AND m.played_at >= ? AND {br_where}{time_filter}
    """, [tenant_id, cutoff, *br_params, *extra]).fetchall()

    first = first_landings(landings)
    # (match, acc) -> (map, poi, landezeit)
    where = {}
    for key, r in first.items():
        poi = poi_at(boxes, r["map_name"], r["actor_x"], r["actor_y"])
        if poi:
            where[key] = (r["map_name"], poi, r["timestamp_ms"])

    lobby = {}
    for (map_name, poi, _ts) in where.values():
        ref = lobby.setdefault((map_name, poi), {"drops": 0, "early": 0})
        ref["drops"] += 1

    kills = conn.execute(f"""
        SELECT m.map_name, e.match_id, e.target_account, e.victim_x,
               e.victim_y, e.timestamp_ms
        FROM telemetry_events e
        JOIN matches m ON m.match_id = e.match_id
        WHERE m.tenant_id = ? AND e.event_type = 'Kill'
          AND e.victim_x IS NOT NULL AND e.target_account IS NOT NULL
          AND m.played_at >= ? AND {br_where}{time_filter}
    """, [tenant_id, cutoff, *br_params, *extra]).fetchall()

    # Verlorener Landefight = Tod binnen LANDING_FIGHT_MS nach der eigenen
    # Landung UND im Landeplatz selbst. Beides gilt fuer die Lobby und fuer
    # den eigenen Wert GLEICH — sonst vergleicht man zwei verschiedene
    # Uhren. `participants.time_survived` laeuft ab Rundenstart und ist
    # deshalb hier NICHT verwendbar: die Landung liegt rund zweieinhalb
    # Minuten spaeter, das Fenster waere fuer die eigene Quote enger als
    # fuer die Lobby und die Differenz kippte ins Gegenteil.
    lost_fight = set()
    for r in kills:
        landed = where.get((r["match_id"], r["target_account"]))
        if not landed:
            continue
        if r["timestamp_ms"] - landed[2] >= LANDING_FIGHT_MS:
            continue
        poi = poi_at(boxes, r["map_name"], r["victim_x"], r["victim_y"])
        if poi and poi == landed[1]:
            lobby[(landed[0], poi)]["early"] += 1
            lost_fight.add((r["match_id"], r["target_account"]))

    part = {(r["match_id"], account_id): r
            for r in _participant_rows(conn, tenant_id, account_id, cutoff,
                                       to_iso)}
    own = []
    for (mid, acc), (map_name, poi, _ts) in where.items():
        if acc != account_id:
            continue
        pr = part.get((mid, acc))
        if not pr:
            continue
        own.append({
            "map": map_name, "poi": poi,
            "earlyDeath": (mid, acc) in lost_fight,
            "timeSurvived": pr["time_survived"],
            "kills": pr["kills"],
            "damage": pr["damage_dealt"],
            "place": pr["place"],
        })

    return {
        "byPoi": summarise_landings(own, lobby, min_drops),
        "ownDrops": len(own),
        "assigned": len(where),
        "minDrops": min_drops,
    }


def trend(conn, tenant_id, account_id):
    """Eigen-Trend: jedes Fenster gegen die gleich langen Matches davor.

    Bewusst unabhaengig vom gewaehlten Zeitraum — eine Session hat zu wenige
    Matches, um eine Trefferquote zu tragen."""
    part = _participant_rows(conn, tenant_id, account_id,
                             "1970-01-01T00:00:00Z")
    if not part:
        return []
    order = [r["match_id"] for r in part]          # neueste zuerst
    weap = _weapon_rows(conn, tenant_id, account_id, "1970-01-01T00:00:00Z")
    by_match = {}
    for r in weap:
        by_match.setdefault(r["match_id"], []).append(r)

    out = []
    for size in TREND_WINDOWS:
        recent_ids = order[:size]
        prior_ids = order[size:size * 2]
        if len(recent_ids) < size:
            continue
        recent = aggregate_weapon_rows(
            [r for mid in recent_ids for r in by_match.get(mid, [])])
        prior = aggregate_weapon_rows(
            [r for mid in prior_ids for r in by_match.get(mid, [])]) \
            if prior_ids else None
        entry = {"window": size, "recent": recent, "prior": prior,
                 "priorMatches": len(prior_ids)}
        entry["delta"] = {
            metric: delta_pct(recent.get(metric),
                              prior.get(metric) if prior else None)
            for metric in ("hitRate", "dmgPer100", "inFightShare",
                           "shotsPerMatch", "headShare")
        }
        out.append(entry)
    return out


def compute_shot_quality(conn, tenant_id, account_id, cutoff,
                         to_iso=None, min_matches=MIN_COHORT_MATCHES,
                         lobby_min_matches=5):
    """Alles in einem Aufruf — so bleibt es ein Endpoint-Call."""
    me = own_metrics(conn, tenant_id, account_id, cutoff, to_iso)
    squad = cohort_players(conn, tenant_id, min_matches)
    lobby = lobby_reference(conn, tenant_id, lobby_min_matches)
    deaths = death_rows(conn, tenant_id, account_id, cutoff, to_iso)

    # Fuer den Perzentil-Vergleich zaehlt das Lifetime-Profil, nicht der
    # gewaehlte Zeitraum — sonst vergleicht man eine Session gegen Bestaende.
    me_lifetime = (me if cutoff <= "1970-01-02"
                   else own_metrics(conn, tenant_id, account_id,
                                    "1970-01-01T00:00:00Z"))
    me_lifetime = dict(me_lifetime, accountId=account_id)

    return {
        "me": me,
        "byPhase": phase_breakdown(conn, tenant_id, account_id, cutoff, to_iso),
        "deaths": {
            **summarise_deaths(deaths),
            "repeatKillers": repeat_killers(conn, tenant_id,
                                            account_id, cutoff),
            "repeatKillerMin": REPEAT_KILLER_MIN,
        },
        "cohort": {
            "bands": build_cohort_bands(squad),
            "players": len(squad),
            "minMatches": min_matches,
        },
        "ranks": {
            "squad": rank_me(me_lifetime, squad),
            "lobby": rank_me(me_lifetime, lobby),
            "lobbyPlayers": len(lobby),
            "lobbyMinMatches": lobby_min_matches,
        },
        "landings": landing_stats(conn, tenant_id, account_id, cutoff,
                                  to_iso=to_iso),
        "trend": trend(conn, tenant_id, account_id),
    }
