// Typed client for the FastAPI backend (same origin in production, proxied in dev).

const BASE = import.meta.env.VITE_API_BASE ?? "";

export interface Metrics {
  n: number;
  mae?: number;
  rmse?: number;
  bias?: number;
  nmae?: number | null;
  mean_actual?: number;
  mean_forecast?: number;
  p10?: number;
  p50?: number;
  p90?: number;
  p95_abs?: number;
  max_abs?: number;
  within_1gw?: number;
  correlation?: number | null;
}

export interface SlimMetrics {
  n: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  p10: number | null;
  p90: number | null;
}

export interface SeriesPoint {
  time: string;
  publish_time: string;
  forecast: number;
  actual: number | null;
  error: number | null;
  horizon_h: number;
}

export interface DayAheadPoint extends SeriesPoint {
  band_low: number;
  band_high: number;
  reliable_p90: number;
}

export interface Meta {
  delivery_days: string[];
  decision_from: string;
  decision_to: string;
  default_gate: string;
  source: string;
  loaded_at: string;
  counts: Record<string, number>;
}

export interface DayAhead {
  date: string;
  gate: string;
  decision_time: string;
  publish_time: string | null;
  forecast_age_h: number | null;
  series: DayAheadPoint[];
  actual_half_hourly: { time: string; actual: number }[];
  summary: {
    forecast_mwh: number;
    reliable_p90_mwh: number;
    peak_mw: number | null;
    min_mw: number | null;
    actual_mwh: number | null;
  };
  metrics: Metrics;
  band: { p10: number; p90: number; basis: string };
}

export interface Buffer {
  confidence: number;
  buffer_mw: number;
}

export interface Accuracy {
  mode: "dayahead" | "horizon";
  gate?: string;
  horizon_h?: number;
  metrics: Metrics;
  buffers: Buffer[];
  by_hour: (SlimMetrics & { hour: number })[];
  histogram: { from: number; to: number; count: number }[];
  daily: (SlimMetrics & { date: string; publish_time: string; forecast_mwh: number; actual_mwh: number })[];
  series: SeriesPoint[];
}

export interface HorizonCurve {
  points: (SlimMetrics & { horizon_h: number })[];
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  dayAhead: (date: string, gate: string) => get<DayAhead>("/api/dayahead", { date, gate }),
  accuracy: (gate: string, horizon?: number) => get<Accuracy>("/api/accuracy", { gate, horizon }),
  horizonCurve: () => get<HorizonCurve>("/api/horizon-curve"),
};
