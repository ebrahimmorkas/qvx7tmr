"""Application settings, overridable through environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, time
from pathlib import Path
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")
BACKEND_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    # Purchase decisions in scope (UK local dates, inclusive). A decision made on
    # day D-1 buys power for delivery day D, so delivery days are shifted by one.
    decision_from: date = date.fromisoformat(_env("GRIDBICK_DECISION_FROM", "2026-01-01"))
    decision_to: date = date.fromisoformat(_env("GRIDBICK_DECISION_TO", "2026-01-31"))

    # Default day-ahead gate closure (UK local time on D-1). Configurable per request.
    default_gate: time = time.fromisoformat(_env("GRIDBICK_DEFAULT_GATE", "09:20"))

    # "auto" = live Elexon API, falling back to the bundled snapshot on failure.
    # "live" = live only. "snapshot" = bundled snapshot only (fast, offline).
    data_source: str = _env("GRIDBICK_DATA_SOURCE", "auto")
    cache_ttl_seconds: int = int(_env("GRIDBICK_CACHE_TTL", "21600"))
    elexon_base_url: str = _env("GRIDBICK_ELEXON_URL", "https://data.elexon.co.uk/bmrs/api/v1")
    snapshot_path: Path = Path(
        _env("GRIDBICK_SNAPSHOT", str(BACKEND_DIR / "data" / "snapshot-2026-01.json.gz"))
    )
    # Built React app served by FastAPI in the Docker image (ignored if missing).
    static_dir: Path = Path(_env("GRIDBICK_STATIC_DIR", str(BACKEND_DIR.parent / "frontend" / "dist")))


settings = Settings()
