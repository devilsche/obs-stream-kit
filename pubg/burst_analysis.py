"""Feuerstoss-Metriken aus der Roh-Telemetrie.

**Wozu.** Die Trefferquote sagt, wie viele Schuesse ankommen, aber nicht
WANN im Feuerstoss. Zwei Spieler mit derselben Quote koennen sehr
verschieden zielen: der eine setzt den ersten Schuss ins Ziel, der andere
zieht drei Schuesse lang nach. Genau diesen Unterschied macht
Crosshair-Placement, und genau den misst dieses Modul — als Index des
ersten Treffers in einem Feuerstoss.

**Warum aus den ROHEN Events.** `telemetry_events` speichert nur
Squad-Events (siehe `filter_squad_events` im Poller), also rund zwei
Schuetzen je Match. Die Rohtelemetrie hat alle ~90 — nur damit gibt es
eine Vergleichsgruppe, die diesen Namen verdient.

**Der Bias, den die Rolle kontrolliert.** Wer aus dem Hinterhalt
eroeffnet, hat den Erstschuss-Treffer leichter als wer auf einen bereits
schiessenden Gegner antwortet. Ohne Trennung misst die Zahl also
mindestens so viel Spielweise wie Zielverhalten. Darum zaehlt jeder
Feuerstoss in genau einen von zwei Toepfen: `initiated` (in den letzten
REACT_WINDOW_S kein Feuerschaden genommen) oder `reacting`.
"""
from collections import defaultdict

from pubg.telemetry_analysis import (_parse_ts, is_gun_damage,
                                     normalize_weapon)

#: Pause, ab der ein neuer Feuerstoss beginnt. Darunter liegt
#: Dauerfeuer und halbautomatisches Nachsetzen, darueber ein neues
#: Anvisieren — und nur dessen erster Schuss sagt etwas ueber die
#: Visierlage aus.
BURST_GAP_S = 1.5

#: Nachlaufzeit zwischen Schuss und Einschlag. Projektile fliegen: ein
#: Kar98k-Treffer auf 300 m landet gut eine halbe Sekunde spaeter. Ohne
#: dieses Fenster gilt jeder Weitschuss als Fehlschlag.
HIT_LAG_S = 0.8

#: Wie lange eingehender Feuerschaden einen Feuerstoss zur Antwort macht.
REACT_WINDOW_S = 10.0

ROLES = ("initiated", "reacting")

#: Spaltennamen in match_weapon_stats, je Rolle.
ROW_FIELDS = {
    "initiated": {"bursts": "bursts_init", "hitBursts": "hit_bursts_init",
                  "firstShotHits": "first_shot_init",
                  "hitIndexSum": "hit_index_sum_init",
                  "shotsAfterHit": "shots_after_hit_init",
                  "hitsAfterHit": "hits_after_hit_init"},
    "reacting": {"bursts": "bursts_react", "hitBursts": "hit_bursts_react",
                 "firstShotHits": "first_shot_react",
                 "hitIndexSum": "hit_index_sum_react",
                 "shotsAfterHit": "shots_after_hit_react",
                 "hitsAfterHit": "hits_after_hit_react"},
}


def split_bursts(times, gap=BURST_GAP_S):
    """Schusszeiten in Feuerstoesse trennen.

    Die Grenze ist inklusiv: genau `gap` Pause gehoert noch zum Stoss,
    sonst zerfaellt halbautomatisches Feuer am Grenzwert in Einzelstoesse.
    """
    clean = sorted(t for t in (times or []) if t is not None)
    out = []
    for t in clean:
        if out and t - out[-1][-1] <= gap:
            out[-1].append(t)
        else:
            out.append([t])
    return out


def first_hit_index(burst, hit_times, lag=HIT_LAG_S):
    """1-basierter Index des Schusses, der als erster traf. None ohne
    Treffer.

    Zugeordnet wird der letzte Schuss VOR dem Einschlag — bei Dauerfeuer
    ist das die einzige Zuordnung, die die Telemetrie hergibt.
    """
    if not burst:
        return None
    lo, hi = burst[0], burst[-1] + lag
    for h in sorted(t for t in (hit_times or []) if t is not None):
        if h < lo:
            continue
        if h > hi:
            return None
        idx = sum(1 for s in burst if s <= h)
        return max(1, min(idx, len(burst)))
    return None


