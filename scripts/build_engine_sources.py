"""Quell-Aufnahmen für den Sound-Bereich im Car editor (tools/car-editor.html) bereitstellen.

Der Car editor lässt die Abschnitte einer Aufnahme (Leerlauf, Hochlauf, Gas weg, Anlassen, Begrenzer) von Hand
markieren, weil die Automatik von scripts/build_engine_sounds.py Bereiche oft falsch erwischt. Dafür braucht er die
Aufnahme selbst, nicht nur die geschnittenen Stücke. Je Aufnahme, die in assets/sounds/engines/bank.json einen
Hochlauf (on) liefert:
  1. aus dem Cache (data/engine-sounds-src/<id>.mp3, wie build_engine_sounds.py) dekodieren, Drehzahlverlauf messen
     (dieselbe Analyse wie das Bauskript: analyse → track → auto_oct)
  2. höchstens 30 s ausschneiden – das Fenster mit dem besten Hochlauf, dazu möglichst Abfall, Leerlauf und Anlassen
  3. Mono-MP3 64 kbit/s (Spitze −1 dBFS; Lautheit gleicht die Laufzeit je markiertem Abschnitt an) nach
     assets/sounds/engines/src/<id>.mp3
  4. assets/sounds/engines/src/<id>.json: Drehzahlverlauf (für die Kurve im Editor und die Drehzahl-Zuordnung des
     markierten Hochlaufs in der Laufzeit) + automatische Vorschläge der Abschnitte
  5. assets/sounds/engines/src/index.json: Liste der Aufnahmen (Titel, Autor, Lizenz, Motorarten, Dauer)

Aufruf:  python3 scripts/build_engine_sources.py [--cache <dir>] [--only <id> …]
Laufzeit: js/car-engine-audio.js (def.sound je Auto), Editor: tools/car-editor.html (Abschnitt „Sound“).
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_engine_sounds as B  # noqa: E402

OUT = os.path.join(B.OUT, "src")
MAX_LEN = 30.0      # s je Aufnahme
BITRATE = "64k"
STEP = 2            # Drehzahlverlauf: jeder 2. Analyse-Schritt (≈ 46 ms)


def bank_sources():
    """Aufnahmen mit Hochlauf in bank.json → {id: [Motorarten, die sie nutzen]} (Hochlauf-Arten zuerst)."""
    bank = json.load(open(os.path.join(B.OUT, "bank.json"), encoding="utf-8"))
    on, use = {}, {}
    for tp, t in bank["types"].items():
        for x in t.get("on", []):
            if not x.get("lent"):
                on.setdefault(x["src"], [])
                if tp not in on[x["src"]]:
                    on[x["src"]].append(tp)
        for k in ("on", "off", "loops", "start", "rev"):
            for x in t.get(k, []):
                use.setdefault(x["src"], set()).add(tp)
    return {sid: tps + sorted(use.get(sid, set()) - set(tps)) for sid, tps in on.items()}, bank


def idle_run(t, rpm, good, rms, idle):
    """Leerlauf: längste laute Stelle mit Drehzahl ±18 % um den Leerlauf (≥ 0,8 s) → (t0, t1) bis 2,5 s, sonst None."""
    top = np.percentile(rms, 98)
    ok = good & (np.abs(np.log(np.maximum(rpm, 1) / idle)) < np.log(1.18)) & (rms > top - 30)
    best, i = None, 0
    while i < len(ok):
        if not ok[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(ok) and ok[j + 1]:
            j += 1
        d = t[j] - t[i]
        if d >= 0.8 and (not best or d > best[1] - best[0]):
            best = (float(t[i]), float(t[j]))
        i = j + 1
    if not best:
        return None
    m, h = (best[0] + best[1]) / 2, min(2.5, best[1] - best[0]) / 2
    return (m - h, m + h)


def choose_window(L, ons, offs, idle, start):
    """Fenster ≤ MAX_LEN s: bester Hochlauf ganz drin (×3), dazu bester Abfall, Leerlauf, Anlassen."""
    if L <= MAX_LEN:
        return 0.0
    best, bw = -1e9, 0.0
    for w0 in np.arange(0, L - MAX_LEN + 0.01, 0.25):
        w1 = w0 + MAX_LEN

        def inside(a, b):
            return a >= w0 and b <= w1
        s = 3 * max([o["score"] for o in ons if inside(o["t0"], o["t0"] + o["dur"])] or [-1])
        s += max([o["score"] for o in offs if inside(o["t0"], o["t0"] + o["dur"])] or [0])
        if idle and inside(*idle):
            s += 0.8
        if start and inside(start[0], start[1]):
            s += 0.5
        if s > best + 1e-9:
            best, bw = s, float(w0)
    return bw


def build(cache, only):
    srcs, bank = bank_sources()
    meta = {sid: (tp, hint, path) for tp, sid, _u, _t, _l, _d, path, hint in B.SOURCES}
    os.makedirs(OUT, exist_ok=True)
    index = {}
    old = os.path.join(OUT, "index.json")
    if only and os.path.exists(old):
        index = json.load(open(old, encoding="utf-8")).get("sources", {})
    for sid, tps in sorted(srcs.items()):
        if only and sid not in only:
            continue
        tp0, hint, path = meta[sid]
        tp = tps[0] if tps[0] in B.TYPES else tp0
        p = B.fetch(cache, sid, path)
        x = B.highpass(B.decode(p, B.SR))
        an = B.analyse(x, tp)
        L = len(x) / B.SR
        rpm, good = B.track(an, tp)
        if rpm is None:
            print("%7d: kein Drehzahlverlauf – übersprungen" % sid)
            continue
        oct_ = hint.get("oct") or B.auto_oct(an, tp, rpm, good)
        rpm = rpm * oct_
        t = an["t"]
        sw = B.find_sweeps(an, tp, rpm, good)
        sp = B.TYPES[tp]
        ons = [o for o in sw if o["kind"] == "up" and max(o["r0"], o["r1"]) <= sp["red"] * 1.15]
        offs = [o for o in sw if o["kind"] == "down" and max(o["r0"], o["r1"]) <= sp["red"] * 1.15]
        idle = idle_run(t, rpm, good, an["rms"], sp["idle"])
        st = None
        if hint.get("start") or "start" in B.SOURCES[[s[1] for s in B.SOURCES].index(sid)][3].lower():
            s0 = B.find_start(an, L)
            if s0:
                st = (s0["t0"], s0["t0"] + s0["dur"])
        w0 = choose_window(L, ons, offs, idle, st)
        w1 = min(L, w0 + MAX_LEN)
        y = x[int(w0 * B.SR):int(w1 * B.SR)]
        y = B.fade(y, 0.01, 0.05)
        pk = float(np.max(np.abs(y)) or 1.0)
        y = y * (10 ** (-1 / 20) / pk)
        dst = os.path.join(OUT, "%d.mp3" % sid)
        _encode(y, dst)

        def rel(a, b):
            return [round(a - w0, 3), round(b - w0, 3)] if a >= w0 - 0.01 and b <= w1 + 0.01 else None

        def best(lst):
            c = [o for o in lst if rel(o["t0"], o["t0"] + o["dur"])]
            return max(c, key=lambda o: o["score"]) if c else None
        auto = {}
        o = best(ons)
        if o:
            r = rel(o["t0"], o["t0"] + o["dur"])
            auto["sweep"] = {"t0": r[0], "t1": r[1], "rpm0": int(round(o["r0"])), "rpm1": int(round(o["r1"]))}
        o = best(offs)
        if o:
            r = rel(o["t0"], o["t0"] + o["dur"])
            auto["lift"] = {"t0": r[0], "t1": r[1], "rpm0": int(round(o["r0"])), "rpm1": int(round(o["r1"]))}
        if idle and rel(*idle):
            auto["idle"] = rel(*idle)
        if st and rel(*st):
            auto["start"] = rel(*st)
        # Drehzahlverlauf im Fenster (0 = kein verlässlicher Grundton / zu leise)
        top = np.percentile(an["rms"], 98)
        voiced = good & (an["rms"] > top - 30)
        sel = np.where((t >= w0) & (t < w1))[0][::STEP]
        curve = [int(round(float(rpm[i]))) if voiced[i] else 0 for i in sel]
        t0c = round(float(t[sel[0]] - w0), 4) if len(sel) else 0
        info = {"src": sid, "type": tp, "cyl": sp["cyl"], "oct": oct_, "dur": round(w1 - w0, 3), "from": round(w0, 3),
                "t0": t0c, "dt": round(STEP * B.HOP / B.ASR, 5), "rpm": curve, "auto": auto}
        with open(os.path.join(OUT, "%d.json" % sid), "w", encoding="utf-8") as f:
            json.dump(info, f, separators=(",", ":"))
        s = bank["sources"].get(str(sid), {})
        index[str(sid)] = {"title": s.get("title", ""), "user": s.get("user", ""), "lic": s.get("lic", ""),
                           "url": s.get("url", ""), "types": tps, "dur": round(w1 - w0, 3)}
        print("%7d %-4s %5.1fs → %4.1f–%4.1f s  %s  %d kB" % (sid, tp, L, w0, w1, ", ".join(sorted(auto)),
                                                           os.path.getsize(dst) // 1024))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "sources": index}, f, ensure_ascii=False, indent=1)


def _encode(y, dst):
    old = B.BITRATE
    B.BITRATE = BITRATE
    try:
        B.encode(y, dst)
    finally:
        B.BITRATE = old


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(B.ROOT, "data", "engine-sounds-src"))
    ap.add_argument("--only", nargs="*", type=int)
    a = ap.parse_args()
    build(a.cache, set(a.only or []))


if __name__ == "__main__":
    main()
