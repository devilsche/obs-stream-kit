"""Telemetrie-Beschaffung: HiDrive zuerst, PUBG-API als Fallback.

Die Reihenfolge ist nicht nur pragmatisch: Telemetrie ist unveraenderlich,
ein archiviertes Match aendert sich nie. HiDrive-first spart damit jeden
externen Call — und die API loescht nach ~17 Tagen (gemessen 2026-08-26).
"""
import pytest

from pubg import telemetry_source as ts


class FakeArchive:
    """Steht fuer pubg.hidrive_telemetry."""

    def __init__(self, stored=None, fail=False):
        self.stored = dict(stored or {})
        self.fail = fail
        self.uploaded = {}

    def download_raw(self, match_id, secrets_path=".secrets", cfg=None):
        if self.fail:
            raise OSError("SFTP kaputt")
        return self.stored.get(match_id)

    def upload_raw(self, match_id, events, secrets_path=".secrets", cfg=None):
        if self.fail:
            raise OSError("SFTP kaputt")
        self.uploaded[match_id] = events
        return True


class FakeClient:
    def __init__(self, events=None, fail=False):
        self.events = events
        self.fail = fail
        self.calls = []

    def get_telemetry(self, url):
        self.calls.append(url)
        if self.fail:
            raise OSError("403 Access Denied")
        return self.events


EV = [{"_T": "LogPlayerAttack"}]


def test_archive_is_preferred_over_api():
    arch = FakeArchive({"m1": EV})
    cli = FakeClient([{"_T": "andere"}])
    res = ts.load_telemetry("m1", telemetry_url="http://x", archive=arch, client=cli)
    assert res.events == EV
    assert res.source == "hidrive"
    assert cli.calls == []          # API gar nicht erst gefragt


def test_falls_back_to_api_when_not_archived():
    arch = FakeArchive({})
    cli = FakeClient(EV)
    res = ts.load_telemetry("m2", telemetry_url="http://x", archive=arch, client=cli)
    assert res.events == EV
    assert res.source == "api"
    assert cli.calls == ["http://x"]


def test_api_result_is_pushed_into_the_archive():
    """Ein von der API geholtes Match wandert ins Archiv — sonst ist es nach
    Ablauf der Retention endgueltig weg."""
    arch = FakeArchive({})
    res = ts.load_telemetry("m3", telemetry_url="http://x",
                            archive=arch, client=FakeClient(EV))
    assert arch.uploaded["m3"] == EV
    assert res.archived is True


def test_upload_failure_does_not_lose_the_events():
    """Der Archiv-Upload ist Beiwerk. Schlaegt er fehl, zaehlen die Daten."""
    arch = FakeArchive({}, fail=True)
    res = ts.load_telemetry("m4", telemetry_url="http://x",
                            archive=arch, client=FakeClient(EV))
    assert res.events == EV
    assert res.source == "api"
    assert res.archived is False


def test_broken_archive_still_reaches_the_api():
    arch = FakeArchive(fail=True)
    res = ts.load_telemetry("m5", telemetry_url="http://x",
                            archive=arch, client=FakeClient(EV))
    assert res.events == EV
    assert res.source == "api"


def test_missing_everywhere_raises_with_a_usable_message():
    arch = FakeArchive({})
    with pytest.raises(ts.TelemetryUnavailable) as e:
        ts.load_telemetry("m6", telemetry_url="http://x",
                          archive=arch, client=FakeClient(fail=True))
    assert "m6" in str(e.value)


def test_without_url_only_the_archive_is_tried():
    """Ohne telemetry_url gibt es keinen API-Weg — das darf kein Crash sein."""
    arch = FakeArchive({})
    with pytest.raises(ts.TelemetryUnavailable):
        ts.load_telemetry("m7", telemetry_url=None, archive=arch, client=FakeClient(EV))


def test_empty_archive_entry_is_treated_as_absent():
    """download_raw kann [] liefern — das ist kein brauchbares Match."""
    arch = FakeArchive({"m8": []})
    res = ts.load_telemetry("m8", telemetry_url="http://x",
                            archive=arch, client=FakeClient(EV))
    assert res.source == "api"


def test_default_client_is_constructible_without_api_key():
    """Der echte Fallback-Client muss ohne .secrets bauen: der
    Telemetrie-Download laeuft ueber die signierte CDN-URL, ohne Auth.
    Vorher zeigte _default_client() auf nicht existierende Namen
    (PubgApiClient/read_api_key) — der ImportError landete im
    "API-Fehler"-Zweig, der API-Fallback war damit fuer jeden Tenant tot."""
    c = ts._default_client("/nicht/vorhanden/.secrets")
    assert hasattr(c, "get_telemetry")
    assert c.api_key == ""
