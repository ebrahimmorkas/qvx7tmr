# Gridbick: UK Wind Forecast Monitor

A web app for a UK utility's day-ahead trading desk. For every delivery day it shows **the latest national wind forecast that was available at the day-ahead decision time**. It also measures **how accurate those forecasts were** and turns the error into a procurement buffer: how much extra power to buy to cover a wind shortfall at a chosen confidence level.

Data: Elexon BMRS [`FUELHH`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) (actual generation, fuel type `WIND`) and [`WINDFOR`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream) (wind forecasts). Scope: purchase decisions made in **January 2026**, i.e. delivery days 2 Jan to 1 Feb 2026.

**Live app:** _<add Vercel / Heroku URL here>_
**Demo video:** _<add unlisted YouTube URL here>_

---

## Features

| Page | What it answers |
|---|---|
| **Day-ahead view** | "What did we know at gate closure?" Picks a delivery day and shows the forecast in force at gate closure on D-1 (default 09:20 UK, configurable): the publish time and its age, the historical P10–P90 error band, the *P90 reliable wind* line, the extra energy to procure, and the actual outturn half-hourly. An hourly table is available. |
| **Forecast accuracy** | "How much can we trust it?" MAE, RMSE, bias, nMAE, P10/P90 error, share of hours within ±1 GW, and correlation. Also: the full-period chart (with zoom), how error grows with lead time over 0–48 h, a shortfall-buffer table (50–99% cover), error by hour of day, the error histogram, and a per-day breakdown that opens each day in the day-ahead view. You can switch between *day-ahead @ gate* and *fixed lead time* (0–48 h slider). |
| **Methodology** | Data sources, how the forecast is selected (no look-ahead), metric definitions, and limitations. |

The gate time, selected day and tab are kept in the URL hash, so any view can be bookmarked or shared.

### Key findings (January 2026, gate 09:20)
- The forecast in force at gate closure was published at 07:30 on D-1, so lead times run from about 16.5 to 40.5 h.
- **MAE 2.04 GW** (18% of mean output), RMSE 2.50 GW, correlation 0.93. The forecast tracks the shape of the day well.
- **Systematic over-forecast of +1.75 GW**: only 26% of hours fall within ±1 GW. A desk that buys only *demand − forecast* would have been short in most hours.
- The bias stays at about 1.5 GW even 0–1 h ahead, so it is not just weather uncertainty. Likely causes are curtailment and differences in what each dataset covers.
- **Buffer to cover 90% of hours: ≈ 4.1 GW** (≈ 98 GWh per day).
- Error grows with lead time: MAE is about 1.7 GW at 0 h and about 2.3 GW at 48 h.

## Architecture

```
React (Vite, TypeScript, Recharts)  ──/api──▶  FastAPI (Python)  ──▶  Elexon BMRS API
                                                  │                      (live, cached 6 h)
                                                  └──▶ bundled snapshot (fallback / offline)
```

- **Backend** (`backend/app`)
  - `elexon.py`: HTTP client for the two stream endpoints. Requests are split into 7-day chunks, retried, and de-duplicated.
  - `store.py`: loads data (live → snapshot fallback), caches it in memory with a TTL, and indexes forecasts per target hour as publish times sorted for binary search. Also aligns the half-hourly actuals to hourly values.
  - `analysis.py`: **pure functions**. They select the forecast (day-ahead gate or fixed horizon, never using a forecast published after the cut-off) and compute the metrics, buffers, histogram, hour-of-day and daily breakdowns, and the lead-time curve.
  - `main.py`: REST endpoints. In Docker it also serves the built React app.
- **Frontend** (`frontend/src`): a single-page app with three views, a typed API client (`api.ts`), a small data-fetching hook (`useApi.ts`), and formatting in UK local time (`format.ts`).
- **Error convention**: error = forecast − actual. A positive error means a wind shortfall the desk has to buy.

