"""FastAPI entry point: JSON API under /api, plus the built React app when present."""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analysis as an
from .config import settings
from .store import Dataset, delivery_days, store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Gridbick - UK Wind Forecast Monitor",
    description="Day-ahead wind forecast visibility and accuracy analytics on Elexon BMRS data.",
    version="1.0.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


# ---------------------------------------------------------------- helpers

def _parse_gate(gate: str | None) -> time:
    if not gate:
        return settings.default_gate
    try:
        return time.fromisoformat(gate)
    except ValueError:
        raise HTTPException(422, "gate must be HH:MM (UK local time)") from None


def _parse_day(value: str) -> date:
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD") from None
    if day not in delivery_days():
        raise HTTPException(404, f"{day} is outside the delivery window in scope")
    return day


@lru_cache(maxsize=64)
def _dayahead_points(loaded_at: datetime, gate: time) -> list[an.Point]:
    return an.dayahead_points(store.get(), delivery_days(), gate)


def _points_for_gate(ds: Dataset, gate: time) -> list[an.Point]:
    return _dayahead_points(ds.loaded_at, gate)


@lru_cache(maxsize=4)
def _horizon_curve(loaded_at: datetime) -> list[dict]:
    return an.horizon_curve(store.get(), delivery_days())


# ---------------------------------------------------------------- routes

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/meta")
def meta() -> dict:
    ds = store.get()
    days = delivery_days()
    return {
        "delivery_days": [d.isoformat() for d in days],
        "decision_from": settings.decision_from.isoformat(),
        "decision_to": settings.decision_to.isoformat(),
        "default_gate": settings.default_gate.strftime("%H:%M"),
        "source": ds.source,
        "loaded_at": ds.loaded_at.isoformat(),
        "counts": {
            "actual_half_hours": len(ds.actual_hh),
            "forecast_targets": len(ds.forecasts),
            "forecast_values": sum(len(p) for p, _ in ds.forecasts.values()),
        },
    }


@app.get("/api/dayahead")
def dayahead(date_: str = Query(..., alias="date"), gate: str | None = None) -> dict:
    """What the desk sees at gate closure for one delivery day, and how it turned out."""
    ds = store.get()
    day, gate_t = _parse_day(date_), _parse_gate(gate)
    month = _points_for_gate(ds, gate_t)
    pts = [p for p in month if p.delivery_day == day]

    m = an.error_metrics(month)
    buffers = an.shortfall_buffers(month)
    p10, p90 = m.get("p10", 0.0), m.get("p90", 0.0)
    b90 = next(b["buffer_mw"] for b in buffers if b["confidence"] == 0.9)

    series = []
    for p in pts:
        row = an.point_json(p)
        # Historical P10-P90 error band: actual = forecast - error.
        row["band_low"] = max(0.0, p.forecast - p90)
        row["band_high"] = p.forecast - p10
        row["reliable_p90"] = max(0.0, p.forecast - b90)
        series.append(row)

    cutoff = an.gate_cutoff(day, gate_t)
    publish = pts[0].publish if pts else None
    return {
        "date": day.isoformat(),
        "gate": gate_t.strftime("%H:%M"),
        "decision_time": an.iso(cutoff),
        "publish_time": an.iso(publish) if publish else None,
        "forecast_age_h": (cutoff - publish).total_seconds() / 3600 if publish else None,
        "series": series,
        "actual_half_hourly": an.actual_hh_series(ds, day),
        "summary": {
            "forecast_mwh": sum(p.forecast for p in pts),
            "reliable_p90_mwh": sum(r["reliable_p90"] for r in series),
            "peak_mw": max((p.forecast for p in pts), default=None),
            "min_mw": min((p.forecast for p in pts), default=None),
            "actual_mwh": sum(p.actual for p in pts if p.actual is not None) if pts else None,
        },
        "metrics": an.error_metrics(pts),
        "band": {"p10": p10, "p90": p90, "basis": "all delivery days in scope, same gate"},
    }


@app.get("/api/accuracy")
def accuracy(gate: str | None = None, horizon: float | None = Query(None, ge=0, le=60)) -> dict:
    """Month-level accuracy. Day-ahead mode by default; pass `horizon` for fixed lead time."""
    ds = store.get()
    if horizon is not None:
        pts = an.horizon_points(ds, delivery_days(), horizon)
        mode = {"mode": "horizon", "horizon_h": horizon}
    else:
        gate_t = _parse_gate(gate)
        pts = _points_for_gate(ds, gate_t)
        mode = {"mode": "dayahead", "gate": gate_t.strftime("%H:%M")}
    return {
        **mode,
        "metrics": an.error_metrics(pts),
        "buffers": an.shortfall_buffers(pts),
        "by_hour": an.by_hour_of_day(pts),
        "histogram": an.histogram(pts),
        "daily": an.daily_summary(pts),
        "series": [an.point_json(p) for p in pts],
    }


@app.get("/api/horizon-curve")
def horizon_curve() -> dict:
    """Error statistics for lead times 0-48 h (latest forecast at least H hours old)."""
    ds = store.get()
    return {"points": _horizon_curve(ds.loaded_at)}


# ---------------------------------------------------------------- frontend

if settings.static_dir.is_dir():
    index_html = settings.static_dir / "index.html"
    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = settings.static_dir / path
        if path and candidate.is_file() and settings.static_dir in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(index_html)
