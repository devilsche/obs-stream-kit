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
