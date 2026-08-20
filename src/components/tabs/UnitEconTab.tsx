"use client";

import ComponentEditor from "../ComponentEditor";
import { InputRow, PeriodHead, ValueRow, YearHead, YearRow } from "../Grid";
import { fmt, fmt1 } from "@/lib/format";
import { TOTAL_YEARS } from "@/lib/model/periods";
import { COGS_BASES, REVENUE_BASES } from "@/lib/model/components";
import type { ModelComponent, RevenueComponent } from "@/lib/model/components";
import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";

export default function UnitEconTab({
  inputs, model, onChange, editable,
}: {
  inputs: ScenarioInputs;
  model: ModelOutputs;
  onChange: (next: ScenarioInputs) => void;
  editable: boolean;
}) {
  // Defence in depth: never emit a change when the session is read only.
  const emit = editable ? onChange : () => {};
  const periods = model.periods;
  const R = model.results;
  const last = R[R.length - 1];
  const p = inputs.parameters;

  return (
    <>
      <div className="page-title">Unit economics</div>
      <div className="page-sub">
        Revenue and cost of goods as editable lines. Rename anything, describe it, change how it is calculated, or add
        and remove lines. Every driver is set by plan year, so a price curve or a yield improvement needs no code change.
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Nameplate capacity</div>
          <div className="k-val">{fmt(last.nameplateTonsPerYear)}</div>
          <div className="k-meta">tons per year at 100%, final year</div>
        </div>
        <div className="kpi">
          <div className="k-label">Realised price per ton</div>
          <div className="k-val">{fmt(last.tons > 0 ? last.revenue / last.tons : 0)}</div>
          <div className="k-meta">including the {Number(p.sustainablePremium ?? 1).toFixed(2)}x premium</div>
        </div>
        <div className="kpi">
          <div className="k-label">Gross margin per ton</div>
          <div className="k-val">{fmt(last.tons > 0 ? last.grossMargin / last.tons : 0)}</div>
          <div className="k-meta">at steady state</div>
        </div>
        <div className="kpi">
          <div className="k-label">Premium contribution</div>
          <div className="k-val">{fmt(last.revenuePremium)}</div>
          <div className="k-meta">
            {last.revenue > 0
              ? `${((last.revenuePremium / last.revenue) * 100).toFixed(0)}% of revenue`
              : "no premium set"}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Plant</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <YearHead years={TOTAL_YEARS} first="Driver" />
            <tbody>
              <YearRow
                label="Annual operating hours at 100%"
                values={inputs.unitEconomics.annualHours}
                years={TOTAL_YEARS}
                editable={editable}
                onChange={(next) =>
                  emit({ ...inputs, unitEconomics: { ...inputs.unitEconomics, annualHours: next } })
                }
              />
            </tbody>
          </table>
        </div>
      </div>

      <ComponentEditor
        kind="revenue"
        title="Revenue lines"
        intro="Each stream carries its own yield and price. The first line is the primary product and its yield sets nameplate capacity. Premium-eligible lines receive the sustainable premium multiplier set on the Global parameters tab."
        components={inputs.revenue}
        bases={REVENUE_BASES}
        editable={editable}
        showPremium
        showYield
        onChange={(next) => emit({ ...inputs, revenue: next as RevenueComponent[] })}
      />

      <ComponentEditor
        kind="cogs"
        title="COGS lines"
        intro="Choose how each line is calculated: per operating hour, per kWh, per ton of product, as a percentage of deployed CAPEX, or as a fixed annual amount. Quantities are physical; the COGS inflation rate escalates the money."
        components={inputs.cogs}
        bases={COGS_BASES}
        editable={editable}
        onChange={(next) => emit({ ...inputs, cogs: next as ModelComponent[] })}
      />

      <div className="card">
        <h3>Capacity utilisation and resulting volumes</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first="Line" />
            <tbody>
              <InputRow
                label="Plant capacity utilisation" suffix="(% of max)" values={inputs.unitEconomics.utilisation}
                periods={periods} editable={editable} scale={100} step="0.1"
                onChange={(next) =>
                  emit({ ...inputs, unitEconomics: { ...inputs.unitEconomics, utilisation: next } })
                }
              />
              <ValueRow label="Nameplate capacity (t/y)" values={R.map((r) => r.nameplateTonsPerYear)} periods={periods} format={fmt1} />
              <ValueRow label="Tons produced" values={R.map((r) => r.tons)} periods={periods} format={fmt1} />
              <ValueRow label="Revenue — base price" values={R.map((r) => r.revenueBase)} periods={periods} />
              <ValueRow label="Revenue — sustainable premium" values={R.map((r) => r.revenuePremium)} periods={periods} />
              <ValueRow label="Total revenue" values={R.map((r) => r.revenue)} periods={periods} bold />
              {inputs.cogs.map((c) => (
                <ValueRow
                  key={c.id}
                  label={`COGS — ${c.name}`}
                  values={R.map((r) => r.cogsByComponent[c.id] ?? 0)}
                  periods={periods}
                />
              ))}
              <ValueRow label="Total COGS" values={R.map((r) => r.cogs)} periods={periods} bold />
              <ValueRow label="Gross margin" values={R.map((r) => r.grossMargin)} periods={periods} bold />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
