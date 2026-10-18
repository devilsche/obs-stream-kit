"""K/D-Staende alter Matches aus der Match-Historie zurueckrechnen.

`player_season_snapshot` haelt nur den letzten Stand fest — der
Primaerschluessel ist (account_id, season_id, mode), jeder Abruf
ueberschreibt den vorigen. Fuer Matches, die vor der Einfuehrung von
`match_player_kd` gespielt wurden, gaebe es damit nur den heutigen
Wert zu konservieren, und der ist nachweislich falsch: PEX_LuCKoR
stand bis zur 20. Runde der Season bei 1,66 (Rueckfall auf die
Vorsaison, weil MIN_KD_ROUNDS noch nicht erreicht war) und sprang
erst mit Runde 20 auf 2,33. Ein Match vom 10.09. zeigte hinterher
2,33, obwohl an dem Abend 1,66 galt.

Die eigene Match-Historie ist vollstaendig, also laesst sich der
Season-Stand exakt aufsummieren: fuer PEX_LuCKoR ergeben die Matches
seit Season-Beginn 26 Runden, 56 Kills, 2 Siege — genau das, was die
API liefert. Fuer Mitspieler ist sie nur so vollstaendig, wie sie mit
uns gespielt haben — als Season-Stand taugt sie dort NICHT: die
20-Runden-Schwelle fragt nach den Season-Runden des Spielers, nicht nach
den Runden mit uns. Fuer Mitspieler gilt deshalb der API-Snapshot, um die
spaeter bekannten Matches zurueckgedreht (`_snapshot_vor`). Fuer
Lobby-Fremde geht es gar nicht, aber deren Lobby-Wert beruht auf Lifetime
und bewegt sich kaum.
"""
from core.db_compat import SqliteCompatConn
from pubg.lobby_kd import ranked_mode


def _raw(conn):
    return conn.raw if isinstance(conn, SqliteCompatConn) else conn


def season_grenzen(conn) -> list:
    """[(season_id, start_iso)] absteigend; die aelteste offen nach hinten.

    Wann eine Season begann, steht nirgends — die API nennt keine Daten.
    Der erste Snapshot dazu ist der beste Anhalt: der Poller holt eine
    neue Season, sobald es sie gibt. Fuer Season 43 ergibt das den
    10.09., und das erste Match dieser Season liegt am selben Tag
    15 Stunden spaeter — die Grenze sitzt also richtig.

    Die aelteste bekannte Season bekommt `None` als Start, damit auch
    Matten von vor der ersten Sammlung eine Season finden.
    """
    with _raw(conn).cursor() as cur:
        cur.execute("SELECT season_id, MIN(fetched_at) AS von "
                    "FROM player_season_snapshot "
                    "WHERE season_id <> 'lifetime' "
                    "GROUP BY season_id ORDER BY season_id DESC")
        rows = cur.fetchall()
    g = [(r["season_id"], r["von"]) for r in rows]
    if g:
        g[-1] = (g[-1][0], None)
    return g


def season_fuer(grenzen, played_at: str):
    """Season, die zu diesem Zeitpunkt lief."""
    if not played_at:
        return None
    for sid, von in grenzen:
        if von is None or played_at >= von:
            return sid
    return None


def _leer():
    return {"kills": 0, "rounds": 0, "wins": 0, "losses": 0}


def _summiere(conn, tenant_id, account_ids, von, bis):
    """Kills/Runden/Siege je Account und Modus im Zeitfenster [von, bis).

    Tenant-uebergreifend gelesen: ein Mitspieler, der selbst Tenant ist,
    hat seine Matches unter seiner eigenen tenant_id liegen. Ohne das
    faehrt man fuer ihn eine zu kleine Historie. `DISTINCT match_id`
    verhindert, dass ein Match doppelt zaehlt, wenn zwei Tenants darin
    sassen.
    """
    ids = [a for a in (account_ids or []) if a]
    if not ids:
        return {}
    sql = ["""
        SELECT s.account_id, s.game_mode, s.is_ranked, count(*) AS n,
               sum(s.kills) AS kills,
               sum(CASE WHEN s.place = 1 THEN 1 ELSE 0 END) AS wins
        FROM (SELECT DISTINCT p.account_id, m.match_id, m.game_mode,
                     COALESCE(m.is_ranked, 0) AS is_ranked,
                     p.kills, p.place
              FROM participants p
              JOIN matches m ON m.match_id = p.match_id
                             AND m.tenant_id = p.tenant_id
              WHERE p.account_id = ANY(%s)
    """]
    params = [ids]
    if von:
        sql.append(" AND m.played_at >= %s")
        params.append(von)
    if bis:
        sql.append(" AND m.played_at < %s")
        params.append(bis)
    sql.append(") s GROUP BY s.account_id, s.game_mode, s.is_ranked")
    with _raw(conn).cursor() as cur:
        cur.execute("".join(sql), params)
        rows = cur.fetchall()
    out = {}
    for r in rows:
        # Ranked steht in `matches` als squad-fpp + is_ranked, in den
        # Snapshots als squad-fpp-ranked. Ohne die Trennung zog die
        # Rueckrechnung Ranked-Runden vom Normal-Stand ab.
        mode = r["game_mode"]
        if r["is_ranked"] and mode:
            mode = ranked_mode(mode)
        st = out.setdefault(r["account_id"], {}).setdefault(mode, _leer())
        n, wins = int(r["n"] or 0), int(r["wins"] or 0)
        st["kills"] += int(r["kills"] or 0)
        st["rounds"] += n
        st["wins"] += wins
        # Ein Tod je nicht gewonnener Runde — mehr weiss die Historie
        # nicht. Gebraucht fuer Ranked, das ueber Tode rechnet.
        st["losses"] += n - wins
    return out


