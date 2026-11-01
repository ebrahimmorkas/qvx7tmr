// Display helpers. All timestamps from the API are UTC; we display UK local time.

const UK = "Europe/London";

export const gw = (mw: number | null | undefined, digits = 1) =>
  mw == null || Number.isNaN(mw) ? "–" : `${(mw / 1000).toFixed(digits)} GW`;

export const signedGw = (mw: number | null | undefined, digits = 2) =>
  mw == null ? "–" : `${mw > 0 ? "+" : ""}${(mw / 1000).toFixed(digits)} GW`;

export const gwh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${(mwh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 0 })} GWh`;

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null ? "–" : `${(x * 100).toFixed(digits)}%`;

export const ukTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: UK, hour: "2-digit", minute: "2-digit" });

export const ukDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: UK, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

export const ukDay = (isoDate: string, opts: Intl.DateTimeFormatOptions = {}) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: UK, weekday: "short", day: "numeric", month: "short", ...opts,
  });

export const ms = (iso: string) => new Date(iso).getTime();

export const shiftDay = (isoDate: string, delta: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
