import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type DayAhead } from "../api";
import { gw, gwh, ms, shiftDay, signedGw, ukDateTime, ukDay, ukTime } from "../format";
import { useApi } from "../useApi";
import { Card, ErrorState, Kpi, Legend, Loading, TooltipBox } from "./ui";

interface Props {
  days: string[];
  day: string;
  gate: string;
  onDay: (d: string) => void;
}

type Row = {
  t: number;
  forecast?: number;
  band?: [number, number];
  reliable?: number;
  actual?: number;
};

function buildRows(d: DayAhead): Row[] {
  const rows = new Map<number, Row>();
  const row = (iso: string) => {
    const t = ms(iso);
    if (!rows.has(t)) rows.set(t, { t });
    return rows.get(t)!;
  };
  for (const p of d.series) {
    const r = row(p.time);
    r.forecast = p.forecast;
    r.band = [p.band_low, p.band_high];
    r.reliable = p.reliable_p90;
  }
  for (const a of d.actual_half_hourly) row(a.time).actual = a.actual;
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

export default function DayAheadView({ days, day, gate, onDay }: Props) {
  const { data, error, loading } = useApi(() => api.dayAhead(day, gate), [day, gate]);
  const [showTable, setShowTable] = useState(false);
  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const idx = days.indexOf(day);

  const nav = (
    <div className="day-nav">
      <button className="icon-btn" aria-label="Previous day" disabled={idx <= 0} onClick={() => onDay(days[idx - 1])}>‹</button>
      <select value={day} onChange={(e) => onDay(e.target.value)} aria-label="Delivery day">
        {days.map((d) => (
          <option key={d} value={d}>{ukDay(d, { year: "numeric" })}</option>
        ))}
      </select>
      <button className="icon-btn" aria-label="Next day" disabled={idx >= days.length - 1} onClick={() => onDay(days[idx + 1])}>›</button>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Day-ahead wind position · {ukDay(day, { weekday: "long", year: "numeric" })}</h1>
          <p>
            What the trading desk sees at day-ahead gate closure on {ukDay(shiftDay(day, -1), { weekday: "long" })}{" "}
            at {gate} — the latest national wind forecast, its historical error band, and how the day actually turned out.
          </p>
        </div>
        {nav}
      </div>

      {error && <ErrorState error={error} />}
      {!data && loading && <Loading what="day-ahead view" />}
      {data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <div className="callout">
            <span>⚡</span>
            <div>
              At the decision point (<b>{ukDateTime(data.decision_time)}</b>) the latest forecast was published{" "}
              <b>{data.publish_time ? ukDateTime(data.publish_time) : "–"}</b>
              {data.forecast_age_h != null && <> ({data.forecast_age_h.toFixed(1)} h old)</>}. It expects{" "}
              <b>{gwh(data.summary.forecast_mwh)}</b> of wind; to be covered in 90% of hours, plan on only{" "}
              <strong>{gwh(data.summary.reliable_p90_mwh)}</strong> and buy the difference.
            </div>
          </div>

          <div className="grid kpis">
            <Kpi label="Forecast wind energy" value={gwh(data.summary.forecast_mwh)} hint={`peak ${gw(data.summary.peak_mw)} · low ${gw(data.summary.min_mw)}`} />
            <Kpi accent label="P90 reliable wind" value={gwh(data.summary.reliable_p90_mwh)} hint="covered in 90% of historical hours" />
            <Kpi
              label="Extra to procure (P90)"
              value={gwh(data.summary.forecast_mwh - data.summary.reliable_p90_mwh)}
              hint="buffer vs. relying on the raw forecast"
            />
            <Kpi
              label="Actual outturn"
              value={gwh(data.summary.actual_mwh)}
              hint={data.metrics.n ? <>day MAE {gw(data.metrics.mae, 2)} · bias {signedGw(data.metrics.bias)}</> : "not yet available"}
            />
          </div>

          <Card
            title="Forecast at gate closure vs. actual generation"
            sub="UK local time · forecast hourly, actuals half-hourly (FUELHH, fuel type WIND)"
            right={
              <button className="tab" onClick={() => setShowTable((s) => !s)}>
                {showTable ? "Hide" : "Show"} hourly table
              </button>
            }
          >
            <Legend
              items={[
                { label: "Latest forecast at gate", color: "var(--forecast)" },
                { label: "Historical P10–P90 range", color: "var(--band)", kind: "area" },
                { label: "P90 reliable wind", color: "var(--reliable)", kind: "dash" },
                { label: "Actual generation", color: "var(--actual)" },
              ]}
            />
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis
                  dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
                  tickFormatter={(t) => ukTime(new Date(t).toISOString())}
                  ticks={rows.filter((r) => new Date(r.t).getUTCMinutes() === 0 && new Date(r.t).getUTCHours() % 3 === 0).map((r) => r.t)}
                  stroke="var(--muted)" fontSize={12} tickLine={false}
                />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}`} stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false}
                  label={{ value: "GW", angle: -90, position: "insideLeft", fill: "var(--muted)", fontSize: 12 }} />
                <Tooltip content={<DayTooltip />} />
                <Area dataKey="band" stroke="none" fill="var(--band)" fillOpacity={0.14} connectNulls isAnimationActive={false} />
                <Line dataKey="reliable" stroke="var(--reliable)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                <Line dataKey="actual" stroke="var(--actual)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <ReferenceLine y={0} stroke="var(--border)" />
              </ComposedChart>
            </ResponsiveContainer>

            {showTable && (
              <div className="scroll" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr><th>Hour</th><th>Forecast</th><th>P90 reliable</th><th>Actual</th><th>Error (F−A)</th><th>Lead time</th></tr>
                  </thead>
                  <tbody>
                    {data.series.map((p) => (
                      <tr key={p.time}>
                        <td>{ukTime(p.time)}</td>
                        <td>{gw(p.forecast, 2)}</td>
                        <td>{gw(p.reliable_p90, 2)}</td>
                        <td>{gw(p.actual, 2)}</td>
                        <td className={p.error == null ? "" : p.error > 0 ? "pos" : "neg"}>{signedGw(p.error)}</td>
                        <td className="muted">{p.horizon_h.toFixed(1)} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r: Row = payload[0].payload;
  const rows: [string, string][] = [];
  if (r.forecast != null) rows.push(["Forecast", gw(r.forecast, 2)]);
  if (r.band) rows.push(["P10–P90", `${gw(r.band[0], 1)} – ${gw(r.band[1], 1)}`]);
  if (r.reliable != null) rows.push(["P90 reliable", gw(r.reliable, 2)]);
  if (r.actual != null) rows.push(["Actual", gw(r.actual, 2)]);
  return <TooltipBox title={ukTime(new Date(r.t).toISOString())} rows={rows} />;
}
