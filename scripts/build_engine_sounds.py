"""Motorklänge für Car Race / Car Drive aus echten Freesound-Aufnahmen bauen (lokal ausführen, braucht ffmpeg + numpy).

Ablauf je Aufnahme (Liste SOURCES unten, nur CC0 / CC BY):
  1. HQ-Vorschau (128 kbit/s MP3, öffentlich) nach data/engine-sounds-src/<id>.mp3 laden (≥ 1,2 s Abstand)
  2. mit ffmpeg nach Mono dekodieren, Pegel (RMS) und Grundton (Zündfrequenz, normierte Autokorrelation im für die
     Motorart möglichen Bereich) alle ~23 ms messen
  3. Stücke schneiden:
     - Schleifen (loop): ruhige Stellen mit stabilem Grundton (≤ 3 % Schwankung, gleichmäßiger Pegel), bis 2,4 s, mit
       Überblendung nahtlos gemacht; Drehzahl = Grundton · 120 / Zylinder. In der Datei steht vor und nach der Schleife
       ein Stück der Schleife selbst (PAD) – loopStart/loopEnd (ls/le) liegen damit unabhängig von der MP3-Verzögerung
       des Dekoders in einem periodischen Bereich
     - Sweeps (on = Hochlauf unter Gas, off = Abfall ohne Gas): Abschnitte zwischen Wendepunkten des Drehzahlverlaufs
       (Oktavsprünge repariert, Faktor ≥ 1,8, ≥ 0,6 s, fast monoton), bewertet nach Abdeckung Leerlauf…Begrenzer,
       Dauer, Klarheit, Pegel; Datei = Abschnitt ± 0,15 s, dazu der Drehzahlverlauf pts [[t, U/min], …] (monoton).
       Die Laufzeit spielt sie granular ab (Position = Drehzahl). Drehzahl-Beschriftung je Aufnahme ggf. × 2 (auto_oct)
     - Einmal-Klänge: start (Anlassen, nach Titel), rev (Gasstoß: Grundton steigt schnell ≥ 40 % und fällt wieder),
       pass (Vorbeifahrt: um die lautesten Stellen), pop (Fehlzündung/Knall: kurze Spitzen ≥ 15 dB über der Umgebung),
       turbo (Abblasventil/Turbo, ganze Aufnahme)
  4. Lautheit angleichen, Mono-MP3 96 kbit/s nach assets/sounds/engines/<typ>/…, dazu assets/sounds/engines/bank.json
     (je Motorart Kenndaten + Sweeps + Schleifen mit Drehzahl + Einmal-Klänge, Quellen, feste Aufnahme je Auto „cars“)
     und assets/sounds/engines/CREDITS.md. Hintergrund: docs/engine-sound-research.md

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
LOOP_LEN = 2.4      # Schleifenlänge s (höchstens; kurze Schleifen klingen als Wiederholung, „Schleifen/Kratzen“)
LOOP_MIN = 0.5      # kürzeste Schleife s
XFADE = 0.25        # Überblendung der Schleife s
N_LEVELS = 10       # Ziel-Drehzahlen je Motorart
PAD = 0.12          # Schleifen-Vorlauf/-Nachlauf in der Datei s
BITRATE = "96k"
MAX_LOOPS = 9       # je Motorart (Rückfall + Leerlauf; je Ziel-Drehzahl höchstens drei Aufnahmen)
MAX_SHOTS = {"start": 4, "rev": 7, "pass": 5, "pop": 6, "turbo": 3}

# Motorarten: Zylinder (Zündfrequenz = Drehzahl · Zyl / 120), Leerlauf, Begrenzer, Gänge, erster Gang bis Anteil von vmax;
# boost = Turbo-Pfeifen in der Laufzeit (True = Standardpegel, Zahl = Pegel). Kenndaten: docs/engine-sound-research.md
TYPES = {
    "i4": dict(label="Inline-4", cyl=4, idle=850, red=6800, gears=5, g1=0.30),
    "t4": dict(label="Turbo inline-4", cyl=4, idle=900, red=7200, gears=6, g1=0.27, turbo=True),
    "i6": dict(label="Inline-6", cyl=6, idle=750, red=7500, gears=6, g1=0.28),
    "f6": dict(label="Flat-6", cyl=6, idle=900, red=8800, gears=7, g1=0.24),
    "v6t": dict(label="Twin-turbo V6 (GT racer)", cyl=6, idle=900, red=8000, gears=7, g1=0.24, turbo=True),
    "v8m": dict(label="Muscle V8", cyl=8, idle=700, red=6500, gears=6, g1=0.30),
    "v8f": dict(label="Exotic V8 (flat-plane)", cyl=8, idle=1000, red=8800, gears=7, g1=0.24),
    "v8t": dict(label="Twin-turbo V8", cyl=8, idle=700, red=7000, gears=8, g1=0.22, turbo=True),
    "v10": dict(label="V10", cyl=10, idle=1000, red=8700, gears=7, g1=0.24),
    "v12": dict(label="V12", cyl=12, idle=950, red=8800, gears=7, g1=0.24),
    "f1": dict(label="Formula 1", cyl=8, idle=4000, red=15000, gears=8, g1=0.22),   # Begrenzer wie die V6-Hybride
    "dsl": dict(label="Diesel truck / bus", cyl=6, idle=600, red=2600, gears=6, g1=0.18, turbo=0.06),
    "ev": dict(label="Electric", cyl=2, idle=0, red=16000, gears=1, g1=1.0),
}

# (typ, Freesound-ID, Autor, Titel, Lizenz, Dauer s, Vorschau-Pfad, Hinweise)
# Hinweise: loops=False (keine Schleifen, z. B. Vorbeifahrt/fern), start/pass/turbo/pop=True (Einmal-Klang-Art erzwingen),
#           revs=False (keine Gasstöße suchen), sweeps=False (keine Hochläufe/Abfälle), oct=Faktor für die
#           Drehzahl-Beschriftung (sonst automatisch: Kreuzebenen-V8 u. a. werden oft auf der halben Zündfrequenz
#           erkannt → Leerlauf deutlich unter dem der Motorart → × 2)
SOURCES = [
    ("i4", 268623, "EverydaySounds", "VW Golf GTI Pull Away (Zoom H2n M&S).wav", "CC0", 53.1, "268/268623_2273054-lq.mp3", {}),
    ("i4", 487553, "thepodcastdoctor", "Honda Engine Start and Rev.wav", "CC0", 18.0, "487/487553_9945386-lq.mp3", {"start": True}),
    ("i4", 692112, "MPooman", "[ MPooman ] Honda Civic Engine Sounds (SE542) (High Quality)", "CC0", 219.5, "692/692112_14220990-lq.mp3", {}),
    ("i4", 535944, "marksayer", "Alfa Romeo Brera accelerating away", "CC0", 14.8, "535/535944_9609148-lq.mp3", {}),
    ("i4", 522221, "Nox_Sound", "Vehicle_Car_Peugeot_308_Acceleration_Idle_Mono.wav", "CC0", 60.4, "522/522221_9250976-lq.mp3", {}),
    ("i4", 33192, "Heigh-hoo", "racing honda.aif", "CC0", 17.9, "33/33192_21830-lq.mp3", {}),
    ("i4", 760690, "imaniv", "Altima startup 1", "CC0", 22.0, "760/760690_12634362-lq.mp3", {"start": True, "sweeps": False}),
    ("i4", 425868, "Soundholder", "Volkswagen Golf V 1.6 FSI exterior passby fast speed stereo ORTF 8040.wav", "CC BY", 19.4, "425/425868_4421503-lq.mp3", {"loops": False, "pass": True, "revs": False, "sweeps": False}),
    ("t4", 496171, "editboy23", "Import car revs on Chassis Dyno with Turbo.wav", "CC0", 35.5, "496/496171_1784475-lq.mp3", {}),
    ("t4", 273334, "ulose2piranha", "WRX - Exhaust sounds", "CC0", 35.2, "273/273334_4168822-lq.mp3", {}),
    ("t4", 659544, "EwanPenman11", "Turbo Spooling and Blow Off.WAV", "CC0", 5.3, "659/659544_13241413-lq.mp3", {"loops": False, "turbo": True, "revs": False, "sweeps": False}),
    ("t4", 369797, "t33kno", "subaru impreza start up-idle-launch limiter.wav", "CC0", 29.1, "369/369797_6850406-lq.mp3", {"start": True}),
    ("t4", 625702, "MilanKovanda", "Subaru Impreza STI idling", "CC BY", 8.1, "625/625702_6886013-lq.mp3", {"sweeps": False}),
    ("t4", 797835, "modusmogulus", "Car Antilag (No cleanup, 32float)", "CC0", 11.3, "797/797835_15956618-lq.mp3", {"loops": False, "pop": True, "sweeps": False}),
    ("i6", 21741, "Erdie", "car-start.mp3", "CC BY", 9.8, "21/21741_118241-lq.mp3", {"start": True, "sweeps": False}),
    ("i6", 57939, "joanfelipsound", "engine start BMW 320 VG91.wav", "CC0", 23.1, "57/57939_515841-lq.mp3", {"start": True, "sweeps": False}),
    ("i6", 173005, "ninebilly", "BMW 320 1988..wav", "CC0", 27.0, "173/173005_773642-lq.mp3", {}),
    ("i6", 185151, "Ears68", "6-cyl-VintageRaceCar-toStartLine-burnout-StartClimb-051.wav", "CC0", 61.1, "185/185151_2214631-lq.mp3", {}),
    ("i6", 415276, "ikbenraar", "BMWM3_01.wav", "CC BY", 107.1, "415/415276_754558-lq.mp3", {}),
    ("i6", 415275, "ikbenraar", "BMWM3_02.wav", "CC BY", 259.9, "415/415275_754558-lq.mp3", {}),
    ("f6", 457560, "florianreichelt", "Acceleration of a Sports Car Engine like Ferrari or Lamborghini or Porsche", "CC0", 16.1, "457/457560_6253486-lq.mp3", {}),
    ("f6", 90404, "mmplisskin", "Porsche.MP3", "CC0", 7.6, "90/90404_1473497-lq.mp3", {}),
    ("f6", 585710, "kevp888", "R4_00225_FR_SportsCar.wav", "CC BY", 15.8, "585/585710_9034501-lq.mp3", {}),
    ("f6", 577941, "kevp888", "VOC_210625-1847_FR_SportsCar.wav", "CC BY", 25.8, "577/577941_9034501-lq.mp3", {}),
    ("f6", 55727, "mharo", "porsche_911.wav", "CC0", 10.0, "55/55727_267249-lq.mp3", {}),
    ("f6", 772802, "jerry.berumen", "vehicle car porsche 911 revving engine motor boxer", "CC BY", 52.6, "772/772802_6753194-lq.mp3", {}),
    ("v6t", 772801, "jerry.berumen", "mercedes benz c43 AMG exhaust rev slow rear", "CC BY", 46.2, "772/772801_6753194-lq.mp3", {"start": True}),
    ("v6t", 754775, "EvanBoyerman", "Sports Car Accelerating/Speeding Up Fast - Exhaust (3.2 V6)", "CC BY", 89.7, "754/754775_6823432-lq.mp3", {}),
    ("v6t", 754776, "EvanBoyerman", "Sports Car Accelerating/Speeding Up Medium - Exhaust (3.2 V6)", "CC BY", 34.3, "754/754776_6823432-lq.mp3", {}),
    ("v8m", 205509, "VacekH", "mustang 8.wav", "CC0", 38.4, "205/205509_1970026-lq.mp3", {}),
    ("v8m", 205504, "VacekH", "mustang 1.wav", "CC0", 29.5, "205/205504_1970026-lq.mp3", {}),
    ("v8m", 205503, "VacekH", "mustang 10.wav", "CC0", 54.6, "205/205503_1970026-lq.mp3", {}),
    ("v8m", 384056, "pastori666", "ford mustang v8 rear 4.wav", "CC BY", 31.6, "384/384056_7160746-lq.mp3", {}),
    ("v8m", 517882, "Acekat13X31", "Mustang Engine Rev", "CC BY", 13.4, "517/517882_11110271-lq.mp3", {}),
    ("v8m", 711565, "Quold", "Tuned 2023 Corvette Sting Ray in parking lot", "CC0", 27.5, "711/711565_1995411-lq.mp3", {}),
    ("v8m", 455926, "noiseloop", "Acceleration sounds of Ford V8 5 Liter engine", "CC BY", 11.5, "455/455926_8138660-lq.mp3", {}),
    ("v8m", 455925, "noiseloop", "Starting of Ford V8 5 Liter engine", "CC BY", 5.7, "455/455925_8138660-lq.mp3", {"start": True, "sweeps": False}),
    ("v8m", 213977, "Ears68", "V-8HotRodApproachRevUpsDrivePast-cut-DR087.wav", "CC0", 74.2, "213/213977_2214631-lq.mp3", {"pass": True}),
    ("v8f", 585215, "myeclecticself", "Car Engine: Maserati GranTurismo Switch to Sport Mode and Launch", "CC0", 16.6, "585/585215_1252192-lq.mp3", {}),
    ("v8f", 43484, "enginemusic", "ferrari355underhood4.mp3", "CC BY", 18.2, "43/43484_462458-lq.mp3", {}),
    ("v8f", 241083, "PritzProductions", "Ferrari 360 Spider - engine sound ", "CC0", 37.9, "241/241083_3450345-lq.mp3", {}),
    ("v8f", 370278, "biholao", "Acceleration 1.wav (Ferrari accelerating)", "CC0", 180.0, "370/370278_6820745-lq.mp3", {}),
    ("v8f", 659560, "EwanPenman11", "Ferrari start up and drive off.WAV", "CC0", 37.3, "659/659560_13241413-lq.mp3", {"start": True, "oct": 1}),
    ("v8f", 465453, "lmartins", "Maserati GranTurismo S", "CC BY", 66.2, "465/465453_113-lq.mp3", {}),
    ("v8t", 339703, "FFKoenigsegg20012017", "Audi V8 Acceleration Sound", "CC0", 13.6, "339/339703_6037438-lq.mp3", {"oct": 2}),
    ("v8t", 505321, "marcelweiss", "S63 AMG V8 Engine Revs", "CC0", 6.2, "505/505321_7236652-lq.mp3", {}),
    ("v8t", 659560, "EwanPenman11", "Ferrari start up and drive off.WAV", "CC0", 37.3, "659/659560_13241413-lq.mp3", {"start": True, "oct": 1}),
    ("v8t", 547057, "lmartins", "Aston Martin V8 Vantage start-up.m4a", "CC BY", 9.9, "547/547057_113-lq.mp3", {"start": True, "sweeps": False}),
    ("v10", 457560, "florianreichelt", "Acceleration of a Sports Car Engine like Ferrari or Lamborghini or Porsche", "CC0", 16.1, "457/457560_6253486-lq.mp3", {}),
    ("v10", 429099, "ikbenraar", "Audi_R8_01.wav (Audi R8 at Zolder)", "CC BY", 246.6, "429/429099_754558-lq.mp3", {"pass": True}),
    ("v10", 112076, "cheesepuff", "lambo rev.mp3", "CC0", 5.3, "112/112076_682033-lq.mp3", {}),
    ("v10", 478756, "richwise", "Supercar rev", "CC0", 13.9, "478/478756_1481531-lq.mp3", {}),
    ("v10", 564375, "JaimeLopes", "Lamborghini Sounds", "CC BY", 36.4, "564/564375_628040-lq.mp3", {}),
    ("v10", 649961, "kevp888", "VOC_220909-2079_FR_SportsCar.wav", "CC BY", 29.1, "649/649961_9034501-lq.mp3", {}),
    ("v10", 649889, "kevp888", "VOC_220909-2078_FR_SportsCar.wav", "CC BY", 25.0, "649/649889_9034501-lq.mp3", {}),
    ("v10", 478597, "Kinoton", "Car, BMW M6, Start, Idle, Accelerate", "CC0", 41.5, "478/478597_2247456-lq.mp3", {"start": True}),
    ("v12", 112076, "cheesepuff", "lambo rev.mp3", "CC0", 5.3, "112/112076_682033-lq.mp3", {}),
    ("v12", 112075, "cheesepuff", "Lambo idle and rev.mp3", "CC0", 63.9, "112/112075_682033-lq.mp3", {}),
    ("v12", 484191, "Janosch-JR", "V12 Engine - Short Rev", "CC0", 3.4, "484/484191_7367578-lq.mp3", {}),
    ("v12", 564373, "JaimeLopes", "Lambo Start Up Sound", "CC0", 22.2, "564/564373_628040-lq.mp3", {"start": True}),
    ("f1", 44289, "rfhache", "F1 BR 07 2P MSBraking1turn.wav", "CC BY", 15.7, "44/44289_201367-lq.mp3", {"loops": False, "pass": True, "sweeps": False}),
    ("f1", 14833, "Heigh-hoo", "backstraight.aif", "CC0", 25.5, "14/14833_21830-lq.mp3", {"pass": True}),
    ("f1", 200810, "WebbFilmsUK", "F1 Single Car Pass.wav", "CC BY", 16.1, "200/200810_2641534-lq.mp3", {"loops": False, "pass": True, "revs": False, "sweeps": False}),
    ("f1", 478546, "LordFluffeh", "Formula 1 racing", "CC0", 28.8, "478/478546_10244830-lq.mp3", {"pass": True}),
    ("f1", 181187, "Ears68", "F-1raceCar-IdleAndRaceStartDemo.wav", "CC0", 24.9, "181/181187_2214631-lq.mp3", {}),
    ("f1", 44771, "rfhache", "F1 BR 06 Engine Starts.wav", "CC BY", 7.3, "44/44771_201367-lq.mp3", {"start": True}),
    ("f1", 131239, "Heigh-hoo", "finish2011.wav", "CC0", 11.5, "131/131239_21830-lq.mp3", {"pass": True}),
    ("f1", 400130, "monkeyman535", "Formula F1 Racing.wav", "CC BY", 9.0, "400/400130_4524389-lq.mp3", {"pass": True}),
    ("f1", 77667, "LG", "BCR F1 Car 07.wav", "CC BY", 39.9, "77/77667_36188-lq.mp3", {}),
    ("dsl", 128160, "ibirdfilm", "Diesel Truck Idling Front.wav", "CC0", 34.4, "128/128160_1372389-lq.mp3", {"revs": False}),
    ("dsl", 49988, "BoilingSand", "080316 Dodge truck revving in driveway.wav", "CC BY", 34.7, "49/49988_571325-lq.mp3", {}),
    ("dsl", 186935, "ReadeOnly", "engine_idle_loop.wav", "CC0", 6.1, "186/186935_545448-lq.mp3", {"revs": False, "sweeps": False}),
    ("dsl", 435656, "YellowJacketStudios", "FORD LTL 9000_engine start and idle.wav", "CC0", 56.6, "435/435656_2347916-lq.mp3", {"start": True}),
    ("dsl", 828756, "chungus43A", "Mississauga Transit Orion V bus engine", "CC0", 48.0, "828/828756_12024110-lq.mp3", {}),
    ("ev", 761685, "justVova", "Acceleration of an electric car", "CC0", 5.2, "761/761685_13088347-lq.mp3", {"revs": False}),
    ("ev", 807728, "Sam-Mortley", "electric car", "CC0", 19.5, "807/807728_16596600-lq.mp3", {"revs": False}),
    ("ev", 635454, "kevp888", "VOC_220519-2006-2_FR_ElectricVehicle.wav", "CC BY", 30.7, "635/635454_9034501-lq.mp3", {"revs": False, "pass": True}),
    ("ev", 170421, "Eelke", "nissan-leaf", "CC0", 9.4, "170/170421_670687-lq.mp3", {"revs": False}),
    ("ev", 324119, "evsecrets", "Electric car start-up and drive away", "CC0", 63.9, "324/324119_2367065-lq.mp3", {"revs": False}),
]
# Bewusst nicht (mehr) verwendet – nach Messung (Grundton über die Zeit, Klarheit, Pegel), Stand 2026-11:
#   174858 „MITSUBISHI IMIEV … SIDE MIRROR motor“ – Spiegel-Stellmotor, kein Antrieb
#   408896 „Engine sound“ (v12) – Grundton steht bei einer Frequenz, passt zu keiner V12-Drehzahl (kein Motorlauf)
#   377148 „Distant Loud Sports Car Vroom“, 641824 „lamborghini“ – fern bzw. kaum Grundton (Klarheit < 0,45)
#   14830 „MSchFerr“ – 5,7 s, unklar was, Drehzahl springt
#   133831 „CarRumble1“, 432508 „Open header V8 cars …“, 144454 „Hot-Rod … BigSpchg“, 651534 „v8 engine rev“ –
#        kein brauchbarer Hochlauf, verrauscht/Publikum, Klarheit ≤ 0,64
#   215960, 424738 (Civic), 128612 (Z4), 466715, 401558, 269771, 343369 (M3 accelerate) – kurz/dünn, durch die
#        langen M3-Aufnahmen von ikbenraar ersetzt
#   181900 „Bus engine looped“ – Leerlauf doppelt (828756 reicht)
#   478597 „BMW M6“ war Reihensechser – der E63 M6 hat einen V10 → jetzt unter v10
# Fehlen einer Motorart hohe Drehzahlen (oberste Schleife < 75 % des Begrenzers), leiht sie Schleifen verwandter
# Motorarten mit gleicher Zündfrequenz (Drehzahl × Zylinder / eigene Zylinder) – in dieser Reihenfolge
SIBLINGS = {"v12": ["v10", "f1", "v8f"], "v10": ["v12", "f1", "v8f"], "v8m": ["v8t", "v8f", "v10"], "v8f": ["v10", "v8m", "f1"],
            "v8t": ["v8m", "v8f"], "v6t": ["f6", "i6", "t4"], "i6": ["f6", "i4", "t4"], "f6": ["i6", "v8f"], "i4": ["t4", "i6"], "t4": ["i4", "i6"],
            "f1": ["v10"]}
POPS_TYPES = {"t4", "i6", "f6", "v6t", "v8m", "v8f", "v8t", "v10", "v12", "f1"}
# Einzelne Autos: Aufnahme fest (Anlassen, Leerlauf und Hochlauf aus demselben Mitschnitt, wenn vorhanden)
CARS = {
    "2020-abt-sportline-audi-rs6": 659560,     # Nutzer: Anlassen „mega“ → Leerlauf/Anfahren aus derselben Aufnahme
    "bmw-m3-competition": 415275,
    "bmw-m2-competition-f87": 415276,
}
MAX_SWEEPS = {"on": 6, "off": 4}


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


def smooth_f0(an, tp, oct_=1.0):
    """Grundton geglättet und über unklare Stellen interpoliert; dazu die Maske der verlässlichen Stellen."""
    f0, cl = an["f0"], an["clar"]
    sp = TYPES[tp]
    fmin = sp["idle"] * 0.5 * sp["cyl"] / 120 / oct_
    fmax = sp["red"] * 1.08 * sp["cyl"] / 120 / oct_
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


def find_loops(an, tp, x44, oct_=1.0):
    """Schleifen je Ziel-Drehzahl: zusammenhängende Stellen, an denen der Grundton ±14 % um das Ziel liegt
    (laut genug, verlässlicher Grundton), auf genau die Ziel-Drehzahl geglättet (flatten). Auch Hochdreh-Stellen
    liefern so Schleifen, solange sie lange genug im Band bleiben."""
    sp = TYPES[tp]
    t, rms = an["t"], an["rms"]
    top = np.percentile(rms, 98)
    out = []
    if tp == "ev":
        return find_loops_ev(an, x44)
    f, good = smooth_f0(an, tp, oct_)
    if f is None:
        return out
    need = LOOP_MIN + XFADE
    for rpm in levels(tp):
        ft = rpm * sp["cyl"] / 120 / oct_
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


def track(an, tp, oct_=1.0):
    """Drehzahlverlauf für Sweeps: Oktavsprünge zwischen Nachbarschritten repariert (je Schritt f, f/2 oder 2f – das
    dem Vorgänger nächste), über Lücken interpoliert, geglättet; × oct (Beschriftungs-Korrektur je Aufnahme).
    → (U/min je Analyse-Schritt, Maske der verlässlichen Schritte) oder (None, None)."""
    sp = TYPES[tp]
    f0, cl = an["f0"], an["clar"]
    lo = sp["idle"] * 0.4 * sp["cyl"] / 120
    hi = sp["red"] * 1.3 * sp["cyl"] / 120
    out = np.zeros_like(f0)
    prev, gap = None, 0
    for i, f in enumerate(f0):
        if f <= 0 or cl[i] < 0.3:
            gap += 1
            if gap > 8:
                prev = None
            continue
        gap = 0
        if prev is not None:
            c = [f * m for m in (0.5, 1, 2) if lo <= f * m <= hi] or [f]
            g = min(c, key=lambda v: abs(np.log(v / prev)))
            if abs(np.log(g / prev)) < np.log(1.25):
                f = g
        out[i] = f
        prev = f
    good = out > 0
    if good.sum() < 10:
        return None, None
    idx = np.arange(len(out))
    lf = np.interp(idx, idx[good], np.log(out[good]))
    k = 5
    lf = np.convolve(np.pad(lf, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    return np.exp(lf) * 120 / sp["cyl"] * oct_, good


def auto_oct(an, tp, rpm, good):
    """Beschriftungs-Korrektur je Aufnahme: liegt der Leerlauf (10. Perzentil der lauten, klaren Stellen) unter 70 %
    des Leerlaufs der Motorart und passt der doppelte Wert noch unter den Begrenzer, wurde eine halbe Ordnung
    erkannt (typisch Kreuzebenen-V8: „Blubbern“ auf der halben Zündfrequenz) → × 2."""
    if rpm is None:
        return 1.0
    sp = TYPES[tp]
    top = np.percentile(an["rms"], 98)
    vv = good & (an["rms"] > top - 22)
    if vv.sum() < 10:
        return 1.0
    p10, p95 = np.percentile(rpm[vv], 10), np.percentile(rpm[vv], 95)
    return 2.0 if p10 < 0.7 * sp["idle"] and p95 * 2 <= sp["red"] * 1.1 else 1.0


def find_sweeps(an, tp, rpm, good):
    """Hochläufe (up) und Abfälle (down): Abschnitte zwischen Wendepunkten des Drehzahlverlaufs (Hysterese 12 %),
    an Messsprüngen (> 12 % je Schritt) geteilt, ≥ 0,45 s, Drehzahl ändert sich ≥ Faktor 1,35, fast durchgehend in
    eine Richtung, laut und mit klarem Grundton. Kurze Stücke decken Teilbereiche ab (z. B. ein Gang durchgezogen) –
    die Auswahl setzt daraus den Drehzahlbereich zusammen.
    Bewertung: Abdeckung von Leerlauf…Begrenzer, Dauer (langsame Hochläufe = unter Last = mehr Material je Drehzahl),
    Klarheit, Pegel; unplausibel schnelle Sprünge (> 15 000 U/min/s, Messfehler) fliegen raus."""
    sp = TYPES[tp]
    t, rms, cl = an["t"], an["rms"], an["clar"]
    top = np.percentile(rms, 98)
    voiced = good & (rms > top - 22)
    lf = np.log(np.maximum(rpm, 1))
    th = np.log(1.12)
    pts, d, lo_i, hi_i = [], 0, 0, 0
    for i in range(len(lf)):
        if not voiced[i]:
            continue
        if lf[i] > lf[hi_i] or not voiced[hi_i]:
            hi_i = i
        if lf[i] < lf[lo_i] or not voiced[lo_i]:
            lo_i = i
        if d >= 0 and lf[hi_i] - lf[i] > th and hi_i >= lo_i:
            pts.append(hi_i); d = -1; lo_i = i
        elif d <= 0 and lf[i] - lf[lo_i] > th and lo_i >= hi_i:
            pts.append(lo_i); d = 1; hi_i = i
    # Abschnitte an Sprüngen (> 12 % je Analyse-Schritt ≈ 23 ms: Messfehler, kein Motor dreht so schnell) teilen
    segs = []
    for a, b in zip(pts, pts[1:]):
        jump = np.where(np.abs(np.diff(lf[a:b + 1])) > np.log(1.12))[0]
        cuts = [a] + [a + int(j) + 1 for j in jump] + [b]
        for u, w in zip(cuts, cuts[1:]):
            if w - 1 > u:
                segs.append((u, w - 1 if w != b else b))
    out = []
    for a, b in segs:
        dur = t[b] - t[a]
        r0, r1 = rpm[a], rpm[b]
        ratio = max(r0, r1) / max(1, min(r0, r1))
        if dur < 0.45 or ratio < 1.35:
            continue
        seg = lf[a:b + 1]
        dd = np.diff(seg) * (1 if r1 > r0 else -1)
        mono = float(np.mean(dd >= -0.002))
        v = float(np.mean(voiced[a:b + 1]))
        slope = abs(r1 - r0) / dur
        if mono < 0.8 or v < 0.8 or slope > 15000:
            continue
        lo, hi = min(r0, r1), max(r0, r1)
        cover = np.log(min(hi, sp["red"]) / max(lo, sp["idle"] * 0.9)) / np.log(sp["red"] / (sp["idle"] * 0.9))
        lvl = float(np.mean(rms[a:b + 1]) - top)
        sc = 2 * max(0.0, cover) + 0.25 * min(dur, 4.0) + float(np.mean(cl[a:b + 1])) + 0.03 * max(lvl, -20)
        if hi > sp["red"] * 1.15:
            sc -= 0.6
        out.append({"kind": "up" if r1 > r0 else "down", "a": a, "b": b, "t0": float(t[a]), "dur": float(dur),
                    "r0": float(r0), "r1": float(r1), "score": round(sc, 3)})
    return out


def sweep_clip(x44, an, rpm, s):
    """Sweep schneiden: Abschnitt + je 0,15 s Rand; Drehzahlverlauf alle ~23 ms, monoton gemacht (Hochlauf:
    laufendes Maximum, Abfall: laufendes Minimum). → (Audio, pts [[t, U/min], …] relativ zum Dateianfang)."""
    t = an["t"]
    m = 0.15
    a_t = max(0.0, t[s["a"]] - m)
    b_t = min(len(x44) / SR, t[s["b"]] + m)
    y = x44[int(a_t * SR):int(b_t * SR)].copy()
    r = rpm[s["a"]:s["b"] + 1].copy()
    r = np.maximum.accumulate(r) if s["kind"] == "up" else np.minimum.accumulate(r)
    tt = t[s["a"]:s["b"] + 1] - a_t
    pts = [[round(float(a), 3), int(round(float(b)))] for a, b in zip(tt, r)]
    return y, pts


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
    bank = {"version": 2, "types": {}, "sources": {}, "cars": {}}
    pool = {tp: {"loops": [], "start": [], "rev": [], "pass": [], "pop": [], "turbo": [], "on": [], "off": []} for tp in TYPES}
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
        found = {"loops": [], "start": [], "rev": [], "pass": [], "pop": [], "turbo": [], "on": [], "off": []}
        oct_, rpm, good = 1.0, None, None
        if tp != "ev":
            rpm, good = track(an, tp)
            oct_ = hint.get("oct") or auto_oct(an, tp, rpm, good)
            if rpm is not None:
                rpm = rpm * oct_
        if hint.get("loops", True):
            found["loops"] = find_loops(an, tp, x, oct_)
        if rpm is not None and hint.get("sweeps", True):
            for sw in find_sweeps(an, tp, rpm, good):
                y, pts = sweep_clip(x, an, rpm, sw)
                sw.update(y=y, pts=pts)
                found["on" if sw["kind"] == "up" else "off"].append(sw)
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
        print("%-4s %7d %5.1fs %-40.40s oct=%g loops=%s start=%d rev=%d pass=%d pop=%d turbo=%d" % (
            tp, sid, L, title, oct_, [l["rpm"] for l in found["loops"]], len(found["start"]), len(found["rev"]),
            len(found["pass"]), len(found["pop"]), len(found["turbo"])))
        for k in ("on", "off"):
            for sw in sorted(found[k], key=lambda o: -o["score"])[:3]:
                print("       %-3s %.2f t=%6.2f %4.2fs %5d→%5d" % (k, sw["score"], sw["t0"], sw["dur"], sw["r0"], sw["r1"]))
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
            entry["boost"] = spec["turbo"]   # Turbo-Pfeifen in der Laufzeit (die Liste "turbo" sind Abblas-Klänge)
        # Sweeps: Stücke so wählen, dass sie zusammen Leerlauf…Begrenzer abdecken (log. Drehzahl): nach Güte, ein Stück
        # kommt nur dazu, wenn es ≥ 12 % neuen Bereich bringt; die festen Autos (CARS) bekommen ihre besten Stücke dazu
        fixed = [src for key, src in CARS.items() if any(o["src"] == src for o in P["on"])]
        for kind in ("on", "off"):
            # nur plausible Bereiche (Messfehler reichen sonst weit über den Begrenzer)
            lst = sorted([o for o in P[kind] if max(o["r0"], o["r1"]) <= spec["red"] * 1.15
                          and min(o["r0"], o["r1"]) >= spec["idle"] * 0.5], key=lambda o: -o["score"])
            lo_t, hi_t = np.log(spec["idle"] * 1.1), np.log(spec["red"] * 0.97)
            cov = []

            def gain(o):
                a, b = max(lo_t, np.log(min(o["r0"], o["r1"]))), min(hi_t, np.log(max(o["r0"], o["r1"])))
                if b <= a:
                    return 0.0
                g = b - a
                for c0, c1 in cov:
                    g -= max(0.0, min(b, c1) - max(a, c0))
                return g
            pick = []
            for o in lst:
                if len(pick) >= MAX_SWEEPS[kind]:
                    break
                if gain(o) >= np.log(1.12) or not pick:
                    pick.append(o)
                    cov.append((np.log(min(o["r0"], o["r1"])), np.log(max(o["r0"], o["r1"]))))
            for src in fixed:
                for o in [o for o in lst if o["src"] == src][:2]:
                    if o not in pick:
                        pick.append(o)
            # reicht immer noch keiner bis 75 %: Hochlauf einer verwandten Motorart leihen (gleiche Zündfrequenz,
            # Drehzahl × deren Zylinder / eigene Zylinder), wie bei den Schleifen
            top = max([max(o["r0"], o["r1"]) for o in pick] or [0])
            for _ in range(2):
                if kind != "on" or top >= spec["red"] * 0.75:
                    break
                c = []
                for sib in SIBLINGS.get(tp, []):
                    k_ = TYPES[sib]["cyl"] / spec["cyl"]
                    c += [(o, k_, sib) for o in pool[sib]["on"] if max(o["r0"], o["r1"]) * k_ <= spec["red"] * 1.1
                          and max(o["r0"], o["r1"]) * k_ > top * 1.15 and min(o["r0"], o["r1"]) * k_ >= spec["idle"] * 0.5]
                if not c:
                    break
                # reicht eines bis 65 % des Begrenzers: das der nächstverwandten Motorart (Reihenfolge SIBLINGS), dort
                # das beste (Güte); sonst das am höchsten reichende
                far = [e for e in c if max(e[0]["r0"], e[0]["r1"]) * e[1] >= spec["red"] * 0.65]
                o, k_, sib = min(far, key=lambda e: (SIBLINGS[tp].index(e[2]), -e[0]["score"])) if far else \
                    max(c, key=lambda e: (max(e[0]["r0"], e[0]["r1"]) * e[1], e[0]["score"]))
                pick.append(dict(o, r0=o["r0"] * k_, r1=o["r1"] * k_, lent=sib,
                                 pts=[[a, int(round(b * k_))] for a, b in o["pts"]]))
                top = max(o["r0"], o["r1"]) * k_
            entry[kind] = []
            for k, o in enumerate(pick):
                y = o["y"]
                q = max(1, len(y) // 4)
                y = norm_rms(fade(y, 0.01, 0.01), -20, -1.0, ref=y[:q] if kind == "on" else y[-q:])
                rel = "%s/%s-%d-%d.mp3" % (tp, kind, o["src"], k)
                encode(y, os.path.join(OUT, rel))
                e = {"f": rel, "src": o["src"], "dur": round(len(y) / SR, 3), "pts": o["pts"], "score": o["score"]}
                if o.get("lent"):
                    e["from"] = o["lent"]
                entry[kind].append(e)
                used.add(o["src"])
        for key, src in CARS.items():
            if any(o["src"] == src for o in entry["on"]) or any(o["src"] == src for o in P["start"]):
                bank["cars"][key] = src
        sweep_srcs = {o["src"] for o in entry["on"]} | set(CARS.values())
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
        # Leerlauf-Schleife je Sweep-/Auto-Quelle (Leerlauf und Hochlauf aus derselben Aufnahme)
        for src in sweep_srcs:
            if any(c["src"] == src and c["rpm"] <= spec["idle"] * 1.3 for c in chosen):
                continue
            il = [o for o in loops if o["src"] == src and o["rpm"] <= spec["idle"] * 1.3]
            if il:
                chosen.append(il[0])
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
        print("%-4s → Hochläufe %s, Abfälle %s" % (tp, ["%d:%d-%d" % (o["src"], o["pts"][0][1], o["pts"][-1][1]) for o in entry["on"]],
                                                  ["%d:%d-%d" % (o["src"], o["pts"][0][1], o["pts"][-1][1]) for o in entry["off"]]))
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
        for kind in ("loops", "on", "off", "start", "rev", "pass", "pop", "turbo"):
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
