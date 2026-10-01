import pytest


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Keep tests off the real ~/.inference-exchange/exchange.db."""
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "exchange.db"))
