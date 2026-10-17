"""Squad Record im Modal zaehlt Tode wie der Report-Header.

Der Header rechnet meine K/D als Kills / (Matches - Wins). Steht mein
Name im Record-Modal, muss dort dieselbe Zahl stehen. Vorher zaehlte
das Modal einen Tod nur, wenn time_survived mehr als 5 s vor dem
Match-Ende lag — wer als letztes Team stirbt, beendet das Match aber
selbst und galt dann als ueberlebt (27/8 = 3,38 statt 27/9 = 3,00).
"""
import pytest

from pubg import db_pg


CONN = None
T = None
ICH = "account.A"
MATE = "account.B"
GEGNER = "account.G"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _match(mid, played_at, place, kills, survived, duration=1472):
    db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", "squad-fpp", False,
                       duration, played_at, None)
    db_pg.insert_team_mapping(CONN.raw, T, mid, [
        {"account_id": ICH, "team_id": 1, "kills": kills, "place": place,
         "time_survived": survived},
        {"account_id": MATE, "team_id": 1, "kills": 1, "place": place,
         "time_survived": survived},
        {"account_id": GEGNER, "team_id": 2, "kills": 0, "place": 1,
         "time_survived": duration}])
    db_pg.insert_participants(CONN.raw, T, mid, [
        {"account_id": ICH, "team_id": 1, "kills": kills, "place": place,
         "name": "PEX_LuCKoR"}])
    db_pg.upsert_player(CONN.raw, T, ICH, "PEX_LuCKoR", "steam", 1)
    db_pg.upsert_player(CONN.raw, T, MATE, "Mate1", "steam", 0)
    CONN.raw.commit()


def test_tod_kurz_vor_match_ende_zaehlt_als_tod():
    """Platz 2, gestorben 3 s vor Ende: das ist ein Tod."""
    from pubg.lobby_kd import lobby_detail
    _match("r1", "2026-10-15T18:00:00Z", place=5, kills=19, survived=900)
    _match("r2", "2026-10-15T18:36:00Z", place=2, kills=8, survived=1469)
    d = lobby_detail(CONN, T, ["r1", "r2"], my_account_id=ICH)
    t = d["totals"]
    assert t["recordDeaths"] == 4, "zwei Matches verloren, je zwei Tote"
    assert t["recordKd"] == pytest.approx(29 / 4)


def test_tod_in_gewonnenem_match_zaehlt_wie_im_header_nicht():
    """Header: Kills / (Matches - Wins). Ein Win zaehlt nie als Tod."""
    from pubg.lobby_kd import lobby_detail
    _match("w1", "2026-10-15T18:00:00Z", place=1, kills=4, survived=600,
           duration=1500)
    _match("w2", "2026-10-15T18:40:00Z", place=3, kills=2, survived=1200,
           duration=1500)
    d = lobby_detail(CONN, T, ["w1", "w2"], my_account_id=ICH)
    t = d["totals"]
    assert t["recordDeaths"] == 2, "nur das verlorene Match, fuer beide"
    assert t["recordKd"] == pytest.approx(8 / 2)
