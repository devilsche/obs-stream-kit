"""Geteilte Serving-Helfer: Window-Var-Injection + tokenisiertes Datei-Serving.

Von Service 1 (Widgets/Tools) und Service 2 (Overlays) gemeinsam genutzt.
"""
import json
import os
import re
from flask import send_from_directory, abort


# Erlaubte Theme-Namen (siehe widgets/_theme.css). Whitelist schuetzt die
# Attribut-Injektion und faengt ungueltige/alte Werte ab → Fallback Default.
ALLOWED_THEMES = ("entry", "terminal", "aurora", "midnight", "editorial", "swiss", "azure")

# Nur das ECHTE <html>-Tag treffen (am Zeilenanfang), nicht ein "<html>" das
# zufaellig in einem Kommentar/Text steht.
_HTML_TAG_RE = re.compile(r"(?m)^\s*<html\b[^>]*>", re.IGNORECASE)


def inject_window_vars(html: str, variables: dict) -> str:
    """Setzt window.<KEY> = <json-value>; in einen <script>-Block vor </head>."""
    lines = "\n".join(
        f"window.{k} = {json.dumps(v)};" for k, v in variables.items()
    )
    script = f"<script>\n{lines}\n</script>"
    if "</head>" in html:
        return html.replace("</head>", script + "\n</head>", 1)
    return script + "\n" + html


def inject_theme(html: str, theme: str) -> str:
    """Setzt data-theme="<theme>" auf das erste <html>-Tag — server-seitig,
    damit das Theme-CSS sofort greift (kein FOUC, kein JS noetig).

    Ungueltige/leere Themes werden ignoriert → das CSS faellt auf den
    :root-Default (Entry) zurueck. Idempotent: vorhandenes data-theme bleibt.
    """
    if not theme or theme not in ALLOWED_THEMES:
        return html

    def _add(m):
        tag = m.group(0)
        if "data-theme" in tag.lower():
            return tag
        return tag[:-1] + f' data-theme="{theme}">'

    return _HTML_TAG_RE.sub(_add, html, count=1)


def _safe_full_path(root: str, subdir: str, filepath: str):
    """Pfad innerhalb root/subdir auflösen, Traversal blocken. None wenn ungültig."""
    base = os.path.join(root, subdir)
    full = os.path.normpath(os.path.join(base, filepath))
    if not full.startswith(base + os.sep) or not os.path.isfile(full):
        return None
    return full


def serve_asset(root: str, subdir: str, filepath: str):
    """Statische Datei aus root/subdir ausliefern (kein Inject)."""
    full = _safe_full_path(root, subdir, filepath)
    if full is None:
        abort(404)
    return send_from_directory(os.path.dirname(full), os.path.basename(full))


def serve_html_or_asset(root: str, subdir: str, filepath: str, variables: dict,
                        theme: str = None):
    """HTML-Dateien mit Inject ausliefern, alles andere als statisches Asset.
    Mit `theme` wird server-seitig data-theme aufs <html> gesetzt (kein FOUC) —
    no-cache, damit OBS/Browser kein veraltetes data-theme zwischenspeichert."""
    full = _safe_full_path(root, subdir, filepath)
    if full is None:
        abort(404)
    if filepath.endswith(".html"):
        with open(full, "r", encoding="utf-8") as f:
            html = f.read()
        if theme:
            html = inject_theme(html, theme)
        return (inject_window_vars(html, variables), 200,
                {"Content-Type": "text/html; charset=utf-8",
                 "Cache-Control": "no-cache, must-revalidate"})
    return send_from_directory(os.path.dirname(full), os.path.basename(full))
