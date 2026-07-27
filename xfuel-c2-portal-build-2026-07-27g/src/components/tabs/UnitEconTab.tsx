"use client";

import { InputRow, PeriodHead, SectionRow, ValueRow, YearHead, YearRow } from "../Grid";
import { TOTAL_YEARS } from "@/lib/model/periods";
import type { YearlyUeKey } from "@/lib/model/types";
import { fmt, fmt1 } from "@/lib/format";
import type { ModelOutputs, ScenarioInputs, UnitEconomics } from "@/lib/model/types";

export default function UnitEconTab({
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
  const ue = inputs.unitEconomics;
  const periods = model.periods;
  const set = (patch: Partial<UnitEconomics>) =>
    emit({ ...inputs, unitEconomics: { ...ue, ...patch } });

  const R = model.results;
  const YEARS = TOTAL_YEARS;
  const setYear = (key: YearlyUeKey) => (next: number[]) => set({ [key]: next } as Partial<UnitEconomics>);

  // Steady-state margin per ton, taken from the last annual period.
  const last = R[R.length - 1];
  const perTon = last.tons > 0 ? (last.revenue - last.cogs) / last.tons : 0;

  return (
    <>
      <div className="page-title">Unit economics</div>
      <div className="page-sub">
        Plant throughput, price and cost drivers, each by plan year. Revenue and COGS are driven by hourly throughput
        times operating hours times capacity utilisation, matching the FAIIP business model. A driver left flat across
        the ten years behaves exactly as a single figure did.
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Nameplate capacity</div>
          <div className="k-val">{fmt(last.nameplateTonsPerYear)}</div>
          <div className="k-meta">tons MGO per year at 100%, final year</div>
        </div>
        <div className="kpi">
          <div className="k-label">Price per ton</div>
          <div className="k-val">{fmt(last.tons > 0 ? last.revenue / last.tons : 0)}</div>
          <div className="k-meta">EUR per ton MGO, final year</div>
        </div>
        <div className="kpi">
          <div className="k-label">Gross margin per ton</div>
          <div className="k-val">{fmt(perTon)}</div>
          <div className="k-meta">at steady state</div>
        </div>
        <div className="kpi">
          <div className="k-label">Steady-state revenue</div>
          <div className="k-val">{fmt(last.revenue)}</div>
          <div className="k-meta">final plan year</div>
        </div>
      </div>

      <div className="card">
        <h3>Drivers by plan year</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <YearHead years={YEARS} first="Driver" />
            <tbody>
              <SectionRow label="Throughput" span={YEARS} />
              <YearRow label="Price per ton MGO" suffix="(EUR)" values={ue.pricePerTon} years={YEARS}
                editable={editable} onChange={setYear("pricePerTon")} />
              <YearRow label="Annual operating hours at 100%" values={ue.annualHours} years={YEARS}
                editable={editable} onChange={setYear("annualHours")} />
              <YearRow label="MGO yield" suffix="(kg/h)" values={ue.mgoYieldKgPerHour} years={YEARS}
                editable={editable} onChange={setYear("mgoYieldKgPerHour")} />
              <YearRow label="MTS input" suffix="(kg/h)" values={ue.mtsInputKgPerHour} years={YEARS}
                editable={editable} onChange={setYear("mtsInputKgPerHour")} />
              <YearRow label="Reactant input" suffix="(kg/h)" values={ue.reactantInputKgPerHour} years={YEARS}
                editable={editable} onChange={setYear("reactantInputKgPerHour")} />
              <YearRow label="Residue yield" suffix="(kg/h)" values={ue.residueYieldKgPerHour} years={YEARS}
                editable={editable} onChange={setYear("residueYieldKgPerHour")} />
              <YearRow label="Water yield" suffix="(kg/h)" values={ue.waterYieldKgPerHour} years={YEARS}
                editable={editable} onChange={setYear("waterYieldKgPerHour")} />

              <SectionRow label="Input costs (EUR per ton)" span={YEARS} />
              <YearRow label="MTS feedstock" values={ue.mtsCostPerTon} years={YEARS}
                editable={editable} onChange={setYear("mtsCostPerTon")} />
              <YearRow label="Reactants" values={ue.reactantCostPerTon} years={YEARS}
                editable={editable} onChange={setYear("reactantCostPerTon")} />
              <YearRow label="Residue disposal" values={ue.residueCostPerTon} years={YEARS}
                editable={editable} onChange={setYear("residueCostPerTon")} />
              <YearRow label="Water" values={ue.waterCostPerTon} years={YEARS}
                editable={editable} onChange={setYear("waterCostPerTon")} />
              <YearRow label="Maintenance" suffix="(% p.a. of deployed CAPEX)" values={ue.maintenancePctOfCapex}
                years={YEARS} scale={100} step="0.01" editable={editable}
                onChange={setYear("maintenancePctOfCapex")} />

              <SectionRow label="Energy" span={YEARS} />
              <YearRow label="Electricity price" suffix="(EUR/kWh)" values={ue.electricityPricePerKwh} years={YEARS}
                step="0.0001" editable={editable} onChange={setYear("electricityPricePerKwh")} />
              <YearRow label="Electricity consumption" suffix="(kWh/h)" values={ue.electricityKwhPerHour} years={YEARS}
                editable={editable} onChange={setYear("electricityKwhPerHour")} />
              <YearRow label="Heat price" suffix="(EUR/kWh)" values={ue.heatPricePerKwh} years={YEARS}
                step="0.0001" editable={editable} onChange={setYear("heatPricePerKwh")} />
              <YearRow label="Heat consumption" suffix="(kWh/h)" values={ue.heatKwhPerHour} years={YEARS}
                editable={editable} onChange={setYear("heatKwhPerHour")} />
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Capacity utilisation and resulting volumes</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <PeriodHead periods={periods} first="Line" />
            <tbody>
              <InputRow
                label="Plant capacity utilisation" suffix="(% of max)" values={ue.utilisation} periods={periods}
                editable={editable} scale={100} step="0.1"
                onChange={(next) => set({ utilisation: next })}
              />
              <ValueRow label="Nameplate capacity (t/y)" values={R.map((r) => r.nameplateTonsPerYear)} periods={periods} format={fmt1} />
              <ValueRow label="Tons produced" values={R.map((r) => r.tons)} periods={periods} format={fmt1} />
              <ValueRow label="Revenue" values={R.map((r) => r.revenue)} periods={periods} bold />
              <ValueRow label="COGS — energy" values={R.map((r) => r.cogsEnergy)} periods={periods} />
              <ValueRow label="COGS — MTS feedstock" values={R.map((r) => r.cogsMts)} periods={periods} />
              <ValueRow label="COGS — reactants" values={R.map((r) => r.cogsReactants)} periods={periods} />
              <ValueRow label="COGS — residue disposal" values={R.map((r) => r.cogsResidue)} periods={periods} />
              <ValueRow label="COGS — water" values={R.map((r) => r.cogsWater)} periods={periods} />
              <ValueRow label="COGS — maintenance" values={R.map((r) => r.cogsMaintenance)} periods={periods} />
              <ValueRow label="Total COGS" values={R.map((r) => r.cogs)} periods={periods} bold />
              <ValueRow label="Gross margin" values={R.map((r) => r.grossMargin)} periods={periods} bold />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
