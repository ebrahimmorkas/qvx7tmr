import type { Meta } from "../api";
import { ukDateTime, ukDay } from "../format";

export default function MethodView({ meta }: { meta: Meta }) {
  return (
    <div className="card method">
      <h2>Methodology</h2>
      <p className="muted">How the numbers on the other two pages are produced, so they can be trusted and challenged.</p>

      <h3>Data</h3>
      <ul>
        <li><b>Actual generation</b>: Elexon BMRS <code>FUELHH</code>, fuel type <code>WIND</code>. Half-hourly average MW of transmission-metered wind.</li>
        <li><b>Forecasts</b>: Elexon BMRS <code>WINDFOR</code>. Hourly national wind forecasts, re-issued about 8 times a day, each with a <code>publishTime</code>.</li>
        <li>Forecast hours are compared with the mean of the two half-hours in that hour. A forecast published after its target hour is dropped.</li>
        <li>
          Loaded from <b>{meta.source === "snapshot" ? "the bundled snapshot" : "the live Elexon API"}</b> at {ukDateTime(meta.loaded_at)}:{" "}
          {meta.counts.actual_half_hours.toLocaleString()} actual half-hours and {meta.counts.forecast_values.toLocaleString()} forecast values.
        </li>
      </ul>

      <h3>Scope: purchase decisions made in January 2026</h3>
      <p>
        A day-ahead decision on day D-1 buys power for delivery day D. Decisions from {ukDay(meta.decision_from, { year: "numeric" })} to{" "}
        {ukDay(meta.decision_to, { year: "numeric" })} therefore cover delivery days{" "}
        {ukDay(meta.delivery_days[0])} – {ukDay(meta.delivery_days[meta.delivery_days.length - 1], { year: "numeric" })}.
      </p>

      <h3>Which forecast the desk would actually have had</h3>
      <p>
        For each delivery day we pick the <b>latest forecast published at or before the gate closure on D-1</b>. The gate time is set in
        the header and defaults to {meta.default_gate} UK time. Later forecasts did not exist yet when the decision was made, so we never use them. This avoids look-ahead bias.
      </p>
      <p>
        The lead-time analysis uses a second method. For each target hour <i>t</i> and lead time <i>H</i>, it takes the latest forecast published at or before <i>t − H</i>.
      </p>

      <h3>Accuracy measures</h3>
      <ul>
        <li><b>Error</b> = forecast − actual. Positive means wind came in below forecast, so the desk is short.</li>
        <li><b>MAE</b>: average size of a miss. <b>RMSE</b>: weights big misses more. <b>Bias</b>: average signed error, i.e. how often and by how much the forecast leans one way.</li>
        <li><b>nMAE</b> = MAE ÷ mean actual output. <b>P10/P90</b>: 80% of hourly errors fall between these values.</li>
        <li>
          <b>Shortfall buffer at confidence c</b> = the c-quantile of the error (floored at 0). If the desk buys <i>demand − forecast + buffer</i>,
          the wind shortfall would have been covered in a share <i>c</i> of the historical hours. <b>P90 reliable wind</b> = forecast − buffer₉₀.
        </li>
        <li>The P10–P90 band on the day view applies the month's error spread around that day's forecast. Because it is fitted on the same month it is shown on, treat it as illustrative. In production it would come from a rolling window of past data.</li>
      </ul>

      <h3>Limitations and next steps</h3>
      <ul>
        <li>This is national wind only, as scoped. Solar, embedded generation and demand forecasts are not included.</li>
        <li>The persistent over-forecast probably reflects curtailment (constraint actions) and differences in coverage between <code>WINDFOR</code> and <code>FUELHH</code>. Worth confirming with the client, and a good candidate for a bias-corrected forecast.</li>
        <li>Next steps: rolling out-of-sample error bands, error broken down by wind regime, alerts when a new forecast moves the position, and adding the desk's own demand forecast to produce a direct buy recommendation.</li>
      </ul>
    </div>
  );
}
