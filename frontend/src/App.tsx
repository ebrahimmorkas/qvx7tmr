import { useEffect, useState } from "react";
import { api } from "./api";
import AccuracyView from "./components/AccuracyView";
import DayAheadView from "./components/DayAheadView";
import MethodView from "./components/MethodView";
import { ErrorState, Loading } from "./components/ui";
import { useApi } from "./useApi";

type Tab = "day" | "accuracy" | "method";
const GATES = ["06:00", "08:00", "09:20", "11:00", "12:00", "15:30"];

/** Tiny URL-hash state so views are shareable/bookmarkable: #tab=day&date=2026-01-15&gate=09:20 */
function readHash(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
}

export default function App() {
  const meta = useApi(() => api.meta(), []);
  const initial = readHash();
  const [tab, setTab] = useState<Tab>((initial.tab as Tab) ?? "day");
  const [gate, setGate] = useState(initial.gate ?? "");
  const [day, setDay] = useState(initial.date ?? "");

  useEffect(() => {
    if (!meta.data) return;
    if (!gate) setGate(meta.data.default_gate);
    if (!day || !meta.data.delivery_days.includes(day)) setDay(meta.data.delivery_days[13] ?? meta.data.delivery_days[0]);
  }, [meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gate && day) window.history.replaceState(null, "", `#${new URLSearchParams({ tab, date: day, gate })}`);
  }, [tab, day, gate]);

  const gates = gate && !GATES.includes(gate) ? [...GATES, gate].sort() : GATES;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 12V22M12 12l7-6M12 12L5 6M12 12h0" />
              </svg>
            </div>
            <div>
              Gridbick
              <small>UK wind forecast monitor</small>
            </div>
          </div>
          <nav className="tabs">
            <button className={`tab ${tab === "day" ? "active" : ""}`} onClick={() => setTab("day")}>Day-ahead view</button>
            <button className={`tab ${tab === "accuracy" ? "active" : ""}`} onClick={() => setTab("accuracy")}>Forecast accuracy</button>
            <button className={`tab ${tab === "method" ? "active" : ""}`} onClick={() => setTab("method")}>Methodology</button>
          </nav>
          <div className="spacer" />
          <label className="control" title="Day-ahead market gate closure on D-1 (UK local time)">
            Gate closure (D-1)
            <select value={gate} onChange={(e) => setGate(e.target.value)}>
              {gates.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          {meta.data && (
            <span className="badge" title={`Loaded ${meta.data.loaded_at}`}>
              <i className={`dot ${meta.data.source === "snapshot" ? "warn" : ""}`} />
              {meta.data.source === "snapshot" ? "Snapshot data" : "Live Elexon data"}
            </span>
          )}
        </div>
      </header>

      <main className="page">
        {meta.error && <ErrorState error={meta.error} />}
        {!meta.data && !meta.error && <Loading what="Elexon data" />}
        {meta.data && gate && day && (
          <>
            {tab === "day" && <DayAheadView days={meta.data.delivery_days} day={day} gate={gate} onDay={setDay} />}
            {tab === "accuracy" && <AccuracyView gate={gate} onOpenDay={(d) => { setDay(d); setTab("day"); }} />}
            {tab === "method" && <MethodView meta={meta.data} />}
          </>
        )}
      </main>
    </>
  );
}
