"""Lobby-Staerke: Season-K/D aller Spieler einer Lobby, gemittelt je Match.

Warum Season und nicht Lifetime: Lifetime gibt die PUBG-API nur einzeln heraus
— 93 Spieler je Match bei einem Budget von 10 Requests pro Minute, das sich
der Match-Poller teilt. Season-Werte kommen im Zehnerpack
(`/seasons/{id}/gameMode/{mode}/players?filter[playerIds]=a,b,...`), also rund
zehn Calls je Match. Und "aktuelle Season" ist ohnehin naeher an der Frage
"wie stark war die Lobby damals" als ein Lifetime-Wert von 2018.

Der Wert ist ein Schnappschuss von heute, nicht von damals: die API kennt
keine Historie. Fuer laufende Seasons ist das nah genug, ueber Season-Grenzen
hinweg nicht — deshalb steht die season_id an jedem Snapshot.

Reine Rechenlogik hier, DB-Zugriff in db_pg (Snapshot-Tabelle) und der
Sammel-Takt im Poller.
"""

#: Der Batch-Endpoint nimmt zehn Spieler-IDs pro Aufruf.
BATCH_SIZE = 10

#: So lange gilt ein Snapshot als aktuell. Danach holt der Sammler ihn neu.
#:
#: Zwei Wochen sind das Machbare: bei rund 53.000 bekannten Lobby-Spielern
#: sind das etwa 3.800 Auffrischungen pro Tag = 2,7 Requests pro Minute — von
#: zehn, die sich Sammler und Match-Poller teilen. Weil die Auswahl nach dem
#: juengsten Auftreten sortiert, treffen die Auffrischungen ausserdem zuerst
#: die Spieler, die gerade wieder in einer Lobby waren; Karteileichen von vor
#: Monaten kommen nie dran, solange es aktuellere gibt.
SNAPSHOT_TTL_DAYS = 14


def is_stale(fetched_at, now=None) -> bool:
    """Ist ein Snapshot alt genug fuer einen erneuten Abruf?"""
    import datetime as _dt
    if not fetched_at:
        return True
    try:
        ts = _dt.datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
        ref = (_dt.datetime.fromisoformat(str(now).replace("Z", "+00:00"))
               if now else _dt.datetime.now(_dt.UTC))
    except (ValueError, TypeError):
        return True
    return (ref - ts).days >= SNAPSHOT_TTL_DAYS


def is_bot(account_id) -> bool:
    return isinstance(account_id, str) and account_id.startswith("ai.")


def chunk(items, size=BATCH_SIZE):
    """Liste in Haeppchen — ein Haeppchen ist ein API-Call."""
    items = list(items)
    return [items[i:i + size] for i in range(0, len(items), size)]


def _kd(kills, losses, rounds):
    """Kills je Tod. Ohne Tode zaehlen die gespielten Runden als Nenner —
    sonst waere ein Spieler ohne Tod rechnerisch unendlich gut."""
    kills = kills or 0
    if losses:
        return kills / losses
    return (kills / rounds) if rounds else None


#: Schluessel, unter dem Lifetime-Werte in derselben Tabelle liegen wie die
#: Season-Snapshots. So stehen beide nebeneinander zur Verfuegung.
LIFETIME_KEY = "lifetime"
#: Ab welcher Abdeckung eine Lobby-Zahl etwas ueber die Lobby sagt und nicht
#: ueber unsere Sammelquote. Dieselbe Schwelle nutzt der Report.
MIN_COVERAGE_PCT = 25
#: Kleinste Lobby, die im Zeitraum-Schnitt mitzaehlt. Arcade-Modi (Heist,
#: TDM) haben eine Handvoll Spieler; im Mittel ueber eine Phase wiegt so ein
#: Match dann genauso schwer wie eine volle Runde mit 96 Gegnern. Beim Match
#: selbst bleibt der Wert stehen — nur gemittelt wird er nicht.
MIN_LOBBY_PLAYERS = 20


def counts_for_average(match) -> bool:
    """Taugt dieses Match fuer einen Zeitraum-Schnitt?"""
    return ((match.get("coverage") or 0) >= MIN_COVERAGE_PCT
            and (match.get("lobbyPlayers") or 0) >= MIN_LOBBY_PLAYERS
            and match.get("lobbyKd") is not None)


