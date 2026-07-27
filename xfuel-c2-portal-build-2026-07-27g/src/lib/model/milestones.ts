import { extendYearly } from "./normalise";
import type { ModelOutputs, ScenarioInputs } from "./types";

export interface Milestone {
  key: string;
  label: string;
  period: number | null;
  periodLabel: string;
  detail: string;
}

export interface UnitEconomicsSummary {
  pricePerTon: number;
  /** Variable cost per ton of product at full utilisation, by component. */
  components: { key: string; label: string; perTon: number }[];
  variableCostPerTon: number;
  contributionPerTon: number;
  contributionPct: number;
  nameplateTonsPerYear: number;
  steadyUtilisation: number;
  steadyTonsPerYear: number;
  steadyRevenue: number;
  steadyEbitda: number;
  steadyEbitdaMargin: number;
  /** Plan year the per-ton figures are quoted in. */
  year: number;
}

/** First index where the predicate holds, or null. */
function firstIndex(values: number[], test: (v: number) => boolean): number | null {
  for (let i = 0; i < values.length; i++) if (test(values[i])) return i;
  return null;
}

function lastIndex(values: number[], test: (v: number) => boolean): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (test(values[i])) return i;
  return null;
}

const labelAt = (model: ModelOutputs, i: number | null) =>
  i === null ? "–" : (model.periods[i]?.label ?? "–");

/**
 * The five headline dates of the project: when CAPEX starts and finishes, when
 * production starts, when the ramp completes, and what steady state looks like.
 */
export function buildMilestones(inputs: ScenarioInputs, model: ModelOutputs): Milestone[] {
  const spend = model.results.map((r) => r.capexSpend);
  const capexStart = firstIndex(spend, (v) => v > 0.5);
  const capexEnd = lastIndex(spend, (v) => v > 0.5);

  const util = model.results.map((r) => r.utilisation);
  const prodStart = firstIndex(util, (v) => v > 0);
  const maxUtil = Math.max(0, ...util);
  // The ramp is complete the first time utilisation reaches its plateau.
  const rampEnd = maxUtil > 0 ? firstIndex(util, (v) => v >= maxUtil - 1e-9) : null;

  const capexTotal = inputs.capex.reduce((a, c) => a + (Number(c.total) || 0), 0);
  const months =
    capexStart !== null && capexEnd !== null
      ? model.periods.slice(capexStart, capexEnd + 1).reduce((a, p) => a + p.months, 0)
      : 0;

  // Nameplate varies by year, so quote the one in force when the ramp completes.
  const nameplate = model.results[rampEnd ?? model.results.length - 1]?.nameplateTonsPerYear ?? 0;

  const rampMonths =
    prodStart !== null && rampEnd !== null
      ? model.periods.slice(prodStart, rampEnd).reduce((a, p) => a + p.months, 0)
      : 0;

  return [
    {
      key: "capexStart",
      label: "CAPEX starts",
      period: capexStart,
      periodLabel: labelAt(model, capexStart),
      detail: `${(capexTotal / 1e6).toFixed(1)}M committed`,
    },
    {
      key: "capexEnd",
      label: "CAPEX ends",
      period: capexEnd,
      periodLabel: labelAt(model, capexEnd),
      detail: months ? `${months}-month build` : "–",
    },
    {
      key: "prodStart",
      label: "Production starts",
      period: prodStart,
      periodLabel: labelAt(model, prodStart),
      detail: prodStart !== null ? `at ${(util[prodStart] * 100).toFixed(0)}% of nameplate` : "–",
    },
    {
      key: "ramp",
      label: "Capacity ramp-up",
      period: rampEnd,
      periodLabel: labelAt(model, rampEnd),
      detail: rampMonths ? `${rampMonths} months to plateau` : "immediate",
    },
    {
      key: "max",
      label: "Maximum production",
      period: rampEnd,
      periodLabel: `${Math.round(nameplate * maxUtil).toLocaleString("en-US")} t/y`,
      detail: `${(maxUtil * 100).toFixed(0)}% of ${Math.round(nameplate).toLocaleString("en-US")} t/y nameplate`,
    },
  ];
}

/**
 * Unit economics at full utilisation, expressed per ton of product so the
 * price stack is directly comparable line by line.
 */
export function buildUnitEconomics(inputs: ScenarioInputs, model: ModelOutputs): UnitEconomicsSummary {
  // Steady state is the final period, which is past the ramp. Every driver is a
  // yearly series, so read each one at that period's plan year rather than
  // assuming a single figure holds for the whole plan.
  const lastIdx = model.results.length - 1;
  const steady = model.results[lastIdx];
  const y = Math.max(0, (model.periods[lastIdx]?.year ?? 1) - 1);
  const at = (v: number[] | number | undefined) => extendYearly(v)[y] ?? 0;

  const ue = inputs.unitEconomics;
  const mgoKgH = at(ue.mgoYieldKgPerHour);
  const hours = at(ue.annualHours);
  const nameplate = (mgoKgH * hours) / 1000;

  // Per hour the plant makes mgoKgH/1000 tons, so dividing an hourly cost by
  // that yield gives cost per ton of product.
  const tonsPerHour = mgoKgH / 1000;
  const perTon = (costPerHour: number) => (tonsPerHour > 0 ? costPerHour / tonsPerHour : 0);

  const energyPerHour =
    at(ue.electricityPricePerKwh) * at(ue.electricityKwhPerHour) +
    at(ue.heatPricePerKwh) * at(ue.heatKwhPerHour);

  const components = [
    { key: "mts", label: "MTS feedstock", perTon: perTon((at(ue.mtsInputKgPerHour) * at(ue.mtsCostPerTon)) / 1000) },
    {
      key: "reactants",
      label: "Reactants",
      perTon: perTon((at(ue.reactantInputKgPerHour) * at(ue.reactantCostPerTon)) / 1000),
    },
    { key: "energy", label: "Energy", perTon: perTon(energyPerHour) },
    {
      key: "residue",
      label: "Residue disposal",
      perTon: perTon((at(ue.residueYieldKgPerHour) * at(ue.residueCostPerTon)) / 1000),
    },
    { key: "water", label: "Water", perTon: perTon((at(ue.waterYieldKgPerHour) * at(ue.waterCostPerTon)) / 1000) },
  ].filter((c) => Math.abs(c.perTon) > 0.005);

  const variableCostPerTon = components.reduce((a, c) => a + c.perTon, 0);
  const pricePerTon = at(ue.pricePerTon);
  const contributionPerTon = pricePerTon - variableCostPerTon;
  const steadyUtilisation = steady?.utilisation ?? 0;

  return {
    pricePerTon,
    components,
    variableCostPerTon,
    contributionPerTon,
    contributionPct: pricePerTon > 0 ? contributionPerTon / pricePerTon : 0,
    nameplateTonsPerYear: nameplate,
    steadyUtilisation,
    steadyTonsPerYear: steady?.tons ?? 0,
    steadyRevenue: steady?.revenue ?? 0,
    steadyEbitda: steady?.ebitda ?? 0,
    steadyEbitdaMargin: steady && steady.revenue > 0 ? steady.ebitda / steady.revenue : 0,
    /** Plan year the per-ton figures are quoted in. */
    year: y + 1,
  };
}
