import os
import sys
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Credential-Vault braucht einen Master-Key. In Tests reicht ein fester
# Dummy — die Test-DB ist ohnehin getrennt. Einen echten Key aus der
# Umgebung lassen wir unangetastet.
os.environ.setdefault(
    "OBS_KIT_MASTER_KEY", "dGVzdC1tYXN0ZXIta2V5LTMyLWJ5dGVzLWxvbmchISE="
)


@pytest.fixture
def tmp_db_path(tmp_path):
    return str(tmp_path / "test.db")
