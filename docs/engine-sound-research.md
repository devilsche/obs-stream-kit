# Motorklang – Recherche und Entscheidungen

Grundlage für `scripts/build_engine_sounds.py` (Schnitt der Freesound-Aufnahmen) und `js/car-engine-audio.js`
(Laufzeit). Stand 2026-11. Ohne Abhören entstanden: Auswahl und Schnitt richten sich nach Messwerten
(Grundton über die Zeit, Harmonie, Pegel), beurteilen muss das Ohr – dafür `tools/engine-sound-lab.html`.

## Wie Spiele/Simulationen Motoren klingen lassen

1. **Schleifen je Drehzahl** (klassisch, „loop based“): mehrere stehende Schleifen bei festen Drehzahlen, Tonhöhe
   per Abspielrate auf die aktuelle Drehzahl gezogen, zwischen Nachbarn überblendet. Funktioniert, wenn die
   Schleifen eng liegen (Faustregel ±10–20 % Tonhöhenänderung je Schleife, darüber klingt es nach „Mickey Mouse“
   bzw. Zeitlupe) und unter Last (on-load) und ohne Last (off-load) getrennte Sätze vorhanden sind. Quellen:
   Audiokinetic, *Loop-Based Car Engine Design with Wwise* Teil 1/2
   (<https://audiokinetic.com/loop-based-car-engine-design-with-wwise-part-1>,
   <https://www.audiokinetic.com/en/loop-based-car-engine-design-with-wwise-part-2>).
2. **Granular über einen Hochdreh-Mitschnitt** („RPM sweep“, Scrubbing): Ein durchgehender Hochlauf unter Last
   (am besten Prüfstand oder ein Gang voll durchgezogen) wird mit kurzen gefensterten Körnern (≈ 40–100 ms,
   Hann, ~50 % Überlappung) abgespielt; die Leseposition folgt der Drehzahl, die Tonhöhe stimmt damit schon aus der
   Aufnahme, nur Restabweichungen werden um wenige Prozent nachgezogen. Die guten Werkzeuge (AudioMotors, REV,
   Wwise-Granular) erkennen dafür die Motorzyklen in der Analyse und setzen die Körner zyklus-synchron, damit sich
   überlappende Körner nicht gegenseitig auslöschen (Kammfilter/„Phasing“). Quellen: Audiokinetic,
   *Engine Sound Modeling: From Sampling to Granular Synthesis in Wwise*
   (<https://www.audiokinetic.com/engine-sound-modeling-from-sampling-to-granular-synthesis-in-wwise>);
   MCV/Develop, *How to make racing car engines roar using AudioMotors/FMOD*
   (<https://www.mcvuk.com/development/how-to-make-racing-car-engines-roar-using-audiomotors-fmod>) – „granular
   synthesis … preserves the short-time signal's timbre“, „engine cycle positions (best crossfade points) are
   automatically detected“.
3. **Last-Ebenen**: on-load (Gas offen, voll, kehlig, mehr Ansauggeräusch) und off-load (Schub/Gas weg: dünner,
   dumpfer, Knallen/Sprotzeln im Auspuff) haben eigene Aufnahmen; ein Last-Parameter blendet über. Off-load =
   „kein Gas, Drehzahl über Leerlauf“ (Audiokinetic Teil 2). BeamNG mischt ebenso nach Last
   (<https://documentation.beamng.com/modding/vehicle/sections/sounds/engine_audio/>).
4. **Mehr Schichten** (Ansaugung, Auspuff, Mechanik, Turbo, Getriebe) machen große Produktionen; hier reicht
   Auspuff-Aufnahme + synthetisches Turbo-Pfeifen + Einmal-Klänge (Abblasen, Knall, Anlassen, Vorbeifahrt).
5. **Schalten**: echte Getriebe verlieren beim Hochschalten die Drehzahl im Verhältnis der Gangsprünge
   (`n_neu = n · i_neu / i_alt`) und nehmen für 0,1–0,25 s die Last weg (Zugkraftunterbrechung, beim
   Doppelkupplungsgetriebe kürzer). Beim Zurückschalten ohne Gas: kurzer Zwischengas-Stoß.

## Physik des Grundtons

- Viertakter: jeder Zylinder zündet einmal je zwei Umdrehungen. **Zündfrequenz f = U/min / 60 · Zylinder / 2**
  (= U/min · Zyl / 120). Der Motorzyklus (720°) hat f_Zyklus = U/min / 120 – die eigentliche Periodizität,
  in der alle Unregelmäßigkeiten zwischen den Zylindern stecken („halbe Ordnungen“).
- Folge für die Analyse: Autokorrelation findet je nach Motor die Zündfrequenz, eine halbe Ordnung (Zyklus- oder
  Bank-Periodizität) oder eine Oberwelle → Oktavfehler. Prüfung im Skript: Energie bei (k+½)·f gegenüber k·f
  und bei f/2 gegenüber f. Ergebnis über alle 78 Aufnahmen: Boxer- und Dieselaufnahmen haben starke halbe
  Ordnungen (Verhältnis ≈ 1), sind aber mit der Zündfrequenz-Annahme plausibel (Leerlauf 600–950 U/min),
  die übrigen haben klare Grundtöne (Verhältnis 0,1–0,5). Für die Laufzeit ist das entschärft: Körner werden
  auf ganze **Motorzyklen** (120 / U/min) ausgerichtet – liegt die Beschriftung eine Oktave daneben, ist die
  Periode trotzdem ein Vielfaches der echten. Je Aufnahme kann `oct` im Skript die Beschriftung korrigieren.

## Was jede Motorart ausmacht (und Kenndaten)

| Typ | Charakter | Leerlauf / Begrenzer | f bei 6000 U/min |
|---|---|---|---|
| i4 Reihenvierer | Grundton = 2. Ordnung, summend, etwas „rau-brummig“, wenig Bass, hell im oberen Drittel (VTEC-Kreischen) | 750–900 / 6500–8000 | 200 Hz |
| t4 Turbo-Vierer | wie i4, gedämpfter (Turbine schluckt Auspuffpulse), Pfeifen beim Laden (2–7 kHz), Abblasventil „pssh“/Flattern beim Gaswegnehmen; Subaru-Boxer: ungleich lange Krümmer → typisches Blubbern (starke halbe Ordnungen) | 800–950 / 6500–7200 | 200 Hz |
| i6 Reihensechser | sehr gleichmäßig (Massenausgleich), seidig, oben metallisch-heiser (BMW M), Turbo-Varianten dumpfer | 700–800 / 7000–7600 | 300 Hz |
| f6 Boxer-Sechser | „Heulen“ mit kernigem Mittelton, starke Ansauggeräusche, Porsche-GT hoch drehend (9000) | 850–950 / 7500–9000 | 300 Hz |
| v6t Biturbo-V6 (Ferrari 296 GT3, Audi RS5) | 120°-„Hot-Vee“ bzw. 90°-V6: rau-heiser, dichter als ein Vierzylinder, Turbo dämpft und pfeift, GT3-Rennwagen mit Sprotzeln im Schub – kein F1-Hybrid-Kreischen | 900–1000 / 8000 | 300 Hz |
| v8m Ami-V8 (Kreuzebene) | Blubbern/„potato“: je Bank ungleiche Zündabstände (90-180-270-180°), dadurch starke halbe Ordnungen und tiefer Bass; niedrige Drehzahlen | 600–750 / 6000–6500 | 400 Hz |
| v8f Flachebenen-V8 (Ferrari, Rennwagen) | gleichmäßige 180°-Zündung je Bank → heller, kreischender, wie zwei Vierzylinder; hoch drehend | 900–1100 / 8500–9000 | 400 Hz |
| v8t Biturbo-V8 (RS6, AMG, M5) | Kreuzebene, aber durch zwei Turbolader gedämpft: tiefes, sattes Grollen, wenig Kreischen, deutliches Laden/Abblasen, Sprotzeln im Schub (Sportabgasanlage) | 600–750 / 6800–7200 | 400 Hz |
| v10 | hoch, rau-kreischend, „Trompete“ (R8/Huracán/E60 M5), Zündabstände je nach Hubzapfen leicht ungleich | 900–1100 / 8500–8700 | 500 Hz |
| v12 | sehr gleichmäßig, dicht, „seidig“ bis kreischend, hoher Grundton | 800–1000 / 8000–9000 | 600 Hz |
| f1 Formel 1 | hier Aufnahmen der V8/V10-Ära (18 000+ U/min, hohes Kreischen); die aktuellen 1,6-l-V6-Turbo-Hybride drehen bis 15 000 U/min (Durchflussbegrenzung 100 kg/h ab 10 500) und klingen tiefer/gedämpfter mit MGU-H-/Turbo-Pfeifen | 4000 / 15 000 (Modell; Aufnahmen bis ~18 000) | 400 Hz (V8) |
| dsl Diesel Lkw/Bus | tief, nagelnd (Verbrennungsklopfen = breitbandiges Klackern je Zündung), Turbo-Pfeifen, Begrenzer bei 2500–3000 | 550–700 / 2500–2800 | – |
| ev Elektro | kein Zündgrundton; Pfeifen aus Motorpolzahl × Drehzahl und Umrichter-Taktfrequenz (Seitenbänder wandern mit der Drehzahl), dazu Getriebe-Heulen und Reifen/Wind | – / 12 000–18 000 Motor | – |

Quellen: Kreuz- vs. Flachebene – Jalopnik, *The Reason Why Flat-Plane Crank V8 Engines Sound So Distinctive*
(<https://jalopnik.com/1878133/why-flat-plane-crank-v8-engines-sound-different/>), Car Throttle,
*Which Sounds Better: A Cross-Plane Or Flat-Plane V8?*
(<https://www.carthrottle.com/news/which-sounds-better-cross-plane-or-flat-plane-v8?page=0>), Wikipedia *Crossplane*
(<https://en.wikipedia.org/wiki/Crossplane>); F1-Regeln – Motorsport.com, *Insider's guide to F1 engine rules*
(<https://www.motorsport.com/f1/news/insiders-guide-f1-engine-rules/7221310/>), Honda *Powertrain MGU-H/MGU-K*
(<https://global.honda/en/tech/motorsports/Formula-1/Powertrain_MGU-H_MGU-K/>); E-Antrieb – SAE 2026-01-0437
*New Inverter Switching Control Method to Enhance Sound Quality for Electric Vehicles*
(<https://saemobilus.sae.org/papers/new-inverter-switching-control-method-enhance-sound-quality-electric-vehicles-2026-01-0437>),
US-Patent 10044317 (Umrichter-Seitenbänder folgen der Motordrehzahl). Leerlauf-/Begrenzerwerte: übliche
Herstellerangaben, gerundet.

## Was daraus folgt (Umsetzung)

- **Gasgeben** spielt echte Hochläufe (`on`-Sweeps) granular ab: Position = Drehzahl, Körner 80 ms Hann,
  50 % Überlappung, auf ganze Motorzyklen gesetzt und per WSOLA (Wellenform-Vergleich) fein angeschlossen;
  Tonhöhe nur außerhalb eines Stücks nachgezogen (−25 / +50 %). Mehrere Stücke (z. B. je Gang) decken zusammen
  Leerlauf…Begrenzer ab, die der Auto-Aufnahme zuerst.
- **Gas weg** blendet nach Last auf einen Abfall-Mitschnitt (`off`-Sweep) über – fehlt er, läuft der Hochlauf
  dumpfer und leiser weiter; dazu Knallen/Sprotzeln je Motorart.
- **Leerlauf** bleibt eine Schleife (stehender Ton ist dort richtig), unterhalb ~1,4 × Leerlauf eingeblendet.
- **Schalten**: Drehzahlsprung nach Übersetzung + 0,1–0,2 s Last weg; zurückschalten ohne Gas mit Zwischengas.
- **Turbo** (t4, v8t, dsl): Pfeifen folgt dem Ladedruck (Last × Drehzahl, träge), Abblasen beim Gaswegnehmen.
- Die alten Drehzahl-Schleifen bleiben als Rückfall (Motorarten ohne Sweep, z. B. ev).
- **Begrenzer** (Kraftstoffabschaltung): unter Last am Begrenzer pendelt die Drehzahl knapp darunter, 10–20 Schnitte
  je Sekunde je Motorart (Renn-Motoren schneller/härter, v8m 10 Hz, f1 20 Hz), Diesel als weicher Regler (5 Hz,
  sinusförmig). Weil das Gangmodell nur je Bild rechnet, kommt das Pendeln auf der Audio-Uhr dazu: je Schnitt
  Pegel-Einbruch (`dip`) und kurz tiefere Tonhöhe (wachsende Verzögerung), Knistern bei t4/i6/v6t/v8m/v8t/v10/v12.
  Nur dort, wo er hingehört: Stand/ausgekuppelt, Gang gehalten, Übertempo. Beim Beschleunigen schaltet das
  Gangmodell vorher hoch (92–97 % je Art), Höchsttempo liegt im obersten Gang bei 90–95 % des Begrenzers.
- **Gleichbleibende Drehzahl** (Höchsttempo, Begrenzer): das kurze Band (±4 %, ≥ 0,35 s) lief immer wieder durch
  dieselbe Stelle – hörbar als Wiederholung („schleift“). Jetzt ein langes Fenster (bis ±30 %, Ziel ≥ 1,2 s), Sprung
  an eine zufällige Stelle nach 2–7 Körnern, Korn-Abstand ±10 %, Drehzahl-Wackeln ±1–2 % und Ansaug-/Auspuffrauschen
  nach Last × Drehzahl. Grenze: Die obersten Hochlauf-Stücke von f6, v6t, v8t, v12, f1 und dsl haben oben nur
  0,3–0,4 s Material im Bereich des Tonhöhen-Nachzugs – dort hilft auf Dauer nur eine Aufnahme mit stehender hoher
  Drehzahl (Begrenzer/Höchsttempo).
- Neue Motorart **v8t** (Biturbo-V8) für RS6/AMG/M5 – vorher als Ferrari-Flachebenen-V8 (v8f) einsortiert.

## Auswahl der Aufnahmen (Messung, Stand 2026-11)

Je Aufnahme: Grundton-Verlauf (Autokorrelation, Oktavsprünge repariert), Klarheit, Pegel, Hoch-/Abläufe
(`python3 scripts/build_engine_sounds.py --report`). Wichtigste Erkenntnisse:

- Viele scheinbar weite Hochläufe der alten Auswahl waren **Messsprünge** (z. B. BMWM3_01 „954→6028 U/min“: in
  Wahrheit ein langsamer Anstieg 954→1219 und dann ein Sprung der Grundton-Erkennung). Deshalb werden Abschnitte an
  Sprüngen > 12 % je 23 ms geteilt und aus kürzeren, sauberen Stücken zusammengesetzt; was nicht reicht, wird von
  einer verwandten Motorart gleicher Zündfrequenz geliehen (`from` in `bank.json`).
- **Raus**: 408896 (konstanter Ton, keine V12-Drehzahl), 377148/641824 (fern, kaum Grundton), 14830 (kurz, unklar),
  133831/432508/144454/651534 (kein Hochlauf, Publikum/verrauscht), 215960/424738/128612/466715/401558/269771/343369
  (kurz/dünn), 181900 (doppelter Leerlauf); 478597 „BMW M6“ ist ein V10 (E63) → von i6 nach v10 verschoben.
- **Neu**: 339703 Audi V8 (CC0), 415275 BMWM3_02 (CC BY), 535944 Alfa Brera und 522221 Peugeot 308 (CC0, i4),
  205503/205504 Mustang (CC0), 384056 Mustang hinten (CC BY), 517882 Mustang Rev (CC BY), 711565 Corvette C8 (CC0),
  370278 Ferrari-Beschleunigung (CC0), 429099 Audi R8 in Zolder (V10, CC BY).
- **Gesucht, nicht gefunden** (Freesound CC0/CC BY): saubere Prüfstands-Hochläufe für V8/V10/V12, RS6/M5-Aufnahmen
  mit Hochlauf. Die Hochdrehzahl-Stücke von v8m/v8t/v12 sind deshalb geliehen.

## Einzelne Autos

- **Audi RS6 (ABT, RS 6 Avant, RS6 GT)**: neue Motorart `v8t`. Das ABT-RS6 startet mit der Aufnahme, deren Anlassen
  der Nutzer gut fand (659560), und läuft im Leerlauf und beim Anfahren aus demselben Mitschnitt weiter
  (`bank.cars`); darüber ein Stück eines Kreuzebenen-V8, Turbo-Pfeifen nach Ladedruck.
- **Ferrari 296 GT3** (vorher `f1`): neue Motorart `v6t` (Biturbo-V6) mit der C43-AMG-V6-Biturbo-Aufnahme (772801)
  und zwei 3,2-l-V6-Fahrten (754775/754776, Auspuffmikrofon); oben ein Boxer-Sechser-Stück (gleiche Zündfrequenz).
  Audi RS5 (2,9 V6 Biturbo) ebenso.
- **„Klingt wie Schleifen statt Schalten“**: die Körner liefen bei gleichbleibender Drehzahl immer wieder über dieselbe
  80-ms-Stelle (bzw. am Rand eines Stücks fest am Ende) – eine sehr kurze Schleife. Jetzt läuft der Lesekopf innerhalb
  eines Bands um die Drehzahl (±4–9 %, mindestens 0,35 s Material) natürlich vorwärts und springt erst am Bandende an
  eine zufällige Stelle (WSOLA-Anschluss); Leerlauf-/Rückfall-Schleifen sind bis 2,4 s lang (0,25 s Überblendung).
  Schalten: Drehzahl fällt um den Gangsprung, 0,14–0,24 s Zugkraftunterbrechung mit hörbarem Pegel-Einbruch, bei
  Turbo-Motoren Abblasen, je nach Motorart Knall.
- **BMW M3 Competition** (i6): fest auf BMWM3_02 (415275, gleiche Session wie BMWM3_01), Leerlauf, Hochlauf-Stücke und
  Abfall aus dieser Aufnahme; M2 Competition auf BMWM3_01.
