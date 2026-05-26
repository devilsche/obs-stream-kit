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


def perp_distance_to_route(px, py, ax, ay, bx, by):
    """Kuerzeste Distanz von Punkt P zur UNENDLICHEN Geraden durch A,B.
    (Flugzeug fliegt ueber die ganze Karte → unendliche Linie, nicht
    Segment.) Bei A==B: Punkt-zu-Punkt-Distanz."""
    dx, dy = bx - ax, by - ay
    denom = math.hypot(dx, dy)
    if denom == 0:
        return math.hypot(px - ax, py - ay)
    # |(B-A) x (A-P)| / |B-A|
    cross = abs(dx * (ay - py) - dy * (ax - px))
    return cross / denom


def apply_pin_cal(x_cm, y_cm, mapKm, cal):
    """Wendet die pinCalibration auf eine Welt-cm-Koordinate an, damit die
    Anzeige zum Karten-Bild passt. Python-Port von _xform aus poi-editor.html.
    Reihenfolge: flipX/Y → rotate(0/90/180/270) → scale+offset (center-anchored).
    offsetX/Y sind in cm. cal kann None/leer sein → unveraendert."""
    if not cal:
        return x_cm, y_cm
    mc = mapKm * 100000 / 2.0
    x, y = x_cm, y_cm
    if cal.get("flipX"):
        x = 2 * mc - x
    if cal.get("flipY"):
        y = 2 * mc - y
    rot = ((cal.get("rotate", 0) or 0) % 360 + 360) % 360
    if rot != 0:
        dx, dy = x - mc, y - mc
        if rot == 90:
            x, y = mc - dy, mc + dx
        elif rot == 180:
            x, y = mc - dx, mc - dy
        elif rot == 270:
            x, y = mc + dy, mc - dx
    ex = (x - mc) * (cal.get("scaleX", 1) or 1) + mc + (cal.get("offsetX", 0) or 0)
    ey = (y - mc) * (cal.get("scaleY", 1) or 1) + mc + (cal.get("offsetY", 0) or 0)
    return ex, ey


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
