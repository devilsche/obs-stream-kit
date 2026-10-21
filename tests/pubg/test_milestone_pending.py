"""Ein gescheiterter Meilenstein-Check wird nachgeholt.

Bisher lief der Check nur im Tick mit neuen Matches. Scheiterte er dort
(Rate-Limit, Netz), kam er erst mit dem naechsten Match wieder — der
Tempo-Rekord vom 21.10. blieb so ungefeiert.
"""
from pubg import poller


def test_gescheiterter_check_wird_im_naechsten_tick_wiederholt(pg_compat,
                                                               monkeypatch):
    conn, t = pg_compat[0], pg_compat[1]
    antworten = [{"error": "429"}, {"detected": 1, "queued": 1}]
    aufrufe = []

    def _fake(conn_, tenant_id, client, account_id=None, **kw):
        aufrufe.append(tenant_id)
        return antworten.pop(0)
    monkeypatch.setattr(poller, "refresh_milestones", _fake)

    poller.milestones_tick(conn, t, None, "account.A", neu=True)
    poller.milestones_tick(conn, t, None, "account.A", neu=False)
    poller.milestones_tick(conn, t, None, "account.A", neu=False)
    assert len(aufrufe) == 2, "nach dem Fehler nochmal, nach Erfolg nicht"


def test_zu_frisch_bleibt_offen(pg_compat, monkeypatch):
    """Ist der letzte Check zu jung, bleibt der Auftrag stehen — sonst
    ginge Telemetrie verloren, die nach dem letzten Check kam."""
    conn, t = pg_compat[0], pg_compat[1]
    antworten = [{"skipped": "frisch (3 min)"}, {"detected": 0}]
    monkeypatch.setattr(poller, "refresh_milestones",
                        lambda *a, **k: antworten.pop(0))
    poller.milestones_tick(conn, t, None, "account.A", neu=True)
    poller.milestones_tick(conn, t, None, "account.A", neu=False)
    assert antworten == []


def test_ohne_anlass_kein_check(pg_compat, monkeypatch):
    conn, t = pg_compat[0], pg_compat[1]
    aufrufe = []
    monkeypatch.setattr(poller, "refresh_milestones",
                        lambda *a, **k: aufrufe.append(1) or {})
    poller.milestones_tick(conn, t, None, "account.A", neu=False)
    assert aufrufe == []
