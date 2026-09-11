/* Gemeinsame Logik der beiden Meilenstein-Fassungen.
 *
 * Beide Sources fragen denselben Endpoint, nur mit anderem `widget`,
 * und quittieren die Feier mit `markShown=1`. Der Server fuehrt je
 * Fassung einen eigenen Marker — laufen beide, sieht jede ihren
 * Eintrag, statt dass die zuerst pollende der anderen den Anlass
 * wegnimmt.
 */
(function (global) {
  "use strict";

  //: Sinnbild je Anlass. Material Symbols, keine Emojis.
  var ICONS = {
    weapon_damage: "local_fire_department",
    weapon_kills: "target",
    weapon_mastered: "workspace_premium",
    weapon_best_damage: "trending_up",
    weapon_best_kills: "military_tech",
    weapon_longest: "my_location",
    thrown_count: "sports_baseball",
    career_damage: "local_fire_department",
    career_kills: "target",
    career_rounds: "sports_esports",
    career_knocks: "personal_injury",
    career_revives: "health_and_safety",
    career_assists: "handshake",
    career_top10s: "leaderboard",
    career_walk: "directions_walk",
    career_ride: "directions_car",
    career_time: "schedule",
    career_heals: "medical_services",
    career_looted: "backpack",
    career_vehicles: "car_crash",
    career_roadkills: "directions_car",
    career_longest_kill: "my_location",
    career_most_kills: "military_tech"
  };

  //: Anlaesse, bei denen der Vorher-Wert die Nachricht ist. Bei einer
  //: Schwelle wurde er gerade ueberschritten und beantwortet eine
  //: Frage, die niemand stellt; beim Rekord macht erst er den neuen
  //: Wert zum Rekord.
  var SHOW_PREV = {
    weapon_best_damage: 1, weapon_best_kills: 1, weapon_longest: 1,
    career_longest_kill: 1, career_most_kills: 1
  };

  var NUM = function (n) {
    return Math.round(n).toLocaleString("en-US");
  };

  /* Wert und Einheit fuer die Anzeige.
   *
   * Strecke kommt in Metern und Zeit in Sekunden — als Rohzahl waere
   * ein Meilenstein "1,000,000 metres" statt "1,000 km", und
   * "360,000 seconds" statt "100 hours". Nur die weiteste Toetung
   * bleibt in Metern, dort ist der Meter die Einheit der Leistung.
   */
  function shown(m) {
    var v = Number(m.value) || 0, u = m.unit || "";
    var isDistanceTotal = m.occasion === "career_walk"
                       || m.occasion === "career_ride";
    if (u === "metres" && isDistanceTotal)
      return { num: NUM(v / 1000), unit: "km", raw: v };
    if (u === "metres") return { num: NUM(v), unit: "m", raw: v };
    if (u === "seconds") return { num: NUM(v / 3600), unit: "h", raw: v };
    // Eine nackte 100 sagt nichts. Ingame steht dort "Level 100" und
    // der Rang "Master" — beides gehoert in die Feier.
    if (u === "level") return { num: NUM(v), unit: "", raw: v,
                                prefix: "level" };
    // "Tier 5" — die Rangnamen zwischen Basic und Master sind nicht
    // bekannt, die Zahl ist die ehrliche Auskunft.
    if (u === "tier") return { num: NUM(v), unit: "", raw: v,
                               prefix: "tier" };
    return { num: NUM(v), unit: "", raw: v };
  }

  /* Grosse Zahlen als Groessenordnung statt als Zaehlerstand.
   * "2.5 M" liest sich als Meilenstein, "2,500,000" als Kilometerzaehler.
   */
  var WORDS = {
    500000: "half a million", 1000000: "one million",
    1500000: "one and a half million", 2000000: "two million",
    2500000: "two and a half million", 3000000: "three million",
    3500000: "three and a half million", 4000000: "four million",
    4500000: "four and a half million", 5000000: "five million"
  };

  //: Der hoechste Rang der Waffen-Mastery. Aus dem Level abgeleitet:
  //: `TierCurrent` aus der API taugt dafuer nicht, dort umfasst Tier 0
  //: die Level 2 bis 98. Belegt ist nur Tier 6 bei Level 100 —
  //: ingame "Master".
  var MASTER_LEVEL = 100;

  //: Hoechstes Mastery-Tier; ingame "Master". Tier 0 ist "Basic".
  var MAX_TIER = 6;

  function bigForm(m) {
    var s = shown(m), v = s.raw;
    if (m.unit === "level")
      return { big: s.num, unit: "level",
               words: v >= MASTER_LEVEL ? "master tier" : null };
    if (m.unit === "tier")
      return { big: s.num, unit: "tier",
               words: v >= MAX_TIER ? "master" : null };
    if (m.unit === "metres" || m.unit === "seconds")
      return { big: s.num, unit: s.unit, words: null };
    if (v >= 1000000) {
      var mio = v / 1000000;
      // "2.5" bei halben Millionen, "4" bei ganzen — eine Stelle
      // reicht, mehr waere wieder ein Zaehlerstand.
      return { big: String(Math.round(mio * 10) / 10), unit: "M",
               words: WORDS[v] || null };
    }
    if (v >= 100000 && v % 1000 === 0)
      return { big: NUM(v / 1000), unit: "K", words: WORDS[v] || null };
    return { big: s.num, unit: s.unit, words: null };
  }

  /* Untertitel: was gefeiert wird. Bei einer Waffe traegt sie den
   * Namen schon im Schild an der Zahl, deshalb nennt der Untertitel
   * dort nur die Kennzahl und nicht die Waffe doppelt.
   */
  function subline(m, withSubject) {
    var label = m.label || m.occasion;
    if (withSubject && m.display) return m.display + " · " + label;
    return label;
  }

  //: Die zweite Zeile. Rekorde nennen den alten Wert, Schwellen die
  //: Einordnung — sonst bliebe die Zeile leer.
  function ctxline(m) {
    if (SHOW_PREV[m.occasion] && m.prevValue) {
      var p = shown({ value: m.prevValue, unit: m.unit,
                      occasion: m.occasion });
      var n = shown(m);
      return "previous best " + p.num + (p.unit ? " " + p.unit : "")
           + " · now " + n.num + (n.unit ? " " + n.unit : "");
    }
    if (m.occasion === "weapon_mastered")
      return (m.value >= MASTER_LEVEL ? "master tier · " : "")
           + "max level reached";
    if (m.occasion === "weapon_tier") {
      var from = m.prevValue ? "tier " + NUM(m.prevValue) : "basic";
      return from + " → tier " + NUM(m.value)
           + (m.value >= MAX_TIER ? " · master" : "");
    }
    if (m.display) return m.display;
    // Kontoweite Anlaesse haben kein Subjekt; ohne diese Zeile blieben
    // sie ohne Einordnung und man wuesste nicht, worauf sich die Zahl
    // bezieht.
    if (m.occasion.indexOf("career_") === 0)
      return "across every mode";
    return "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  //: Burst aus der Mitte plus Nachregen. Die Streuung steckt in den
  //: data-Attributen, die zugehoerigen Regeln im Stylesheet.
  function confetti(withRain) {
    var out = "", i;
    for (i = 0; i < 54; i++)
      out += '<i class="c" data-b="' + i + '" data-col="' + (i % 4) + '"></i>';
    if (withRain !== false)
      for (i = 0; i < 40; i++)
        out += '<i class="r" data-r="' + i + '" data-col="'
             + ((i + 1) % 4) + '"></i>';
    return '<div class="conf">' + out + "</div>";
  }

  function secondBurst() {
    var out = "";
    for (var i = 0; i < 46; i++)
      out += '<i class="c2" data-b2="' + i + '" data-col="' + (i % 4) + '"></i>';
    return out;
  }

  function iconFor(m) {
    return ICONS[m.occasion] || "military_tech";
  }

  /* Poll-Schleife. Ein Meilenstein wird beim Abholen quittiert, damit
   * ein Reload der Source ihn nicht erneut feiert; genau deshalb wird
   * `markShown=1` erst mitgeschickt, wenn die Feier auch laeuft.
   */
  function poller(opts) {
    var base = (global.__SERVE_BASE__ || "/") + "api/pubg/milestone-pending";
    var busy = false;

    function url(mark) {
      return base + "?widget=" + encodeURIComponent(opts.widget)
           + (mark ? "&markShown=1" : "");
    }

    function once() {
      if (busy) return Promise.resolve();
      return fetch(url(true), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var m = d && (d.milestone || (d.data && d.data.milestone));
          if (!m) return;
          busy = true;
          return Promise.resolve(opts.celebrate(m)).then(function () {
            busy = false;
          }, function () { busy = false; });
        })
        .catch(function () { /* Netz weg: beim naechsten Takt erneut */ });
    }

    once();
    setInterval(once, opts.intervalMs || 15000);
    return once;
  }

  /* Vorschau: den Meilenstein zu einem Anlass holen, ohne ihn
   * einzureihen. `?demo=1` nimmt den ersten Anlass, der zur Fassung
   * passt; `?demo=<anlass>` genau diesen. Werte kommen vom Server aus
   * dem letzten Stand, also ist die gezeigte Marke die, die wirklich
   * als naechste fallen wuerde.
   */
  function demo(occasion, extra) {
    var base = (global.__SERVE_BASE__ || "/") + "api/pubg/milestone-demo";
    var q = new URLSearchParams();
    q.set("occasion", occasion);
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k]) q.set(k, extra[k]);
    });
    return fetch(base + "?" + q.toString(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var body = (d && d.data) || d || {};
        return body.milestone || null;
      });
  }

  /* Die Anlass-Liste, damit `?demo=1` etwas Sinnvolles waehlen kann und
   * ein falsch geschriebener Name nicht stumm ins Leere laeuft.
   */
  function occasions() {
    var base = (global.__SERVE_BASE__ || "/") + "api/pubg/milestone-occasions";
    return fetch(base, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var body = (d && d.data) || d || {};
        return body.occasions || [];
      })
      .catch(function () { return []; });
  }

  /* Alle Anlaesse der Reihe nach zeigen — `?demo=all`. Zum Durchsehen,
   * ohne die URL zwei Dutzend Mal von Hand zu aendern.
   */
  function demoAll(celebrate, filter, loud) {
    return occasions().then(function (list) {
      var todo = list.filter(filter || function () { return true; });
      return todo.reduce(function (chain, o) {
        return chain.then(function () {
          return demo(o.id, { loud: loud }).then(function (m) {
            return m ? celebrate(m) : null;
          });
        });
      }, Promise.resolve()).then(function () { return todo.length; });
    });
  }

  global.Milestone = {
    demo: demo, demoAll: demoAll, occasions: occasions,
    ICONS: ICONS, SHOW_PREV: SHOW_PREV, NUM: NUM,
    shown: shown, bigForm: bigForm, subline: subline, ctxline: ctxline,
    confetti: confetti, secondBurst: secondBurst, iconFor: iconFor,
    esc: esc, poller: poller
  };
}(window));
