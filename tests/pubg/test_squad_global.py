"""Das eigene Team kommt aus den Daten aller Tenants.

Ein Match ist ein Match: wer in welchem Team saß, hängt nicht daran,
wessen Poller die Runde geholt hat. `participants` trägt aber nur, was
der eigene Poller geholt hat — bei 72 von 508 geteilten Matches stand
dort für einen Tenant nur er selbst, während ein anderer alle vier
führte.

Die Folge war doppelt: der Squad-Schnitt blieb leer, **und die eigenen
Mitspieler zählten als Gegner in die Lobby-K/D**.
"""
import pytest

from pubg import db_pg
from pubg.lobby_kd import squad_names_per_match, squad_per_match

ICH = "acc-ich"
MATE = "acc-mate"
GEGNER = "acc-gegner"
MID = "m1"


@pytest.fixture
def geteilt(pg_compat):
    """Ein Match, das zwei Tenants kennen — mit ungleichen participants."""
    conn, t1, t2 = pg_compat
    db_pg.upsert_player(conn.raw, t1, ICH, "PEX_LuCKoR", "steam", 1)
    db_pg.upsert_player(conn.raw, t2, MATE, "original_Hat3", "steam", 1)
    for t in (t1, t2):
        db_pg.insert_match(conn.raw, t, MID, "Baltic_Main", "squad-fpp",
                           False, 1800, "2026-04-28T12:00:00Z", None)
        # Die Team-Zuordnung ist bei beiden vollständig und gleich —
        # gemessen an 508 geteilten Matches zeilengleich.
        db_pg.insert_team_mapping(conn.raw, t, MID, [
            {"account_id": ICH, "team_id": 7, "kills": 3, "place": 8},
            {"account_id": MATE, "team_id": 7, "kills": 2, "place": 8},
            {"account_id": GEGNER, "team_id": 9, "kills": 5, "place": 1},
        ])
    # Tenant 1 kennt beide Teammitglieder, Tenant 2 nur sich selbst.
    def _p(acc, name):
        return {"account_id": acc, "name": name, "team_id": 7, "place": 8,
                "kills": 1, "headshot_kills": 0, "assists": 0, "dbnos": 0,
                "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
                "time_survived": 900, "walk_distance": 0.0,
                "ride_distance": 0.0, "swim_distance": 0.0,
                "weapons_acquired": 1, "heals": 0, "boosts": 0,
                "team_kills": 0}
    db_pg.insert_participants(conn.raw, t1, MID,
                              [_p(ICH, "PEX_LuCKoR"), _p(MATE, "original_Hat3")])
    db_pg.insert_participants(conn.raw, t2, MID, [_p(MATE, "original_Hat3")])
    conn.raw.commit()
    return conn, t1, t2


def test_tenant_mit_vollstaendigen_daten(geteilt):
    conn, t1, _ = geteilt
    assert squad_per_match(conn, t1, [MID])[MID] == {ICH, MATE}


def test_tenant_mit_lueckigen_daten_bekommt_dasselbe(geteilt):
    # Der eigentliche Fehler: hier stand vorher nur {MATE}.
    conn, _, t2 = geteilt
    assert squad_per_match(conn, t2, [MID])[MID] == {ICH, MATE}


def test_der_gegner_gehoert_nie_dazu(geteilt):
    conn, t1, t2 = geteilt
    for t in (t1, t2):
        assert GEGNER not in squad_per_match(conn, t, [MID])[MID]


def test_namen_kommen_aus_allen_tenants(geteilt):
    # Tenant 2 kennt den Namen von ICH nicht aus eigenen participants.
    conn, _, _ = geteilt
    namen = squad_names_per_match(conn, [MID])
    assert namen[ICH] == "PEX_LuCKoR"
    assert namen[MATE] == "original_Hat3"


def test_ohne_matches_kein_aufwand(geteilt):
    conn, t1, _ = geteilt
    assert squad_per_match(conn, t1, []) == {}
    assert squad_names_per_match(conn, []) == {}


def test_fremdes_match_liefert_nichts(geteilt):
    conn, t1, _ = geteilt
    assert squad_per_match(conn, t1, ["gibtsnicht"]) == {}


def test_squad_faellt_aus_der_lobby(geteilt):
    # Der Punkt des Ganzen: Squad-K/D ist Squad-K/D und darf nicht in
    # die Lobby-Zahl einfließen — egal, welcher Tenant hinsieht.
    conn, t1, t2 = geteilt
    alle = {ICH, MATE, GEGNER}
    for t in (t1, t2):
        squad = squad_per_match(conn, t, [MID])[MID]
        lobby = alle - squad
        assert lobby == {GEGNER}, f"Tenant {t}: Lobby war {lobby}"