def hits_after_first(burst, hit_times, lag=HIT_LAG_S):
    """(Schuesse nach dem ersten Treffer, Treffer darunter).

    Trennt zwei Faehigkeiten, die die Trefferquote zusammenwirft: bis zum
    ersten Treffer entscheidet die Visierlage, danach Rueckstosskontrolle
    und Nachfuehren. Ein Spieler kann das Ziel schlecht finden und gut
    halten — oder umgekehrt.
    """
    idx = first_hit_index(burst, hit_times, lag)
    if idx is None or not burst:
        return (0, 0)
    rest = burst[idx:]
    if not rest:
        return (0, 0)
    lo, hi = rest[0], burst[-1] + lag
    got = sum(1 for h in (hit_times or [])
              if h is not None and lo <= h <= hi)
    # Nie mehr Treffer als Schuesse: bei Schrot meldet die Telemetrie ein
    # Ereignis je Pellet, das wuerde sonst ueber 100 % ergeben.
    return (len(rest), min(got, len(rest)))


def role_of(burst_start, damage_taken, window=REACT_WINDOW_S):
    """`reacting`, wenn der Spieler kurz vor dem Stoss Feuerschaden nahm.

    Siehe Modul-Docstring: ohne diese Trennung misst die Metrik
    mindestens so viel Spielweise wie Zielverhalten.
    """
    for t in (damage_taken or []):
        if t is None:
            continue
        if burst_start - window <= t <= burst_start:
            return "reacting"
    return "initiated"


def _blank():
    return {"bursts": 0, "hitBursts": 0, "firstShotHits": 0, "hitIndexSum": 0,
            "shotsAfterHit": 0, "hitsAfterHit": 0}


def analyse_bursts(events):
    """{Spielername: {Waffe: {Rolle: Kennzahlen}}} aus einer Event-Liste.

    Waffen-IDs werden normalisiert, weil `LogPlayerAttack`
    "Item_Weapon_HK416_C" meldet und `LogPlayerTakeDamage`
    "WeapHK416_C" — ohne das findet kein Treffer je seinen Schuss.
    """
    shots = defaultdict(list)        # (name, weapon) -> Zeiten
    hits = defaultdict(list)         # (name, weapon) -> Zeiten
    taken = defaultdict(list)        # name -> Zeiten eingehenden Feuers

    for e in events or []:
        typ = e.get("_T")
        if typ == "LogPlayerAttack":
            who = (e.get("attacker") or {}).get("name")
            wid = normalize_weapon((e.get("weapon") or {}).get("itemId"))
            t = _parse_ts(e.get("_D"))
            if who and wid and t is not None:
                shots[(who, wid)].append(t)
        elif typ == "LogPlayerTakeDamage":
            # Zonenschaden und Sturz sind keine Treffer und markieren auch
            # keine Reaktion — sonst gilt jeder Stoss nach einem
            # Blue-Zone-Tick als Antwort auf Feindfeuer.
            if not is_gun_damage(e.get("damageTypeCategory")):
                continue
            t = _parse_ts(e.get("_D"))
            if t is None:
                continue
            att = (e.get("attacker") or {}).get("name")
            vic = (e.get("victim") or {}).get("name")
            wid = normalize_weapon(e.get("damageCauserName"))
            if att and wid:
                hits[(att, wid)].append(t)
            if vic:
                taken[vic].append(t)

    out = {}
    for (who, wid), times in shots.items():
        per_role = out.setdefault(who, {}).setdefault(
            wid, {r: _blank() for r in ROLES})
        hit_times = hits.get((who, wid), [])
        for burst in split_bursts(times):
            slot = per_role[role_of(burst[0], taken.get(who))]
            slot["bursts"] += 1
            idx = first_hit_index(burst, hit_times)
            if idx is None:
                continue
            slot["hitBursts"] += 1
            slot["hitIndexSum"] += idx
            if idx == 1:
                slot["firstShotHits"] += 1
            sa, ha = hits_after_first(burst, hit_times)
            slot["shotsAfterHit"] += sa
            slot["hitsAfterHit"] += ha
    return out


def to_row_fields(stat):
    """Beide Rollen zu den acht Spalten von match_weapon_stats flachen."""
    row = {}
    for role, cols in ROW_FIELDS.items():
        src = (stat or {}).get(role) or {}
        for key, col in cols.items():
            row[col] = int(src.get(key) or 0)
    return row


