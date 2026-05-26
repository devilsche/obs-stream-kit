"""Parst rohe PUBG-Telemetrie zu strukturierten Replay-Daten fuer ALLE
Teams eines Matches. Keine DB-/HTTP-Abhaengigkeit — nimmt Raw-Blob +
Team-Mapping + Map-Meta als Argumente, damit isoliert testbar."""


def normalize_coords(x_cm, y_cm, mapKm):
    """World-cm → [0,1] relativ zur Kartengroesse. Geclamped."""
    if x_cm is None or y_cm is None:
        return None, None
    span = mapKm * 100000.0
    nx = max(0.0, min(1.0, x_cm / span))
    ny = max(0.0, min(1.0, y_cm / span))
    return nx, ny


# 24-Farben-Palette, gut unterscheidbar (HSV-verteilt, gesaettigt).
_TEAM_PALETTE = [
    "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
    "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff",
    "#9a6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1",
    "#000075", "#808080", "#ff6699", "#00cc99", "#cc6600", "#6699ff",
]


def team_colors(team_ids):
    """team_id → hex-Farbe. Sortiert nach team_id fuer stabile Zuordnung,
    Palette wraps bei >24 Teams."""
    out = {}
    for i, tid in enumerate(sorted(set(team_ids))):
        out[tid] = _TEAM_PALETTE[i % len(_TEAM_PALETTE)]
    return out
