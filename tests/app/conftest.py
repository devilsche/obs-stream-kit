import os
import pytest
from app import create_app


@pytest.fixture
def app():
    return create_app(testing=True)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def pg_dsn_test():
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST braucht 'test' im Namen (Schutz)")
    return dsn
