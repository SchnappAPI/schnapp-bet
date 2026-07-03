"""NFL season derivation + unpublished-season detection (ADR-20260703-2).

The June-flip bug 404'd every weekly run from 2026-06-02; these pin the
September flip and the SKIP classifier."""

from datetime import datetime, timezone
from unittest.mock import patch

import etl.nfl_etl as nfl_etl


def _at(year, month):
    fake_now = datetime(year, month, 15, tzinfo=timezone.utc)
    with patch.object(nfl_etl, "datetime") as dt:
        dt.now.return_value = fake_now
        return nfl_etl.current_nfl_season()


def test_offseason_months_target_completed_season():
    for month in (1, 2, 3, 4, 5, 6, 7, 8):
        assert _at(2026, month) == 2025, month


def test_in_season_months_target_current_year():
    for month in (9, 10, 11, 12):
        assert _at(2026, month) == 2026, month


def test_unpublished_season_errors_are_skips():
    assert nfl_etl._season_not_published(
        ValueError("Season must be between 2002 and 2025"))
    assert nfl_etl._season_not_published(ConnectionError(
        "Failed to download https://github.com/nflverse/nflverse-data/releases/"
        "download/stats_team/stats_team_week_2026.parquet: 404 Client Error"))


def test_real_failures_are_not_skips():
    assert not nfl_etl._season_not_published(RuntimeError("DB connection lost"))
    assert not nfl_etl._season_not_published(ValueError("bad dtype"))
    # A 404 from a non-nflverse URL is not an unpublished-season signal.
    assert not nfl_etl._season_not_published(
        ConnectionError("404 Client Error for url: https://example.com/x"))


def test_gsis_numeric_round_trip():
    from etl.odds_etl import _gsis_numeric
    assert _gsis_numeric("00-0033873") == 33873
    assert f"00-{_gsis_numeric('00-0033873'):07d}" == "00-0033873"
    assert _gsis_numeric(None) is None
    assert _gsis_numeric("garbage") is None
