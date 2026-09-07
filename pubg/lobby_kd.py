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


#: Mindest-Runden, ab denen eine Stufe der Fallback-Kette gilt. Darunter ist
#: der Wert Rauschen: auf prod stand ein Account mit 20 Kills aus ZWEI
#: Solo-Runden als "20er K/D" an der Spitze einer Lobby — in squad-fpp hatte
#: derselbe Spieler 0,43 aus 49 Runden.
#:
#: Stand 2026-09-07 von 50 auf 20 gesenkt. Wirkung auf die Abdeckung ist
#: gering (gemessen 292 von 82.404 Accounts liegen zwischen 20 und 49
#: Runden), aber der engere Modus gewinnt damit oefter gegen die
#: Perspektiv-Summe — und 0,43 aus 49 squad-fpp-Runden ist die praezisere
#: Auskunft als 0,82 aus 51 Runden, in denen zwei Solo-Ausreisser stecken.
#: MIN_KD_SHARE haelt weiter dagegen, dass eine Handvoll Runden die
#: Haupt-Bilanz schlaegt.
MIN_KD_ROUNDS = 20
#: Zusaetzlich muss eine Stufe einen nennenswerten Teil der Karriere abdecken.
#: Ohne das schlaegt eine Handvoll Third-Person-Runden die Haupt-Bilanz: bei
#: einem Solo-Match fiel die Rechnung auf 25 TPP-Runden zurueck (4,74),
#: obwohl daneben 10.663 Runden squad-fpp mit 1,50 standen.
MIN_KD_SHARE = 0.10
#: Untergrenze fuer die letzte Stufe (alle Modi zusammen). Die lag auf 1 —
#: "lieber irgendein Wert als ein leeres Feld". Das kippt bei Neulingen: ein
#: Spieler mit EINER Runde (0 Kills, 1 Tod) stand mit K/D 0,00 in der Lobby
#: und zog den Schnitt runter, obwohl eine Runde ueber niemanden etwas sagt.
#: Bei 10 Runden ist der Wert wenigstens kein Muenzwurf mehr. In einer
#: gemessenen 96er-Lobby betraf das 6 Spieler.
MIN_KD_ROUNDS_TOTAL = 10
#: Perspektive schlaegt Modus: First-Person und Third-Person sind zwei
#: verschiedene Spiele, ein TPP-Wert sagt ueber einen FPP-Gegner wenig.
FPP_MODES = ("solo-fpp", "duo-fpp", "squad-fpp")
TPP_MODES = ("solo", "duo", "squad")


#: Alle Modi, die es als Season-Snapshot geben kann. Der Season-Endpoint
#: nimmt den Modus im Pfad (`/gameMode/{mode}/players`), holt also je Call
#: nur einen — anders als der Lifetime-Abruf, der alle sechs mitbringt.
SEASON_MODES = FPP_MODES + TPP_MODES


def rotating_season_mode(tenant_id: int, minute: int = None) -> str:
    """Welchen Modus dieser Tenant gerade sammelt.

    Fest auf squad-fpp verdrahtet blieben die anderen fuenf Modi leer: ein
    Gegner aus einem Duo-Match hatte dann squad-Werte oder gar keine. Die
    Rotation kostet nichts extra — es ist derselbe eine Call je Tick, nur
    abwechselnd fuer einen anderen Modus.

    Der Tenant-Versatz sorgt dafuer, dass die Keys nicht alle gleichzeitig
    denselben Modus holen: Snapshots sind global, doppelte Arbeit waere
    verschenkte Kapazitaet.
    """
    if minute is None:
        import datetime as _dt
        minute = _dt.datetime.now(_dt.UTC).minute
    return SEASON_MODES[(minute + (tenant_id or 0)) % len(SEASON_MODES)]


def _sum_modes(per_mode, modes):
    kills = losses = rounds = 0
    for m in modes:
        st = (per_mode or {}).get(m)
        if not st:
            continue
        kills += st.get("kills") or 0
        losses += st.get("losses") or 0
        rounds += st.get("rounds") or 0
    return kills, losses, rounds


def _kd_if_enough(kills, losses, rounds, min_rounds, total_rounds=0):
    if rounds < min_rounds:
        return None
    if total_rounds and rounds < total_rounds * MIN_KD_SHARE:
        return None
    return _kd(kills, losses, rounds)


