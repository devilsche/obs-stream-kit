#!/usr/bin/env python3
"""Textkontrast aller Sources gegen alle Themes pruefen (WCAG 1.4.3).

**Warum ein Werkzeug und kein Einmal-Skript.** Die Fehler tauchen nicht
beim Schreiben auf, sondern erst wenn jemand ein helles Theme waehlt: ein
festes Hell-Gruen sieht auf dem dunklen Standard-Theme gut aus und ist auf
`editorial` mit Kontrast 1,5 unsichtbar. Niemand testet acht Themes von
Hand, also muss es messbar sein.

Geprueft werden zwei Faelle:

* **feste Hex-Farben** in `color:`-Deklarationen — gegen JEDEN
  Theme-Hintergrund, weil sie nicht mitwandern koennen.
* **Token-Farben** (`var(--theme-…)`) — je Theme aufgeloest und gegen die
  Flaeche desselben Themes gestellt.

Schwellen nach WCAG 1.4.3: 4.5 fuer normalen Text, 3.0 fuer grossen
(>= 24px, oder >= 18.66px bei font-weight >= 700).

    python3 scripts/check_contrast.py [--min 4.5] [pfad …]
"""
import argparse
import pathlib
import re
import sys

THEME_DIR = pathlib.Path("widgets/themes")
DEFAULT_PATHS = ("widgets", "tools", "app/static")

#: Flaechen, auf denen Text sitzen kann. Reihenfolge = Praeferenz beim
#: Melden; geprueft wird gegen die HELLSTE bzw. dunkelste, also den
#: schlechtesten Fall.
SURFACE_TOKENS = ("surface", "surface-2", "bg", "page-bg")


def luminance(hex_color):
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return None
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    if la is None or lb is None:
        return None
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def load_themes():
    """{theme: {token: hexwert}} — nur echte Hex-Werte, Gradienten
    tragen keinen einzelnen Kontrast."""
    out = {}
    for f in sorted(THEME_DIR.glob("*.css")):
        if f.stem in ("master", "_alias"):
            continue
        css = f.read_text(encoding="utf-8")
        tokens = dict(re.findall(
            r"--theme-([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})", css))
        if tokens.get("surface") or tokens.get("bg"):
            out[f.stem] = tokens
    return out


#: Vordergrund-Tokens, die PER DEFINITION auf eingefaerbtem Grund sitzen.
#: Sie gegen die Kartenflaeche zu pruefen meldet 1,00 und ist sinnlos —
#: --theme-on-primary gehoert auf --theme-primary, nirgends sonst.
FG_ON_COLOR = {"on-primary", "bg", "page-bg"}

#: Token, das der Regel-Hintergrund nutzt -> was der Vordergrund treffen
#: muss. Ohne diese Aufloesung prueft der Check gegen die falsche Flaeche.
BG_ALIAS = {"primary": "primary", "accent": "accent", "accent-2": "accent-2",
            "danger": "danger", "ok": "ok", "warn": "warn",
            "surface": "surface", "surface-2": "surface-2", "bg": "bg",
            "page-bg": "page-bg"}


def rule_background(decls):
    """Hintergrund-Token oder -Hex aus DERSELBEN Regel, falls gesetzt.

    Setzt eine Regel ihren eigenen Grund (ein Badge, ein aktiver Chip,
    ein Knopf), dann gilt der und nicht die Karte darunter.
    """
    m = re.search(r"background(?:-color)?\s*:\s*([^;}]+)", decls)
    if not m:
        return None
    val = m.group(1).strip()
    # Durchscheinender Grund: was zaehlt, ist die Flaeche DARUNTER. Ein
    # "color-mix(… 10%, transparent)" ist praktisch die Karte, kein
    # eigener Grund — gegen das Token darin zu pruefen ergibt 1,00 und
    # meldet jeden korrekten Akzent-Knopf als Fehler.
    if re.search(r"\btransparent\b|\bnone\b", val):
        return None
    if val.startswith("rgba") and re.search(r",\s*0?\.\d+\s*\)$", val):
        return None
    tok = re.search(r"--theme-([a-zA-Z0-9-]+)", val)
    if tok:
        return ("token", BG_ALIAS.get(tok.group(1), tok.group(1)))
    hexc = re.search(r"#[0-9a-fA-F]{3,8}", val)
    if hexc:
        return ("hex", hexc.group(0))
    return ("opaque", None)      # Gradient und Aehnliches: unbestimmt