def first_shot_pct(hit_bursts, first_shot_hits):
    """Anteil der Treffer-Stoesse, bei denen schon Schuss 1 sass.

    Nenner sind die Stoesse MIT Treffer, nicht alle: ein Stoss ohne
    jeden Treffer sagt nichts ueber die Visierlage, sondern ueber die
    Trefferquote — die steht schon in einer eigenen Spalte.
    """
    return (100.0 * first_shot_hits / hit_bursts) if hit_bursts else None


def avg_hit_index(hit_bursts, hit_index_sum):
    """Der wievielte Schuss traf im Schnitt zuerst. Niedriger ist besser."""
    return (hit_index_sum / hit_bursts) if hit_bursts else None


def follow_up_pct(shots_after_hit, hits_after_hit):
    """Trefferquote der Schuesse NACH dem ersten Treffer.

    Das Ziel ist gefunden und steht im Visier — was hier fehlt, ist
    Rueckstosskontrolle und Nachfuehren, nicht Visierlage.
    """
    return ((100.0 * hits_after_hit / shots_after_hit)
            if shots_after_hit else None)


# ---------------------------------------------------------------------------
# Auswertung: Klassen falten und gegen die Lobby stellen
# ---------------------------------------------------------------------------

#: Ab so vielen Treffer-Stoessen traegt eine Zeile ihre Quote. Darunter
#: bleibt sie sichtbar, aber als duenn markiert — dieselbe Haltung wie bei
#: den Landing Spots: die Zahl verschweigen hilft nicht, sie als Befund
#: auszugeben auch nicht.
RELIABLE_HIT_BURSTS = 20

#: Unter so wenigen Treffer-Stoessen wird KEINE Quote gebildet. "1 von 1
#: Stoessen traf mit dem ersten Schuss" ergibt 100 % und liest sich als
#: Befund, obwohl es eine einzige Beobachtung ist. Die Rohzahl sagt
#: dasselbe, ohne etwas zu behaupten.
MIN_RATE_HIT_BURSTS = 5

#: Mindestzahl fuer einen Spieler in der Perzentil-Gruppe. Bewusst
#: niedriger als RELIABLE_HIT_BURSTS: Rauschen im Einzelwert verbreitert
#: die Verteilung, verschiebt den Median aber kaum — und eine strenge
#: Schwelle liess nur Stammmates uebrig, weil ein fremder Gegner nach zwei
#: Minuten tot ist.
POOL_MIN_HIT_BURSTS = 10


def class_of_weapon_name(name):
    """Klarname -> Waffenklasse.

    In `match_weapon_stats` steht der normalisierte Name ("M416"), die
    Kategorie haengt in WEAPON_NAMES aber an der Roh-Id ("WeapHK416_C").
    Ohne diese Umkehrung fiele jede Waffe auf "other", und der Vergleich
    mischte Sniper mit SMG — bei Basiswerten von 100 % gegen 20 % ist das
    kein Vergleich mehr.
    """
    if not name:
        return "other"
    global _CLASS_OF_NAME
    try:
        cache = _CLASS_OF_NAME
    except NameError:
        cache = None
    if cache is None:
        from pubg.aggregations import WEAPON_NAMES
        cache = {}
        for label, cat in WEAPON_NAMES.values():
            if label:
                cache.setdefault(label, cat or "other")
        _CLASS_OF_NAME = cache
    return cache.get(name, "other")


_CLASS_OF_NAME = None


def fold_bursts_by_class(rows):
    """DB-Zeilen -> {(account_id, klasse): {rolle: Kennzahlen}}.

    Zeilen ohne einen einzigen Feuerstoss fallen weg: der Grossteil der
    Tabelle stammt aus Matches vor dem Backfill und wuerde sonst
    Klassen-Eintraege mit Nenner 0 erzeugen.
    """
    out = {}
    for r in rows or []:
        total = ((r.get("bursts_init") or 0) + (r.get("bursts_react") or 0))
        if not total:
            continue
        key = (r.get("account_id"), class_of_weapon_name(r.get("weapon")))
        slot = out.setdefault(key, {role: _blank() for role in ROLES})
        for role, cols in ROW_FIELDS.items():
            for field, col in cols.items():
                slot[role][field] += int(r.get(col) or 0)
    return out