def _narrow_basis(per_mode, modes, basis):
    """Sammelbasis auf den einen Modus zurueckfuehren, der sie ausmacht.

    "alle FPP" behauptet eine Zusammenfassung. Steuert faktisch nur ein
    Modus Runden bei, ist das eine falsche Auskunft: ein Spieler mit 67
    Runden squad-fpp und sonst nichts stand in einem duo-fpp-Match als
    "alle FPP" da. Dann wird der Modus genannt, der es wirklich ist.
    """
    if basis not in ("fpp", "tpp", "all"):
        return basis
    used = [m for m in modes if ((per_mode or {}).get(m) or {}).get("rounds")]
    return used[0] if len(used) == 1 else basis


def kd_for_mode(per_mode, mode: str, min_rounds: int = MIN_KD_ROUNDS) -> dict:
    """K/D eines Spielers aus der Sicht des gespielten Modus.

    Drei Stufen, jede erst wenn die vorige zu duenn ist:
      1. der Modus selbst (squad-fpp gegen squad-fpp)
      2. dieselbe Perspektive (FPP bzw. TPP zusammengefasst)
      3. alles zusammen

    Vorher wurde immer sofort alles summiert. Das ergab Werte wie 20,0 aus
    zwei Solo-Runden, waehrend derselbe Spieler in squad-fpp bei 0,43 stand —
    und genau in squad-fpp trifft man ihn.

    Returns {"kd", "basis", "rounds"} — `basis` sagt, worauf der Wert beruht
    (Modusname, "fpp", "tpp", "all" oder None).
    """
    group = FPP_MODES if (mode or "").endswith("-fpp") else TPP_MODES
    all_modes = tuple(per_mode or ())
    _, _, total = _sum_modes(per_mode, all_modes)
    steps = ((mode, (mode,)) if mode else (None, ()),
             ("fpp" if group is FPP_MODES else "tpp", group),
             ("all", all_modes))
    for basis, modes in steps:
        if not modes:
            continue
        kills, losses, rounds = _sum_modes(per_mode, modes)
        # Die letzte Stufe ist die ganze Karriere — dort greift die
        # Anteils-Regel nicht, wohl aber eine eigene Untergrenze: unter
        # MIN_KD_ROUNDS_TOTAL Runden ist der Wert Rauschen (siehe dort).
        effective_min = (MIN_KD_ROUNDS_TOTAL if basis == "all"
                         else min_rounds)
        kd = _kd_if_enough(kills, losses, rounds, effective_min,
                           0 if basis == "all" else total)
        if kd is not None:
            return {"kd": kd, "basis": _narrow_basis(per_mode, modes, basis),
                    "rounds": rounds}
    _, _, rounds = _sum_modes(per_mode, tuple(per_mode or ()))
    return {"kd": None, "basis": None, "rounds": rounds}



def kd_with_fallback(season_per_mode, lifetime_per_mode, mode: str,
                     min_rounds: int = MIN_KD_ROUNDS) -> dict:
    """K/D mit verschraenkter Season-/Lifetime-Fallback-Kette.

    Reihenfolge:
      1. Season   gleicher Modus
      2. Lifetime  gleicher Modus
      3. Season   gleiche Perspektive (FPP oder TPP)
      4. Lifetime  gleiche Perspektive
      5. Season   alle Modes (ab MIN_KD_ROUNDS_TOTAL Runden)
      6. Lifetime  alle Modes (ab MIN_KD_ROUNDS_TOTAL Runden)
    """
    group = FPP_MODES if (mode or "").endswith("-fpp") else TPP_MODES

    def _try(per_mode, modes, eff_min):
        if not per_mode or not modes:
            return None
        _, _, total = _sum_modes(per_mode, tuple(per_mode))
        kills, losses, rounds = _sum_modes(per_mode, modes)
        kd = _kd_if_enough(kills, losses, rounds, eff_min,
                            0 if eff_min == MIN_KD_ROUNDS_TOTAL else total)
        return {"kd": kd, "basis": None, "rounds": rounds} if kd is not None else None

    s_all = tuple(season_per_mode or ())
    l_all = tuple(lifetime_per_mode or ())
    steps = [
        (season_per_mode,   (mode,) if mode else (), min_rounds),
        (lifetime_per_mode, (mode,) if mode else (), min_rounds),
        (season_per_mode,   group,                   min_rounds),
        (lifetime_per_mode, group,                   min_rounds),
        (season_per_mode,   s_all,   MIN_KD_ROUNDS_TOTAL),
        (lifetime_per_mode, l_all,   MIN_KD_ROUNDS_TOTAL),
    ]
    for per_mode, modes, eff_min in steps:
        res = _try(per_mode, modes, eff_min)
        if res:
            return res
    _, _, rounds = _sum_modes(lifetime_per_mode, l_all)
    return {"kd": None, "basis": None, "rounds": rounds}


