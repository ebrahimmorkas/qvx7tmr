"""Thin client for the two Elexon BMRS datasets used by the app.

* FUELHH  - half-hourly outturn generation by fuel type (we keep fuelType=WIND)
* WINDFOR - hourly national wind generation forecasts, many publish times per target
"""

from __future__ import annotations

import logging
import time as _time
from datetime import date, datetime, timedelta, timezone

import httpx

from .config import settings

log = logging.getLogger(__name__)

CHUNK_DAYS = 7
RETRIES = 3


def _get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    url = f"{settings.elexon_base_url}{path}"
    for attempt in range(1, RETRIES + 1):
        try:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            # Stream endpoints return a bare list; non-stream ones wrap it in "data".
            return data["data"] if isinstance(data, dict) else data
        except (httpx.HTTPError, ValueError) as exc:
            if attempt == RETRIES:
                raise
            log.warning("Elexon %s failed (attempt %d): %s", path, attempt, exc)
            _time.sleep(attempt)
    return []  # pragma: no cover


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_actuals(day_from: date, day_to: date, client: httpx.Client | None = None) -> list[dict]:
    """Wind outturn for settlement dates [day_from, day_to], inclusive."""
    own = client is None
    client = client or httpx.Client(timeout=60)
    out: dict[str, dict] = {}
    try:
        start = day_from
        while start <= day_to:
            end = min(start + timedelta(days=CHUNK_DAYS - 1), day_to)
            rows = _get(client, "/datasets/FUELHH/stream", {
                "settlementDateFrom": start.isoformat(),
                "settlementDateTo": end.isoformat(),
                "fuelType": "WIND",
            })
            for r in rows:
                if r.get("fuelType") == "WIND" and r.get("generation") is not None:
                    out[r["startTime"]] = {"startTime": r["startTime"], "generation": float(r["generation"])}
            start = end + timedelta(days=1)
    finally:
        if own:
            client.close()
    return sorted(out.values(), key=lambda r: r["startTime"])


def fetch_forecasts(publish_from: datetime, publish_to: datetime,
                    client: httpx.Client | None = None) -> list[dict]:
    """Every wind forecast published in [publish_from, publish_to]."""
    own = client is None
    client = client or httpx.Client(timeout=60)
    out: dict[tuple[str, str], dict] = {}
    try:
        start = publish_from
        while start < publish_to:
            end = min(start + timedelta(days=CHUNK_DAYS), publish_to)
            rows = _get(client, "/datasets/WINDFOR/stream", {
                "publishDateTimeFrom": _iso(start),
                "publishDateTimeTo": _iso(end),
            })
            for r in rows:
                if r.get("generation") is None:
                    continue
                key = (r["publishTime"], r["startTime"])
                out[key] = {"publishTime": r["publishTime"], "startTime": r["startTime"],
                            "generation": float(r["generation"])}
            start = end
    finally:
        if own:
            client.close()
    return sorted(out.values(), key=lambda r: (r["startTime"], r["publishTime"]))
