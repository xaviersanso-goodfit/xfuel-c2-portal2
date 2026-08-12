"use client";

import { InputRow, PeriodHead, ValueRow } from "../Grid";
import { fmt } from "@/lib/format";
import { PERIOD_COUNT } from "@/lib/model/periods";
import type { CapexLine, ModelOutputs, ScenarioInputs } from "@/lib/model/types";

export default function CapexTab({
  inputs, model, onChange, editable,
}: {
  inputs: ScenarioInputs;
  model: ModelOutputs;
  onChange: (next: ScenarioInputs) => void;
  editable: boolean;
}) {
  // Defence in depth: never emit a change when the session is read only,
  // even if an input's disabled attribute is bypassed.
  const emit = editable ? onChange : () => {};
  const periods = model.periods;

  const setLine = (idx: number, patch: Partial<CapexLine>) => {
    const capex = inputs.capex.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    emit({ ...inputs, capex });
  };

  /** Phasing is stored from the concept's startPeriod; show it on the absolute grid. */
  const absolutePhasing = (line: CapexLine): number[] => {
    const out = new Array(PERIOD_COUNT).fill(0);
    const start = Math.min(Math.max(line.startPeriod ?? 0, 0), PERIOD_COUNT - 1);
    (line.phasing ?? []).forEach((v, k) => {
      if (start + k < PERIOD_COUNT) out[start + k] = v;
    });
    return out;
  };

  const total = inputs.capex.reduce((a, l) => a + l.total, 0);
  const spend = model.results.map((r) => r.capexSpend);
  const cum = model.results.map((r) => r.capexCumulative);
  const dep = model.results.map((r) => r.depreciation);

  return (
    <>
      <div className="page-title">CAPEX</div>
      <div className="page-sub">
        Enter the total by concept, the month spend starts, and the monthly phasing as a percentage of the total.
        Phasing must sum to 100%. Depreciation runs at each concept&apos;s monthly rate from the operations start month.
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Total CAPEX</div>
          <div className="k-val">{fmt(total)}</div>
          <div className="k-meta">across {inputs.capex.length} concepts</div>
        </div>
        {inputs.capex.map((l) => (
          <div className="kpi" key={l.id}>
            <div className="k-label">{l.label}</div>
            <div className="k-val" style={{ fontSize: 19 }}>{fmt(l.total)}</div>
            <div className="k-meta">
              {l.depRateMonthly > 0 ? `${(l.depRateMonthly * 100).toFixed(3)}%/month` : "not depreciated"}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Concepts</h3>
        <table className="list">
          <thead>
            <tr>
              <th>Concept</th>
              <th style={{ textAlign: "right" }}>Total cost (EUR)</th>
              <th style={{ textAlign: "right" }}>Start period</th>
              <th style={{ textAlign: "right" }}>Monthly dep. rate (%)</th>
              <th style={{ textAlign: "right" }}>Useful life (months)</th>
              <th style={{ textAlign: "right" }}>Phasing sum</th>
            </tr>
          </thead>
          <tbody>
            {inputs.capex.map((l, idx) => {
              const phaseSum = (l.phasing ?? []).reduce((a, b) => a + b, 0);
              const ok = Math.abs(phaseSum - 1) < 0.005 || l.total === 0;
              return (
                <tr key={l.id}>
                  <td>{l.label}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="cell" style={{ width: 130 }} type="number" disabled={!editable} value={l.total}
                      onChange={(e) => setLine(idx, { total: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="cell" style={{ width: 70 }} type="number" step="1" disabled={!editable}
                      value={l.startPeriod}
                      onChange={(e) => setLine(idx, { startPeriod: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="cell" style={{ width: 90 }} type="number" step="0.001" disabled={!editable}
                      value={Math.round(l.depRateMonthly * 1e7) / 1e5}
                      onChange={(e) => setLine(idx, { depRateMonthly: (Number(e.target.value) || 0) / 100 })}
                    />
                  </td>
                  <td style={{ textAlign: "right" }} className="muted">
                    {l.depRateMonthly > 0 ? Math.round(1 / l.depRateMonthly) : "–"}
                  </td>
                  <td style={{ textAlign: "right", color: ok ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
                    {(phaseSum * 100).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Monthly phasing (% of concept total)</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first="Concept" />
            <tbody>
              {inputs.capex.map((l, idx) => (
                <InputRow
                  key={l.id}
                  label={l.label}
                  values={absolutePhasing(l)}
                  periods={periods}
                  editable={editable}
                  scale={100}
                  step="0.1"
                  onChange={(next) => setLine(idx, { startPeriod: 0, phasing: next })}
                />
              ))}
              <ValueRow label="Total CAPEX spend" values={spend} periods={periods} bold />
              <ValueRow label="Cumulative deployed CAPEX" values={cum} periods={periods} bold />
              <ValueRow label="Depreciation" values={dep} periods={periods} />
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Values are percentages of each concept&apos;s total. Editing this grid sets the start period to the first
          month of the plan and stores the full absolute phasing.
        </div>
      </div>
    </>
  );
}