def _newest_season_id(raw_conn):
    """Hoechste bekannte season_id — gilt als die laufende Season.

    Die API-Abfrage der aktuellen Season kostet Rate-Limit; die hoechste
    gesammelte season_id ist derselbe Wert, solange ueberhaupt gesammelt
    wird. Faellt auf None zurueck, dann behandelt kd_resolved schlicht
    die neueste vorhandene je Account als aktuell.
    """
    try:
        with raw_conn.cursor() as cur:
            cur.execute("SELECT MAX(season_id) AS sid "
                        "FROM player_season_snapshot "
                        "WHERE season_id <> 'lifetime'")
            row = cur.fetchone()
        return (row["sid"] if row and "sid" in row.keys() else None) or None
    except Exception:
        return None


def kd_resolved(mode: str, current_season=None, last_seasons=None,
                lifetime=None, min_rounds: int = MIN_KD_ROUNDS,
                current_season_id: str = None) -> dict:
    """K/D eines Spielers — feste Quellen-Reihenfolge (Stand 2026-09-07).

    `mode` ist die Spielart des Matches inklusive Perspektive, also
    "squad-fpp", "duo-fpp", "solo" usw. POV meint die zugehoerige Gruppe:
    alle FPP-Modi bzw. alle TPP-Modi.

      1. aktueller Modus, aktuelle Season
      2. aktueller Modus, letzte bekannte Season — und wenn die zu duenn
         ist, weiter rueckwaerts, bis eine Season im Modus genug Runden
         hat. Reicht keine, geht es zu Stufe 3.
      3. aktueller Modus, Lifetime
      4. POV,             aktuelle Season
      5. POV,             Lifetime
      6. alle Modi,       Lifetime

    Modus-Genauigkeit geht also vor Aktualitaet: der exakte Modus aus
    Lifetime (3) schlaegt die POV-Summe der laufenden Season (4).

    Auf POV-Ebene wird die letzte Season bewusst NICHT geprueft, und
    "alle Modi" gibt es nur aus Lifetime — so festgelegt.

    Vorher hatte Lifetime durchgaengig Vorrang und Season war blosse
    Ersatzquelle; eine "letzte bekannte Season" gab es nicht.

    `last_seasons` ist eine absteigend sortierte Liste von
    (season_id, per_mode)-Paaren — alle Seasons ausser der aktuellen.

    Returns {"kd", "basis", "rounds", "source", "seasonId"}. `source` ist
    "season", "lifetime" oder None; `seasonId` steht nur an Season-Werten.
    """
    group = FPP_MODES if (mode or "").endswith("-fpp") else TPP_MODES
    mode_tuple = (mode,) if mode else ()
    # Karriere-Gesamtrunden als Bezugsgroesse: 230 Season-Runden von 7000
    # Alltime sagen mehr aus als 230 allein.
    _, _, lifetime_rounds = _sum_modes(lifetime, tuple(lifetime or ()))

    # (Quelle, Daten, Modus-Auswahl, Mindestrunden, Anteilsregel?, season_id)
    steps = [
        ("season",   current_season, mode_tuple, min_rounds, True,
         current_season_id),
    ]
    # Stufe 2: rueckwaerts durch die aelteren Seasons, bis eine traegt.
    for _sid, _data in (last_seasons or []):
        steps.append(("season", _data, mode_tuple, min_rounds, True, _sid))
    steps += [
        ("lifetime", lifetime,       mode_tuple, min_rounds, True, None),
        ("season",   current_season, group,      min_rounds, True,
         current_season_id),
        ("lifetime", lifetime,       group,      min_rounds, True, None),
        ("lifetime", lifetime,       None,       MIN_KD_ROUNDS_TOTAL, False,
         None),
    ]

    for source, per_mode, modes, eff_min, use_share, sid in steps:
        if not per_mode:
            continue
        # None = alle Modi, die der Datensatz kennt.
        sel = tuple(per_mode) if modes is None else modes
        if not sel:
            continue
        kills, losses, rounds = _sum_modes(per_mode, sel)
        total = 0
        if use_share:
            _, _, total = _sum_modes(per_mode, tuple(per_mode))
        kd = _kd_if_enough(kills, losses, rounds, eff_min, total)
        if kd is None:
            continue
        basis = mode if modes is mode_tuple and mode else (
            "all" if modes is None else
            ("fpp" if group is FPP_MODES else "tpp"))
        return {
            "kd":             kd,
            "basis":          _narrow_basis(per_mode, sel, basis),
            "rounds":         rounds,
            "lifetimeRounds": lifetime_rounds,
            "source":         source,
            "seasonId":       sid if source == "season" else None,
        }

    rounds = 0
    for per_mode in ([current_season]
                     + [d for _, d in (last_seasons or [])]
                     + [lifetime]):
        if per_mode:
            _, _, rounds = _sum_modes(per_mode, tuple(per_mode))
            if rounds:
                break
    return {"kd": None, "basis": None, "rounds": rounds,
            "lifetimeRounds": lifetime_rounds,
            "source": None, "seasonId": None}


