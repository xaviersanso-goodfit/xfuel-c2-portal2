"use client";

import { Field, InputRow, PeriodHead, ValueRow } from "../Grid";
import { fmt } from "@/lib/format";
import { PERIOD_COUNT, zeroes } from "@/lib/model/periods";
import type { ModelOutputs, OpexCategory, PersonnelArchetype, ScenarioInputs } from "@/lib/model/types";

export default function OpexTab({
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
  const lastYear = model.periods[model.periods.length - 1]?.year ?? 10;

  const setArch = (idx: number, patch: Partial<PersonnelArchetype>) =>
    emit({ ...inputs, personnel: inputs.personnel.map((a, i) => (i === idx ? { ...a, ...patch } : a)) });
  const p = inputs.parameters;
  const setP = (patch: Partial<typeof p>) => emit({ ...inputs, parameters: { ...p, ...patch } });
  const setCat = (idx: number, patch: Partial<OpexCategory>) =>
    emit({ ...inputs, opex: inputs.opex.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });

  const addArch = () =>
    emit({
      ...inputs,
      personnel: [
        ...inputs.personnel,
        { id: `role_${Date.now()}`, label: "New role", annualCost: 50000, ftes: zeroes(PERIOD_COUNT) },
      ],
    });
  const removeArch = (idx: number) =>
    emit({ ...inputs, personnel: inputs.personnel.filter((_, i) => i !== idx) });

  const addCat = () =>
    emit({
      ...inputs,
      opex: [...inputs.opex, { id: `cat_${Date.now()}`, label: "New category", amounts: zeroes(PERIOD_COUNT) }],
    });
  const removeCat = (idx: number) => emit({ ...inputs, opex: inputs.opex.filter((_, i) => i !== idx) });

  const lastIdx = R.length - 1;
  const steadyFte = inputs.personnel.reduce((a, p) => a + (p.ftes[lastIdx] ?? 0), 0);

  return (
    <>
      <div className="page-title">OPEX &amp; personnel</div>
      <div className="page-sub">
        Personnel archetypes carry a fully loaded annual cost per FTE; enter FTEs month by month (decimals allowed).
        Other OPEX categories take a fixed amount per period, optionally plus a percentage of deployed CAPEX.
        Amounts are entered in year 1 money and escalated by the inflation rates below.
      </div>

      {/* These are global parameters, but they belong next to the costs they
          escalate: this is where you look for them. The same two fields appear
          on Global parameters and edit the same values. */}
      <div className="card">
        <h3>Inflation</h3>
        <div className="grid3">
          <Field
            label="Compensation inflation (% p.a.)" value={p.compensationInflation} scale={100} step="0.1"
            editable={editable}
            onChange={(x) => setP({ compensationInflation: (Number(x) || 0) / 100 })}
            hint="Applied to the annual cost per FTE of every archetype. Compounds from year 1, which is the base year."
          />
          <Field
            label="OPEX inflation (% p.a.)" value={p.opexInflation} scale={100} step="0.1" editable={editable}
            onChange={(x) => setP({ opexInflation: (Number(x) || 0) / 100 })}
            hint="Applied to the category amounts below. The CAPEX-linked components, such as insurance, are not escalated: they already move with the deployed asset base."
          />
          <div className="field">
            <label>Effect by the final year</label>
            <div style={{ fontSize: 13, paddingTop: 6 }}>
              Salaries ×{Math.pow(1 + p.compensationInflation, lastYear - 1).toFixed(2)} · other OPEX ×
              {Math.pow(1 + p.opexInflation, lastYear - 1).toFixed(2)}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              Cumulative factor applied in year {lastYear} relative to year 1.
            </div>
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Steady-state FTEs</div>
          <div className="k-val">{steadyFte.toFixed(1)}</div>
          <div className="k-meta">across {inputs.personnel.length} archetypes</div>
        </div>
        <div className="kpi">
          <div className="k-label">Steady-state personnel cost</div>
          <div className="k-val">{fmt(R[lastIdx].opexPersonnel)}</div>
          <div className="k-meta">final plan year</div>
        </div>
        <div className="kpi">
          <div className="k-label">Steady-state other OPEX</div>
          <div className="k-val">{fmt(R[lastIdx].opexOther)}</div>
          <div className="k-meta">final plan year</div>
        </div>
        <div className="kpi">
          <div className="k-label">Steady-state total OPEX</div>
          <div className="k-val">{fmt(R[lastIdx].opexTotal)}</div>
          <div className="k-meta">final plan year</div>
        </div>
      </div>

      <div className="card">
        <h3>Personnel archetypes</h3>
        <table className="list">
          <thead>
            <tr>
              <th>Archetype</th>
              <th style={{ textAlign: "right" }}>Fully loaded annual cost per FTE (EUR)</th>
              <th style={{ textAlign: "right" }}>FTEs at end of plan</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {inputs.personnel.map((a, idx) => (
              <tr key={a.id}>
                <td>
                  <input
                    className="cell" style={{ width: 240, textAlign: "left" }} type="text" disabled={!editable}
                    value={a.label} onChange={(e) => setArch(idx, { label: e.target.value })}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    className="cell" style={{ width: 120 }} type="number" disabled={!editable} value={a.annualCost}
                    onChange={(e) => setArch(idx, { annualCost: Number(e.target.value) || 0 })}
                  />
                </td>
                <td style={{ textAlign: "right" }} className="muted">{(a.ftes[lastIdx] ?? 0).toFixed(2)}</td>
                <td style={{ textAlign: "right" }}>
                  {editable && (
                    <button className="btn danger sm" onClick={() => removeArch(idx)}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div style={{ marginTop: 12 }}>
            <button className="btn ghost sm" onClick={addArch}>+ Add archetype</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>FTEs by period</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first="Archetype" />
            <tbody>
              {inputs.personnel.map((a, idx) => (
                <InputRow
                  key={a.id} label={a.label} values={a.ftes} periods={periods} editable={editable} step="0.1"
                  onChange={(next) => setArch(idx, { ftes: next })}
                />
              ))}
              <ValueRow
                label="Total FTEs"
                values={periods.map((_, i) => inputs.personnel.reduce((s, a) => s + (a.ftes[i] ?? 0), 0))}
                periods={periods} bold format={(n) => n.toFixed(2)}
              />
              <ValueRow label="Personnel cost" values={R.map((r) => r.opexPersonnel)} periods={periods} bold />
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Other OPEX categories</h3>
        <table className="list">
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>% p.a. of deployed CAPEX (optional)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {inputs.opex.map((c, idx) => (
              <tr key={c.id}>
                <td>
                  <input
                    className="cell" style={{ width: 280, textAlign: "left" }} type="text" disabled={!editable}
                    value={c.label} onChange={(e) => setCat(idx, { label: e.target.value })}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  <input
                    className="cell" style={{ width: 90 }} type="number" step="0.01" disabled={!editable}
                    value={c.pctOfCapexPerAnnum ? Math.round(c.pctOfCapexPerAnnum * 1e6) / 1e4 : 0}
                    onChange={(e) => {
                      const v = (Number(e.target.value) || 0) / 100;
                      setCat(idx, { pctOfCapexPerAnnum: v > 0 ? v : undefined });
                    }}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  {editable && <button className="btn danger sm" onClick={() => removeCat(idx)}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div style={{ marginTop: 12 }}>
            <button className="btn ghost sm" onClick={addCat}>+ Add category</button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Other OPEX by period (fixed amounts, EUR)</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first="Category" />
            <tbody>
              {inputs.opex.map((c, idx) => (
                <InputRow
                  key={c.id} label={c.label} values={c.amounts} periods={periods} editable={editable}
                  onChange={(next) => setCat(idx, { amounts: next })}
                />
              ))}
              <ValueRow label="Total other OPEX (incl. % of CAPEX)" values={R.map((r) => r.opexOther)} periods={periods} bold />
              <ValueRow label="Total OPEX" values={R.map((r) => r.opexTotal)} periods={periods} bold />
              <ValueRow label="EBITDA" values={R.map((r) => r.ebitda)} periods={periods} bold />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