def compare_to_pool(folded, account_id, min_hit_bursts=POOL_MIN_HIT_BURSTS):
    """Eigene Werte, Pool-Referenz und Perzentil je Klasse und Rolle.

    Der **Pool** wirft die Feuerstoesse aller anderen zusammen und nutzt
    damit den ganzen Bestand. Das **Perzentil** braucht dagegen Werte je
    Person und damit eine Mindestzahl — beides steht in der Antwort, weil
    der Pool robust und das Perzentil einordnend ist.
    """
    classes = sorted({cls for (acc, cls) in folded if acc == account_id})
    out = []
    for cls in classes:
        for role in ROLES:
            raw_me = (folded.get((account_id, cls)) or {}).get(role) or {}
            me = _blank()
            me.update({k: raw_me.get(k, 0) for k in me})
            if not me["bursts"]:
                continue
            # Ohne einen einzigen Treffer-Stoss gibt es keine Visierlage zu
            # messen. Das trifft vor allem Wurfgeraete und Werkzeug:
            # Rauchgranaten, Schneebaelle, Aepfel und Flares erzeugen
            # Attack-Events, aber keinen Schusswaffenschaden — an
            # Prod-Daten 27 % aller Stoesse in Zeilen, die nichts aussagen.
            # Der Filter ueber den Nenner trifft sie alle, ohne eine
            # Klassen-Blacklist zu pflegen (die bei jeder neuen Waffe
            # veralten wuerde).
            if not me["hitBursts"]:
                continue
            pool = _blank()
            per_player = []
            for (acc, c), stat in folded.items():
                if c != cls or acc == account_id:
                    continue
                raw = stat.get(role) or {}
                s = _blank()
                s.update({k: raw.get(k, 0) for k in s})
                if not s["hitBursts"]:
                    continue
                for k in pool:
                    pool[k] += s[k]
                if s["hitBursts"] >= min_hit_bursts:
                    per_player.append(first_shot_pct(s["hitBursts"],
                                                     s["firstShotHits"]))
            # Quote erst ab MIN_RATE_HIT_BURSTS; darunter traegt die Zeile
            # nur ihre Rohzahlen, und die Anzeige zeigt "1/1" statt 100 %.
            enough = me["hitBursts"] >= MIN_RATE_HIT_BURSTS
            my_pct = (first_shot_pct(me["hitBursts"], me["firstShotHits"])
                      if enough else None)
            pool_pct = first_shot_pct(pool["hitBursts"], pool["firstShotHits"])
            vals = sorted(v for v in per_player if v is not None)
            pctl = None
            if vals and my_pct is not None:
                pctl = 100.0 * sum(1 for v in vals if v < my_pct) / len(vals)
            out.append({
                "class": cls,
                "role": role,
                "bursts": me["bursts"],
                "hitBursts": me["hitBursts"],
                "firstShotPct": my_pct,
                # Rohzahlen, damit eine Zeile unter der Schwelle nicht leer
                # aussieht: "1/1" ist ablesbar, 100 % waere irrefuehrend.
                "firstShotHits": me["firstShotHits"],
                "ratedEnough": enough,
                "avgHitIndex": (avg_hit_index(me["hitBursts"],
                                              me["hitIndexSum"])
                                if enough else None),
                "poolFirstShotPct": pool_pct,
                "poolAvgHitIndex": avg_hit_index(pool["hitBursts"],
                                                 pool["hitIndexSum"]),
                "followUpPct": (follow_up_pct(me["shotsAfterHit"],
                                              me["hitsAfterHit"])
                                if enough else None),
                "poolFollowUpPct": follow_up_pct(pool["shotsAfterHit"],
                                                 pool["hitsAfterHit"]),
                # Anteil der Stoesse, die ueberhaupt nichts trafen — die
                # Signatur wahllosen Feuers. Braucht keine eigene Spalte,
                # steckt in bursts und hitBursts.
                "missBurstPct": (100.0 * (me["bursts"] - me["hitBursts"])
                                 / me["bursts"]) if me["bursts"] else None,
                "poolMissBurstPct": (100.0 * (pool["bursts"] - pool["hitBursts"])
                                     / pool["bursts"]) if pool["bursts"] else None,
                "poolHitBursts": pool["hitBursts"],
                # Zahl der Spieler HINTER dem Perzentil, nicht im Pool:
                # der Pool zaehlt jeden mit, das Perzentil nur die mit
                # genug eigenen Stoessen.
                "poolPlayers": len(vals),
                "diff": (my_pct - pool_pct)
                        if (my_pct is not None and pool_pct is not None)
                        else None,
                "percentile": pctl,
                "reliable": me["hitBursts"] >= RELIABLE_HIT_BURSTS,
            })
    return out
