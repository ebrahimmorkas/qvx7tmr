from datetime import date, datetime, time, timezone

import pytest

from app import analysis as an
from app.store import Dataset


def make_dataset() -> Dataset:
    """Tiny synthetic dataset for delivery day 2026-01-02 (GMT, so UK local == UTC)."""
    actuals = []
    for h in range(24):
        for m in (0, 30):
            actuals.append({"startTime": f"2026-01-02T{h:02d}:{m:02d}:00Z", "generation": 1000.0})
    forecasts = []
    for h in range(24):
        target = f"2026-01-02T{h:02d}:00:00Z"
        # Older forecast (D-1 04:30) says 1200, newer (D-1 07:30) says 1100,
        # one published after gate (D-1 11:30) says 5000 and must never be used day-ahead.
        forecasts += [
            {"publishTime": "2026-01-01T04:30:00Z", "startTime": target, "generation": 1200.0},
            {"publishTime": "2026-01-01T07:30:00Z", "startTime": target, "generation": 1100.0},
            {"publishTime": "2026-01-01T11:30:00Z", "startTime": target, "generation": 5000.0},
        ]
    # A "forecast" published after its target must be dropped.
    forecasts.append({"publishTime": "2026-01-02T05:00:00Z", "startTime": "2026-01-02T01:00:00Z",
                      "generation": 9999.0})
    return Dataset.from_raw(actuals, forecasts, "test")


def test_quantile_matches_linear_interpolation():
    assert an.quantile([1, 2, 3, 4], 0.5) == 2.5
    assert an.quantile([10], 0.9) == 10
    assert an.quantile([0, 10], 0.9) == pytest.approx(9.0)


def test_gate_cutoff_is_previous_uk_day():
    assert an.gate_cutoff(date(2026, 1, 2), time(9, 20)) == datetime(2026, 1, 1, 9, 20, tzinfo=timezone.utc)
    # In summer (BST, UTC+1) 09:20 UK is 08:20 UTC.
    assert an.gate_cutoff(date(2026, 7, 2), time(9, 20)) == datetime(2026, 7, 1, 8, 20, tzinfo=timezone.utc)


def test_dayahead_uses_latest_forecast_before_gate():
    ds = make_dataset()
    pts = an.dayahead_points(ds, [date(2026, 1, 2)], time(9, 20))
    assert len(pts) == 24
    assert {p.forecast for p in pts} == {1100.0}
    assert all(p.publish == datetime(2026, 1, 1, 7, 30, tzinfo=timezone.utc) for p in pts)


def test_earlier_gate_falls_back_to_older_forecast():
    pts = an.dayahead_points(make_dataset(), [date(2026, 1, 2)], time(6, 0))
    assert {p.forecast for p in pts} == {1200.0}


def test_forecasts_published_after_target_are_ignored():
    ds = make_dataset()
    target = datetime(2026, 1, 2, 1, tzinfo=timezone.utc)
    assert 9999.0 not in ds.forecasts[target][1]


def test_horizon_mode_respects_lead_time():
    ds = make_dataset()
    pts = an.horizon_points(ds, [date(2026, 1, 2)], 0)
    first = next(p for p in pts if p.target.hour == 0)
    assert first.forecast == 5000.0          # 11:30 publish is the latest before 00:00
    pts_long = an.horizon_points(ds, [date(2026, 1, 2)], 17)
    assert next(p for p in pts_long if p.target.hour == 0).forecast == 1200.0


def test_error_metrics_and_buffers():
    pts = an.dayahead_points(make_dataset(), [date(2026, 1, 2)], time(9, 20))
    m = an.error_metrics(pts)
    assert m["n"] == 24
    assert m["mae"] == pytest.approx(100.0)
    assert m["bias"] == pytest.approx(100.0)   # forecast 1100 vs actual 1000
    assert m["nmae"] == pytest.approx(0.1)
    buffers = {b["confidence"]: b["buffer_mw"] for b in an.shortfall_buffers(pts)}
    assert buffers[0.9] == pytest.approx(100.0)


def test_buffers_never_negative():
    p = an.Point(datetime(2026, 1, 2, tzinfo=timezone.utc), datetime(2026, 1, 1, tzinfo=timezone.utc),
                 500.0, 1000.0, 24.0, date(2026, 1, 2))
    assert all(b["buffer_mw"] == 0.0 for b in an.shortfall_buffers([p]))


def test_actual_hourly_averages_half_hours():
    ds = Dataset.from_raw(
        [{"startTime": "2026-01-02T00:00:00Z", "generation": 100},
         {"startTime": "2026-01-02T00:30:00Z", "generation": 300},
         {"startTime": "2026-01-02T01:00:00Z", "generation": 50}],   # no partner half-hour
        [], "test")
    assert ds.actual_hourly == {datetime(2026, 1, 2, tzinfo=timezone.utc): 200.0}


def test_histogram_bins_cover_errors():
    pts = an.dayahead_points(make_dataset(), [date(2026, 1, 2)], time(9, 20))
    hist = an.histogram(pts, bin_mw=500)
    assert hist == [{"from": 0, "to": 500, "count": 24}]
