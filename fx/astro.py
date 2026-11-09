"""Sonnen- und Mondstand für die Weather-Source.

Formeln nach SunCalc (Vladimir Agafonkin, BSD-2-Clause), auf das Nötige
gekürzt. Winkel in Radiant; Azimut ab Süden, positiv nach Westen.

sky_xy() bildet den Stand grob auf den oberen Bildrand ab. Gerundet, damit
die Werte im Overlay den Ort des Streamers nicht verraten.
"""
import math

RAD = math.pi / 180
_DAY = 86400
_J1970 = 2440588
_J2000 = 2451545
_E = RAD * 23.4397


def _days(ts: float) -> float:
    return ts / _DAY - 0.5 + _J1970 - _J2000


def _ra(l, b):
    return math.atan2(math.sin(l) * math.cos(_E) - math.tan(b) * math.sin(_E), math.cos(l))


def _dec(l, b):
    return math.asin(math.sin(b) * math.cos(_E) + math.cos(b) * math.sin(_E) * math.sin(l))


def _azimuth(h, phi, dec):
    return math.atan2(math.sin(h), math.cos(h) * math.sin(phi) - math.tan(dec) * math.cos(phi))


def _altitude(h, phi, dec):
    return math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(h))


def _sidereal(d, lw):
    return RAD * (280.16 + 360.9856235 * d) - lw


def _sun_coords(d):
    m = RAD * (357.5291 + 0.98560028 * d)
    c = RAD * (1.9148 * math.sin(m) + 0.02 * math.sin(2 * m) + 0.0003 * math.sin(3 * m))
    lon = m + c + RAD * 102.9372 + math.pi
    return _dec(lon, 0), _ra(lon, 0)


def _moon_coords(d):
    lon = RAD * (218.316 + 13.176396 * d)
    m = RAD * (134.963 + 13.064993 * d)
    f = RAD * (93.272 + 13.229350 * d)
    l = lon + RAD * 6.289 * math.sin(m)
    b = RAD * 5.128 * math.sin(f)
    return _dec(l, b), _ra(l, b), 385001 - 20905 * math.cos(m)


def sun_position(ts: float, lat: float, lon: float):
    """→ (azimut, höhe)"""
    lw, phi, d = RAD * -lon, RAD * lat, _days(ts)
    dec, ra = _sun_coords(d)
    h = _sidereal(d, lw) - ra
    return _azimuth(h, phi, dec), _altitude(h, phi, dec)


def moon_position(ts: float, lat: float, lon: float):
    """→ (azimut, höhe inkl. Refraktion)"""
    lw, phi, d = RAD * -lon, RAD * lat, _days(ts)
    dec, ra, _dist = _moon_coords(d)
    h = _sidereal(d, lw) - ra
    alt = _altitude(h, phi, dec)
    a = max(alt, 0)
    alt += 0.0002967 / math.tan(a + 0.00312536 / (a + 0.08901179))
    return _azimuth(h, phi, dec), alt


def moon_illumination(ts: float):
    """→ (beleuchteter Anteil 0..1, Phase 0..1: 0 Neumond, 0.5 Vollmond)"""
    d = _days(ts)
    s_dec, s_ra = _sun_coords(d)
    m_dec, m_ra, m_dist = _moon_coords(d)
    sdist = 149598000
    phi = math.acos(math.sin(s_dec) * math.sin(m_dec)
                    + math.cos(s_dec) * math.cos(m_dec) * math.cos(s_ra - m_ra))
    inc = math.atan2(sdist * math.sin(phi), m_dist - sdist * math.cos(phi))
    angle = math.atan2(math.cos(s_dec) * math.sin(s_ra - m_ra),
                       math.sin(s_dec) * math.cos(m_dec)
                       - math.cos(s_dec) * math.sin(m_dec) * math.cos(s_ra - m_ra))
    return (1 + math.cos(inc)) / 2, 0.5 + 0.5 * inc * (-1 if angle < 0 else 1) / math.pi


def sky_xy(azimuth: float, altitude: float, lat: float):
    """Stand → Bildposition (x 0..1 von links, y 0..1: 0 = hoch, 1 = Horizont).
    Nordhalbkugel blickt nach Süden (Osten links), Südhalbkugel nach Norden."""
    az = azimuth
    if lat < 0:
        az = (az + 2 * math.pi) % (2 * math.pi) - math.pi
    x = min(0.97, max(0.03, 0.5 + az / math.pi))
    y = 1 - min(1.0, max(0.0, altitude / (math.pi / 2)))
    return round(round(x / 0.02) * 0.02, 2), round(round(y / 0.05) * 0.05, 2)