def kd_alltime(lifetime_per_mode, season_per_mode, mode: str,
               min_rounds: int = MIN_KD_ROUNDS, season_id: str = None) -> dict:
    """Alltime-K/D mit Season als Ersatzquelle.

    Nicht jeder Lobby-Spieler hat eine `lifetime`-Zeile im Snapshot — die
    kommt aus einem eigenen API-Call, der oft noch aussteht. Season-Werte
    liegen dagegen fast immer vor. Ohne diesen Rueckfall galten solche
    Spieler als unbekannt: in einem gemessenen Duo-Match hatten 52 von 96
    eine Lifetime-Zeile, die uebrigen 44 aber zusammen 1.969 Season-Runden.

    Lifetime hat Vorrang — der Wert heisst Alltime. Erst wenn dort nichts
    zu holen ist, zaehlt die Season. Innerhalb jeder Quelle gilt dieselbe
    Kette wie sonst: gespielter Modus > gleiche Perspektive > alles.

    Returns {"kd", "basis", "rounds", "source", "seasonId"}; `source` ist
    "lifetime", "season" oder None und gehoert sichtbar an den Wert — ein
    Season-K/D ist etwas anderes als ein Karriere-K/D. `seasonId` steht nur
    am Season-Wert, damit der Zeitraum mit angezeigt werden kann.
    """
    for source, per_mode in (("lifetime", lifetime_per_mode),
                             ("season",   season_per_mode)):
        if not per_mode:
            continue
        res = kd_for_mode(per_mode, mode, min_rounds)
        if res["kd"] is not None:
            return {**res, "source": source,
                    "seasonId": season_id if source == "season" else None}
    rounds = 0
    for per_mode in (lifetime_per_mode, season_per_mode):
        if per_mode:
            _, _, rounds = _sum_modes(per_mode, tuple(per_mode))
            if rounds:
                break
    return {"kd": None, "basis": None, "rounds": rounds,
            "source": None, "seasonId": None}


