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

    done = 0
    for acc in todo[:max_calls]:
        try:
            rows = parse_lifetime(client.get_lifetime(acc))
        except Exception:
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

    snaps = db_pg.get_season_snapshots(raw, season_id, mode, list(all_accounts))
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

    solid = [m for m in out if (m["coverage"] or 0) >= 25 and m["lobbyKd"]]
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