def parse_lifetime(payload) -> dict:
    """Lifetime-Antwort eines Spielers → {mode: stats}.

    Ein Call liefert ALLE Spielmodi mit; die werden alle gespeichert, sonst
    zahlt man denselben Call fuer den naechsten Modus noch einmal.
    """
    stats_by_mode = (((payload or {}).get("data") or {})
                     .get("attributes") or {}).get("gameModeStats") or {}
    out = {}
    for mode, stats in stats_by_mode.items():
        if not stats:
            continue
        kd = _kd(stats.get("kills"), stats.get("losses"),
                 stats.get("roundsPlayed"))
        if kd is None:
            continue
        out[mode] = {
            "kills": stats.get("kills") or 0,
            "losses": stats.get("losses") or 0,
            "rounds": stats.get("roundsPlayed") or 0,
            "wins": stats.get("wins") or 0,
            "damage": float(stats.get("damageDealt") or 0.0),
            "kd": kd,
        }
    return out


def fetch_lifetime(client, account_ids, store: dict,
                   max_calls: int = 2) -> int:
    """Lifetime-Werte holen — ein Call je Spieler.

    Die PUBG-API kennt keinen Batch fuer Lifetime; bei 93 Spielern je Lobby
    und einem Budget von zehn Requests pro Minute ist das der teure Weg. Genau
    deshalb das harte `max_calls`-Budget und der Negativ-Eintrag fuer Spieler,
    die die API nicht kennt.

    `store` wird in-place gefuellt: {account_id: {mode: stats}} oder None.
    """
    seen = set()
    todo = []
    for acc in account_ids or []:
        if not acc or is_bot(acc) or acc in store or acc in seen:
            continue
        seen.add(acc)
        todo.append(acc)

    from pubg.api_client import RateLimitError

    done = 0
    for acc in todo[:max_calls]:
        try:
            rows = parse_lifetime(client.get_lifetime(acc))
        except RateLimitError:
            break            # Budget erschoepft: nichts merken, spaeter weiter
        except Exception as e:
            status = getattr(e, "status", None)
            if isinstance(status, int) and 400 <= status < 500 and status != 429:
                # Nur ein echtes "gibt es nicht" wird vermerkt. Ein 429 oder
                # ein Serverfehler wuerde den Spieler sonst dauerhaft als
                # unbekannt einbrennen — genau so entstanden 1.400 falsche
                # Fehlanzeigen.
                store[acc] = None
                done += 1
            continue
        store[acc] = rows or None
        done += 1
    return done


def parse_season_batch(payload, mode: str) -> dict:
    """Antwort des Season-Batch-Endpoints → {account_id: stats}.

    Spieler ohne Zahlen in diesem Modus fehlen im Ergebnis — sie haben ihn
    schlicht nicht gespielt.
    """
    out = {}
    for entry in (payload or {}).get("data") or []:
        acc = entry.get("id")
        rel = ((entry.get("relationships") or {}).get("player") or {}).get("data")
        if rel and rel.get("id"):
            acc = rel["id"]
        stats = (((entry.get("attributes") or {}).get("gameModeStats") or {})
                 .get(mode))
        if not acc or not stats:
            continue
        kd = _kd(stats.get("kills"), stats.get("losses"),
                 stats.get("roundsPlayed"))
        if kd is None:
            continue
        out[acc] = {
            "kills": stats.get("kills") or 0,
            "losses": stats.get("losses") or 0,
            "rounds": stats.get("roundsPlayed") or 0,
            "wins": stats.get("wins") or 0,
            "damage": float(stats.get("damageDealt") or 0.0),
            "kd": kd,
        }
    return out