def kd_by_perspective(per_mode, min_rounds: int = MIN_KD_ROUNDS) -> dict:
    """{"fpp": {...}, "tpp": {...}, "all": {...}} — zum Nebeneinanderstellen."""
    out = {}
    for key, modes in (("fpp", FPP_MODES), ("tpp", TPP_MODES),
                       ("all", tuple(per_mode or ()))):
        kills, losses, rounds = _sum_modes(per_mode, modes)
        out[key] = {"kd": _kd_if_enough(kills, losses, rounds, min_rounds),
                    "rounds": rounds, "kills": kills, "losses": losses}
    return out


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

    `players` = [(name, kd)] oder [(name, kd, info)], wobei `info` die
    Herkunft des Werts traegt (Modus/Perspektive und Rundenzahl). Unbekannte
    gehoeren nicht hinein.

    Der Median steht neben dem Schnitt, weil K/D bei 0 endet und nach oben
    offen ist — der Schnitt haengt an den wenigen Starken. Gemessen an prod
    sind das allerdings nur 0,05 bis 0,10 Unterschied; die Aussage steckt in
    Top gegen Low (2,45 gegen 0,51 in einer typischen Lobby).

    Bei wenigen Bekannten werden die Raender gekuerzt, damit sich Top und Low
    nicht ueberlappen und derselbe Spieler nicht auf beiden Seiten steht.
    """
    vals = sorted(((p[0], p[1], p[2] if len(p) > 2 else {})
                   for p in (players or []) if p[1] is not None),
                  key=lambda p: p[1])
    if not vals:
        return {"known": 0, "avg": None, "median": None, "max": None,
                "top": [], "low": [], "topAvg": None, "lowAvg": None}
    kds = [k for _, k, _ in vals]
    n = min(top_n, len(vals) // 2) or (1 if len(vals) == 1 else 0)

    def _entry(row):
        nm, k, info = row
        return {"name": nm, "kd": k, "basis": (info or {}).get("basis"),
                "rounds": (info or {}).get("rounds"),
                "lifetimeRounds": (info or {}).get("lifetimeRounds"),
                "source": (info or {}).get("source"),
                "seasonId": (info or {}).get("seasonId")}

    top = [_entry(r) for r in reversed(vals[len(vals) - n:])]
    low = [_entry(r) for r in vals[:n]]
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
        "SELECT mtm.match_id, mtm.account_id, m.played_at, m.map_name, "
        "       m.game_mode "
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
                                            "mode": r["game_mode"],
                                            "accounts": []})
        entry["accounts"].append(r["account_id"])
        all_accounts.add(r["account_id"])

    # Alle drei Quellen fuer ALLE Accounts laden — kd_resolved braucht sie
    # nebeneinander. Season vorher nur fuer Accounts ohne Lifetime-Zeile zu
    # holen war eine Luecke: wer eine duenne Lifetime-Zeile hatte, blieb
    # unbekannt, obwohl Season-Werte vorlagen.
    lifetime_by_mode = db_pg.get_lifetime_by_mode(raw, list(all_accounts))
    cur_season_id = _newest_season_id(raw)
    cur_season_by_mode, older_seasons_by_acc = (
        db_pg.get_season_split_by_mode(raw, list(all_accounts),
                                        current_season_id=cur_season_id))

    by_mode = {}
    if season_id == LIFETIME_KEY:
        # Alltime heisst ueber die ganze Karriere — aber gemessen wird am
        # Modus, in dem man sich begegnet ist (Rueckfall: gleiche Perspektive,
        # dann alles). Sonst steht ein Spieler mit 20 Kills aus zwei
        # Solo-Runden als 20er-K/D in einer squad-fpp-Lobby, wo er 0,43 hat.
        by_mode = lifetime_by_mode
        kd_by_acc = {}
    else:
        # Alle Modes der Season laden — kd_for_mode macht dann den Fallback:
        # gleicher Modus > gleiche Perspektive > Gesamt-Season > Lifetime.
        by_mode = db_pg.get_season_by_mode(raw, season_id, list(all_accounts))
        kd_by_acc = {}
    my_kd = None
    if my_account_id:
        my_kd = kd_resolved(
            mode,
            current_season=cur_season_by_mode.get(my_account_id),
            last_seasons=older_seasons_by_acc.get(my_account_id),
            lifetime=lifetime_by_mode.get(my_account_id),
            current_season_id=cur_season_id)["kd"]

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
        if by_mode is not None:
            m_hint = entry.get("mode")
            kd_by_acc = {}
            for a in set(entry["accounts"]) | set(squad):
                kd_by_acc[a] = kd_resolved(
                    m_hint,
                    current_season=cur_season_by_mode.get(a),
                    last_seasons=older_seasons_by_acc.get(a),
                    lifetime=lifetime_by_mode.get(a),
                    current_season_id=cur_season_id)["kd"]
        # Lobby heisst hier: alle ausser uns. Der eigene Squad steckte sonst
        # in beiden Seiten des Vergleichs.
        avg = lobby_average(entry["accounts"], kd_by_acc, exclude=squad)
        squad_avg = lobby_average(sorted(squad), kd_by_acc)
        # Die Spitze der Lobby als eigener Wert: der Schnitt sagt nicht, ob
        # oben fuenf Haie sassen. Der Report markiert damit harte Runden.
        top_kds = sorted((kd_by_acc.get(a) for a in entry["accounts"]
                          if a not in squad and not is_bot(a)
                          and kd_by_acc.get(a) is not None), reverse=True)[:5]
        top5 = (sum(top_kds) / len(top_kds)) if top_kds else None
        extra_avg = (lobby_average(entry["accounts"], extra_by_acc,
                                    exclude=squad) if extra_key else None)
        out.append({
            "matchId": mid,
            "playedAt": entry["playedAt"],
            "map": entry["map"],
            "lobbyKd": avg["avgKd"],
            "lobbyTop5": top5,
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
        "SELECT mtm.match_id, mtm.account_id, m.played_at, m.map_name, "
        "       m.game_mode "
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
                                  "map": r["map_name"],
                                  "mode": r["game_mode"], "accounts": []})
        e["accounts"].append(r["account_id"])
        accounts.add(r["account_id"])

    accounts.update(squad_names)
    by_mode = db_pg.get_lifetime_by_mode(raw, list(accounts))
    # Wer keine Lifetime-Zeile hat, wird mit seiner Season gemessen statt
    # als unbekannt zu gelten — die Herkunft steht als `source` am Wert.
    _cur_sid = _newest_season_id(raw)
    cur_season_by_mode, older_by_acc = (
        db_pg.get_season_split_by_mode(raw, list(accounts),
                                        current_season_id=_cur_sid))
    names = db_pg.get_player_names(raw, tenant_id, list(accounts))
    names.update({a: n for a, n in squad_names.items() if n})

    out, strongest, weakest = [], {}, {}
    squad_seen = {}
    for mid, e in per_match.items():
        squad = squad_by_match.get(mid, set())
        lobby = [a for a in e["accounts"]
                 if a not in squad and not is_bot(a)]
        # Gemessen wird am Modus, in dem man sich begegnet ist — mit Rueckfall
        # auf dieselbe Perspektive und erst zuletzt auf alles.
        kd_by_acc = {a: kd_resolved(
                            e.get("mode"),
                            current_season=cur_season_by_mode.get(a),
                            last_seasons=older_by_acc.get(a),
                            lifetime=by_mode.get(a),
                            current_season_id=_cur_sid)
                     for a in set(lobby) | set(squad)}
        players = [(names.get(a) or a[:12], (kd_by_acc.get(a) or {}).get("kd"),
                    kd_by_acc.get(a) or {}) for a in lobby]
        b = lobby_breakdown(players, top_n=top_n)
        # Die eigenen Leute mit ihrem Karriere-Wert — dieselbe Frage wie fuer
        # die Lobby, nur andersherum: wer sitzt eigentlich im eigenen Auto.
        mates = []
        for a in sorted(squad, key=lambda x: -((kd_by_acc.get(x) or {}).get("kd")
                                               or -1)):
            info = kd_by_acc.get(a) or {}
            mates.append({"name": names.get(a) or a[:12], "kd": info.get("kd"),
                          "basis": info.get("basis"), "rounds": info.get("rounds"),
                          "source": info.get("source"),
                          "lifetimeRounds": info.get("lifetimeRounds"),
                          "seasonId": info.get("seasonId"), "accountId": a})
            agg = squad_seen.setdefault(a, {"name": names.get(a) or a[:12],
                                            "kd": info.get("kd"),
                                            "basis": info.get("basis"),
                                            "rounds": info.get("rounds"),
                                            "source": info.get("source"),
                                            "lifetimeRounds": info.get("lifetimeRounds"),
                                            "seasonId": info.get("seasonId"),
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
            info = kd_by_acc.get(a) or {}
            kd = info.get("kd")
            if kd is None:
                continue
            entry = {"name": names.get(a) or a[:12], "kd": kd,
                     "basis": info.get("basis"), "rounds": info.get("rounds"),
                     "source": info.get("source"),
                     "lifetimeRounds": info.get("lifetimeRounds"),
                     "seasonId": info.get("seasonId"),
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