# ── Teilnehmer-Zeilen tenant-übergreifend ───────────────────────────────────

def test_teilnehmer_kommen_aus_allen_tenants(geteilt):
    # Der sichtbare Schaden war: im Match-Detail standen die Mitspieler
    # mit lauter Nullen — 2 Kills und 199 Schaden erschienen aus der
    # anderen Perspektive als 0 und 0.
    from pubg.aggregations import participants_global
    conn, _, _ = geteilt
    rows = participants_global(conn, [MID])
    accs = {r["account_id"] for r in rows}
    assert accs == {ICH, MATE}


def test_je_account_nur_eine_zeile(geteilt):
    # Beide Tenants führen dieselbe Person; doppelt gezählt wäre der
    # Schaden verdoppelt.
    from pubg.aggregations import participants_global
    conn, _, _ = geteilt
    rows = participants_global(conn, [MID])
    accs = [r["account_id"] for r in rows]
    assert len(accs) == len(set(accs))


def test_auf_bestimmte_accounts_einschraenkbar(geteilt):
    from pubg.aggregations import participants_global
    conn, _, _ = geteilt
    rows = participants_global(conn, [MID], [ICH])
    assert [r["account_id"] for r in rows] == [ICH]


def test_die_vollstaendigste_zeile_gewinnt(pg_compat):
    # Eine später nachgetragene Leerzeile darf die Zahlen nicht
    # überschreiben.
    from pubg.aggregations import participants_global
    conn, t1, t2 = pg_compat
    for t in (t1, t2):
        db_pg.insert_match(conn.raw, t, MID, "Baltic_Main", "squad-fpp",
                           False, 1800, "2026-04-28T12:00:00Z", None)
    def _p(dmg, kills):
        return {"account_id": ICH, "name": "PEX_LuCKoR", "team_id": 7,
                "place": 8, "kills": kills, "headshot_kills": 0,
                "assists": 0, "dbnos": 0, "revives": 0,
                "damage_dealt": dmg, "longest_kill": 0.0,
                "time_survived": 900, "walk_distance": 0.0,
                "ride_distance": 0.0, "swim_distance": 0.0,
                "weapons_acquired": 1, "heals": 0, "boosts": 0,
                "team_kills": 0}
    db_pg.insert_participants(conn.raw, t1, MID, [_p(199.1, 2)])
    db_pg.insert_participants(conn.raw, t2, MID, [_p(0.0, 0)])
    conn.raw.commit()
    rows = participants_global(conn, [MID])
    assert len(rows) == 1
    assert rows[0]["kills"] == 2
    assert float(rows[0]["damage_dealt"]) == pytest.approx(199.1)


def test_ohne_matches_keine_abfrage(geteilt):
    from pubg.aggregations import participants_global
    conn, _, _ = geteilt
    assert participants_global(conn, []) == []


def test_rueckfall_greift_je_match_nicht_global(geteilt):
    """Ein Match ohne Team-Zuordnung darf die anderen nicht mitreißen.

    Der Rückfall auf `participants` lief zuerst nur, wenn **gar kein**
    Match eine Team-Zuordnung hatte. Ein einziges Match mit Zuordnung
    brachte damit alle anderen um ihren Squad.
    """
    from pubg.lobby_kd import squad_per_match
    conn, t1, _ = geteilt
    # Ein zweites Match, nur mit participants und ohne Team-Zuordnung.
    db_pg.insert_match(conn.raw, t1, "m2", "Baltic_Main", "squad-fpp",
                       False, 1800, "2026-04-29T12:00:00Z", None)
    db_pg.insert_participants(conn.raw, t1, "m2", [{
        "account_id": ICH, "name": "PEX_LuCKoR", "team_id": 3, "place": 5,
        "kills": 1, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 50.0, "longest_kill": 0.0,
        "time_survived": 600, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 1, "heals": 0,
        "boosts": 0, "team_kills": 0}])
    conn.raw.commit()
    d = squad_per_match(conn, t1, [MID, "m2"])
    # Das Match mit Zuordnung bleibt vollständig …
    assert d[MID] == {ICH, MATE}
    # … und das ohne taucht hier gar nicht auf, der Rückfall im Aufrufer
    # muss es abfangen.
    assert "m2" not in d
