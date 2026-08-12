"use client";

import { PeriodHead, ValueRow } from "../Grid";
import { fmt } from "@/lib/format";
import type { Instrument, InstrumentKind, ModelOutputs, RepaymentProfile, ScenarioInputs } from "@/lib/model/types";

export default function FinancingTab({
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
  const R = model.results;

  const setInst = (idx: number, patch: Partial<Instrument>) =>
    emit({ ...inputs, instruments: inputs.instruments.map((x, i) => (i === idx ? { ...x, ...patch } : x)) });

  const add = (kind: InstrumentKind) =>
    emit({
      ...inputs,
      instruments: [
        ...inputs.instruments,
        kind === "debt"
          ? { id: `i_${Date.now()}`, kind, label: "New facility", amount: 1_000_000, drawPeriod: 0, rate: 0.06, graceMonths: 12, tenorMonths: 84, repayment: "linear", upfrontFeePct: 0 }
          : { id: `i_${Date.now()}`, kind, label: kind === "grant" ? "New grant" : "New equity round", amount: 1_000_000, drawPeriod: 0 },
      ],
    });
  const remove = (idx: number) =>
    emit({ ...inputs, instruments: inputs.instruments.filter((_, i) => i !== idx) });

  const totals = {
    debt: inputs.instruments.filter((i) => i.kind === "debt").reduce((a, i) => a + i.amount, 0),
    grant: inputs.instruments.filter((i) => i.kind === "grant").reduce((a, i) => a + i.amount, 0),
    equity: inputs.instruments.filter((i) => i.kind === "equity").reduce((a, i) => a + i.amount, 0),
  };
  const totalInterest = R.reduce((a, r) => a + r.interestExpense, 0);

  return (
    <>
      <div className="page-title">Financing</div>
      <div className="page-sub">
        Debt, non-dilutive funding and equity. Debt drives the financing cash flow and the interest charge below
        EBITDA. Grants are recognised as income below EBITDA in the month they are collected, and their cash is shown
        in financing.
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Debt raised</div>
          <div className="k-val">{fmt(totals.debt)}</div>
          <div className="k-meta">across {inputs.instruments.filter((i) => i.kind === "debt").length} facilities</div>
        </div>
        <div className="kpi">
          <div className="k-label">Grants</div>
          <div className="k-val">{fmt(totals.grant)}</div>
          <div className="k-meta">non-dilutive</div>
        </div>
        <div className="kpi">
          <div className="k-label">Equity</div>
          <div className="k-val">{fmt(totals.equity)}</div>
          <div className="k-meta">dilutive</div>
        </div>
        <div className="kpi">
          <div className="k-label">Total interest over plan</div>
          <div className="k-val">{fmt(totalInterest)}</div>
          <div className="k-meta">incl. upfront fees</div>
        </div>
        <div className="kpi">
          <div className="k-label">Debt outstanding at exit</div>
          <div className="k-val">{fmt(R[R.length - 1].debtBalance)}</div>
          <div className="k-meta">reduces equity terminal value</div>
        </div>
      </div>

      <div className="card">
        <h3>Instruments</h3>
        <div className="tbl-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Amount (EUR)</th>
                <th style={{ textAlign: "right" }}>Draw / collect period</th>
                <th style={{ textAlign: "right" }}>Rate (%)</th>
                <th style={{ textAlign: "right" }}>Grace (m)</th>
                <th style={{ textAlign: "right" }}>Tenor (m)</th>
                <th>Profile</th>
                <th style={{ textAlign: "right" }}>Fee (%)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inputs.instruments.map((inst, idx) => {
                const isDebt = inst.kind === "debt";
                return (
                  <tr key={inst.id}>
                    <td>
                      <input
                        className="cell" style={{ width: 170, textAlign: "left" }} type="text" disabled={!editable}
                        value={inst.label} onChange={(e) => setInst(idx, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        disabled={!editable} value={inst.kind}
                        onChange={(e) => setInst(idx, { kind: e.target.value as InstrumentKind })}
                        style={{ padding: "5px 7px", borderRadius: 6, border: "1px solid var(--line)" }}
                      >
                        <option value="debt">Debt</option>
                        <option value="grant">Grant</option>
                        <option value="equity">Equity</option>
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="cell" style={{ width: 120 }} type="number" disabled={!editable} value={inst.amount}
                        onChange={(e) => setInst(idx, { amount: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="cell" style={{ width: 70 }} type="number" step="1" disabled={!editable}
                        value={inst.drawPeriod}
                        onChange={(e) => setInst(idx, { drawPeriod: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      />
                      <div className="muted" style={{ fontSize: 11 }}>
                        {periods[Math.min(inst.drawPeriod, periods.length - 1)]?.label}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="cell" style={{ width: 70 }} type="number" step="0.1"
                        disabled={!editable || !isDebt}
                        value={inst.rate ? Math.round(inst.rate * 1e6) / 1e4 : 0}
                        onChange={(e) => setInst(idx, { rate: (Number(e.target.value) || 0) / 100 })}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="cell" style={{ width: 60 }} type="number" step="1"
                        disabled={!editable || !isDebt} value={inst.graceMonths ?? 0}
                        onChange={(e) => setInst(idx, { graceMonths: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="cell" style={{ width: 60 }} type="number" step="1"
                        disabled={!editable || !isDebt} value={inst.tenorMonths ?? 0}
                        onChange={(e) => setInst(idx, { tenorMonths: Math.max(1, Math.round(Number(e.target.value) || 0)) })}
                      />
                    </td>
                    <td>
                      <select
                        disabled={!editable || !isDebt} value={inst.repayment ?? "linear"}
                        onChange={(e) => setInst(idx, { repayment: e.target.value as RepaymentProfile })}
                        style={{ padding: "5px 7px", borderRadius: 6, border: "1px solid var(--line)" }}
                      >
                        <option value="linear">Linear</option>
                        <option value="annuity">Annuity</option>
                        <option value="bullet">Bullet</option>
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        className="cell" style={{ width: 60 }} type="number" step="0.1"
                        disabled={!editable || !isDebt}
                        value={inst.upfrontFeePct ? Math.round(inst.upfrontFeePct * 1e6) / 1e4 : 0}
                        onChange={(e) => setInst(idx, { upfrontFeePct: (Number(e.target.value) || 0) / 100 })}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {editable && <button className="btn danger sm" onClick={() => remove(idx)}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <button className="btn ghost sm" onClick={() => add("debt")}>+ Add debt facility</button>
            <button className="btn ghost sm" onClick={() => add("grant")}>+ Add grant</button>
            <button className="btn ghost sm" onClick={() => add("equity")}>+ Add equity</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Resulting schedules</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first="Line" />
            <tbody>
              <ValueRow label="Debt drawdown" values={R.map((r) => r.debtDraw)} periods={periods} />
              <ValueRow label="Debt repayment" values={R.map((r) => r.debtRepayment)} periods={periods} />
              <ValueRow label="Debt balance (closing)" values={R.map((r) => r.debtBalance)} periods={periods} />
              <ValueRow label="Interest expense (incl. fees)" values={R.map((r) => r.interestExpense)} periods={periods} />
              <ValueRow label="Equity raised" values={R.map((r) => r.equityRaise)} periods={periods} />
              <ValueRow label="Grants collected" values={R.map((r) => r.grantCash)} periods={periods} />
              <ValueRow label="Financing cash flow (CFF)" values={R.map((r) => r.cff)} periods={periods} bold />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
