import { PERIOD_COUNT, TOTAL_YEARS, buildPeriods } from "./periods";
import { GROUP_MONTHS, defaultGroupInputs, groupZeroes } from "./group";
import { clampDescription } from "./components";
import type { ModelComponent, RevenueComponent } from "./components";
import type { Period, ScenarioInputs, UnitEconomics } from "./types";
import { defaultScenario } from "./defaults";

/**
 * How a per-period series should behave when the plan runs longer than the
 * values supplied for it.
 *
 *   rate   — a level that persists: utilisation %, FTE count. Carried forward
 *            unchanged, because 90% utilisation stays 90% whether the period is
 *            one month or twelve.
 *   amount — a EUR figure earned or spent over the period. Carried forward and
 *            rescaled by period length, so 10,000 per month becomes 120,000 in
 *            an annual period.
 *   none   — absence means zero: CAPEX phasing (which must sum to 1) and manual
 *            working-capital adjustments (which are corrections, not a run rate).
 */
export type SeriesKind = "rate" | "amount" | "none";

/**
 * Coerce a series to exactly `periods.length` entries.
 *
 * Two failure modes this exists to prevent, both of which silently produced
 * zeroes before: an array saved under a shorter plan horizon, and a sparse
 * array created by writing past the end of a short array in an input grid.
 */
export function extendSeries(
  values: number[] | undefined,
  periods: Period[],
  kind: SeriesKind
): number[] {
  const n = periods.length;
  const out = new Array<number>(n).fill(0);
  if (!values || values.length === 0) return out;

  // Copy what was supplied, treating holes, nulls and NaN as zero.
  const supplied = Math.min(values.length, n);
  for (let i = 0; i < supplied; i++) {
    const v = Number(values[i]);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  if (supplied >= n || kind === "none") return out;

  // Extend from the last period the user actually supplied.
  const lastIdx = supplied - 1;
  const last = out[lastIdx];
  const lastMonths = periods[lastIdx]?.months || 1;
  for (let i = supplied; i < n; i++) {
    out[i] = kind === "amount" ? (last * periods[i].months) / lastMonths : last;
  }
  return out;
}

/**
 * Bring every per-period array in a scenario up to the current plan length.
 *
 * Applied wherever a scenario enters the app from outside the current build:
 * the database, an uploaded workbook, or a scenario saved before the horizon
 * changed. Doing it here rather than inside the engine keeps the input grids
 * and the computed model showing the same numbers, so a carried-forward value
 * is visible and editable instead of being invented at calculation time.
 */
export function normaliseScenario(inputs: ScenarioInputs): ScenarioInputs {
  const periods = buildPeriods(inputs?.parameters?.startMonth ?? "2027-01");

  return {
    ...inputs,
    parameters: {
      ...inputs.parameters,
      otherWorkingCapital: extendSeries(inputs.parameters?.otherWorkingCapital, periods, "none"),
    },
    capex: (inputs.capex ?? []).map((line) => ({
      ...line,
      // Phasing is indexed from the concept's own start and must sum to 1, so a
      // short array means "spending finished", not "carry on spending".
      phasing: (line.phasing ?? []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)),
    })),
    unitEconomics: {
      annualHours: extendYearly(inputs.unitEconomics?.annualHours),
      utilisation: extendSeries(inputs.unitEconomics?.utilisation, periods, "rate"),
    },
    revenue: normaliseComponents(inputs.revenue, "revenue") as RevenueComponent[],
    cogs: normaliseComponents(inputs.cogs, "cogs"),
    personnel: (inputs.personnel ?? []).map((p) => ({
      ...p,
      ftes: extendSeries(p.ftes, periods, "rate"),
    })),
    opex: normaliseComponents(inputs.opex, "opex"),
    instruments: inputs.instruments ?? [],
    group: normaliseGroup(inputs.group),
  };
}

/**
 * Bring the group overlay up to shape.
 *
 * Absent entirely on scenarios saved before the group tab existed, so it falls
 * back to the seeded defaults rather than leaving the tab blank.
 */
export function normaliseGroup(g: ScenarioInputs["group"]) {
  const base = defaultGroupInputs();
  if (!g) return base;
  return {
    openingCash: Number.isFinite(Number(g.openingCash)) ? Number(g.openingCash) : base.openingCash,
    eliminateIntercompanyEquity: g.eliminateIntercompanyEquity !== false,
    lines: (g.lines ?? base.lines).map((l) => {
      const amounts = groupZeroes();
      for (let i = 0; i < Math.min(l.amounts?.length ?? 0, GROUP_MONTHS); i++) {
        const v = Number(l.amounts[i]);
        amounts[i] = Number.isFinite(v) ? v : 0;
      }
      return { ...l, amounts };
    }),
  };
}

/** Period count the current build plans over. Re-exported for callers. */
export { PERIOD_COUNT };

/**
 * Coerce a yearly driver to exactly `years` entries.
 *
 * Accepts a bare number so that scenarios saved before these drivers became
 * yearly still load: the old scalar becomes a flat series. Short arrays hold
 * their last value, which is what you want for a price or a yield.
 */
export function extendYearly(value: number | number[] | undefined, years = TOTAL_YEARS): number[] {
  const out = new Array<number>(years).fill(0);
  if (value === undefined || value === null) return out;

  if (!Array.isArray(value)) {
    const v = Number(value);
    return out.fill(Number.isFinite(v) ? v : 0);
  }
  if (value.length === 0) return out;

  const supplied = Math.min(value.length, years);
  for (let i = 0; i < supplied; i++) {
    const v = Number(value[i]);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  for (let i = supplied; i < years; i++) out[i] = out[supplied - 1];
  return out;
}

/**
 * Bring a component list to shape: full-length yearly series, a trimmed
 * description, and a usable basis.
 *
 * A scenario saved by version 1 has no component arrays at all, so an empty or
 * missing list falls back to the seeded defaults for that block rather than
 * leaving the tab blank. That is a deliberate choice: a silently empty revenue
 * list would compute zero revenue and look like a modelling result rather than
 * a migration failure.
 */
export function normaliseComponents(
  list: ModelComponent[] | undefined,
  kind: "revenue" | "cogs" | "opex"
): ModelComponent[] {
  const source = list && list.length > 0 ? list : (defaultScenario()[kind] as ModelComponent[]);
  return source.map((c, i) => {
    const out: ModelComponent = {
      id: c.id || `${kind}_${i}`,
      name: c.name || `Line ${i + 1}`,
      description: clampDescription(c.description),
      basis: c.basis ?? (kind === "opex" ? "fixedAnnual" : "perTon"),
      quantity: extendYearly(c.quantity),
      unitCost: extendYearly(c.unitCost),
    };
    if (kind === "revenue") {
      out.premiumEligible = c.premiumEligible !== false;
      out.yieldKgPerHour = extendYearly(c.yieldKgPerHour);
    }
    return out;
  });
}
