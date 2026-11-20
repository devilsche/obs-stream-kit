"""Motorklänge für Car Race / Car Drive aus echten Freesound-Aufnahmen bauen (lokal ausführen, braucht ffmpeg + numpy).

Ablauf je Aufnahme (Liste SOURCES unten, nur CC0 / CC BY):
  1. HQ-Vorschau (128 kbit/s MP3, öffentlich) nach data/engine-sounds-src/<id>.mp3 laden (≥ 1,2 s Abstand)
  2. mit ffmpeg nach Mono dekodieren, Pegel (RMS) und Grundton (Zündfrequenz, normierte Autokorrelation im für die
     Motorart möglichen Bereich) alle ~23 ms messen
  3. Stücke schneiden:
     - Schleifen (loop): ruhige Stellen mit stabilem Grundton (≤ 3 % Schwankung, gleichmäßiger Pegel), 1,6 s, mit
       Überblendung nahtlos gemacht; Drehzahl = Grundton · 120 / Zylinder. In der Datei steht vor und nach der Schleife
       ein Stück der Schleife selbst (PAD) – loopStart/loopEnd (ls/le) liegen damit unabhängig von der MP3-Verzögerung
       des Dekoders in einem periodischen Bereich
     - Einmal-Klänge: start (Anlassen, nach Titel), rev (Gasstoß: Grundton steigt schnell ≥ 40 % und fällt wieder),
       pass (Vorbeifahrt: um die lautesten Stellen), pop (Fehlzündung/Knall: kurze Spitzen ≥ 15 dB über der Umgebung),
       turbo (Abblasventil/Turbo, ganze Aufnahme)
  4. Lautheit angleichen, Mono-MP3 96 kbit/s nach assets/sounds/engines/<typ>/…, dazu assets/sounds/engines/bank.json
     (je Motorart Kenndaten + Schleifen mit Drehzahl + Einmal-Klänge, Quellen) und assets/sounds/engines/CREDITS.md

Aufruf:  python3 scripts/build_engine_sounds.py [--only <typ> …] [--report] [--cache <dir>]
  --report: nur messen und je Aufnahme auflisten, was gefunden wurde (nichts schreiben)
Laufzeit: js/car-engine-audio.js. Hören und beurteilen tut der Nutzer – das Skript schneidet nur nach Messwerten.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "sounds", "engines")
SR = 44100          # Schnitt + Ausgabe
ASR = 11025         # Analyse
HOP = 256           # Analyse-Schritt (≈ 23 ms)
WIN = 1024          # Analyse-Fenster (≈ 93 ms)
LOOP_LEN = 1.4      # Schleifenlänge s (höchstens)
LOOP_MIN = 0.5      # kürzeste Schleife s
XFADE = 0.16        # Überblendung der Schleife s
N_LEVELS = 10       # Ziel-Drehzahlen je Motorart
PAD = 0.12          # Schleifen-Vorlauf/-Nachlauf in der Datei s
BITRATE = "96k"
MAX_LOOPS = 18      # je Motorart (je Ziel-Drehzahl höchstens drei Aufnahmen)
MAX_SHOTS = {"start": 4, "rev": 7, "pass": 5, "pop": 6, "turbo": 3}

# Motorarten: Zylinder (Zündfrequenz = Drehzahl · Zyl / 120), Leerlauf, Begrenzer, Gänge, erster Gang bis Anteil von vmax
TYPES = {
    "i4": dict(label="Inline-4", cyl=4, idle=850, red=6800, gears=5, g1=0.30),
    "t4": dict(label="Turbo inline-4", cyl=4, idle=900, red=7200, gears=6, g1=0.27, turbo=True),
    "i6": dict(label="Inline-6", cyl=6, idle=750, red=7500, gears=6, g1=0.28),
    "f6": dict(label="Flat-6", cyl=6, idle=900, red=8800, gears=7, g1=0.24),
    "v8m": dict(label="Muscle V8", cyl=8, idle=700, red=6500, gears=6, g1=0.30),
    "v8f": dict(label="Exotic V8", cyl=8, idle=1000, red=8800, gears=7, g1=0.24),
    "v10": dict(label="V10", cyl=10, idle=1000, red=8700, gears=7, g1=0.24),
    "v12": dict(label="V12", cyl=12, idle=950, red=8800, gears=7, g1=0.24),
    "f1": dict(label="Formula 1", cyl=8, idle=4000, red=18000, gears=8, g1=0.22),
    "dsl": dict(label="Diesel truck / bus", cyl=6, idle=600, red=2600, gears=6, g1=0.18),
    "ev": dict(label="Electric", cyl=2, idle=0, red=16000, gears=1, g1=1.0),
}

# (typ, Freesound-ID, Autor, Titel, Lizenz, Dauer s, Vorschau-Pfad, Hinweise)
# Hinweise: loops=False (keine Schleifen, z. B. Vorbeifahrt/fern), start/pass/turbo/pop=True (Einmal-Klang-Art erzwingen),
#           revs=False (keine Gasstöße suchen)
SOURCES = [
    ("i4", 268623, "EverydaySounds", "VW Golf GTI Pull Away (Zoom H2n M&S).wav", "CC0", 53.1, "268/268623_2273054-lq.mp3", {}),
    ("i4", 487553, "thepodcastdoctor", "Honda Engine Start and Rev.wav", "CC0", 18.0, "487/487553_9945386-lq.mp3", {"start": True}),
    ("i4", 692112, "MPooman", "[ MPooman ] Honda Civic Engine Sounds (SE542) (High Quality)", "CC0", 219.5, "692/692112_14220990-lq.mp3", {}),
    ("i4", 33192, "Heigh-hoo", "racing honda.aif", "CC0", 17.9, "33/33192_21830-lq.mp3", {}),
    ("i4", 215960, "jess_pfohl", "4civic engine.wav", "CC0", 17.5, "215/215960_4037653-lq.mp3", {}),
    ("i4", 424738, "Joaofmms", "Old 2001 Honda Civic Engine", "CC0", 6.8, "424/424738_8524423-lq.mp3", {}),
    ("i4", 760690, "imaniv", "Altima startup 1", "CC0", 22.0, "760/760690_12634362-lq.mp3", {"start": True}),
    ("i4", 425868, "Soundholder", "Volkswagen Golf V 1.6 FSI exterior passby fast speed stereo ORTF 8040.wav", "CC BY", 19.4, "425/425868_4421503-lq.mp3", {"loops": False, "pass": True, "revs": False}),
    ("t4", 496171, "editboy23", "Import car revs on Chassis Dyno with Turbo.wav", "CC0", 35.5, "496/496171_1784475-lq.mp3", {}),
    ("t4", 273334, "ulose2piranha", "WRX - Exhaust sounds", "CC0", 35.2, "273/273334_4168822-lq.mp3", {}),
    ("t4", 659544, "EwanPenman11", "Turbo Spooling and Blow Off.WAV", "CC0", 5.3, "659/659544_13241413-lq.mp3", {"loops": False, "turbo": True, "revs": False}),
    ("t4", 369797, "t33kno", "subaru impreza start up-idle-launch limiter.wav", "CC0", 29.1, "369/369797_6850406-lq.mp3", {"start": True}),
    ("t4", 625702, "MilanKovanda", "Subaru Impreza STI idling", "CC BY", 8.1, "625/625702_6886013-lq.mp3", {}),
    ("t4", 797835, "modusmogulus", "Car Antilag (No cleanup, 32float)", "CC0", 11.3, "797/797835_15956618-lq.mp3", {"loops": False, "pop": True}),
    ("i6", 21741, "Erdie", "car-start.mp3", "CC BY", 9.8, "21/21741_118241-lq.mp3", {"start": True}),
    ("i6", 401558, "GiocoSound", "SFX_Car_Engine_Outside_Start.wav", "CC0", 2.5, "401/401558_5820033-lq.mp3", {"start": True, "loops": False, "revs": False}),
    ("i6", 269771, "seth-m", "car idle", "CC0", 2.4, "269/269771_3366749-lq.mp3", {"revs": False}),
    ("i6", 478597, "Kinoton", "Car, BMW M6, Start, Idle, Accelerate", "CC0", 41.5, "478/478597_2247456-lq.mp3", {"start": True}),
    ("i6", 57939, "joanfelipsound", "engine start BMW 320 VG91.wav", "CC0", 23.1, "57/57939_515841-lq.mp3", {"start": True}),
    ("i6", 173005, "ninebilly", "BMW 320 1988..wav", "CC0", 27.0, "173/173005_773642-lq.mp3", {}),
    ("i6", 128612, "Heigh-hoo", "bmwz4.wav", "CC0", 8.8, "128/128612_21830-lq.mp3", {}),
    ("i6", 466715, "dudebrobrodude", "Inline Six.wav", "CC0", 3.1, "466/466715_9835095-lq.mp3", {}),
    ("i6", 185151, "Ears68", "6-cyl-VintageRaceCar-toStartLine-burnout-StartClimb-051.wav", "CC0", 61.1, "185/185151_2214631-lq.mp3", {}),
    ("i6", 415276, "ikbenraar", "BMWM3_01.wav", "CC BY", 107.1, "415/415276_754558-lq.mp3", {}),
    ("i6", 343369, "ccdff2", "M3 accelerate", "CC BY", 20.8, "343/343369_4316916-lq.mp3", {}),
    ("f6", 457560, "florianreichelt", "Acceleration of a Sports Car Engine like Ferrari or Lamborghini or Porsche", "CC0", 16.1, "457/457560_6253486-lq.mp3", {}),
    ("f6", 90404, "mmplisskin", "Porsche.MP3", "CC0", 7.6, "90/90404_1473497-lq.mp3", {}),
    ("f6", 585710, "kevp888", "R4_00225_FR_SportsCar.wav", "CC BY", 15.8, "585/585710_9034501-lq.mp3", {}),
    ("f6", 577941, "kevp888", "VOC_210625-1847_FR_SportsCar.wav", "CC BY", 25.8, "577/577941_9034501-lq.mp3", {}),
    ("f6", 55727, "mharo", "porsche_911.wav", "CC0", 10.0, "55/55727_267249-lq.mp3", {}),
    ("f6", 772802, "jerry.berumen", "vehicle car porsche 911 revving engine motor boxer", "CC BY", 52.6, "772/772802_6753194-lq.mp3", {}),
    ("v8m", 133831, "Gx3Gary", "CarRumble1.wav", "CC0", 27.2, "133/133831_2416438-lq.mp3", {}),
    ("v8m", 205509, "VacekH", "mustang 8.wav", "CC0", 38.4, "205/205509_1970026-lq.mp3", {}),
    ("v8m", 455926, "noiseloop", "Acceleration sounds of Ford V8 5 Liter engine", "CC BY", 11.5, "455/455926_8138660-lq.mp3", {}),
    ("v8m", 455925, "noiseloop", "Starting of Ford V8 5 Liter engine", "CC BY", 5.7, "455/455925_8138660-lq.mp3", {"start": True}),
    ("v8m", 432508, "holderall", "Open header V8 cars idling and revving", "CC0", 149.9, "432/432508_2758260-lq.mp3", {}),
    ("v8m", 213977, "Ears68", "V-8HotRodApproachRevUpsDrivePast-cut-DR087.wav", "CC0", 74.2, "213/213977_2214631-lq.mp3", {"pass": True}),
    ("v8m", 144454, "Ears68", "Hot-Rod-V-8-BigSpchg-RoughIdle-RevUps-IdleDR025-30sec.wav", "CC BY", 30.4, "144/144454_2214631-lq.mp3", {}),
    ("v8m", 651534, "overmedium", "v8 engine rev.wav", "CC0", 8.5, "651/651534_2396512-lq.mp3", {}),
    ("v8f", 14830, "Heigh-hoo", "MSchFerr.aif", "CC0", 5.7, "14/14830_21830-lq.mp3", {}),
    ("v8f", 585215, "myeclecticself", "Car Engine: Maserati GranTurismo Switch to Sport Mode and Launch", "CC0", 16.6, "585/585215_1252192-lq.mp3", {}),
    ("v8f", 43484, "enginemusic", "ferrari355underhood4.mp3", "CC BY", 18.2, "43/43484_462458-lq.mp3", {}),
    ("v8f", 241083, "PritzProductions", "Ferrari 360 Spider - engine sound ", "CC0", 37.9, "241/241083_3450345-lq.mp3", {}),
    ("v8f", 505321, "marcelweiss", "S63 AMG V8 Engine Revs", "CC0", 6.2, "505/505321_7236652-lq.mp3", {}),
    ("v8f", 659560, "EwanPenman11", "Ferrari start up and drive off.WAV", "CC0", 37.3, "659/659560_13241413-lq.mp3", {"start": True}),
    ("v8f", 547057, "lmartins", "Aston Martin V8 Vantage start-up.m4a", "CC BY", 9.9, "547/547057_113-lq.mp3", {"start": True}),
    ("v8f", 465453, "lmartins", "Maserati GranTurismo S", "CC BY", 66.2, "465/465453_113-lq.mp3", {}),
    ("v10", 377148, "Mr_KeybOred", "Distant Loud Sports Car Vroom", "CC0", 5.2, "377/377148_6417448-lq.mp3", {"loops": False, "pass": True, "revs": False}),
    ("v10", 457560, "florianreichelt", "Acceleration of a Sports Car Engine like Ferrari or Lamborghini or Porsche", "CC0", 16.1, "457/457560_6253486-lq.mp3", {}),
    ("v10", 112076, "cheesepuff", "lambo rev.mp3", "CC0", 5.3, "112/112076_682033-lq.mp3", {}),
    ("v10", 478756, "richwise", "Supercar rev", "CC0", 13.9, "478/478756_1481531-lq.mp3", {}),
    ("v10", 564375, "JaimeLopes", "Lamborghini Sounds", "CC BY", 36.4, "564/564375_628040-lq.mp3", {}),
    ("v10", 641824, "TheStolenBattenberg", "lamborghini", "CC0", 8.7, "641/641824_13445393-lq.mp3", {}),
    ("v10", 649961, "kevp888", "VOC_220909-2079_FR_SportsCar.wav", "CC BY", 29.1, "649/649961_9034501-lq.mp3", {}),
    ("v10", 649889, "kevp888", "VOC_220909-2078_FR_SportsCar.wav", "CC BY", 25.0, "649/649889_9034501-lq.mp3", {}),
    ("v12", 408896, "oldazatloukal", "Engine sound", "CC0", 9.4, "408/408896_3253961-lq.mp3", {}),
    ("v12", 112076, "cheesepuff", "lambo rev.mp3", "CC0", 5.3, "112/112076_682033-lq.mp3", {}),
    ("v12", 112075, "cheesepuff", "Lambo idle and rev.mp3", "CC0", 63.9, "112/112075_682033-lq.mp3", {}),
    ("v12", 484191, "Janosch-JR", "V12 Engine - Short Rev", "CC0", 3.4, "484/484191_7367578-lq.mp3", {}),
    ("v12", 564373, "JaimeLopes", "Lambo Start Up Sound", "CC0", 22.2, "564/564373_628040-lq.mp3", {"start": True}),
    ("f1", 44289, "rfhache", "F1 BR 07 2P MSBraking1turn.wav", "CC BY", 15.7, "44/44289_201367-lq.mp3", {"loops": False, "pass": True}),
    ("f1", 14833, "Heigh-hoo", "backstraight.aif", "CC0", 25.5, "14/14833_21830-lq.mp3", {"pass": True}),
    ("f1", 200810, "WebbFilmsUK", "F1 Single Car Pass.wav", "CC BY", 16.1, "200/200810_2641534-lq.mp3", {"loops": False, "pass": True, "revs": False}),
    ("f1", 478546, "LordFluffeh", "Formula 1 racing", "CC0", 28.8, "478/478546_10244830-lq.mp3", {"pass": True}),
    ("f1", 181187, "Ears68", "F-1raceCar-IdleAndRaceStartDemo.wav", "CC0", 24.9, "181/181187_2214631-lq.mp3", {}),
    ("f1", 44771, "rfhache", "F1 BR 06 Engine Starts.wav", "CC BY", 7.3, "44/44771_201367-lq.mp3", {"start": True}),
    ("f1", 131239, "Heigh-hoo", "finish2011.wav", "CC0", 11.5, "131/131239_21830-lq.mp3", {"pass": True}),
    ("f1", 400130, "monkeyman535", "Formula F1 Racing.wav", "CC BY", 9.0, "400/400130_4524389-lq.mp3", {"pass": True}),
    ("f1", 77667, "LG", "BCR F1 Car 07.wav", "CC BY", 39.9, "77/77667_36188-lq.mp3", {}),
    ("dsl", 128160, "ibirdfilm", "Diesel Truck Idling Front.wav", "CC0", 34.4, "128/128160_1372389-lq.mp3", {"revs": False}),
    ("dsl", 49988, "BoilingSand", "080316 Dodge truck revving in driveway.wav", "CC BY", 34.7, "49/49988_571325-lq.mp3", {}),
    ("dsl", 186935, "ReadeOnly", "engine_idle_loop.wav", "CC0", 6.1, "186/186935_545448-lq.mp3", {"revs": False}),
    ("dsl", 181900, "yurkobb", "Bus engine looped", "CC0", 4.6, "181/181900_2023784-lq.mp3", {"revs": False}),
    ("dsl", 435656, "YellowJacketStudios", "FORD LTL 9000_engine start and idle.wav", "CC0", 56.6, "435/435656_2347916-lq.mp3", {"start": True}),
    ("dsl", 828756, "chungus43A", "Mississauga Transit Orion V bus engine", "CC0", 48.0, "828/828756_12024110-lq.mp3", {}),
    ("ev", 761685, "justVova", "Acceleration of an electric car", "CC0", 5.2, "761/761685_13088347-lq.mp3", {"revs": False}),
    ("ev", 807728, "Sam-Mortley", "electric car", "CC0", 19.5, "807/807728_16596600-lq.mp3", {"revs": False}),
    ("ev", 635454, "kevp888", "VOC_220519-2006-2_FR_ElectricVehicle.wav", "CC BY", 30.7, "635/635454_9034501-lq.mp3", {"revs": False, "pass": True}),
    ("ev", 170421, "Eelke", "nissan-leaf", "CC0", 9.4, "170/170421_670687-lq.mp3", {"revs": False}),
    ("ev", 324119, "evsecrets", "Electric car start-up and drive away", "CC0", 63.9, "324/324119_2367065-lq.mp3", {"revs": False}),
]
# Bewusst nicht verwendet (aus der Kandidatenliste):
#   174858 „MITSUBISHI IMIEV electric car SIDE MIRROR motor“ – Spiegel-Stellmotor, kein Antrieb
#   505321 „S63 AMG V8 Engine Revs“ stand bei t4/v10/v12 – ist ein V8, nur unter v8f
# Fehlen einer Motorart hohe Drehzahlen (oberste Schleife < 75 % des Begrenzers), leiht sie Schleifen verwandter
# Motorarten mit gleicher Zündfrequenz (Drehzahl × Zylinder / eigene Zylinder) – in dieser Reihenfolge
SIBLINGS = {"v12": ["v10", "f1", "v8f"], "v10": ["v12", "f1", "v8f"], "v8m": ["v8f", "v10"], "v8f": ["v10", "v8m", "f1"],
            "i6": ["f6", "i4", "t4"], "f6": ["i6", "v8f"], "i4": ["t4", "i6"], "t4": ["i4", "i6"], "f1": ["v10"]}
POPS_TYPES = {"t4", "i6", "f6", "v8m", "v8f", "v10", "v12", "f1"}


# ---------------------------------------------------------------- Laden / Dekodieren

def fetch(cache, sid, path):
    os.makedirs(cache, exist_ok=True)
    dst = os.path.join(cache, "%d.mp3" % sid)
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return dst
    url = "https://cdn.freesound.org/previews/" + path.replace("-lq.mp3", "-hq.mp3")
    req = urllib.request.Request(url, headers={"User-Agent": "obs-stream-kit engine-sound builder"})
    data = urllib.request.urlopen(req, timeout=60).read()
    with open(dst + ".part", "wb") as f:
        f.write(data)
    os.replace(dst + ".part", dst)
    time.sleep(1.2)
    return dst


def decode(path, sr):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def fft_band(x, sr, lo, hi):
    """Bandpass per FFT-Maske mit weichen Flanken (ganze Aufnahme auf einmal)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / sr)
    m = np.ones_like(f)
    if lo:
        m *= np.clip((f - lo * 0.7) / (lo * 0.3), 0, 1)
    if hi:
        m *= np.clip((hi * 1.3 - f) / (hi * 0.3), 0, 1)
    return np.fft.irfft(X * m, n)


