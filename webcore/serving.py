"""Geteilte Serving-Helfer: Window-Var-Injection + tokenisiertes Datei-Serving.

Von Service 1 (Widgets/Tools) und Service 2 (Overlays) gemeinsam genutzt.
"""
import json
import os
from flask import send_from_directory, abort


def inject_window_vars(html: str, variables: dict) -> str:
    """Setzt window.<KEY> = <json-value>; in einen <script>-Block vor </head>."""
    lines = "\n".join(
        f"window.{k} = {json.dumps(v)};" for k, v in variables.items()
    )
    script = f"<script>\n{lines}\n</script>"
    if "</head>" in html:
        return html.replace("</head>", script + "\n</head>", 1)
    return script + "\n" + html


def _safe_full_path(root: str, subdir: str, filepath: str):
    """Pfad innerhalb root/subdir auflösen, Traversal blocken. None wenn ungültig."""
    base = os.path.join(root, subdir)
    full = os.path.normpath(os.path.join(base, filepath))
    if not full.startswith(base) or not os.path.isfile(full):
        return None
    return full


def serve_asset(root: str, subdir: str, filepath: str):
    """Statische Datei aus root/subdir ausliefern (kein Inject)."""
    full = _safe_full_path(root, subdir, filepath)
    if full is None:
        abort(404)
    return send_from_directory(os.path.dirname(full), os.path.basename(full))


def serve_html_or_asset(root: str, subdir: str, filepath: str, variables: dict):
    """HTML-Dateien mit Inject ausliefern, alles andere als statisches Asset."""
    full = _safe_full_path(root, subdir, filepath)
    if full is None:
        abort(404)
    if filepath.endswith(".html"):
        with open(full, "r", encoding="utf-8") as f:
            html = f.read()
        return (inject_window_vars(html, variables), 200,
                {"Content-Type": "text/html; charset=utf-8"})
    return send_from_directory(os.path.dirname(full), os.path.basename(full))
