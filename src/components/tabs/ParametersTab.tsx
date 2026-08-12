"use client";

import { Field } from "../Grid";
import ChartFrame from "../charts/ChartFrame";
import CoverChart from "../charts/CoverChart";
import ProjectSummary from "../charts/ProjectSummary";
import UnitEconomics from "../charts/UnitEconomics";
import ValuationPanel from "../charts/ValuationPanel";
import { fmt } from "@/lib/format";
import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";

export default function ParametersTab({
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
  const p = inputs.parameters;
  const setP = (patch: Partial<typeof p>) => emit({ ...inputs, parameters: { ...p, ...patch } });

  const opsLabel = model.periods[Math.min(p.opsStartPeriod, model.periods.length - 1)]?.label ?? "–";

  return (
    <>
      <div className="page-title">Global parameters</div>
      <div className="page-sub">
        Plan inputs and headline outputs. All figures in EUR. Horizon: monthly for Y1 to Y3, annual to Y10, with an
        exit at the end of Y10.
      </div>

      {/* ---------- cover ---------- */}
      <ChartFrame
        wide
        title="Cash profile — first three years"
        subtitle="CAPEX deployed by concept and operating cash flow, month by month, against the closing cash balance."
        filename="c2-cash-profile-36m"
      >
        <CoverChart inputs={inputs} model={model} />
      </ChartFrame>

      <ChartFrame
        wide
        title="Project summary"
        subtitle="Construction and production milestones, derived from the CAPEX phasing and the utilisation curve."
        filename="c2-project-summary"
      >
        <ProjectSummary inputs={inputs} model={model} />
      </ChartFrame>

      <ChartFrame
        wide
        title="Unit economics"
        subtitle="Price and variable cost per ton of product at full utilisation, with steady-state annual figures."
        filename="c2-unit-economics"
      >
        <UnitEconomics inputs={inputs} model={model} />
      </ChartFrame>

      {/* ---------- outputs ---------- */}
      <ChartFrame
        wide
        title="IRR and NPV"
        subtitle="Returns, valuation and funding, each with its definition. Green means the metric clears its own hurdle."
        filename="c2-irr-npv"
      >
        <ValuationPanel inputs={inputs} model={model} />
      </ChartFrame>

      {/* ---------- inputs ---------- */}
      <div className="grid3">
        <div className="card">
          <h3>Plan</h3>
          <Field
            label="Plan start month (YYYY-MM)" type="text" value={p.startMonth} editable={editable}
            onChange={(x) => setP({ startMonth: x })}
          />
          <Field
            label="Operations start (period index)" value={p.opsStartPeriod} editable={editable} step="1"
            onChange={(x) => setP({ opsStartPeriod: Math.max(0, Math.round(Number(x) || 0)) })}
            hint={`Depreciation begins in ${opsLabel}. 0 = first month of the plan.`}
          />
        </div>

        <div className="card">
          <h3>Tax and working capital</h3>
          <Field
            label="Corporate income tax rate (%)" value={p.citr} scale={100} editable={editable}
            onChange={(x) => setP({ citr: (Number(x) || 0) / 100 })}
            hint="Applied to profits after loss carry-forward."
          />
          <Field
            label="DSO (days)" value={p.dso} editable={editable}
            onChange={(x) => setP({ dso: Number(x) || 0 })} hint="Receivables on revenue."
          />
          <Field
            label="DPO (days)" value={p.dpo} editable={editable}
            onChange={(x) => setP({ dpo: Number(x) || 0 })} hint="Payables on COGS + OPEX."
          />
        </div>

        <div className="card">
          <h3>Inflation</h3>
          <Field
            label="OPEX inflation (% p.a.)" value={p.opexInflation} scale={100} step="0.1" editable={editable}
            onChange={(x) => setP({ opexInflation: (Number(x) || 0) / 100 })}
            hint="Compounds from year 1, which is the base. Applied to OPEX category amounts, not to the CAPEX-linked components such as insurance."
          />
          <Field
            label="Compensation inflation (% p.a.)" value={p.compensationInflation} scale={100} step="0.1"
            editable={editable}
            onChange={(x) => setP({ compensationInflation: (Number(x) || 0) / 100 })}
            hint="Compounds from year 1. Applied to the annual cost per FTE of every archetype."
          />
          <Field
            label="Opening cash (EUR)" value={p.openingCash} editable={editable}
            onChange={(x) => setP({ openingCash: Number(x) || 0 })}
          />
        </div>

        <div className="card">
          <h3>Valuation</h3>
          <Field
            label="WACC — project discount rate (%)" value={p.wacc} scale={100} editable={editable}
            onChange={(x) => setP({ wacc: (Number(x) || 0) / 100 })}
          />
          <Field
            label="Cost of equity (%)" value={p.costOfEquity} scale={100} editable={editable}
            onChange={(x) => setP({ costOfEquity: (Number(x) || 0) / 100 })}
          />
          <Field
            label="Exit EV/EBITDA multiple" value={p.exitMultiple} editable={editable} step="0.1"
            onChange={(x) => setP({ exitMultiple: Number(x) || 0 })}
            hint="Applied to final-year EBITDA at the end of Y10."
          />
        </div>
      </div>

      {/* ---------- annual summary ---------- */}
      <div className="card">
        <h3>Annual summary — P&amp;L</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <thead>
              <tr>
                <th>Line</th>
                {model.annual.map((a) => (
                  <th key={a.year}>{a.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["Revenue", "revenue", false],
                ["COGS", "cogs", false],
                ["Gross margin", "grossMargin", true],
                ["Total OPEX", "opexTotal", false],
                ["EBITDA", "ebitda", true],
                ["Depreciation", "depreciation", false],
                ["EBIT", "ebit", true],
                ["Interest expense", "interestExpense", false],
                ["Grant income", "grantIncome", false],
                ["Profit before tax", "pbt", true],
                ["Income tax", "tax", false],
                ["Net income", "netIncome", true],
              ] as [string, keyof (typeof model.annual)[number], boolean][]).map(([label, key, bold]) => (
                <tr key={label} className={bold ? "subtotal" : ""}>
                  <td>{label}</td>
                  {model.annual.map((a) => (
                    <td key={a.year} className={`num ${(a[key] as number) < 0 ? "neg" : ""}`}>
                      {fmt(a[key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Annual summary — cash flow</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <thead>
              <tr>
                <th>Line</th>
                {model.annual.map((a) => (
                  <th key={a.year}>{a.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["Operating cash flow", "cfo", false],
                ["Investing cash flow", "cfi", false],
                ["Financing cash flow", "cff", false],
                ["Net cash flow", "netCashFlow", true],
                ["Closing cash", "closingCash", true],
              ] as [string, keyof (typeof model.annual)[number], boolean][]).map(([label, key, bold]) => (
                <tr key={label} className={bold ? "subtotal" : ""}>
                  <td>{label}</td>
                  {model.annual.map((a) => (
                    <td key={a.year} className={`num ${(a[key] as number) < 0 ? "neg" : ""}`}>
                      {fmt(a[key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
