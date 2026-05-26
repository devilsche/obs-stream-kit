"""Reine Geometrie fuer POI-Zuordnung von Lande-Koordinaten.
Python-Port der Logik aus widgets/pubg/_pubg_pois.js. World-cm.
Keine DB-/HTTP-Abhaengigkeit — isoliert testbar."""
import math


def poly_area(points):
    if not points or len(points) < 3:
        return 0.0
    a = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def point_in_poly(px, py, points):
    if not points or len(points) < 3:
        return False
    inside = False
    n = len(points)
    j = n - 1
    for i in range(n):
        xi, yi = points[i]
        xj, yj = points[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def dist_to_poly(px, py, points):
    if not points or len(points) < 2:
        return float("inf")
    best = float("inf")
    n = len(points)
    for i in range(n):
        ax, ay = points[i]
        bx, by = points[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        len2 = dx * dx + dy * dy
        t = 0.0
        if len2 > 0:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
        qx, qy = ax + t * dx, ay + t * dy
        d = math.hypot(px - qx, py - qy)
        if d < best:
            best = d
    return best


def match_poi(x, y, regions):
    """Liefert den POI-Namen fuer eine Koordinate. Kleinste umschliessende
    benannte Region gewinnt (Nesting-faehig). None wenn in keiner Region.
    Namenlose Regionen ('') werden ignoriert."""
    best = None
    best_area = float("inf")
    for r in regions or []:
        name = r.get("name")
        if not name:
            continue
        pts = r.get("points") or []
        if point_in_poly(x, y, pts):
            a = poly_area(pts)
            if a < best_area:
                best_area = a
                best = name
    return best