def overall_kd(per_mode) -> float | None:
    """Alltime-K/D ueber ALLE Spielmodi: Summe Kills durch Summe Tode.

    Der modusspezifische Wert laesst zu viele Spieler ohne Zahl — gemessen an
    einer Session: 493 von 1.839 Lobby-Spielern hatten keine squad-fpp-Werte,
    382 davon aber Zahlen in einem anderen Modus (die meisten spielen mehr
    Duo). Und "Alltime" meint ohnehin die ganze Karriere, nicht einen Modus.
    """
    kills = losses = rounds = 0
    for st in (per_mode or {}).values():
        if not st:
            continue
        kills += st.get("kills") or 0
        losses += st.get("losses") or 0
        rounds += st.get("rounds") or 0
    if not (kills or losses or rounds):
        return None
    return _kd(kills, losses, rounds)


def lobby_breakdown(players, top_n: int = 5) -> dict:
    """Eine Lobby aufgeschluesselt: Median, Maximum und die beiden Raender.

    `players` = [(name, kd), ...]; Unbekannte gehoeren nicht hinein.

    Der Median steht neben dem Schnitt, weil K/D bei 0 endet und nach oben
    offen ist — der Schnitt haengt an den wenigen Starken. Gemessen an prod
    sind das allerdings nur 0,05 bis 0,10 Unterschied; die Aussage steckt in
    Top gegen Low (2,45 gegen 0,51 in einer typischen Lobby).

    Bei wenigen Bekannten werden die Raender gekuerzt, damit sich Top und Low
    nicht ueberlappen und derselbe Spieler nicht auf beiden Seiten steht.
    """
    vals = sorted(((n, k) for n, k in (players or []) if k is not None),
                  key=lambda p: p[1])
    if not vals:
        return {"known": 0, "avg": None, "median": None, "max": None,
                "top": [], "low": [], "topAvg": None, "lowAvg": None}
    kds = [k for _, k in vals]
    n = min(top_n, len(vals) // 2) or (1 if len(vals) == 1 else 0)
    top = [{"name": nm, "kd": k} for nm, k in reversed(vals[len(vals) - n:])]
    low = [{"name": nm, "kd": k} for nm, k in vals[:n]]
    return {
        "known": len(vals),
        "avg": sum(kds) / len(kds),
        "median": _median(kds),
        "max": kds[-1],
        "top": top,
        "low": low,
        "topAvg": (sum(p["kd"] for p in top) / len(top)) if top else None,
        "lowAvg": (sum(p["kd"] for p in low) / len(low)) if low else None,
    }


def _median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    m = len(vals)
    return vals[m // 2] if m % 2 else (vals[m // 2 - 1] + vals[m // 2]) / 2.0


def lobby_average(account_ids, snapshots, exclude=None) -> dict:
    """Durchschnittliches Season-K/D einer Lobby.

    `snapshots` = {account_id: kd oder None}. Unbekannte Spieler fliegen aus
    dem Durchschnitt, zaehlen aber im Nenner der Abdeckung: ein Mittelwert
    ueber die halbe Lobby ist brauchbar, muss aber als solcher erkennbar sein.
    Bots bleiben ganz draussen — sie haben keine Season-Stats und wuerden die
    Lobby kuenstlich schwach aussehen lassen. `exclude` nimmt den eigenen
    Squad heraus: gegen sich selbst zu vergleichen verwaessert den Wert.
    """
    skip = set(exclude or ())
    real = [a for a in (account_ids or []) if a and not is_bot(a)
            and a not in skip]
    known = [snapshots[a] for a in real
             if snapshots.get(a) is not None]
    return {
        "avgKd": (sum(known) / len(known)) if known else None,
        "known": len(known),
        "total": len(real),
        "coverage": (100.0 * len(known) / len(real)) if real else None,
    }


def fetch_missing(client, account_ids, season_id: str, mode: str,
                  store: dict, max_batches: int = 1) -> int:
    """Holt fehlende Season-Snapshots in Zehnerpacks.

    `store` wird in-place gefuellt: {account_id: stats} — oder None fuer
    Spieler, die die API in diesem Modus nicht kennt. Der Negativ-Eintrag ist
    wichtig, sonst fragt der Sammler dieselben Accounts in jedem Durchlauf
    erneut ab.

    `max_batches` ist das zugeteilte Budget: der Match-Poller braucht dasselbe
    Rate-Limit, der Sammler nimmt nur, was uebrig ist.

    Returns Anzahl neu bekannter Spieler.
    """
    seen = set()
    missing = []
    for acc in account_ids or []:
        if not acc or is_bot(acc) or acc in store or acc in seen:
            continue
        seen.add(acc)
        missing.append(acc)
    if not missing:
        return 0

    found = 0
    for batch in chunk(missing)[:max_batches]:
        try:
            payload = client.get_season_batch(batch, season_id, mode)
        except Exception:
            break                    # Rate-Limit oder Netz: spaeter weiter
        rows = parse_season_batch(payload, mode)
        for acc in batch:
            if acc in rows:
                store[acc] = rows[acc]
                found += 1
            else:
                store[acc] = None    # kennt die API nicht — nicht neu fragen
    return found


# ── DB-Anbindung ────────────────────────────────────────────────────────────

def lobby_kd_for_matches(conn, tenant_id: int, match_ids, season_id: str,
                         mode: str = "squad-fpp", my_account_id=None,
                         extra_key: str = None) -> dict:
    """Je Match: Lobby-Schnitt, eigener Season-K/D, Abdeckung — plus ein
    Gesamtschnitt ueber die Matches, die genug Abdeckung haben.

    Matches, in denen weniger als ein Viertel der Lobby bekannt ist, zaehlen
    nicht in den Gesamtschnitt: ein Mittelwert aus zehn von 93 Spielern sagt
    mehr ueber unsere Sammelquote als ueber die Lobby.
    """
    from pubg import db_pg

    match_ids = [m for m in (match_ids or []) if m]
    if not match_ids:
        return {"matches": [], "avgKd": None, "seasonId": season_id,
                "mode": mode, "coverage": None}

    raw = getattr(conn, "raw", conn)
    rows = conn.execute(
        "SELECT mtm.match_id, mtm.account_id, m.played_at, m.map_name "
        "FROM match_team_mapping mtm "
        "JOIN matches m ON m.match_id = mtm.match_id "
        "               AND m.tenant_id = mtm.tenant_id "
        f"WHERE mtm.tenant_id = ? AND mtm.match_id IN "
        f"({','.join('?' * len(match_ids))})",
        [tenant_id] + list(match_ids)).fetchall()

    # Eigener Squad je Match: participants enthaelt nur das eigene Team.
    squad_rows = conn.execute(
        "SELECT match_id, account_id FROM participants "
        f"WHERE tenant_id = ? AND match_id IN "
        f"({','.join('?' * len(match_ids))})",
        [tenant_id] + list(match_ids)).fetchall()
    squad_by_match = {}
    for r in squad_rows:
        squad_by_match.setdefault(r["match_id"], set()).add(r["account_id"])

    per_match = {}
    all_accounts = set()
    for r in rows:
        mid = r["match_id"]
        entry = per_match.setdefault(mid, {"matchId": mid,
                                            "playedAt": r["played_at"],
                                            "map": r["map_name"],
                                            "accounts": []})
        entry["accounts"].append(r["account_id"])
        all_accounts.add(r["account_id"])

    if season_id == LIFETIME_KEY:
        # Alltime heisst ueber die ganze Karriere, nicht ueber einen Modus:
        # wer nur Duo spielt, haette in squad-fpp keine Zahl.
        kd_by_acc = db_pg.get_lifetime_overall(raw, list(all_accounts))
    else:
        snaps = db_pg.get_season_snapshots(raw, season_id, mode,
                                           list(all_accounts))
        kd_by_acc = {a: (v or {}).get("kd") if v else None
                     for a, v in snaps.items()}
    my_kd = kd_by_acc.get(my_account_id)

    # Zweiter Satz Zahlen (z.B. Season neben Alltime) — dieselbe Rechnung,
    # nur mit anderem Schluessel; steht in der Ansicht als Zusatzspalte.
    extra_by_acc = {}
    if extra_key:
        extra_snaps = db_pg.get_season_snapshots(raw, extra_key, mode,
                                                  list(all_accounts))
        extra_by_acc = {a: (v or {}).get("kd") if v else None
                        for a, v in extra_snaps.items()}

    out = []
    for mid, entry in per_match.items():
        squad = squad_by_match.get(mid, set())
        # Lobby heisst hier: alle ausser uns. Der eigene Squad steckte sonst
        # in beiden Seiten des Vergleichs.
        avg = lobby_average(entry["accounts"], kd_by_acc, exclude=squad)
        squad_avg = lobby_average(sorted(squad), kd_by_acc)
        extra_avg = (lobby_average(entry["accounts"], extra_by_acc,
                                    exclude=squad) if extra_key else None)
        out.append({
            "matchId": mid,
            "playedAt": entry["playedAt"],
            "map": entry["map"],
            "lobbyKd": avg["avgKd"],
            "known": avg["known"],
            "lobbyPlayers": avg["total"],
            "coverage": avg["coverage"],
            "squadKd": squad_avg["avgKd"],
            "squadKnown": squad_avg["known"],
            "squadPlayers": squad_avg["total"],
            "myKd": my_kd,
            "lobbyKdExtra": (extra_avg or {}).get("avgKd"),
            "extraCoverage": (extra_avg or {}).get("coverage"),
            "diff": (squad_avg["avgKd"] - avg["avgKd"])
                    if (squad_avg["avgKd"] is not None
                        and avg["avgKd"] is not None) else None,
        })
    out.sort(key=lambda m: m["playedAt"] or "", reverse=True)

    solid = [m for m in out if counts_for_average(m)]
    with_squad = [m for m in solid if m["squadKd"] is not None]
    return {
        "matches": out,
        "avgKd": (sum(m["lobbyKd"] for m in solid) / len(solid)) if solid else None,
        "avgSquadKd": (sum(m["squadKd"] for m in with_squad) / len(with_squad))
                      if with_squad else None,
        "matchesInAverage": len(solid),
        "myKd": my_kd,
        "seasonId": season_id,
        "mode": mode,
        "coverage": (sum(m["coverage"] or 0 for m in out) / len(out))
                    if out else None,
    }


def lobby_detail(conn, tenant_id: int, match_ids, season_id: str = LIFETIME_KEY,
                 my_account_id=None, top_n: int = 5) -> dict:
    """Aufschluesselung der Lobby je Match plus ein Gesamtbild ueber alle.

    Fuer die Detailansicht hinter der Lobby-K/D-Zahl: wer war die Spitze, wie
    weich war der Boden, wie sah der typische Gegner aus. Eigener Squad und
    Bots bleiben draussen — der Squad steckte sonst in beiden Seiten des
    Vergleichs, und Bots haben ohnehin keine Zahlen.

    Der Gesamtwert einer Phase mittelt die MATCH-Werte, statt alle Spieler in
    einen Topf zu werfen: sonst wiegt eine volle Lobby schwerer als ein kurzes
    Match, und "die staerksten Fuenf" waeren immer dieselben Ausreisser statt
    der typischen Spitze.
    """
    from pubg import db_pg

    match_ids = [m for m in (match_ids or []) if m]
    if not match_ids:
        return {"matches": [], "totals": None}

    raw = getattr(conn, "raw", conn)
    marks = ",".join("?" * len(match_ids))
    rows = conn.execute(
        "SELECT mtm.match_id, mtm.account_id, m.played_at, m.map_name "
        "FROM match_team_mapping mtm "
        "JOIN matches m ON m.match_id = mtm.match_id "
        "               AND m.tenant_id = mtm.tenant_id "
        f"WHERE mtm.tenant_id = ? AND mtm.match_id IN ({marks})",
        [tenant_id] + list(match_ids)).fetchall()
    squad_rows = conn.execute(
        f"SELECT match_id, account_id, name FROM participants "
        f"WHERE tenant_id = ? AND match_id IN ({marks})",
        [tenant_id] + list(match_ids)).fetchall()
    squad_by_match, squad_names = {}, {}
    for r in squad_rows:
        squad_by_match.setdefault(r["match_id"], set()).add(r["account_id"])
        # participants fuehrt den Namen mit — fuer die eigenen Leute ist das
        # die verlaesslichere Quelle als der players-Bestand.
        squad_names[r["account_id"]] = r["name"]

    per_match, accounts = {}, set()
    for r in rows:
        e = per_match.setdefault(r["match_id"],
                                 {"playedAt": r["played_at"],
                                  "map": r["map_name"], "accounts": []})
        e["accounts"].append(r["account_id"])
        accounts.add(r["account_id"])

    accounts.update(squad_names)
    kd_by_acc = db_pg.get_lifetime_overall(raw, list(accounts))
    names = db_pg.get_player_names(raw, tenant_id, list(accounts))
    names.update({a: n for a, n in squad_names.items() if n})

    out, strongest, weakest = [], {}, {}
    squad_seen = {}
    for mid, e in per_match.items():
        squad = squad_by_match.get(mid, set())
        lobby = [a for a in e["accounts"]
                 if a not in squad and not is_bot(a)]
        players = [(names.get(a) or a[:12], kd_by_acc.get(a)) for a in lobby]
        b = lobby_breakdown(players, top_n=top_n)
        # Die eigenen Leute mit ihrem Karriere-Wert — dieselbe Frage wie fuer
        # die Lobby, nur andersherum: wer sitzt eigentlich im eigenen Auto.
        mates = []
        for a in sorted(squad, key=lambda x: -(kd_by_acc.get(x) or -1)):
            mates.append({"name": names.get(a) or a[:12], "kd": kd_by_acc.get(a),
                          "accountId": a})
            agg = squad_seen.setdefault(a, {"name": names.get(a) or a[:12],
                                            "kd": kd_by_acc.get(a),
                                            "matches": 0})
            agg["matches"] += 1
        known_mates = [m["kd"] for m in mates if m["kd"] is not None]
        b.update({"matchId": mid, "playedAt": e["playedAt"], "map": e["map"],
                  "lobbyPlayers": len(lobby),
                  "coverage": (100.0 * b["known"] / len(lobby)) if lobby else None,
                  "squad": mates,
                  "squadKnown": len(known_mates),
                  "squadAvg": (sum(known_mates) / len(known_mates))
                              if known_mates else None})
        out.append(b)
        for a in lobby:
            kd = kd_by_acc.get(a)
            if kd is None:
                continue
            entry = {"name": names.get(a) or a[:12], "kd": kd,
                     "matchId": mid, "playedAt": e["playedAt"]}
            prev = strongest.get(a)
            if prev is None or kd > prev["kd"]:
                strongest[a] = entry
            prev = weakest.get(a)
            if prev is None or kd < prev["kd"]:
                weakest[a] = entry
    out.sort(key=lambda m: m["playedAt"] or "", reverse=True)

    # Nur Matches mit brauchbarer Abdeckung tragen zum Gesamtbild bei.
    solid = [m for m in out
             if counts_for_average({"coverage": m["coverage"],
                                    "lobbyPlayers": m["lobbyPlayers"],
                                    "lobbyKd": m["avg"]})]

    def _avg(key):
        vals = [m[key] for m in solid if m.get(key) is not None]
        return (sum(vals) / len(vals)) if vals else None

    totals = {
        "matches": len(out),
        "matchesInAverage": len(solid),
        "avg": _avg("avg"),
        "median": _avg("median"),
        "topAvg": _avg("topAvg"),
        "lowAvg": _avg("lowAvg"),
        "max": max((m["max"] for m in solid if m["max"] is not None),
                   default=None),
        # Namentlich die Extreme der ganzen Phase — der Schnitt sagt nicht,
        # ob da ein Hai drin sass.
        "strongest": sorted(strongest.values(), key=lambda p: -p["kd"])[:top_n],
        "weakest": sorted(weakest.values(), key=lambda p: p["kd"])[:top_n],
        # Ueber die Phase: jeder, der mitgespielt hat, mit seiner Karriere-K/D
        # und der Zahl der Runden — wer nur zwei Matches dabei war, faellt so
        # auf, statt den Eindruck zu praegen.
        "squad": sorted(squad_seen.values(),
                        key=lambda p: (-(p["kd"] or -1), -p["matches"])),
        "squadAvg": _avg("squadAvg"),
    }
    return {"matches": out, "totals": totals, "seasonId": season_id,
            "topN": top_n}
