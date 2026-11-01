import type { ReactNode } from "react";

export function Kpi({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={`card kpi${accent ? " accent" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Card({ title, sub, children, right }: { title: string; sub?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h2>{title}</h2>
          {sub ? <p className="sub">{sub}</p> : <div style={{ height: 12 }} />}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "area" | "dash" }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`sw ${i.kind ?? "line"}`} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function TooltipBox({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <div className="tooltip">
      <div className="t">{title}</div>
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export const Loading = ({ what = "data" }: { what?: string }) => <div className="state">Loading {what}…</div>;
export const ErrorState = ({ error }: { error: Error }) => (
  <div className="state error">Could not load data: {error.message}</div>
);
