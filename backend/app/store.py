"""Loads raw Elexon data (live or snapshot), caches it and indexes it for analysis."""

from __future__ import annotations

import bisect
import gzip
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import elexon
from .config import UK_TZ, settings

log = logging.getLogger(__name__)
HOUR = timedelta(hours=1)
HALF_HOUR = timedelta(minutes=30)


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def delivery_days() -> list[date]:
    """Delivery days whose day-ahead purchase decision falls inside the configured window."""
    days, d = [], settings.decision_from
    while d <= settings.decision_to:
        days.append(d + timedelta(days=1))
        d += timedelta(days=1)
    return days


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """UTC [start, end) of a UK local calendar day (handles GMT/BST)."""
    start = datetime(day.year, day.month, day.day, tzinfo=UK_TZ)
    nxt = day + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=UK_TZ)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def fetch_window() -> tuple[date, date, datetime, datetime]:
    """Raw data window: actual settlement dates and forecast publish times."""
    days = delivery_days()
    first_start, _ = day_bounds_utc(days[0])
    _, last_end = day_bounds_utc(days[-1])
    # Forecasts: enough history for a 48h+ lead time before the first target.
    return (days[0] - timedelta(days=1), days[-1] + timedelta(days=1),
            first_start - timedelta(hours=72), last_end)


@dataclass
class Dataset:
    """Indexed data. Times are UTC datetimes; generation is MW."""
    actual_hh: dict[datetime, float]                       # half-hourly outturn
    forecasts: dict[datetime, tuple[list[datetime], list[float]]]  # target -> (publish times asc, values)
    source: str
    loaded_at: datetime
    actual_hourly: dict[datetime, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Forecasts are hourly; align actuals by averaging the two half-hours of each hour.
        for t, v in self.actual_hh.items():
            if t.minute == 0 and (t + HALF_HOUR) in self.actual_hh:
                self.actual_hourly[t] = (v + self.actual_hh[t + HALF_HOUR]) / 2

    @classmethod
    def from_raw(cls, actuals: list[dict], forecasts: list[dict], source: str) -> Dataset:
        actual_hh = {parse_ts(r["startTime"]): float(r["generation"]) for r in actuals}
        grouped: dict[datetime, list[tuple[datetime, float]]] = {}
        for r in forecasts:
            target, pub = parse_ts(r["startTime"]), parse_ts(r["publishTime"])
            if pub > target:          # "forecasts" of the past are not forecasts
                continue
            grouped.setdefault(target, []).append((pub, float(r["generation"])))
        index = {}
        for target, items in grouped.items():
            items.sort()
            index[target] = ([p for p, _ in items], [v for _, v in items])
        return cls(actual_hh, index, source, datetime.now(timezone.utc))

    def latest_forecast(self, target: datetime, cutoff: datetime) -> tuple[datetime, float] | None:
        """Most recent forecast for `target` published at or before `cutoff`."""
        entry = self.forecasts.get(target)
        if not entry:
            return None
        pubs, vals = entry
        i = bisect.bisect_right(pubs, cutoff) - 1
        return (pubs[i], vals[i]) if i >= 0 else None


def load_snapshot(path: Path) -> tuple[list[dict], list[dict]]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        raw = json.load(fh)
    return raw["actuals"], raw["forecasts"]


def fetch_live() -> tuple[list[dict], list[dict]]:
    a_from, a_to, f_from, f_to = fetch_window()
    return elexon.fetch_actuals(a_from, a_to), elexon.fetch_forecasts(f_from, f_to)


class Store:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: Dataset | None = None
        self._expires = 0.0

    def get(self) -> Dataset:
        with self._lock:
            if self._data is None or time.monotonic() > self._expires:
                self._data = self._load()
                self._expires = time.monotonic() + settings.cache_ttl_seconds
            return self._data

    def _load(self) -> Dataset:
        mode = settings.data_source
        if mode in ("auto", "live"):
            try:
                actuals, forecasts = fetch_live()
                log.info("Loaded %d actuals, %d forecasts from Elexon", len(actuals), len(forecasts))
                return Dataset.from_raw(actuals, forecasts, "elexon-live")
            except Exception:
                if mode == "live":
                    raise
                log.exception("Live Elexon fetch failed; falling back to snapshot")
        actuals, forecasts = load_snapshot(settings.snapshot_path)
        return Dataset.from_raw(actuals, forecasts, "snapshot")


store = Store()
