"""G1R-Aggregationen (Sub-2): leitet aus g1r_run/g1r_sample/g1r_event die
Anzeige-Kennzahlen ab — Run-Liste (Picker), Career-Card pro run_id ODER
all-time, und Live-Snapshot des aktiven Runs.

Reine Lese-Funktionen über die bestehende Conn (sqlite ODER SqliteCompatConn auf
Postgres). Alles tenant-gescoped — JEDE Query filtert tenant_id, sonst lecken
Runs zwischen Tenants (siehe feedback_verify_own_work)."""
import json

# Welche Sample-Spalten die Career-Card als "stats" zeigt (jüngstes Sample).
_STAT_FIELDS = ["level", "xp", "strength", "dexterity", "magic_circle",
                "learn_pts", "hp_max", "mana_max", "guild_key",
                "strongest_melee", "strongest_melee_dmg",
                "strongest_ranged", "strongest_ranged_dmg", "strongest_spell"]


def _row_to_dict(row):
    if row is None:
        return None
    try:
        return dict(row)
    except (TypeError, ValueError):
        return {k: row[k] for k in row.keys()}


def list_runs(conn, tenant_id):
    """Alle Runs des Tenants, neueste zuerst. Pro Run: Meta + abgeleitet
    höchstes Level und Sample-Anzahl (für den Run-Picker)."""
    rows = conn.execute(
        "SELECT id, save_key, started_at, ended_at, label, detection FROM g1r_run "
        "WHERE tenant_id=? ORDER BY id DESC",
        (tenant_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        agg = conn.execute(
            "SELECT COUNT(*) AS samples, MAX(level) AS level FROM g1r_sample "
            "WHERE tenant_id=? AND run_id=?",
            (tenant_id, d["id"]),
        ).fetchone()
        a = _row_to_dict(agg) or {}
        d["samples"] = a.get("samples") or 0
        d["level"] = a.get("level")
        out.append(d)
    return out


def _latest_sample(conn, tenant_id, run_id):
    if run_id is None:
        r = conn.execute(
            "SELECT * FROM g1r_sample WHERE tenant_id=? ORDER BY id DESC LIMIT 1",
            (tenant_id,),
        ).fetchone()
    else:
        r = conn.execute(
            "SELECT * FROM g1r_sample WHERE tenant_id=? AND run_id=? ORDER BY id DESC LIMIT 1",
            (tenant_id, run_id),
        ).fetchone()
    return _row_to_dict(r)


def _stats_from_sample(sample):
    if not sample:
        return {}
    return {k: sample[k] for k in _STAT_FIELDS
            if k in sample and sample[k] is not None}


def _event_aggregates(conn, tenant_id, run_id):
    """SUM/MAX/COUNT je Event-Art, run-gescoped oder all-time (run_id=None)."""
    if run_id is None:
        rows = conn.execute(
            "SELECT kind, SUM(value) AS s, MAX(value) AS m, COUNT(*) AS c "
            "FROM g1r_event WHERE tenant_id=? GROUP BY kind",
            (tenant_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT kind, SUM(value) AS s, MAX(value) AS m, COUNT(*) AS c "
            "FROM g1r_event WHERE tenant_id=? AND run_id=? GROUP BY kind",
            (tenant_id, run_id),
        ).fetchall()
    agg = {}
    for r in rows:
        d = _row_to_dict(r)
        agg[d["kind"]] = {"sum": d["s"] or 0, "max": d["m"] or 0, "count": d["c"] or 0}
    return agg


def _sample_records(conn, tenant_id, run_id):
    """Weiteste Strecke/Schritte = Maximum der (pro Session kumulativen) Samples."""
    if run_id is None:
        r = conn.execute(
            "SELECT MAX(distance_m) AS d, MAX(steps) AS s FROM g1r_sample WHERE tenant_id=?",
            (tenant_id,),
        ).fetchone()
    else:
        r = conn.execute(
            "SELECT MAX(distance_m) AS d, MAX(steps) AS s FROM g1r_sample "
            "WHERE tenant_id=? AND run_id=?",
            (tenant_id, run_id),
        ).fetchone()
    d = _row_to_dict(r) or {}
    return (d.get("d") or 0, d.get("s") or 0)


def career(conn, tenant_id, run_id=None):
    """Career-Card-Daten. run_id gesetzt → Scope dieser Run; None → all-time
    über alle Runs des Tenants. Liefert stats (jüngstes Sample) + totals
    (Event-Summen) + records (größte Einzelwerte/weiteste Strecke)."""
    run = None
    if run_id is not None:
        run = _row_to_dict(conn.execute(
            "SELECT id, save_key, started_at, ended_at, label, detection FROM g1r_run "
            "WHERE tenant_id=? AND id=?",
            (tenant_id, run_id),
        ).fetchone())

    sample = _latest_sample(conn, tenant_id, run_id)
    agg = _event_aggregates(conn, tenant_id, run_id)
    dist, steps = _sample_records(conn, tenant_id, run_id)

    kill = agg.get("kill", {})
    dealt = agg.get("hit_dealt", {})
    taken = agg.get("hit_taken", {})
    return {
        "scope": "run" if run_id is not None else "all",
        "run": run,
        "stats": _stats_from_sample(sample),
        "totals": {
            "kills": kill.get("sum", 0),
            "damage_dealt": dealt.get("sum", 0),
            "damage_taken": taken.get("sum", 0),
            "hits_dealt": dealt.get("count", 0),
            "hits_taken": taken.get("count", 0),
        },
        "records": {
            "hardest_dealt": dealt.get("max", 0),
            "hardest_taken": taken.get("max", 0),
            "distance_m": dist,
            "steps": steps,
        },
    }


def _active_run_row(conn, tenant_id):
    """Aktiver Run = laufender (ended_at NULL) bevorzugt, sonst zuletzt angelegter."""
    return _row_to_dict(conn.execute(
        "SELECT id, save_key, started_at, ended_at, label, detection FROM g1r_run "
        "WHERE tenant_id=? ORDER BY (ended_at IS NULL) DESC, id DESC LIMIT 1",
        (tenant_id,),
    ).fetchone())


def live(conn, tenant_id, *, event_limit=20):
    """Live-Snapshot: aktiver Run + jüngstes Sample + jüngste Events (für ein
    Live-Widget). Keine Daten → run=None, stats={}, events=[]."""
    run = _active_run_row(conn, tenant_id)
    if run is None:
        return {"run": None, "stats": {}, "events": []}
    sample = _latest_sample(conn, tenant_id, run["id"])
    rows = conn.execute(
        "SELECT ts, kind, value, meta FROM g1r_event WHERE tenant_id=? AND run_id=? "
        "ORDER BY id DESC LIMIT ?",
        (tenant_id, run["id"], event_limit),
    ).fetchall()
    events = []
    for r in rows:
        d = _row_to_dict(r)
        meta = d.get("meta")
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except ValueError:
                meta = None
        events.append({"ts": d.get("ts"), "kind": d.get("kind"),
                       "value": d.get("value"), "meta": meta})
    events.reverse()   # chronologisch (älteste zuerst) für den Ticker
    return {"run": run, "stats": _stats_from_sample(sample), "events": events}
