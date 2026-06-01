"""Credentials-Gate fuer Widget- und Tool-Routen.

Bestimmt fuer einen Asset-Pfad welche API-Credentials (PUBG, Steam)
gebraucht werden, prueft den Tenant-Status und liefert eine HTML-
Sperrseite wenn was fehlt. Verhindert dass Widgets/Tools "lautlos
kaputt" laden wenn kein API-Key hinterlegt ist.

Regeln (Pfad-Praefix):
  widgets/pubg/*      → braucht pubg
  widgets/steam/*     → braucht steam
  tools/poi-editor    → keine Creds (lokale Datei-Edits)
  tools/*             → braucht pubg  (alle anderen Tools sind PUBG-basiert)
"""
from typing import Iterable


# Tool-Pfade die KEINE API-Creds brauchen (Bearbeiten lokaler Daten).
_TOOLS_NO_CREDS = {"tools/poi-editor.html"}

# Tool-Pfade die BEIDES brauchen (PUBG + Steam zusammen).
_TOOLS_BOTH = {"tools/achievement-browser.html"}


def required_domains(asset_path: str) -> set:
    """Set von 'pubg' / 'steam' die fuer asset_path verfuegbar sein muessen."""
    p = asset_path.lstrip("/")
    if p in _TOOLS_NO_CREDS:
        return set()
    if p in _TOOLS_BOTH:
        return {"pubg", "steam"}
    if p.startswith("widgets/pubg/"):
        return {"pubg"}
    if p.startswith("widgets/steam/"):
        return {"steam"}
    if p.startswith("tools/"):
        # Default: alle uebrigen Tools sind PUBG-basiert
        return {"pubg"}
    return set()


def missing_domains(creds, needed: Iterable[str]) -> list:
    """creds = core.credentials.get(...) Rueckgabe. Gibt Liste der
    fehlenden Domains zurueck (subset von needed)."""
    missing = []
    for d in needed:
        if d == "pubg":
            if not (creds.pubg_name and creds.pubg_api_key):
                missing.append("pubg")
        elif d == "steam":
            if not (creds.steam_id and creds.steam_api_key):
                missing.append("steam")
    return missing


def render_block_page(asset_path: str, missing: list,
                       setup_url: str = "/app/setup") -> str:
    """Sperrseite — minimales HTML, dezent, Hinweis auf Setup."""
    label = ", ".join(d.upper() for d in missing)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Credentials required</title>
<style>
  body {{
    margin: 0; padding: 0;
    background: rgba(0,0,0,0.85);
    color: #e8e0f0;
    font: 14px/1.5 system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh;
  }}
  .card {{
    background: #1a0d2e;
    border: 1px solid #5e2a79;
    border-radius: 8px;
    padding: 24px 28px;
    max-width: 480px;
    text-align: center;
  }}
  .card h1 {{
    margin: 0 0 12px;
    color: #f2b705;
    font-size: 1.1em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  .card p {{ margin: 8px 0; color: #c8bcd6; }}
  .card code {{
    color: #f2b705;
    background: rgba(0,0,0,0.4);
    padding: 2px 6px;
    border-radius: 3px;
  }}
  .card a {{
    display: inline-block;
    margin-top: 14px;
    padding: 8px 18px;
    background: #5e2a79;
    color: #fff;
    text-decoration: none;
    border-radius: 5px;
    font-weight: 600;
  }}
  .card a:hover {{ background: #7a3a96; }}
  .path {{ color: #8a7d99; font-size: 0.85em; margin-top: 12px; }}
</style>
</head>
<body>
  <div class="card" role="alert">
    <h1>Credentials required</h1>
    <p>This view needs <code>{label}</code> credentials to work.</p>
    <p>Set them up first in your dashboard.</p>
    <a href="{setup_url}">Open Setup</a>
    <div class="path">{asset_path}</div>
  </div>
</body>
</html>
"""
