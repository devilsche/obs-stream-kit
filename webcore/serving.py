"""Geteilte Serving-Helfer: Window-Var-Injection + tokenisiertes Datei-Serving.

Von Service 1 (Widgets/Tools) und Service 2 (Overlays) gemeinsam genutzt.
"""
import json
import os
import re
from flask import send_from_directory, abort


# Erlaubte Theme-Namen (siehe widgets/_theme.css). Whitelist schuetzt die
# Attribut-Injektion und faengt ungueltige/alte Werte ab → Fallback Default.
ALLOWED_THEMES = ("entry", "terminal", "aurora", "midnight", "editorial", "swiss", "azure",
                  "oldcamp", "barrier", "sect")

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


# Banner fuer die Admin-Fremdsicht (?asTenant=...). Die Dashboard-Seiten
# haben ihr Banner in base.html + dashboard.css; datei-servierte Tools und
# Widgets laden dashboard.css nicht, brauchen also eigene Regeln. Optik
# bewusst gleich (Purple mit Goldkante), Farben aber deckend statt rgba:
# der Untergrund im Tool ist unbekannt, ein transparentes Banner koennte
# jeden Kontrast verlieren.
_IMPERSONATION_CSS = """
<style>
.obs-impersonation {
  position: sticky;
  top: 0;
  z-index: 9999;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 12px;
  padding: 10px 18px;
  background: #3c1b4e;
  border-bottom: 2px solid #f2b705;
  color: #ffffff;
  font: 600 14px/1.4 "DM Sans", system-ui, sans-serif;
}
.obs-impersonation__icon {
  width: 20px;
  height: 20px;
  flex: none;
  fill: #f2b705;
}
.obs-impersonation__who {
  color: #f2b705;
}
.obs-impersonation__exit {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 3px;
  color: #f2b705;
  text-decoration: underline;
}
.obs-impersonation__exit:hover {
  background: #f2b705;
  color: #2a1236;
}
.obs-impersonation__exit:focus-visible {
  outline: 3px solid #f2b705;
  outline-offset: 2px;
}
</style>"""

# Auge als Inline-SVG statt Material-Symbols-Ligatur: die Icon-Font ist in
# den Tools nicht durchgaengig geladen, und ohne sie stuende dort das Wort
# "visibility" im Banner.
_IMPERSONATION_ICON = (
    '<svg class="obs-impersonation__icon" viewBox="0 0 24 24" '
    'aria-hidden="true" focusable="false">'
    '<path d="M12 5c-5 0-9 4.4-9 7s4 7 9 7 9-4.4 9-7-4-7-9-7zm0 12c-2.8 0-5-2.2'
    '-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8a3 3 0 100 6 3 3 0 000-6z"/>'
    '</svg>'
)

_BODY_TAG_RE = re.compile(r"(?i)<body\b[^>]*>")


def _drop_query_param(url: str, param: str) -> str:
    """URL ohne den genannten Query-Parameter — Rest bleibt unberuehrt."""
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    parts = urlsplit(url)
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k != param]
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(kept), parts.fragment))


def inject_impersonation_banner(html: str, tenant_info, current_url: str) -> str:
    """Sichtbarer Hinweis, dass die Seite die Daten eines FREMDEN Tenants
    zeigt (Admin-Impersonation via ?asTenant=...).

    Ohne den Hinweis ist an der Seite nicht zu erkennen, wessen Daten da
    stehen — und eine Fremdsicht bleibt bis zum naechsten Klick ohne
    Parameter bestehen.

    Sitzt direkt nach <body> und ist `sticky`, nicht `fixed`: so schiebt es
    den Inhalt nach unten statt fokussierte Elemente zu verdecken
    (WCAG 2.4.12).

    `tenant_info` ist g.tenant_impersonating (oder None → unveraendert).
    """
    if not tenant_info:
        return html
    from markupsafe import escape
    name = escape(tenant_info.get("display_name")
                  or tenant_info.get("slug") or tenant_info.get("id"))
    tid = escape(tenant_info.get("id") if tenant_info.get("id") is not None
                 else tenant_info.get("slug") or "?")
    # Nur den asTenant-Parameter abstreifen: range/matchId & Co. sollen beim
    # Wechsel in die eigene Sicht stehen bleiben.
    exit_url = escape(_drop_query_param(current_url, "asTenant"))
    banner = (
        f'{_IMPERSONATION_CSS}\n'
        f'<div class="obs-impersonation" role="status">'
        f'{_IMPERSONATION_ICON}'
        f'<span>Viewing as <b class="obs-impersonation__who">{name}</b> '
        f'(Tenant&nbsp;#{tid})</span>'
        f'<a class="obs-impersonation__exit" href="{exit_url}">'
        f'Zur\u00fcck zur eigenen Sicht</a>'
        f'</div>'
    )
    m = _BODY_TAG_RE.search(html)
    if m:
        return html[:m.end()] + "\n" + banner + html[m.end():]
    return banner + "\n" + html


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
