// PUBG POI-Lookup: Welt-Koordinaten (Unreal Units / cm) -> bekannter
// Ortsname. Pro Map eine Liste von Punkten + Radius (in km). Wir
// nehmen den nearestPoint dessen Distanz <= Radius ist; sonst gibt's
// einen Quadranten-Fallback ("NW", "Center", ...).
//
// Koordinaten-System: 0/0 = top-left (Nord-West), positive Y geht
// nach Süden, positive X nach Osten. Werte hier in km (umgerechnet
// von cm: x_km = x_cm / 100000).
//
// Quelle: erfahrungswerte + map-genau geschätzt. Nicht pixelperfekt,
// aber gut genug fuer den Tooltip "Pochinki" / "Sosnovka Military".
(function () {
  if (!window.PubgUI) window.PubgUI = {};
  const POI = window.PubgUI.POI = {};

  // Map-Groesse in km (= Welt-Edge). Wird fuer Quadranten-Fallback genutzt.
  const MAP_SIZE_KM = {
    "Baltic_Main":     8,   // Erangel
    "Erangel_Main":    8,
    "Desert_Main":     8,   // Miramar
    "Savage_Main":     4,   // Sanhok
    "DihorOtok_Main":  8,   // Vikendi (8x8 since 2020 update)
    "Tiger_Main":      8,   // Taego
    "Kiki_Main":       8,   // Deston
    "Neon_Main":       8,   // Rondo
    "Chimera_Main":    3,   // Paramo
    "Summerland_Main": 2,   // Karakin
    "Heaven_Main":     1,   // Haven
    "Range_Main":      2,   // Camp Jackal
  };

  // POI-Tabellen pro Map. Jeder Eintrag: { name, x, y, r }
  // x/y in km, r = match-Radius in km.
  // Reihenfolge egal — wir finden das nearest innerhalb r.
  const POIS = {
    "Baltic_Main": [
      { name: "Pochinki",          x: 3.55, y: 3.30, r: 0.6 },
      { name: "School",            x: 4.45, y: 2.95, r: 0.4 },
      { name: "Hospital",          x: 2.80, y: 3.40, r: 0.5 },
      { name: "Rozhok",            x: 3.30, y: 2.40, r: 0.5 },
      { name: "Yasnaya Polyana",   x: 5.35, y: 2.55, r: 0.7 },
      { name: "Georgopol",         x: 1.80, y: 2.40, r: 0.8 },
      { name: "Severny",           x: 4.40, y: 1.10, r: 0.6 },
      { name: "Stalber",           x: 4.65, y: 0.75, r: 0.5 },
      { name: "Lipovka",           x: 6.70, y: 3.85, r: 0.7 },
      { name: "Mylta",             x: 6.20, y: 4.75, r: 0.6 },
      { name: "Mylta Power",       x: 7.10, y: 4.35, r: 0.5 },
      { name: "Quarry",            x: 2.40, y: 5.10, r: 0.5 },
      { name: "Mansion",           x: 5.45, y: 4.85, r: 0.5 },
      { name: "Gatka",             x: 1.40, y: 3.30, r: 0.5 },
      { name: "Primorsk",          x: 1.40, y: 6.40, r: 0.7 },
      { name: "Novorepnoye",       x: 5.30, y: 7.00, r: 0.7 },
      { name: "Military Base",     x: 5.80, y: 6.30, r: 0.8 },
      { name: "Ferry Pier",        x: 4.10, y: 5.85, r: 0.5 },
      { name: "Kameshki",          x: 6.25, y: 1.05, r: 0.5 },
      { name: "Zharki",            x: 1.55, y: 1.50, r: 0.5 },
      { name: "Shooting Range",    x: 5.10, y: 1.85, r: 0.4 },
      { name: "Shelter",           x: 4.45, y: 3.85, r: 0.4 },
      { name: "Power Plant",       x: 3.85, y: 4.50, r: 0.5 },
      { name: "Farm",              x: 5.55, y: 4.30, r: 0.4 },
      { name: "Ruins",             x: 2.60, y: 4.45, r: 0.4 },
      { name: "Water Town",        x: 3.35, y: 5.30, r: 0.5 },
      { name: "Kameshki Mil. Bay", x: 7.10, y: 6.10, r: 0.6 },
    ],
    "Desert_Main": [
      { name: "Pecado",            x: 4.10, y: 4.10, r: 0.7 },
      { name: "Hacienda del Patrón", x: 2.60, y: 3.45, r: 0.6 },
      { name: "Los Leones",        x: 5.10, y: 5.00, r: 1.0 },
      { name: "San Martín",        x: 3.65, y: 3.10, r: 0.6 },
      { name: "Power Grid",        x: 3.65, y: 4.65, r: 0.5 },
      { name: "Water Treatment",   x: 4.85, y: 4.10, r: 0.5 },
      { name: "Prison",            x: 1.30, y: 5.95, r: 0.6 },
      { name: "Campo Militar",     x: 6.65, y: 5.25, r: 0.7 },
      { name: "Cruz del Valle",    x: 4.25, y: 1.80, r: 0.6 },
      { name: "El Pozo",           x: 1.60, y: 3.05, r: 0.7 },
      { name: "Valle del Mar",     x: 1.10, y: 5.05, r: 0.6 },
      { name: "La Cobrería",       x: 2.50, y: 2.05, r: 0.5 },
      { name: "Pecado Boxing Ring", x: 4.30, y: 4.10, r: 0.3 },
      { name: "Trailer Park",      x: 4.65, y: 1.40, r: 0.5 },
      { name: "Tierra Bronca",     x: 6.10, y: 1.65, r: 0.6 },
      { name: "El Azahar",         x: 5.75, y: 2.30, r: 0.5 },
      { name: "Impala",            x: 6.45, y: 3.40, r: 0.5 },
      { name: "Crater Fields",     x: 7.15, y: 4.65, r: 0.6 },
      { name: "Ladrillera",        x: 5.65, y: 6.80, r: 0.5 },
      { name: "Puerto Paraíso",    x: 6.45, y: 6.60, r: 0.5 },
      { name: "Chumacera",         x: 2.40, y: 6.70, r: 0.5 },
      { name: "Monte Nuevo",       x: 1.25, y: 4.20, r: 0.5 },
      { name: "Alcantara",         x: 2.10, y: 5.30, r: 0.4 },
      { name: "Torre Ahumada",     x: 4.70, y: 6.35, r: 0.4 },
      { name: "Graveyard",         x: 5.20, y: 5.85, r: 0.4 },
      { name: "Junkyard",          x: 4.00, y: 6.10, r: 0.4 },
      { name: "Minas Generales",   x: 3.55, y: 6.95, r: 0.5 },
      { name: "Oasis",             x: 3.05, y: 5.55, r: 0.4 },
    ],
    "Savage_Main": [
      { name: "Paradise Resort",   x: 2.20, y: 1.80, r: 0.4 },
      { name: "Bootcamp",          x: 2.10, y: 2.30, r: 0.4 },
      { name: "Camp Bravo",        x: 3.20, y: 2.30, r: 0.3 },
      { name: "Camp Charlie",      x: 1.65, y: 2.85, r: 0.3 },
      { name: "Camp Alpha",        x: 0.95, y: 1.80, r: 0.3 },
      { name: "Ruins",             x: 2.55, y: 2.45, r: 0.3 },
      { name: "Pai Nan",           x: 1.40, y: 2.20, r: 0.3 },
      { name: "Mongnai",           x: 3.40, y: 3.05, r: 0.3 },
      { name: "Sahmee",            x: 2.85, y: 1.30, r: 0.3 },
      { name: "Cave",              x: 2.85, y: 2.45, r: 0.2 },
      { name: "Bhan",              x: 1.85, y: 1.55, r: 0.3 },
      { name: "Quarry",            x: 1.30, y: 3.30, r: 0.3 },
      { name: "Kampong",           x: 2.05, y: 3.45, r: 0.3 },
      { name: "Tat Mok",           x: 0.95, y: 1.20, r: 0.3 },
      { name: "Ha Tinh",           x: 1.20, y: 0.95, r: 0.3 },
      { name: "Na Kham",           x: 0.50, y: 2.55, r: 0.3 },
      { name: "Bottom of Map",     x: 2.05, y: 3.70, r: 0.3 },
    ],
    "DihorOtok_Main": [
      { name: "Castle",            x: 3.70, y: 3.40, r: 0.5 },
      { name: "Volnova",           x: 2.85, y: 3.00, r: 0.6 },
      { name: "Cement Factory",    x: 4.20, y: 1.45, r: 0.5 },
      { name: "Cosmodrome",        x: 4.85, y: 3.85, r: 0.7 },
      { name: "Goroka",            x: 5.60, y: 4.30, r: 0.5 },
      { name: "Dobro Mesto",       x: 4.10, y: 4.20, r: 0.5 },
      { name: "Movatra",           x: 2.85, y: 4.25, r: 0.5 },
      { name: "Tovar",             x: 2.95, y: 5.40, r: 0.5 },
      { name: "Krichas",           x: 1.85, y: 4.60, r: 0.5 },
      { name: "Trevno",            x: 1.05, y: 3.50, r: 0.5 },
      { name: "Lumber Yard",       x: 5.95, y: 2.65, r: 0.5 },
      { name: "Pilnec",            x: 5.65, y: 5.40, r: 0.5 },
      { name: "Vihar",             x: 6.65, y: 3.05, r: 0.5 },
      { name: "Coal Mine",         x: 6.10, y: 1.60, r: 0.5 },
      { name: "Podvosto",          x: 4.85, y: 2.45, r: 0.4 },
      { name: "Peshkova",          x: 3.10, y: 1.95, r: 0.4 },
      { name: "Zabava",            x: 1.95, y: 2.45, r: 0.4 },
      { name: "Sawmill",           x: 3.55, y: 5.50, r: 0.4 },
      { name: "Winery",            x: 5.20, y: 4.65, r: 0.3 },
      { name: "Abbey",             x: 4.95, y: 5.10, r: 0.3 },
    ],
    "Tiger_Main": [
      { name: "Hosan",             x: 3.85, y: 4.00, r: 0.6 },
      { name: "Sangok-Myeon",      x: 4.20, y: 5.45, r: 0.6 },
      { name: "Palace",            x: 3.95, y: 2.40, r: 0.6 },
      { name: "Go-Gok-Dam",        x: 5.75, y: 4.80, r: 0.6 },
      { name: "Yumun Valley",      x: 2.40, y: 4.40, r: 0.6 },
      { name: "Po Town",           x: 4.50, y: 6.45, r: 0.5 },
      { name: "Hwasangok",         x: 5.60, y: 3.35, r: 0.5 },
      { name: "Jongchon-eup",      x: 6.55, y: 2.30, r: 0.5 },
      { name: "Naerin Forest",     x: 2.30, y: 2.85, r: 0.5 },
      { name: "Yongcheon-myeon",   x: 6.55, y: 6.05, r: 0.5 },
      { name: "Sungrok-jiok",      x: 1.55, y: 5.80, r: 0.5 },
      { name: "Sambok",            x: 5.55, y: 1.75, r: 0.5 },
      { name: "Wolsan",            x: 1.40, y: 2.40, r: 0.5 },
      { name: "Cheonbuk",          x: 2.10, y: 6.30, r: 0.5 },
      { name: "Hawolsan",          x: 6.20, y: 1.30, r: 0.5 },
      { name: "Ho-San",            x: 5.20, y: 6.15, r: 0.4 },
      { name: "Imo Bay",           x: 6.50, y: 5.15, r: 0.4 },
      { name: "Sky Hill",          x: 5.05, y: 4.25, r: 0.4 },
      { name: "Yangji",            x: 3.10, y: 3.40, r: 0.4 },
    ],
    "Kiki_Main": [
      { name: "Capital",           x: 4.00, y: 1.95, r: 0.7 },
      { name: "Constellation",     x: 5.40, y: 3.10, r: 0.6 },
      { name: "Stargazer",         x: 5.80, y: 5.55, r: 0.5 },
      { name: "Inn-On Lake",       x: 2.55, y: 5.30, r: 0.5 },
      { name: "Beachfront",        x: 1.10, y: 4.80, r: 0.5 },
      { name: "Greenhouse",        x: 3.30, y: 3.55, r: 0.5 },
      { name: "Holdout",           x: 4.20, y: 5.40, r: 0.5 },
      { name: "Lodge",             x: 6.40, y: 4.00, r: 0.5 },
      { name: "Old Hope",          x: 5.40, y: 6.40, r: 0.5 },
      { name: "Riverbend",         x: 2.20, y: 2.65, r: 0.5 },
      { name: "Rockledge",         x: 3.30, y: 5.05, r: 0.5 },
      { name: "Town Center",       x: 4.65, y: 3.80, r: 0.5 },
      { name: "Trailer Park",      x: 6.55, y: 5.50, r: 0.5 },
      { name: "Watershed",         x: 6.20, y: 6.10, r: 0.5 },
      { name: "Highway 7",         x: 4.95, y: 2.70, r: 0.4 },
      { name: "The Verticals",     x: 4.30, y: 2.55, r: 0.4 },
      { name: "Lighthouse",        x: 0.95, y: 6.30, r: 0.4 },
      { name: "Pelagic Bunker",    x: 1.60, y: 3.85, r: 0.4 },
      { name: "Hub",               x: 4.50, y: 4.55, r: 0.4 },
    ],
    "Neon_Main": [
      { name: "Ban Yai",           x: 3.80, y: 3.85, r: 0.6 },
      { name: "Phueng",            x: 5.40, y: 4.10, r: 0.6 },
      { name: "Tham Soeng",        x: 2.85, y: 4.30, r: 0.5 },
      { name: "Lung Tao",          x: 5.95, y: 3.05, r: 0.5 },
      { name: "Mae Tha",           x: 4.65, y: 5.05, r: 0.5 },
      { name: "Doi Sahk",          x: 4.10, y: 2.05, r: 0.5 },
      { name: "Kham Yai",          x: 2.55, y: 2.85, r: 0.5 },
      { name: "Hin Pho",           x: 6.30, y: 4.80, r: 0.5 },
      { name: "Pai Lay",           x: 5.85, y: 5.50, r: 0.5 },
      { name: "Wat Chai",          x: 2.25, y: 5.55, r: 0.5 },
      { name: "Phaya Naga",        x: 3.35, y: 5.85, r: 0.5 },
      { name: "Khun Pha",          x: 1.65, y: 4.00, r: 0.5 },
      { name: "Suan Hin",          x: 3.60, y: 6.85, r: 0.5 },
      { name: "Thoeng",            x: 4.95, y: 6.55, r: 0.5 },
      { name: "Bang Pae",          x: 6.65, y: 6.10, r: 0.5 },
      { name: "Cargo Port",        x: 1.10, y: 5.05, r: 0.5 },
      { name: "Mai Nam",           x: 5.10, y: 1.85, r: 0.5 },
      { name: "Pong Kao",          x: 6.95, y: 2.20, r: 0.5 },
      { name: "Mountain Castle",   x: 3.95, y: 1.20, r: 0.5 },
    ],
  };

  // Aliase damit beide Erangel-Spellings funktionieren.
  POIS["Erangel_Main"] = POIS["Baltic_Main"];

  POI.fromCoords = function (mapName, xCm, yCm) {
    if (!mapName || xCm == null || yCm == null) return null;
    const list = POIS[mapName];
    const xKm = xCm / 100000;
    const yKm = yCm / 100000;
    if (list && list.length) {
      let best = null;
      let bestDist = Infinity;
      for (const p of list) {
        const dx = p.x - xKm;
        const dy = p.y - yKm;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = p;
        }
      }
      if (best) {
        const dist = Math.sqrt(bestDist);
        if (dist <= best.r) return best.name;
        // Bisschen ausserhalb des Radius -> "near"
        if (dist <= best.r * 1.6) return "near " + best.name;
      }
    }
    // Quadrant-Fallback wenn keine POI matched
    const size = MAP_SIZE_KM[mapName] || 8;
    const mid = size / 2;
    const ns = yKm < mid ? "N" : "S";
    const ew = xKm < mid ? "W" : "E";
    return ns + ew + " quadrant";
  };
})();
