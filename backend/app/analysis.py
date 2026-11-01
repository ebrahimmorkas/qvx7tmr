"""Forecast selection and accuracy analytics. Pure functions over a Dataset.

Conventions
-----------
* error = forecast - actual (MW). Positive error = wind under-delivered against the
  forecast, i.e. a shortfall the desk must cover by buying more power.
* Day-ahead mode: for delivery day D, the forecast used for every hour of D is the
  latest one published at or before the gate closure on D-1 (UK local time).
* Fixed-horizon mode: for each target hour t, the latest forecast published at or
  before t - H. Used to show how accuracy decays with lead time.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from .config import UK_TZ
from .store import Dataset, day_bounds_utc

HOUR = timedelta(hours=1)
CONFIDENCE_LEVELS = (0.5, 0.8, 0.9, 0.95, 0.99)


@dataclass(frozen=True)
class Point:
    target: datetime
    publish: datetime
    forecast: float
    actual: float | None
    horizon_h: float
    delivery_day: date

    @property
    def error(self) -> float | None:
        return None if self.actual is None else self.forecast - self.actual


# ---------------------------------------------------------------- statistics

def quantile(values: list[float], q: float) -> float:
    """Linear-interpolated quantile (same as numpy's default)."""
    if not values:
        return math.nan
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def error_metrics(points: list[Point]) -> dict:
    pairs = [(p.forecast, p.actual) for p in points if p.actual is not None]
    n = len(pairs)
    if n == 0:
        return {"n": 0}
    errors = [f - a for f, a in pairs]
    abs_err = [abs(e) for e in errors]
    mean_actual = sum(a for _, a in pairs) / n
    mae = sum(abs_err) / n
    return {
        "n": n,
        "mae": mae,
        "rmse": math.sqrt(sum(e * e for e in errors) / n),
        "bias": sum(errors) / n,
        "nmae": mae / mean_actual if mean_actual else None,
        "mean_actual": mean_actual,
        "mean_forecast": sum(f for f, _ in pairs) / n,
        "p10": quantile(errors, 0.10),
        "p50": quantile(errors, 0.50),
        "p90": quantile(errors, 0.90),
        "p95_abs": quantile(abs_err, 0.95),
        "max_abs": max(abs_err),
        "within_1gw": sum(1 for e in abs_err if e <= 1000) / n,
        "correlation": _corr([f for f, _ in pairs], [a for _, a in pairs]),
    }


def _corr(x: list[float], y: list[float]) -> float | None:
    n = len(x)
    if n < 2:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y, strict=False))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else None


def shortfall_buffers(points: list[Point], levels=CONFIDENCE_LEVELS) -> list[dict]:
    """Extra MW to procure on top of (demand - wind forecast) so that wind
    shortfall is covered in `level` of historical hours: B = quantile(error, level)."""
    errors = [p.error for p in points if p.error is not None]
    out = []
    for lvl in levels:
        b = max(0.0, quantile(errors, lvl)) if errors else math.nan
        out.append({"confidence": lvl, "buffer_mw": b})
    return out


def histogram(points: list[Point], bin_mw: int = 500) -> list[dict]:
    counts: dict[int, int] = defaultdict(int)
    for p in points:
        if p.error is not None:
            counts[math.floor(p.error / bin_mw)] += 1
    if not counts:
        return []
    return [{"from": k * bin_mw, "to": (k + 1) * bin_mw, "count": counts.get(k, 0)}
            for k in range(min(counts), max(counts) + 1)]


def by_hour_of_day(points: list[Point]) -> list[dict]:
    groups: dict[int, list[Point]] = defaultdict(list)
    for p in points:
        groups[p.target.astimezone(UK_TZ).hour].append(p)
    return [{"hour": h, **_slim(error_metrics(groups[h]))} for h in range(24) if groups.get(h)]


def daily_summary(points: list[Point]) -> list[dict]:
    groups: dict[date, list[Point]] = defaultdict(list)
    for p in points:
        groups[p.delivery_day].append(p)
    out = []
    for day in sorted(groups):
        pts = [p for p in groups[day] if p.actual is not None]
        m = error_metrics(pts)
        out.append({
            "date": day.isoformat(),
            "publish_time": iso(groups[day][0].publish),
            "forecast_mwh": sum(p.forecast for p in pts),   # hourly MW -> MWh
            "actual_mwh": sum(p.actual for p in pts),
            **_slim(m),
        })
    return out


def _slim(m: dict) -> dict:
    keys = ("n", "mae", "rmse", "bias", "p10", "p90")
    return {k: m.get(k) for k in keys}


# ---------------------------------------------------------------- selection

def gate_cutoff(day: date, gate: time) -> datetime:
    """Decision time for delivery `day`: gate closure on the previous UK day."""
    prev = day - timedelta(days=1)
    return datetime.combine(prev, gate, tzinfo=UK_TZ).astimezone(timezone.utc)


def hourly_targets(day: date) -> list[datetime]:
    start, end = day_bounds_utc(day)
    out, t = [], start
    while t < end:
        out.append(t)
        t += HOUR
    return out


def dayahead_points(ds: Dataset, days: list[date], gate: time) -> list[Point]:
    pts = []
    for day in days:
        cutoff = gate_cutoff(day, gate)
        for t in hourly_targets(day):
            hit = ds.latest_forecast(t, cutoff)
            if hit:
                pub, val = hit
                pts.append(Point(t, pub, val, ds.actual_hourly.get(t),
                                 (t - pub).total_seconds() / 3600, day))
    return pts


def horizon_points(ds: Dataset, days: list[date], horizon_h: float) -> list[Point]:
    lead = timedelta(hours=horizon_h)
    pts = []
    for day in days:
        for t in hourly_targets(day):
            hit = ds.latest_forecast(t, t - lead)
            if hit:
                pub, val = hit
                pts.append(Point(t, pub, val, ds.actual_hourly.get(t),
                                 (t - pub).total_seconds() / 3600, day))
    return pts


def horizon_curve(ds: Dataset, days: list[date], max_h: int = 48) -> list[dict]:
    return [{"horizon_h": h, **_slim(error_metrics(horizon_points(ds, days, h)))}
            for h in range(0, max_h + 1)]


# ---------------------------------------------------------------- serialisers

def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def point_json(p: Point) -> dict:
    return {
        "time": iso(p.target),
        "publish_time": iso(p.publish),
        "forecast": p.forecast,
        "actual": p.actual,
        "error": p.error,
        "horizon_h": p.horizon_h,
    }


def actual_hh_series(ds: Dataset, day: date) -> list[dict]:
    start, end = day_bounds_utc(day)
    return [{"time": iso(t), "actual": v} for t, v in sorted(ds.actual_hh.items()) if start <= t < end]