def season_stand_vor(conn, tenant_id: int, account_ids, season_start,
                     bis: str) -> dict:
    """Season-Stand, wie er vor diesem Match galt.

    `bis` ist exklusiv: gefragt ist, wie stark jemand in die Runde ging,
    nicht wie er nach ihr dasteht.
    """
    return _summiere(conn, tenant_id, account_ids, season_start, bis)


def _snapshot_vor(conn, tenant_id: int, account_ids, season_id: str,
                  bis: str, ende: str = None) -> dict:
    """Snapshot einer Season (oder 'lifetime') auf den Stand vor `bis`.

    Der gespeicherte Stand ist der vom Abruf (`fetched_at`). Abgezogen
    wird, was zwischen `bis` und dem Abruf gespielt wurde — und bei einer
    Season nur bis zu ihrem Ende (`ende`), denn spaetere Matches gehoeren
    in die naechste. Was nach dem Abruf kam, steckt im Snapshot nicht
    drin und bleibt unangetastet.

    Fuer die eigenen Accounts ist das exakt. Fuer Mitspieler fehlen die
    Matches ohne uns, dann faellt die Korrektur zu klein aus und der Stand
    eher etwas zu hoch — aber die Groessenordnung stimmt, waehrend die
    Summe "Matches mit uns" sie um ein Vielfaches unterschaetzt.
    """
    ids = [a for a in (account_ids or []) if a]
    if not ids:
        return {}
    with _raw(conn).cursor() as cur:
        cur.execute("""
            SELECT account_id, mode, kills, losses, rounds, wins, fetched_at
            FROM player_season_snapshot
            WHERE season_id = %s AND account_id = ANY(%s)
              AND kills IS NOT NULL
        """, (season_id, ids))
        rows = cur.fetchall()
    if not rows:
        return {}
    out, abruf = {}, {}
    for r in rows:
        out.setdefault(r["account_id"], {})[r["mode"]] = {
            "kills": r["kills"] or 0, "losses": r["losses"] or 0,
            "rounds": r["rounds"] or 0, "wins": r["wins"] or 0}
        abruf.setdefault(r["account_id"], {})[r["mode"]] = r["fetched_at"]
    for acc, je_modus in abruf.items():
        # Je Abrufzeitpunkt einmal summieren — meist ist es nur einer.
        for zeitpunkt in set(je_modus.values()):
            obergrenze = min(x for x in (zeitpunkt, ende) if x)
            if not obergrenze or obergrenze <= bis:
                continue
            spaeter = _summiere(conn, tenant_id, [acc], bis,
                                obergrenze).get(acc) or {}
            for mode, st in spaeter.items():
                if je_modus.get(mode) != zeitpunkt:
                    continue
                ziel = out[acc][mode]
                for k in ("kills", "rounds", "wins", "losses"):
                    ziel[k] = max(0, ziel[k] - st[k])
    return out


def lifetime_stand_vor(conn, tenant_id: int, account_ids,
                       bis: str) -> dict:
    """Lifetime-Snapshot um die spaeter gespielten Matches zurueckdrehen."""
    return _snapshot_vor(conn, tenant_id, account_ids, "lifetime", bis)