# ---------------------------------------------------------------- Analyse

def frames(x, win, hop):
    n = max(0, 1 + (len(x) - win) // hop)
    if n == 0:
        return np.zeros((0, win))
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def analyse(x44, tp):
    """→ dict t (s), rms (dB), f0 (Hz, 0 = unklar), clar (0..1) je Analyse-Schritt."""
    spec = TYPES[tp]
    x = decimate(x44)
    if tp == "ev":
        fmin, fmax = 60.0, 1400.0
    else:
        fmin = max(18.0, spec["idle"] * 0.55 * spec["cyl"] / 120)
        fmax = spec["red"] * 1.15 * spec["cyl"] / 120
    fmax = min(fmax, ASR / 2 * 0.8)
    xb = fft_band(x, ASR, fmin * 0.8, min(fmax * 2.2, ASR / 2 * 0.9))
    F = frames(xb, WIN, HOP) * np.hanning(WIN)[None, :]
    Fr = frames(x, WIN, HOP)
    rms = 10 * np.log10(np.mean(Fr ** 2, axis=1) + 1e-12)
    nf = 2 * WIN
    S = np.fft.rfft(F, nf, axis=1)
    ac = np.fft.irfft(np.abs(S) ** 2, nf, axis=1)[:, :WIN]
    w = np.fft.irfft(np.abs(np.fft.rfft(np.hanning(WIN), nf)) ** 2, nf)[:WIN]
    ac = ac / np.maximum(w[None, :], 1e-9)
    nac = ac / np.maximum(ac[:, :1], 1e-12)
    tmin, tmax = int(ASR / fmax), min(int(ASR / fmin), WIN // 2)
    f0 = np.zeros(len(nac))
    clar = np.zeros(len(nac))
    for i, r in enumerate(nac):
        seg = r[tmin:tmax + 1]
        if len(seg) < 3:
            continue
        M = seg.max()
        if M <= 0.05:
            continue
        # kleinste Periode mit lokalem Maximum ≥ 0,88 · Maximum (gegen Oktavfehler nach unten)
        pk = np.where((seg[1:-1] >= seg[:-2]) & (seg[1:-1] >= seg[2:]) & (seg[1:-1] >= 0.88 * M))[0]
        k = (pk[0] + 1) if len(pk) else int(np.argmax(seg))
        a, b, c = seg[max(k - 1, 0)], seg[k], seg[min(k + 1, len(seg) - 1)]
        den = a - 2 * b + c
        off = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
        tau = tmin + k + max(-0.5, min(0.5, off))
        f0[i] = ASR / tau
        clar[i] = b
    # Median über 5 Schritte
    if len(f0) >= 5:
        P = np.stack([np.roll(f0, s) for s in range(-2, 3)])
        f0 = np.median(P, axis=0)
    t = (np.arange(len(rms)) * HOP + WIN / 2) / ASR
    return {"t": t, "rms": rms, "f0": f0, "clar": clar}


def decimate(x44):
    y = fft_band(x44, SR, 0, ASR / 2 * 0.9)
    return y[::SR // ASR]


# ---------------------------------------------------------------- Stücke finden

def levels(tp):
    """Ziel-Drehzahlen der Schleifen: geometrisch vom Leerlauf bis knapp unter den Begrenzer."""
    sp = TYPES[tp]
    lo, hi = (sp["red"] * 0.08, sp["red"] * 0.95) if tp == "ev" else (sp["idle"], sp["red"] * 0.92)
    return [round(lo * (hi / lo) ** (k / (N_LEVELS - 1))) for k in range(N_LEVELS)]


def smooth_f0(an, tp):
    """Grundton geglättet und über unklare Stellen interpoliert; dazu die Maske der verlässlichen Stellen."""
    f0, cl = an["f0"], an["clar"]
    sp = TYPES[tp]
    fmin = sp["idle"] * 0.5 * sp["cyl"] / 120
    fmax = sp["red"] * 1.08 * sp["cyl"] / 120
    good = (f0 > fmin) & (f0 < fmax) & (cl >= 0.3)
    if good.sum() < 8:
        return None, good
    idx = np.arange(len(f0))
    lf = np.interp(idx, idx[good], np.log(f0[good]))
    k = 5
    lf = np.convolve(np.pad(lf, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    return np.exp(lf), good


def flatten(x, t, f, i0, i1, f_target):
    """Stück [i0, i1] (Analyse-Schritte) so umtasten, dass der Grundton konstant f_target ist (Phase gleichmäßig)."""
    tt, ff = t[i0:i1 + 1], f[i0:i1 + 1]
    ph = np.concatenate([[0.0], np.cumsum((ff[1:] + ff[:-1]) / 2 * np.diff(tt))])
    n = int(ph[-1] / f_target * SR)
    if n < 10:
        return np.zeros(0)
    tsrc = np.interp(f_target * np.arange(n) / SR, ph, tt)
    return np.interp(tsrc * SR, np.arange(len(x)), x)


def find_loops(an, tp, x44):
    """Schleifen je Ziel-Drehzahl: zusammenhängende Stellen, an denen der Grundton ±14 % um das Ziel liegt
    (laut genug, verlässlicher Grundton), auf genau die Ziel-Drehzahl geglättet (flatten). Auch Hochdreh-Stellen
    liefern so Schleifen, solange sie lange genug im Band bleiben."""
    sp = TYPES[tp]
    t, rms = an["t"], an["rms"]
    top = np.percentile(rms, 98)
    out = []
    if tp == "ev":
        return find_loops_ev(an, x44)
    f, good = smooth_f0(an, tp)
    if f is None:
        return out
    need = LOOP_MIN + XFADE
    for rpm in levels(tp):
        ft = rpm * sp["cyl"] / 120
        ok = (np.abs(np.log(f / ft)) < np.log(1.14)) & (rms > top - 24)
        # Läufe finden
        best = None
        i = 0
        while i < len(ok):
            if not ok[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(ok) and ok[j + 1]:
                j += 1
            if j > i + 3:
                q = float(np.mean(good[i:j + 1]))
                if q >= 0.35:
                    y = flatten(x44, t, f, i, j, ft)
                    dur = len(y) / SR
                    if dur >= need:
                        sc = q + 0.2 * min(dur, 2.0) - 0.03 * float(np.std(rms[i:j + 1]))
                        if not best or sc > best[0]:
                            best = (sc, i, j, dur)
            i = j + 1
        if best:
            sc, i, j, dur = best
            y = flatten(x44, t, f, i, j, ft)
            d = min(dur, LOOP_LEN + XFADE)
            a = max(0, (len(y) - int(d * SR)) // 2)          # Mitte des Laufs
            out.append({"t0": float(t[i] - WIN / 2 / ASR), "rpm": rpm, "dur": d, "y": y[a:a + int(d * SR)],
                        "score": round(sc, 3)})
    return out


def find_loops_ev(an, x44):
    """E-Autos: ruhige, laute Stellen; „Drehzahl“ aus dem Schwerpunkt des Spektrums (Surren wird mit Tempo höher)."""
    t, rms = an["t"], an["rms"]
    top = np.percentile(rms, 98)
    n = int((LOOP_MIN + XFADE + 0.3) / (HOP / ASR))
    out = []
    used = []
    for i in range(0, max(0, len(t) - n), max(1, n // 3)):
        r = rms[i:i + n]
        if np.mean(r) < top - 14 or np.std(r) > 3:
            continue
        a = int(max(0, t[i] - WIN / 2 / ASR) * SR)
        seg = x44[a:a + int(n * HOP / ASR * SR)]
        if len(seg) < SR * 0.5:
            continue
        S = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        fr = np.fft.rfftfreq(len(seg), 1 / SR)
        band = (fr > 150) & (fr < 8000)
        c = float(np.sum(fr[band] * S[band]) / max(1e-9, np.sum(S[band])))
        used.append((float(np.mean(r)), i, c))
    used.sort(reverse=True)
    for m, i, c in used[:6]:
        rpm = int(TYPES["ev"]["red"] * min(1.0, max(0.08, (c - 400) / 3600)))
        if any(abs(np.log(rpm / o["rpm"])) < 0.08 for o in out):
            continue
        t0 = float(max(0, t[i] - WIN / 2 / ASR))
        d = min(LOOP_LEN + XFADE, n * HOP / ASR)
        out.append({"t0": t0, "rpm": rpm, "dur": d, "y": cut(x44, t0, d), "score": round((m - top) / 20 + 1, 3)})
    return out


def find_revs(an, tp):
    """Gasstöße: Grundton steigt binnen ≤ 1,4 s um ≥ 40 % und fällt danach wieder (oder die Aufnahme endet)."""
    t, f0, cl, rms = an["t"], an["f0"].copy(), an["clar"], an["rms"]
    dt = HOP / ASR
    good = (f0 > 0) & (cl >= 0.3)
    if good.sum() < 10:
        return []
    idx = np.arange(len(f0))
    lf = np.interp(idx, idx[good], np.log(f0[good]))
    # glätten (0,2 s)
    k = max(1, int(0.2 / dt))
    lf = np.convolve(lf, np.ones(k) / k, mode="same")
    top = np.percentile(rms, 98)
    out = []
    i = 0
    W = int(1.4 / dt)
    while i < len(lf) - 5:
        j_end = min(len(lf), i + W)
        j = i + int(np.argmax(lf[i:j_end]))
        if j > i and lf[j] - lf[i] >= np.log(1.4) and rms[j] > top - 14:
            # Spitze verfolgen, solange es weiter steigt
            while j + 1 < len(lf) and lf[j + 1] >= lf[j]:
                j += 1
            # Abfall bis 0,9 s nach der Spitze
            e = min(len(lf) - 1, j + int(0.9 / dt))
            s = max(0, i - int(0.12 / dt))
            if (t[e] - t[s]) <= 3.2:
                out.append({"t0": float(t[s] - WIN / 2 / ASR), "dur": float(t[e] - t[s]), "gain": round(float(np.exp(lf[j] - lf[i])), 2)})
            i = e + 1
        else:
            i += max(1, int(0.1 / dt))
    return [o for o in out if o["t0"] >= 0][:4]


def find_start(an, x_len):
    rms = an["rms"]
    t = an["t"]
    floor = np.percentile(rms, 8)
    top = np.percentile(rms, 98)
    if top - floor < 12:
        return None
    th = floor + 0.45 * (top - floor)
    hit = np.where(rms > th)[0]
    if not len(hit):
        return None
    t0 = max(0.0, t[hit[0]] - 0.35)
    return {"t0": float(t0), "dur": float(min(3.2, x_len - t0))}


def find_passes(an, max_n=3):
    rms, t = an["rms"], an["t"]
    dt = HOP / ASR
    k = max(1, int(0.25 / dt))
    sm = np.convolve(rms, np.ones(k) / k, mode="same")
    top = sm.max()
    out = []
    order = np.argsort(-sm)
    for i in order:
        if sm[i] < top - 8:
            break
        if any(abs(t[i] - o) < 4.5 for o in out):
            continue
        out.append(float(t[i]))
        if len(out) >= max_n:
            break
    res = []
    for pk in out:
        s = max(0.0, pk - 1.2)       # lauteste Stelle ~1,2 s nach Beginn (die Laufzeit löst so früh aus)
        res.append({"t0": s, "dur": min(3.0, t[-1] - s), "peak": pk})
    return res


def find_pops(x44, an, max_n=4):
    """kurze Knalle: 5-ms-Energie ≥ 15 dB über dem gleitenden Median (0,3 s) und laut genug."""
    hop = int(0.005 * SR)
    n = len(x44) // hop
    if n < 100:
        return []
    e = 10 * np.log10(np.mean(x44[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    k = 61
    pad = np.pad(e, k // 2, mode="edge")
    med = np.median(np.lib.stride_tricks.sliding_window_view(pad, k)[:n], axis=1)
    top = np.percentile(e, 99.5)
    cand = np.where((e - med > 15) & (e > top - 14))[0]
    out = []
    for c in cand:
        tc = c * hop / SR
        if any(abs(tc - o) < 0.35 for o in out):
            continue
        out.append(tc)
    out.sort(key=lambda tc: -e[int(tc * SR / hop)])
    return [{"t0": max(0.0, tc - 0.02), "dur": 0.32} for tc in out[:max_n]]


# ---------------------------------------------------------------- Aufbereiten / Schreiben

def cut(x, t0, dur):
    a = int(max(0, t0) * SR)
    return x[a:a + int(dur * SR)].copy()


def fade(y, fi, fo):
    y = y.copy()
    a, b = int(fi * SR), int(fo * SR)
    if a:
        y[:a] *= np.linspace(0, 1, a) ** 2
    if b:
        y[-b:] *= np.linspace(1, 0, b) ** 2
    return y


def make_loop(s, dur):
    """Schleife aus dem Stück s: Länge L+F, Anfang mit dem Überhang überblendet (gleiche Leistung) → nahtlos.
    Datei = [Ende der Schleife (PAD)] + Schleife + [Anfang der Schleife (PAD)]."""
    F = int(XFADE * SR)
    L = int((dur - XFADE) * SR)
    if len(s) < L + F:
        L = len(s) - F
    X = s[:L].copy()
    a = np.linspace(0, 1, F)
    X[:F] = s[:F] * np.sqrt(a) + s[L:L + F] * np.sqrt(1 - a)
    P = int(PAD * SR)
    return np.concatenate([X[-P:], X, X[:P]]), PAD, PAD + L / SR


def norm_rms(y, target_db, peak_db=-1.0, ref=None):
    r = ref if ref is not None else y
    rms = np.sqrt(np.mean(r ** 2) + 1e-12)
    g = 10 ** (target_db / 20) / rms
    pk = np.max(np.abs(y)) * g
    lim = 10 ** (peak_db / 20)
    if pk > lim:
        g *= lim / pk
    return y * g


def highpass(y, hz=28):
    return fft_band(y, SR, hz, 0) if len(y) > 64 else y


def encode(y, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".f32", delete=False) as f:
        f.write(np.clip(y, -1, 1).astype(np.float32).tobytes())
        tmp = f.name
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", tmp,
                        "-c:a", "libmp3lame", "-b:a", BITRATE, "-ar", str(SR), "-ac", "1", "-map_metadata", "-1", dst],
                        check=True)
    finally:
        os.unlink(tmp)


def build(only, report, cache):
    bank = {"version": 1, "types": {}, "sources": {}}
    pool = {tp: {"loops": [], "start": [], "rev": [], "pass": [], "pop": [], "turbo": []} for tp in TYPES}
    decoded = {}
    for tp, sid, user, title, lic, dur, path, hint in SOURCES:
        if only and tp not in only:
            continue
        p = fetch(cache, sid, path)
        if sid not in decoded:
            x = highpass(decode(p, SR))
            decoded[sid] = x
        x = decoded[sid]
        an = analyse(x, tp)
        L = len(x) / SR
        title_l = title.lower()
        found = {"loops": [], "start": [], "rev": [], "pass": [], "pop": [], "turbo": []}
        if hint.get("loops", True):
            found["loops"] = find_loops(an, tp, x)
        if hint.get("start") or ("start" in title_l and hint.get("start") is not False):
            s = find_start(an, L)
            if s:
                found["start"].append(s)
        if hint.get("revs", True) and tp != "ev":
            found["rev"] = find_revs(an, tp)
        if hint.get("pass"):
            found["pass"] = find_passes(an)
        if hint.get("pop") or (tp in POPS_TYPES and hint.get("revs", True)):
            found["pop"] = find_pops(x, an, 4 if hint.get("pop") else 2)
        if hint.get("turbo"):
            nz = np.where(np.abs(x) > 0.02 * np.max(np.abs(x)))[0]
            a, b = (nz[0] / SR, nz[-1] / SR) if len(nz) else (0, L)
            found["turbo"].append({"t0": max(0, a - 0.05), "dur": min(4.5, b - a + 0.2)})
        print("%-4s %7d %5.1fs %-40.40s loops=%s start=%d rev=%d pass=%d pop=%d turbo=%d" % (
            tp, sid, L, title, [l["rpm"] for l in found["loops"]], len(found["start"]), len(found["rev"]),
            len(found["pass"]), len(found["pop"]), len(found["turbo"])))
        for k, lst in found.items():
            for o in lst:
                o["src"] = sid
                pool[tp][k].append(o)
        bank["sources"][str(sid)] = {"user": user, "title": title.strip(), "lic": lic,
                                     "url": "https://freesound.org/people/%s/sounds/%d/" % (user, sid)}
    if report:
        return
    if os.path.isdir(OUT):
        for tp in TYPES:
            if not only or tp in only:
                shutil.rmtree(os.path.join(OUT, tp), ignore_errors=True)
        if os.path.exists(os.path.join(OUT, "bank.json")) and only:
            old = json.load(open(os.path.join(OUT, "bank.json"), encoding="utf-8"))
            for tp, v in old.get("types", {}).items():
                if tp not in only:
                    bank["types"][tp] = v
            for k, v in old.get("sources", {}).items():
                bank["sources"].setdefault(k, v)
    used = set()
    for tp, spec in TYPES.items():
        if only and tp not in only:
            continue
        P = pool[tp]
        entry = {k: spec[k] for k in ("label", "cyl", "idle", "red", "gears", "g1")}
        if spec.get("turbo"):
            entry["boost"] = True        # Turbo-Pfeifen in der Laufzeit (die Liste "turbo" sind Abblas-Klänge)
        # Schleifen: nach Güte, je Drehzahl-Nachbarschaft (±8 %) höchstens zwei verschiedene Aufnahmen
        # Schleifen: erst die beste Aufnahme je Ziel-Drehzahl, dann bis zu zwei weitere (andere Quellen) als Varianten
        loops = sorted(P["loops"], key=lambda o: -o["score"])
        chosen = []
        for rnd in (0, 1, 2):
            for o in loops:
                if any(o is c for c in chosen) or len(chosen) >= MAX_LOOPS:
                    continue
                near = [c for c in chosen if abs(np.log(o["rpm"] / c["rpm"])) < 0.08]
                if len(near) > rnd or any(c["src"] == o["src"] for c in near):
                    continue
                chosen.append(o)
        # oben auffüllen: geliehene Schleifen verwandter Motorarten (höchstens 4, je ≥ 15 % auseinander)
        top = max([c["rpm"] for c in chosen] or [spec["idle"]])
        lent = 0
        for sib in SIBLINGS.get(tp, []):
            for o in sorted(pool[sib]["loops"], key=lambda o: o["rpm"]):
                if top >= spec["red"] * 0.75 or lent >= 4:
                    break
                rpm = round(o["rpm"] * TYPES[sib]["cyl"] / spec["cyl"])
                if rpm < top * 1.15 or rpm > spec["red"]:
                    continue
                chosen.append(dict(o, rpm=rpm, lent=sib))
                top = rpm
                lent += 1
        chosen.sort(key=lambda o: o["rpm"])
        entry["loops"] = []
        for k, o in enumerate(chosen):
            y, ls, le = make_loop(o["y"], o["dur"])
            y = norm_rms(y, -20, -1.5)
            rel = "%s/loop-%d-%d.mp3" % (tp, o["rpm"], o["src"])
            encode(y, os.path.join(OUT, rel))
            e = {"f": rel, "rpm": o["rpm"], "ls": round(ls, 4), "le": round(le, 4), "src": o["src"]}
            if o.get("lent"):
                e["from"] = o["lent"]
            entry["loops"].append(e)
            used.add(o["src"])
        for kind in ("start", "rev", "pass", "pop", "turbo"):
            lst = P[kind]
            if kind == "rev":
                lst = sorted(lst, key=lambda o: -o["gain"])
            # möglichst viele verschiedene Aufnahmen: reihum je Quelle
            by = {}
            for o in lst:
                by.setdefault(o["src"], []).append(o)
            order = []
            while any(by.values()):
                for s in list(by):
                    if by[s]:
                        order.append(by[s].pop(0))
            order = order[:MAX_SHOTS[kind]]
            entry[kind] = []
            for k, o in enumerate(order):
                y = cut(decoded[o["src"]], o["t0"], o["dur"])
                if len(y) < SR * 0.1:
                    continue
                if kind == "pop":
                    y = fade(y, 0.003, 0.12)
                    y = norm_rms(y, -14, -3)
                elif kind == "pass":
                    y = fade(y, 0.4, 0.8)
                    y = norm_rms(y, -18, -1.5)
                elif kind == "start":
                    y = fade(y, 0.02, 0.6)
                    y = norm_rms(y, -20, -1.5)
                else:
                    y = fade(y, 0.03, 0.35)
                    y = norm_rms(y, -19, -1.5)
                rel = "%s/%s-%d-%d.mp3" % (tp, kind, o["src"], k)
                encode(y, os.path.join(OUT, rel))
                e = {"f": rel, "src": o["src"], "dur": round(len(y) / SR, 2)}
                if kind == "pass":
                    e["peak"] = round(o["peak"] - o["t0"], 2)
                entry[kind].append(e)
                used.add(o["src"])
        bank["types"][tp] = entry
        print("%-4s → %d Schleifen (%s), start %d, rev %d, pass %d, pop %d, turbo %d" % (
            tp, len(entry["loops"]), ", ".join(str(l["rpm"]) for l in entry["loops"]), len(entry["start"]),
            len(entry["rev"]), len(entry["pass"]), len(entry["pop"]), len(entry["turbo"])))
    if not only:
        bank["sources"] = {k: v for k, v in bank["sources"].items() if int(k) in used}
    with open(os.path.join(OUT, "bank.json"), "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=1)
    write_credits(bank)
    size = sum(os.path.getsize(os.path.join(d, n)) for d, _, ns in os.walk(OUT) for n in ns)
    print("gesamt %.2f MB in %s" % (size / 1e6, OUT))


def write_credits(bank):
    lines = ["# Engine sound credits", "",
             "Engine sounds for Car Race / Car Drive are cut from these Freesound recordings",
             "(built by `scripts/build_engine_sounds.py`). CC0 = public domain, CC BY 3.0/4.0 = attribution required.", "",
             "| Recording | Author | Licence | Used for |", "|---|---|---|---|"]
    use = {}
    for tp, e in bank["types"].items():
        for kind in ("loops", "start", "rev", "pass", "pop", "turbo"):
            for o in e.get(kind, []):
                use.setdefault(str(o["src"]), set()).add(e["label"])
    for sid, s in sorted(bank["sources"].items(), key=lambda kv: (kv[1]["lic"], kv[1]["user"].lower())):
        if sid not in use:
            continue
        lines.append("| [%s](%s) | %s | %s | %s |" % (s["title"].replace("|", "/"), s["url"], s["user"], s["lic"],
                                                     ", ".join(sorted(use[sid]))))
    lines.append("")
    with open(os.path.join(OUT, "CREDITS.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--cache", default=os.path.join(ROOT, "data", "engine-sounds-src"))
    a = ap.parse_args()
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg fehlt")
    build(set(a.only or []), a.report, a.cache)


if __name__ == "__main__":
    main()
