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

from pubg.telemetry_analysis import (GUN_CATEGORY, _parse_ts,
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
                  "hitIndexSum": "hit_index_sum_init"},
    "reacting": {"bursts": "bursts_react", "hitBursts": "hit_bursts_react",
                 "firstShotHits": "first_shot_react",
                 "hitIndexSum": "hit_index_sum_react"},
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
    return {"bursts": 0, "hitBursts": 0, "firstShotHits": 0, "hitIndexSum": 0}


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
            if e.get("damageTypeCategory") not in (None, GUN_CATEGORY):
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
