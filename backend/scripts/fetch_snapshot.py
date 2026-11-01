"""Download the in-scope Elexon data and save it as a gzipped JSON snapshot.

The snapshot is the fallback when the live API is unreachable, and makes tests and
offline demos deterministic.  Usage (from backend/):  python -m scripts.fetch_snapshot
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.store import fetch_live, fetch_window  # noqa: E402


def main() -> None:
    a_from, a_to, f_from, f_to = fetch_window()
    print(f"actuals {a_from}..{a_to}, forecasts published {f_from:%Y-%m-%d %H:%M}..{f_to:%Y-%m-%d %H:%M} UTC")
    actuals, forecasts = fetch_live()
    settings.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(settings.snapshot_path, "wt", encoding="utf-8") as fh:
        json.dump({"actuals": actuals, "forecasts": forecasts}, fh, separators=(",", ":"))
    print(f"wrote {len(actuals)} actuals, {len(forecasts)} forecasts -> {settings.snapshot_path}")


if __name__ == "__main__":
    main()
