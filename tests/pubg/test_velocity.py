"""Fahrzeug-Geschwindigkeit aus der Telemetrie.

PUBG haengt an fast jedes Event den Zustand des Fahrzeugs, in dem der
Spieler gerade sitzt — auch an `LogPlayerPosition`, das ohnehin
importiert wird. Die Geschwindigkeit stand damit in jedem Blob und
wurde bisher weggeworfen.
"""
from pubg.telemetry import _normalize


def _pos(vel=None, vid=None, ts="2026-09-14T10:00:00.0Z"):
    e = {"_T": "LogPlayerPosition", "_D": ts,
         "character": {"accountId": "account.A", "name": "PEX_LuCKoR",
                       "location": {"x": 1.0, "y": 2.0, "z": 3.0},
                       "health": 100.0}}
    if vid is not None:
        e["vehicle"] = {"vehicleId": vid, "velocity": vel,
                        "vehicleType": "WheeledVehicle"}
    return e


def test_position_traegt_geschwindigkeit_und_fahrzeug():
    r = _normalize(_pos(vel=4166.0, vid="BP_Mirado_A_03_C"))
    assert r["velocity"] == 4166.0
    assert r["vehicle_id"] == "BP_Mirado_A_03_C"
    # `weapon` bleibt der Waffe vorbehalten — sonst waere jede Position
    # eines Autofahrers ploetzlich ein Waffen-Ereignis.
    assert r["weapon"] is None


def test_der_sitzplatz_kommt_mit():
    """Nur so laesst sich "ich fuhr" von "ich sass daneben" trennen."""
    e = _pos(vel=4166.0, vid="BP_Mirado_A_03_C")
    e["vehicle"]["seatIndex"] = 2
    assert _normalize(e)["seat_index"] == 2


def test_zu_fuss_bleibt_ohne_fahrzeug():
    r = _normalize(_pos())
    assert r["velocity"] is None
    assert r["vehicle_id"] is None


def test_vehicle_events_tragen_die_geschwindigkeit_auch():
    """Beim Aussteigen aus voller Fahrt ist sie besonders interessant."""
    e = {"_T": "LogVehicleLeave", "_D": "2026-09-14T10:00:00.0Z",
         "character": {"accountId": "account.A",
                       "location": {"x": 1.0, "y": 2.0, "z": 3.0},
                       "health": 100.0},
         "vehicle": {"vehicleId": "Dacia_A_01_v2_C", "velocity": 2500.0},
         "rideDistance": 1234.0, "seatIndex": 0}
    r = _normalize(e)
    assert r["velocity"] == 2500.0
    assert r["vehicle_id"] == "Dacia_A_01_v2_C"
    # Bei Fahrzeug-Events steht die Id weiterhin auch in `weapon` — daran
    # haengt die vorhandene Intervall-Bildung.
    assert r["weapon"] == "Dacia_A_01_v2_C"


def test_das_flugzeug_ist_kein_fahrzeug():
    """1060 km/h im Transporter waere jeder Geschwindigkeits-Rekord.

    Die Maschine taucht in den Positionen jedes Spielers auf, solange er
    noch drin sitzt.
    """
    from pubg.telemetry import ist_landfahrzeug
    assert ist_landfahrzeug("Dacia_A_01_v2_C") is True
    assert ist_landfahrzeug("BP_Special_Sedan_01_C") is True
    assert ist_landfahrzeug("DummyTransportAircraft_C") is False
    assert ist_landfahrzeug("RedeployAircraft_Tiger_C") is False
    assert ist_landfahrzeug("TransportAircraft_Chimera_C") is False
    assert ist_landfahrzeug("BP_Motorglider_C") is False
    assert ist_landfahrzeug(None) is False
