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
  /** Price before the sustainable premium. */
  basePricePerTon: number;
  /** The premium uplift per ton. */
  premiumPerTon: number;
  /** Contribution attributable to the base price. */
  contributionBasePerTon: number;
  /** Contribution attributable to the premium. */
  contributionPremiumPerTon: number;
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
  // Steady state is the final period, which is past the ramp. Everything is read
  // off the computed result rather than re-derived, so the panel cannot drift
  // from the engine when a component is added or its basis changed.
  const lastIdx = model.results.length - 1;
  const steady = model.results[lastIdx];
  const year = model.periods[lastIdx]?.year ?? 1;
  const tons = steady?.tons ?? 0;
  const perTon = (v: number) => (tons > 0 ? v / tons : 0);

  const components = (inputs.cogs ?? [])
    .map((c) => ({ key: c.id, label: c.name, perTon: perTon(steady?.cogsByComponent?.[c.id] ?? 0) }))
    .filter((c) => Math.abs(c.perTon) > 0.005);

  const variableCostPerTon = perTon(steady?.cogs ?? 0);
  const basePricePerTon = perTon(steady?.revenueBase ?? 0);
  const premiumPerTon = perTon(steady?.revenuePremium ?? 0);
  const pricePerTon = basePricePerTon + premiumPerTon;
  const contributionPerTon = pricePerTon - variableCostPerTon;

  return {
    pricePerTon,
    basePricePerTon,
    premiumPerTon,
    components,
    variableCostPerTon,
    contributionPerTon,
    contributionPct: pricePerTon > 0 ? contributionPerTon / pricePerTon : 0,
    /** Margin split: what the base price contributes, and what the premium adds. */
    contributionBasePerTon: basePricePerTon - variableCostPerTon,
    contributionPremiumPerTon: premiumPerTon,
    nameplateTonsPerYear: steady?.nameplateTonsPerYear ?? 0,
    steadyUtilisation: steady?.utilisation ?? 0,
    steadyTonsPerYear: tons,
    steadyRevenue: steady?.revenue ?? 0,
    steadyEbitda: steady?.ebitda ?? 0,
    steadyEbitdaMargin: steady && steady.revenue > 0 ? steady.ebitda / steady.revenue : 0,
    year,
  };
}
