import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api";
import { gw, gwh, ms, pct, signedGw, ukDateTime, ukDay } from "../format";
import { useApi } from "../useApi";
import { Card, ErrorState, Kpi, Legend, Loading, TooltipBox } from "./ui";

interface Props {
  gate: string;
  onOpenDay: (d: string) => void;
}

const tick = { stroke: "var(--muted)", fontSize: 12, tickLine: false } as const;
const gwTick = (v: number) => `${+(v / 1000).toFixed(1)}`;

export default function AccuracyView({ gate, onOpenDay }: Props) {
  const [mode, setMode] = useState<"dayahead" | "horizon">("dayahead");
  const [horizon, setHorizon] = useState(24);
  const acc = useApi(() => api.accuracy(gate, mode === "horizon" ? horizon : undefined), [gate, mode, horizon]);
  const curve = useApi(() => api.horizonCurve(), []);
  const d = acc.data;

  const series = useMemo(
    () => (d ? d.series.map((p) => ({ t: ms(p.time), forecast: p.forecast, actual: p.actual, error: p.error })) : []),
    [d],
  );
  const leadRange = useMemo(() => {
    if (!d || d.mode !== "dayahead" || !d.series.length) return null;
    const hs = d.series.map((p) => p.horizon_h);
    return [Math.min(...hs), Math.max(...hs)] as const;
  }, [d]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Forecast accuracy · January 2026 decisions</h1>
          <p>
            How far the wind forecast that was available at decision time ended up from reality, across all 31 delivery days.
            Error = forecast − actual: positive means wind under-delivered (a shortfall to buy).
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            <button className={mode === "dayahead" ? "on" : ""} onClick={() => setMode("dayahead")}>Day-ahead @ {gate}</button>
            <button className={mode === "horizon" ? "on" : ""} onClick={() => setMode("horizon")}>Fixed lead time</button>
          </div>
          {mode === "horizon" && (
            <label className="control">
              <input type="range" min={0} max={48} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} />
              <b style={{ minWidth: 34 }}>{horizon} h</b>
            </label>
          )}
        </div>
      </div>

      {acc.error && <ErrorState error={acc.error} />}
      {!d && acc.loading && <Loading what="accuracy analysis" />}
      {d && (
        <div style={{ opacity: acc.loading ? 0.6 : 1, transition: "opacity .15s" }}>
          {d.metrics.bias != null && (
            <div className="callout">
              <span>📊</span>
              <div>
                The forecast <b>{d.metrics.bias > 0 ? "over-estimated" : "under-estimated"}</b> wind by{" "}
                <strong>{gw(Math.abs(d.metrics.bias), 2)}</strong> on average ({pct(Math.abs(d.metrics.bias) / (d.metrics.mean_actual ?? 1), 0)} of mean output).
                The error is systematic rather than random, so a desk that buys only{" "}
                <i>demand − forecast</i> would have been short most hours. Holding a{" "}
                <b>{gw(d.buffers.find((b) => b.confidence === 0.9)?.buffer_mw, 1)}</b> buffer covers 90% of hours.
              </div>
            </div>
          )}

          <div className="grid kpis">
            <Kpi label="Mean absolute error" value={gw(d.metrics.mae, 2)} hint={`${pct(d.metrics.nmae)} of mean actual (nMAE)`} />
            <Kpi label="RMSE" value={gw(d.metrics.rmse, 2)} hint="penalises large misses" />
            <Kpi label="Bias (mean error)" value={signedGw(d.metrics.bias)} hint="+ = forecast too high" />
            <Kpi label="P10 / P90 error" value={<>{signedGw(d.metrics.p10, 1)} / {signedGw(d.metrics.p90, 1)}</>} hint="80% of hours inside this range" />
            <Kpi label="Hours within ±1 GW" value={pct(d.metrics.within_1gw, 0)} hint={`correlation ${d.metrics.correlation?.toFixed(3) ?? "–"} · n=${d.metrics.n}`} />
          </div>

          <Card title="Forecast vs. actual — whole period" sub={d.mode === "dayahead" ? `Forecast = latest published before ${gate} on D-1` : `Forecast = latest published at least ${horizon} h before each hour`}>
            <Legend items={[{ label: "Forecast", color: "var(--forecast)" }, { label: "Actual (hourly mean)", color: "var(--actual)" }, { label: "Error", color: "var(--short)", kind: "area" }]} />
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} {...tick}
                  tickFormatter={(t) => ukDay(new Date(t).toISOString().slice(0, 10), { weekday: undefined })} />
                <YAxis tickFormatter={gwTick} {...tick} axisLine={false} />
                <Tooltip content={<SeriesTooltip />} />
                <Area dataKey="error" stroke="none" fill="var(--short)" fillOpacity={0.15} isAnimationActive={false} />
                <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line dataKey="actual" stroke="var(--actual)" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
                <Brush dataKey="t" height={24} stroke="var(--accent)" fill="var(--surface-2)" travellerWidth={8}
                  tickFormatter={(t) => ukDay(new Date(t).toISOString().slice(0, 10), { weekday: undefined })} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid two" style={{ marginTop: 16 }}>
            <Card title="Accuracy decays with lead time" sub="Latest forecast published ≥ H hours before each target hour. Shaded: lead times used by day-ahead decisions.">
              <Legend items={[{ label: "MAE", color: "var(--forecast)" }, { label: "Bias", color: "var(--short)" }, { label: "P10–P90 error", color: "var(--band)", kind: "area" }]} />
              {curve.data ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={curve.data.points.map((p) => ({ ...p, range: [p.p10, p.p90] }))} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    {leadRange && <ReferenceArea x1={Math.round(leadRange[0])} x2={Math.min(48, Math.round(leadRange[1]))} fill="var(--accent)" fillOpacity={0.07} />}
                    <XAxis dataKey="horizon_h" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} {...tick} unit="h" />
                    <YAxis tickFormatter={gwTick} {...tick} axisLine={false} />
                    <Tooltip content={<CurveTooltip />} />
                    <Area dataKey="range" stroke="none" fill="var(--band)" fillOpacity={0.14} isAnimationActive={false} />
                    <Line dataKey="mae" stroke="var(--forecast)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line dataKey="bias" stroke="var(--short)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : curve.error ? <ErrorState error={curve.error} /> : <Loading what="lead-time curve" />}
            </Card>

            <Card title="How much extra to buy" sub="Buffer on top of (demand − wind forecast) that would have covered the wind shortfall in a given share of hours.">
              <table>
                <thead><tr><th>Cover shortfall in</th><th>Extra capacity</th><th>Extra energy / day</th></tr></thead>
                <tbody>
                  {d.buffers.map((b) => (
                    <tr key={b.confidence}>
                      <td><b>{pct(b.confidence, 0)}</b> of hours</td>
                      <td>{gw(b.buffer_mw, 2)}</td>
                      <td>{gwh(b.buffer_mw * 24)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={d.buffers.map((b) => ({ ...b, label: pct(b.confidence, 0) }))} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" {...tick} />
                  <YAxis tickFormatter={gwTick} {...tick} axisLine={false} />
                  <Bar dataKey="buffer_mw" fill="var(--reliable)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <div className="grid two" style={{ marginTop: 16 }}>
            <Card title="Error by hour of day" sub="UK local time. Bars: MAE; line: bias.">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={d.by_hour} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="hour" {...tick} tickFormatter={(h) => `${String(h).padStart(2, "0")}`} />
                  <YAxis tickFormatter={gwTick} {...tick} axisLine={false} />
                  <Tooltip content={<HourTooltip />} />
                  <Bar dataKey="mae" fill="var(--forecast)" fillOpacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Line dataKey="bias" stroke="var(--short)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Error distribution" sub="Hours by forecast − actual, 0.5 GW bins. Red = shortfall, green = surplus.">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.histogram.map((h) => ({ ...h, mid: (h.from + h.to) / 2 }))} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="mid" {...tick} tickFormatter={(v) => (v / 1000).toFixed(1)} />
                  <YAxis {...tick} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<HistTooltip />} />
                  <Bar dataKey="count" isAnimationActive={false}>
                    {d.histogram.map((h) => <Cell key={h.from} fill={h.from >= 0 ? "var(--short)" : "var(--surplus)"} fillOpacity={0.8} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="Daily breakdown" sub={d.mode === "dayahead" ? "Click a day to open it in the day-ahead view." : "Daily error at the selected lead time."}>
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>Delivery day</th>{d.mode === "dayahead" && <th>Forecast used</th>}<th>Forecast</th><th>Actual</th><th>Difference</th><th>MAE</th><th>Bias</th><th>Daily MAE</th></tr>
                </thead>
                <tbody>
                  {d.daily.map((r) => {
                    const diff = r.forecast_mwh - r.actual_mwh;
                    return (
                      <tr key={r.date} className={d.mode === "dayahead" ? "clickable" : ""} onClick={() => d.mode === "dayahead" && onOpenDay(r.date)}>
                        <td>{ukDay(r.date)}</td>
                        {d.mode === "dayahead" && <td className="muted">{ukDateTime(r.publish_time)}</td>}
                        <td>{gwh(r.forecast_mwh)}</td>
                        <td>{gwh(r.actual_mwh)}</td>
                        <td className={diff > 0 ? "pos" : "neg"}>{diff > 0 ? "+" : ""}{gwh(diff)}</td>
                        <td>{gw(r.mae, 2)}</td>
                        <td className={(r.bias ?? 0) > 0 ? "pos" : "neg"}>{signedGw(r.bias)}</td>
                        <td style={{ width: 120 }}>
                          <div style={{ height: 6, borderRadius: 3, background: "var(--forecast)", opacity: 0.7, width: `${Math.min(100, ((r.mae ?? 0) / 5000) * 100)}%` }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function SeriesTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return <TooltipBox title={ukDateTime(new Date(r.t).toISOString())} rows={[["Forecast", gw(r.forecast, 2)], ["Actual", gw(r.actual, 2)], ["Error", signedGw(r.error)]]} />;
}
function CurveTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return <TooltipBox title={`Lead time ≥ ${r.horizon_h} h`} rows={[["MAE", gw(r.mae, 2)], ["Bias", signedGw(r.bias)], ["P10 / P90", `${signedGw(r.p10, 1)} / ${signedGw(r.p90, 1)}`], ["Hours", String(r.n)]]} />;
}
function HourTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return <TooltipBox title={`${String(r.hour).padStart(2, "0")}:00`} rows={[["MAE", gw(r.mae, 2)], ["Bias", signedGw(r.bias)], ["Hours", String(r.n)]]} />;
}
function HistTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return <TooltipBox title={`${signedGw(r.from, 1)} to ${signedGw(r.to, 1)}`} rows={[["Hours", String(r.count)]]} />;
}