### API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/meta` | Delivery days in scope, default gate, data source, record counts |
| `GET /api/dayahead?date=2026-01-15&gate=09:20` | Forecast at gate for one delivery day, with band, reliable line, actuals and day metrics |
| `GET /api/accuracy?gate=09:20` or `?horizon=24` | Metrics, buffers, by-hour, histogram, daily table and series for the whole period |
| `GET /api/horizon-curve` | MAE / RMSE / bias / P10 / P90 for lead times 0–48 h |

Interactive docs: `/docs` (Swagger UI).

## Repository layout

```
.
├── backend/
│   ├── app/
│   │   ├── config.py        # settings (env-overridable)
│   │   ├── elexon.py        # Elexon BMRS client
│   │   ├── store.py         # loading, caching, indexing
│   │   ├── analysis.py      # forecast selection + accuracy metrics (pure)
│   │   └── main.py          # FastAPI routes + static frontend
│   ├── data/snapshot-2026-01.json.gz   # offline/fallback copy of the in-scope data
│   ├── scripts/fetch_snapshot.py       # regenerates the snapshot from Elexon
│   ├── tests/               # pytest: unit tests (synthetic data) + API tests (snapshot)
│   ├── requirements.txt / requirements-dev.txt
│   └── pyproject.toml       # pytest + ruff config
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # shell, tabs, gate selector, URL state
│   │   ├── api.ts           # typed API client
│   │   ├── components/      # DayAheadView, AccuracyView, MethodView, ui
│   │   ├── format.ts, useApi.ts, styles.css
│   ├── index.html, vite.config.ts, tsconfig.json, package.json
├── api/index.py             # Vercel serverless entry (wraps backend FastAPI app)
├── vercel.json, .vercelignore, requirements.txt   # Vercel deployment
├── Dockerfile               # multi-stage: build React → serve with FastAPI
├── docker-compose.yml       # one-command local run
└── heroku.yml               # Heroku container deployment
```

## Running it

### Option 1: Docker (recommended)
```bash
docker compose up --build
# open http://localhost:8000
```
To run offline using only the bundled snapshot: `GRIDBICK_DATA_SOURCE=snapshot docker compose up --build`

### Option 2: Local development
```bash
# backend (Python 3.12+)
cd backend
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# frontend (Node 20+), in a second terminal
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :8000
```

### Tests and lint
```bash
cd backend && pytest && ruff check .
cd frontend && npm run typecheck
```

### Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `GRIDBICK_DATA_SOURCE` | `auto` | `auto` = live Elexon, falling back to the snapshot · `live` · `snapshot` |
| `GRIDBICK_DECISION_FROM` / `_TO` | `2026-01-01` / `2026-01-31` | Decision window (delivery day = decision day + 1) |
| `GRIDBICK_DEFAULT_GATE` | `09:20` | Default gate closure, UK local time on D-1 |
| `GRIDBICK_CACHE_TTL` | `21600` | Seconds before data is fetched from Elexon again |

## Deployment

- **Vercel**: import the repo. `vercel.json` builds the frontend as static files and deploys `api/index.py` (FastAPI) as a Python serverless function behind `/api/*`.
- **Heroku**: `heroku stack:set container && git push heroku main` builds the `Dockerfile` using `heroku.yml`.

## Development practices
- Domain logic is kept in pure, typed functions (`analysis.py`), separate from I/O (`elexon.py`, `store.py`) and HTTP (`main.py`).
- Look-ahead bias is avoided by construction: forecast selection always uses `publishTime ≤ cut-off`, and this is covered by tests.
- Times are handled in UTC internally and converted with `Europe/London` at the edges, so it stays correct across GMT/BST changes.
- Tests run offline: unit tests on synthetic data and API tests on the bundled snapshot. Linting uses ruff, and the frontend uses strict TypeScript.
- The app keeps working when Elexon is down (snapshot fallback), and the UI shows which data source is in use.

## Use of AI tools
This project was built with help from **Claude Code (Anthropic)**, an AI coding assistant. It was used to explore the Elexon API, scaffold the backend and frontend, write the analysis code and tests, and draft this README. All design decisions, analysis results and code were reviewed by the author.
