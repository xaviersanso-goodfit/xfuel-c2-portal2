import { MONTHLY_PERIODS, PERIOD_COUNT, TOTAL_YEARS, zeroes } from "./periods";
import type { ScenarioInputs } from "./types";

/**
 * Seed scenario for the C2 Tarragona FOAK plant.
 *
 * CAPEX totals: "C2_Tarragona_CAPEX_integrated_260724 (5.1 DDIB - 30Jun Ditecsa)", CAPEX Summary tab.
 *   ISBL 13,699,966 · OSBL 10,953,612 (incl. land 1,375,000) · Overheads 2,582,095 · Grand total 27,235,672.
 *   Land is split out here so it can be excluded from depreciation.
 * Unit economics, OPEX and personnel: "Business model FAIIP (v20260515)".
 */

// Straight-line monthly depreciation rates.
const DEP_ISBL = 1 / 180; // 15 years
const DEP_OSBL = 1 / 300; // 25 years
const DEP_OTHER = 1 / 120; // 10 years

/** 18-month construction S-curve, starting at period 0. Sums to 1. */
const CONSTRUCTION_CURVE = [
  0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.08, 0.08,
  0.08, 0.08, 0.07, 0.07, 0.06, 0.05, 0.04, 0.03, 0.01,
];

/** Period index at which the plant starts producing. */
export const OPS_START_PERIOD = 18;

/**
 * A unit-economics driver held flat across the horizon.
 *
 * The FAIIP business model quotes one figure per driver, so every year starts
 * on the same value. They are yearly series rather than scalars so that the
 * plan can carry a price curve, a yield improvement or an energy contract
 * step-up without touching the engine.
 */
const flat = (v: number): number[] => new Array(TOTAL_YEARS).fill(v);

function rampUtilisation(): number[] {
  const u = zeroes(PERIOD_COUNT);
  // Ramp month by month from the operations start, then hold at steady state.
  const ramp = [0.3, 0.45, 0.6, 0.7, 0.8, 0.85, 0.88, 0.9];
  for (let k = 0; k < ramp.length; k++) {
    const idx = OPS_START_PERIOD + k;
    if (idx < PERIOD_COUNT) u[idx] = ramp[k];
  }
  for (let i = OPS_START_PERIOD + ramp.length; i < PERIOD_COUNT; i++) u[i] = 0.9;
  return u;
}

function fteProfile(total: number): number[] {
  const f = zeroes(PERIOD_COUNT);
  // Hire from three months before operations start.
  for (let i = OPS_START_PERIOD - 3; i < OPS_START_PERIOD; i++) f[i] = total * 0.5;
  for (let i = OPS_START_PERIOD; i < PERIOD_COUNT; i++) f[i] = total;
  return f;
}

export function defaultScenario(): ScenarioInputs {
  return {
    name: "Base case",
    parameters: {
      startMonth: "2027-01",
      opsStartPeriod: OPS_START_PERIOD,
      citr: 0.25,
      dso: 45,
      dpo: 60,
      otherWorkingCapital: zeroes(PERIOD_COUNT),
      wacc: 0.09,
      costOfEquity: 0.15,
      exitMultiple: 8,
      openingCash: 0,
      opexInflation: 0.02,
      compensationInflation: 0.025,
    },
    capex: [
      {
        id: "isbl",
        label: "ISBL — process plant",
        total: 13_699_966,
        depRateMonthly: DEP_ISBL,
        startPeriod: 0,
        phasing: [...CONSTRUCTION_CURVE],
      },
      {
        id: "osbl",
        label: "OSBL — infrastructure & civil",
        total: 9_578_612, // 10,953,612 less land 1,375,000
        depRateMonthly: DEP_OSBL,
        startPeriod: 0,
        phasing: [...CONSTRUCTION_CURVE],
      },
      {
        id: "other",
        label: "Other — overheads & licensing",
        total: 2_582_095,
        depRateMonthly: DEP_OTHER,
        startPeriod: 0,
        phasing: [...CONSTRUCTION_CURVE],
      },
      {
        id: "land",
        label: "Land / plot purchase",
        total: 1_375_000,
        depRateMonthly: 0,
        startPeriod: 0,
        phasing: [1],
      },
    ],
    unitEconomics: {
      pricePerTon: flat(688.8469),
      annualHours: flat(8000),
      mgoYieldKgPerHour: flat(1840),
      mtsInputKgPerHour: flat(2000),
      reactantInputKgPerHour: flat(50),
      residueYieldKgPerHour: flat(210),
      waterYieldKgPerHour: flat(0),
      mtsCostPerTon: flat(180.2806),
      reactantCostPerTon: flat(3670),
      residueCostPerTon: flat(360),
      waterCostPerTon: flat(0),
      electricityPricePerKwh: flat(0.1088692),
      electricityKwhPerHour: flat(138.53),
      heatPricePerKwh: flat(0.075),
      heatKwhPerHour: flat(515.5),
      maintenancePctOfCapex: flat(0.04),
      utilisation: rampUtilisation(),
    },
    personnel: [
      { id: "gm", label: "General manager", annualCost: 126_000, ftes: fteProfile(1) },
      { id: "qa", label: "QA & HR supervisor", annualCost: 73_450, ftes: fteProfile(1) },
      { id: "proc_sup", label: "Process engineer supervisor", annualCost: 73_450, ftes: fteProfile(1) },
      { id: "proc_tech", label: "Process technician", annualCost: 56_500, ftes: fteProfile(3.9) },
      { id: "operators", label: "Operators", annualCost: 39_550, ftes: fteProfile(7.8) },
      { id: "maint", label: "Maintenance general & relief cover", annualCost: 45_200, ftes: fteProfile(3.9) },
      { id: "admin", label: "Admin", annualCost: 33_900, ftes: fteProfile(1) },
    ],
    opex: [
      {
        id: "insurance",
        label: "Insurance (% of deployed CAPEX)",
        amounts: zeroes(PERIOD_COUNT),
        pctOfCapexPerAnnum: 0.015,
      },
      { id: "admin_oh", label: "Admin overhead", amounts: adminOverhead() },
      { id: "land_lease", label: "Land cost (leasing)", amounts: zeroes(PERIOD_COUNT) },
    ],
    instruments: [
      {
        id: "faiip",
        kind: "debt",
        label: "FAIIP facility",
        amount: 10_000_000,
        drawPeriod: 2,
        rate: 0.04,
        graceMonths: 24,
        tenorMonths: 120,
        repayment: "linear",
        upfrontFeePct: 0,
      },
      {
        id: "grant_eic",
        kind: "grant",
        label: "Grant / subsidy",
        amount: 2_500_000,
        drawPeriod: 6,
      },
      {
        id: "equity_a",
        kind: "equity",
        label: "Equity — Series A",
        amount: 17_000_000,
        drawPeriod: 0,
      },
    ],
  };
}

function adminOverhead(): number[] {
  const a = zeroes(PERIOD_COUNT);
  // 10,000 per month once the site is staffed; annual periods carry 12 months.
  for (let i = OPS_START_PERIOD - 3; i < MONTHLY_PERIODS; i++) a[i] = 10_000;
  for (let i = MONTHLY_PERIODS; i < PERIOD_COUNT; i++) a[i] = 120_000;
  return a;
}
