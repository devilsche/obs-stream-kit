/**
 * Smoke-Test fuer Widget-Frontends — laeuft ohne Browser, ohne npm.
 *
 *   node tests/js/render-smoke.js
 *
 * Prueft, ob der <script>-Block einer Seite ohne Fehler durchlaeuft. Das
 * klingt banal, faengt aber genau den Ausfall vom 02.09.2026: ein
 * getElementById auf ein Element, das im Markup ERST NACH dem Script steht,
 * liefert null — der TypeError brach das ganze Script ab, und der
 * Session-Report hat daraufhin nicht einmal mehr seine Daten angefragt.
 *
 * Deshalb bildet der Fake-DOM diese Reihenfolge nach: waehrend der
 * Init-Phase gibt getElementById nur fuer IDs ein Element zurueck, die im
 * HTML vor dem Script stehen. Alles andere ist ein Proxy, der auf jeden
 * Zugriff sich selbst liefert — damit kommt jede uebliche DOM-Kette durch.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PAGES = [
  "widgets/pubg/session-report.html",
  "tools/squad-playstyle.html",
  "tools/weapon-performance.html",
];

function checkPage(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) return { rel, skipped: "kein Inline-Script" };

  const scriptStart = html.indexOf("<script>");
  const idsBefore = new Set(
    [...html.slice(0, html.indexOf("</script>", scriptStart))
       .matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));

  const el = new Proxy(function () {}, {
    get: (t, k) => {
      if (k === "innerHTML" || k === "textContent" || k === "value") return "";
      if (k === "children" || k === "childNodes") return [];
      if (k === Symbol.toPrimitive) return () => "";
      return el;
    },
    set: () => true,
    apply: () => el,
  });
  const doc = new Proxy({}, { get: (t, k) => {
    if (k === "querySelectorAll") return () => [];
    if (k === "readyState") return "complete";
    if (k === "getElementById") return (id) => (!idsBefore.has(id) ? null : el);
    return el;
  } });

  const win = {
    __SERVE_BASE__: "/", location: { href: "http://x/", search: "", hash: "" },
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 0, setInterval: () => 0,
  };
  // navigator ist in neueren Node-Versionen nur lesbar — deshalb einzeln
  // und defensiv setzen statt per Object.assign.
  const globals = {
    document: doc, window: win, location: win.location,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => new Promise(() => {}),
    requestAnimationFrame: () => 0,
    CSS: { escape: String },
    navigator: { language: "de-DE" },
  };
  for (const [k, v] of Object.entries(globals)) {
    try { global[k] = v; } catch (_) { /* read-only in dieser Node-Version */ }
  }

  // Die Helfer laden sich selbst nach window.PubgUI.
  const helpers = fs.readFileSync(
    path.join(ROOT, "widgets/pubg/_pubg.js"), "utf8");
  new Function("window", "document", helpers)(win, doc);
  global.PubgUI = global.PubgUI || win.PubgUI;
  if (global.PubgUI) {
    global.PubgUI.fetchJson = () => new Promise(() => {});
    global.PubgUI.poll = () => () => {};
  }

  try {
    new Function(m[1])();
    return { rel, ok: true };
  } catch (e) {
    return { rel, ok: false, err: e.message,
             where: (e.stack || "").split("\n")[1] };
  }
}

let failed = 0;
for (const rel of PAGES) {
  const r = checkPage(rel);
  if (r.skipped) { console.log(`SKIP ${rel} — ${r.skipped}`); continue; }
  if (r.ok) { console.log(`ok   ${rel}`); continue; }
  failed++;
  console.log(`FAIL ${rel}\n     ${r.err}\n    ${r.where || ""}`);
}
process.exit(failed ? 1 : 0);