def style_blocks(path):
    """(text, zeilenversatz) je CSS-Quelle in der Datei.

    Bei HTML nur der Inhalt der <style>-Bloecke: laeuft der Regex ueber
    das ganze Dokument, matcht er Attribute und Skript-Fragmente als
    CSS-Regeln und meldet Zeilennummern, an denen kein CSS steht.
    """
    txt = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".css":
        return [(txt, 0)]
    out = []
    for m in re.finditer(r"<style[^>]*>([\s\S]*?)</style>", txt, re.I):
        out.append((m.group(1), txt[:m.start(1)].count("\n")))
    return out


def find_colors(path):
    """(selektor, farbe, eigener_grund, zeile) je color-Deklaration."""
    out = []
    for txt, offset in style_blocks(path):
        for m in re.finditer(r"([^\n{};]*)\{([^}]*)\}", txt):
            sel = (m.group(1).strip().splitlines()[-1].strip()
                   if m.group(1).strip() else "?")
            decls = m.group(2)
            c = re.search(r"(?<![-\w])color\s*:\s*"
                          r"(#[0-9a-fA-F]{3,8}|var\(\s*--theme-[a-zA-Z0-9-]+)",
                          decls)
            if not c:
                continue
            line = offset + txt[:m.start()].count("\n") + 1
            out.append((sel, c.group(1), rule_background(decls), line))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", default=list(DEFAULT_PATHS))
    ap.add_argument("--min", type=float, default=4.5,
                    help="Mindestkontrast (Default 4.5 = WCAG AA Text)")
    ap.add_argument("--all", action="store_true",
                    help="auch die bestandenen Kombinationen zeigen")
    args = ap.parse_args(argv)

    themes = load_themes()
    if not themes:
        print("keine Theme-Dateien gefunden", file=sys.stderr)
        return 2
    print(f"{len(themes)} Themes: {', '.join(themes)}\n")

    files = []
    for p in args.paths:
        root = pathlib.Path(p)
        if root.is_file():
            files.append(root)
        else:
            files += [f for f in root.rglob("*")
                      if f.suffix in (".html", ".css") and "themes/" not in str(f)]

    problems, skipped = [], 0
    for f in sorted(set(files)):
        for sel, color, own_bg, line in find_colors(f):
            token = None
            if color.startswith("var("):
                token = re.search(r"--theme-([a-zA-Z0-9-]+)", color).group(1)
            # Vordergrund, der auf Farbe gehoert: nur gegen den eigenen
            # Grund pruefbar. Ohne eigenen Grund nicht entscheidbar.
            if token in FG_ON_COLOR and not own_bg:
                skipped += 1
                continue
            if own_bg and own_bg[0] == "opaque":
                skipped += 1     # Gradient/rgba: Grund nicht bestimmbar
                continue
            for theme, tk in themes.items():
                fg = tk.get(token) if token else color
                if not fg:
                    continue          # Token in diesem Theme ohne Hex-Wert
                if own_bg:
                    bg = own_bg[1] if own_bg[0] == "hex" else tk.get(own_bg[1])
                    if not bg:
                        continue
                    c = contrast(fg, bg)
                    if c is not None and c < args.min:
                        problems.append((c, theme, own_bg[1] or "eigener Grund",
                                         str(f), line, sel, color))
                    continue
                # Sonst: schlechtester Fall ueber die Flaechen des Themes
                worst, on = None, None
                for s in SURFACE_TOKENS:
                    b = tk.get(s)
                    if not b:
                        continue
                    c = contrast(fg, b)
                    if c is not None and (worst is None or c < worst):
                        worst, on = c, s
                if worst is not None and worst < args.min:
                    problems.append((worst, theme, on, str(f), line, sel, color))

    problems.sort()
    if skipped:
        print(f"{skipped} Deklarationen nicht entscheidbar "
              f"(Gradient/rgba als Grund, oder Farbe-auf-Farbe ohne "
              f"eigenen Hintergrund)\n")
    if not problems:
        print(f"keine Textfarbe unter {args.min}:1 in {len(files)} Dateien")
        return 0

    # Nach Datei gruppieren — so liest man es beim Beheben.
    by_file = {}
    for p in problems:
        by_file.setdefault(p[3], []).append(p)
    print(f"{len(problems)} Kombinationen unter {args.min}:1 "
          f"in {len(by_file)} Dateien\n")
    for path, items in sorted(by_file.items(),
                              key=lambda kv: min(x[0] for x in kv[1])):
        print(f"  {path}")
        seen = set()
        for worst, theme, on, _f, line, sel, color in items:
            key = (line, sel, color)
            if key in seen:
                continue
            seen.add(key)
            others = sorted({t for w, t, *_ in items
                             if (_[2], _[3], _[4]) == key} ) if False else None
            th = sorted({t for w, t, o, ff, ll, ss, cc in items
                         if (ll, ss, cc) == key})
            print(f"    Zeile {line:5d}  {worst:5.2f}  {color:34s} {sel[:34]:34s}"
                  f"  {','.join(th)}")
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