def _aeltere_seasons(conn, account_ids, bis_season):
    """Abgeschlossene Seasons als (season_id, {mode: stats}), absteigend.

    Abgeschlossen heisst unveraenderlich: diese Snapshots sind der Stand
    von damals, ohne Rueckrechnung.
    """
    ids = [a for a in (account_ids or []) if a]
    if not ids:
        return {}
    with _raw(conn).cursor() as cur:
        cur.execute("""
            SELECT account_id, season_id, mode, kills, losses, rounds, wins
            FROM player_season_snapshot
            WHERE season_id <> 'lifetime' AND account_id = ANY(%s)
              AND season_id < %s AND kills IS NOT NULL
            ORDER BY account_id, season_id DESC
        """, (ids, bis_season or "zzz"))
        rows = cur.fetchall()
    tmp = {}
    for r in rows:
        tmp.setdefault(r["account_id"], {}) \
           .setdefault(r["season_id"], {})[r["mode"]] = {
               "kills": r["kills"] or 0, "losses": r["losses"] or 0,
               "rounds": r["rounds"] or 0, "wins": r["wins"] or 0}
    return {acc: sorted(d.items(), key=lambda x: x[0], reverse=True)
            for acc, d in tmp.items()}


def _direkt_danach(played_at: str) -> str:
    """Stichtag, ab dem das Match selbst mitzaehlt.

    Alle Summen fragen `played_at < bis`. Eine Sekunde spaeter liegt das
    Match davor, das naechste (mindestens Minuten spaeter) noch nicht.
    """
    from datetime import datetime, timedelta, timezone
    t = datetime.fromisoformat(played_at.replace("Z", "+00:00"))
    t = (t + timedelta(seconds=1)).astimezone(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def kd_vor_match(conn, tenant_id: int, match_id: str,
                 nach: bool = False) -> list:
    """Eintraege fuer `save_match_player_kd` — Stand vor dem Match.

    Gerechnet wird mit derselben Quellen-Kette wie im Livebetrieb
    (`kd_resolved`), nur mit zurueckgedrehten Zahlen. Damit greift auch
    die 20-Runden-Schwelle wieder so, wie sie damals griff.

    `nach=True` rechnet das Match selbst mit ein — der Stand, mit dem
    man aus der Runde herausgeht. Springt ein Spieler genau mit diesem
    Match auf 20 Season-Runden, steht hier schon die neue Season.
    """
    from pubg.lobby_kd import kd_resolved

    r = conn.execute("SELECT played_at, game_mode, is_ranked FROM matches "
                     "WHERE match_id = ? AND tenant_id = ? LIMIT 1",
                     (match_id, tenant_id)).fetchone()
    if not r:
        return []
    played_at = r["played_at"]
    if not played_at:
        return []
    season_zeit = played_at
    if nach:
        played_at = _direkt_danach(played_at)
    mode = r["game_mode"] or "squad-fpp"
    mates = eigene_squad_accounts(conn, tenant_id, match_id)
    if not mates:
        return []

    liste = season_grenzen(conn)
    # Die Season haengt am Match, nicht am verschobenen Stichtag.
    sid = season_fuer(liste, season_zeit)
    grenzen = dict(liste)
    # Ende der Season = Beginn der naechst neueren (Liste ist absteigend).
    ende = None
    for i, (x, _von) in enumerate(liste):
        if x == sid and i > 0:
            ende = liste[i - 1][1]
    # Eigene Accounts: die Historie ist vollstaendig, die Summe exakt.
    # Mitspieler: der API-Stand, zurueckgedreht. Die gemeinsamen Matches
    # allein sind kein Season-Stand — mit ihnen fiel ein Mitspieler mit
    # 100 Season-Runden unter die 20-Runden-Schwelle, weil nur 17 davon
    # mit uns waren.
    eigene = set(eigene_accounts(conn, tenant_id, mates))
    aktuell = season_stand_vor(conn, tenant_id, [a for a in mates
                                                 if a in eigene],
                               grenzen.get(sid), played_at)
    if sid:
        aktuell.update(_snapshot_vor(conn, tenant_id,
                                     [a for a in mates if a not in eigene],
                                     sid, played_at, ende))
    aelter = _aeltere_seasons(conn, mates, sid)
    lifetime = lifetime_stand_vor(conn, tenant_id, mates, played_at)

    out = []
    for acc in mates:
        res = kd_resolved(mode, current_season=aktuell.get(acc),
                          last_seasons=aelter.get(acc),
                          lifetime=lifetime.get(acc),
                          current_season_id=sid,
                          is_ranked=bool(r["is_ranked"]))
        if res.get("kd") is None:
            continue
        out.append({"account_id": acc, "mode": res.get("basis") or mode,
                    "kd": round(res["kd"], 4), "rounds": res.get("rounds"),
                    "source": res.get("source"),
                    "season_id": res.get("seasonId")})
    return out


def kd_eintraege(conn, tenant_id: int, match_id: str) -> list:
    """Stand vor UND nach dem Match, fertig fuer `save_match_player_kd`."""
    vor = kd_vor_match(conn, tenant_id, match_id)
    nach = {e["account_id"]: e
            for e in kd_vor_match(conn, tenant_id, match_id, nach=True)}
    for e in vor:
        n = nach.get(e["account_id"])
        if n:
            e["nach"] = {k: n.get(k) for k in
                         ("kd", "rounds", "mode", "source", "season_id")}
    return vor


def eigene_accounts(conn, tenant_id: int, account_ids) -> list:
    """Welche dieser Accounts gehoeren dem Tenant selbst (is_self)."""
    ids = [a for a in (account_ids or []) if a]
    if not ids:
        return []
    with _raw(conn).cursor() as cur:
        cur.execute("SELECT DISTINCT account_id FROM players "
                    "WHERE tenant_id = %s AND is_self = 1 "
                    "AND account_id = ANY(%s)", (tenant_id, ids))
        return [r["account_id"] for r in cur.fetchall()]


def eigene_squad_accounts(conn, tenant_id: int, match_id: str) -> list:
    """Das eigene Team in diesem Match — Gegner bleiben aussen vor."""
    return [x["account_id"] for x in conn.execute("""
        SELECT DISTINCT m2.account_id
        FROM match_team_mapping m1
        JOIN match_team_mapping m2 ON m2.match_id = m1.match_id
                                   AND m2.team_id = m1.team_id
                                   AND m2.tenant_id = m1.tenant_id
        JOIN players p ON p.account_id = m1.account_id
                       AND p.tenant_id = m1.tenant_id AND p.is_self = 1
        WHERE m1.match_id = ? AND m1.tenant_id = ?
    """, (match_id, tenant_id)).fetchall()]


def offene_matches(conn, tenant_id: int, limit: int = None) -> list:
    """Matches ohne eingefrorenen Stand, aelteste zuerst.

    Aelteste zuerst, weil ein abgebrochener Lauf dann trotzdem einen
    zusammenhaengenden Block erledigt hat.
    """
    sql = """
        SELECT m.match_id FROM matches m
        WHERE m.tenant_id = ?
          AND NOT EXISTS (SELECT 1 FROM match_player_kd k
                          WHERE k.match_id = m.match_id)
        ORDER BY m.played_at
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [r["match_id"] for r in conn.execute(sql, (tenant_id,)).fetchall()]


def backfill(conn, tenant_id: int, limit: int = None,
             fortschritt=None) -> int:
    """Fehlende Matches nachtragen. Returns Anzahl geschriebener Matches."""
    from pubg.db_pg import save_match_player_kd, _now_iso

    jetzt = _now_iso()
    n = 0
    mids = offene_matches(conn, tenant_id, limit)
    for i, mid in enumerate(mids, 1):
        eintraege = kd_eintraege(conn, tenant_id, mid)
        if not eintraege:
            continue
        save_match_player_kd(_raw(conn), mid, eintraege, jetzt)
        n += 1
        if fortschritt:
            fortschritt(i, len(mids), mid, len(eintraege))
    return n


def neu_berechnen(conn, tenant_id: int, ab: str, fortschritt=None) -> int:
    """Eingefrorene Staende ab `ab` neu rechnen und ueberschreiben.

    Fuer den Fall, dass die Rechnung selbst falsch war — so geschehen bei
    Mitspielern, deren Season-Stand aus den gemeinsamen Matches statt aus
    der API kam. Returns Anzahl neu geschriebener Matches.
    """
    from pubg.db_pg import save_match_player_kd, _now_iso

    jetzt = _now_iso()
    mids = [r["match_id"] for r in conn.execute("""
        SELECT DISTINCT m.match_id, m.played_at FROM matches m
        WHERE m.tenant_id = ? AND m.played_at >= ?
        ORDER BY m.played_at
    """, (tenant_id, ab)).fetchall()]
    n = 0
    for i, mid in enumerate(mids, 1):
        eintraege = kd_eintraege(conn, tenant_id, mid)
        if not eintraege:
            continue
        save_match_player_kd(_raw(conn), mid, eintraege, jetzt,
                             ersetzen=True)
        n += 1
        if fortschritt:
            fortschritt(i, len(mids), mid, len(eintraege))
    return n
