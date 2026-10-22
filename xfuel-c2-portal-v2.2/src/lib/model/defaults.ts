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
      revenueInflation: 0.02,
      cogsInflation: 0.02,
      // 1.0 means no premium. The FAIIP price is a base price, so the seeded
      // case carries no uplift until XFuel sets one.
      sustainablePremium: 1.0,
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
      annualHours: flat(8000),
      utilisation: rampUtilisation(),
    },
    // Revenue, COGS and OPEX are editable lists. Names and descriptions can be
    // changed in the portal; the ids are what the changelog and Excel key on.
    revenue: [
      {
        id: "mgo",
        name: "MGO",
        description: "Marine gas oil, the primary product. Yield and price from the FAIIP business model.",
        basis: "perTon",
        premiumEligible: true,
        yieldKgPerHour: flat(1840),
        quantity: flat(0),
        unitCost: flat(688.8469),
      },
    ],
    cogs: [
      {
        id: "mts",
        name: "MTS feedstock",
        description: "Mixed tyre shred fed to the reactor, priced per ton delivered.",
        basis: "perHour",
        quantity: flat(2000),
        unitCost: flat(180.2806),
      },
      {
        id: "reactants",
        name: "Reactants",
        description: "Process reactants consumed per operating hour.",
        basis: "perHour",
        quantity: flat(50),
        unitCost: flat(3670),
      },
      {
        id: "residue",
        name: "Residue disposal",
        description: "Solid residue removed from site and disposed of, charged per ton.",
        basis: "perHour",
        quantity: flat(210),
        unitCost: flat(360),
      },
      {
        id: "water",
        name: "Water",
        description: "Process water. Zero in the base case; set a yield and a cost per ton to activate.",
        basis: "perHour",
        quantity: flat(0),
        unitCost: flat(0),
      },
      {
        id: "electricity",
        name: "Electricity",
        description: "Grid electricity consumed by the plant, at the contracted price per kWh.",
        basis: "perKwh",
        quantity: flat(138.53),
        unitCost: flat(0.1088692),
      },
      {
        id: "heat",
        name: "Heat",
        description: "Process heat consumed per operating hour, at the contracted price per kWh.",
        basis: "perKwh",
        quantity: flat(515.5),
        unitCost: flat(0.075),
      },
      {
        id: "maintenance",
        name: "Maintenance",
        description: "Plant maintenance, run as a percentage per annum of deployed CAPEX.",
        basis: "pctOfCapex",
        quantity: flat(0.04),
        unitCost: flat(0),
      },
    ],
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
        name: "Insurance",
        description: "Plant and liability insurance, entered as an annual amount.",
        basis: "fixedAnnual",
        quantity: flat(0),
        // Was 1.5% of deployed CAPEX, which on the seeded 27.2M build is c. 409k.
        unitCost: insuranceAmount(),
      },
      {
        id: "admin_oh",
        name: "Admin overhead",
        description: "Site administration and corporate recharges.",
        basis: "fixedAnnual",
        quantity: flat(0),
        unitCost: adminOverheadYearly(),
      },
      {
        id: "land_lease",
        name: "Land lease",
        description: "Ground rent, where the plot is leased rather than owned.",
        basis: "fixedAnnual",
        quantity: flat(0),
        unitCost: flat(0),
      },
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

/**
 * Admin overhead by plan year. Nothing before the site is staffed, then 120k a
 * year once operations begin.
 */
function adminOverheadYearly(): number[] {
  const a = new Array(TOTAL_YEARS).fill(0);
  const firstStaffedYear = Math.max(0, Math.floor((OPS_START_PERIOD - 3) / 12));
  for (let y = firstStaffedYear; y < TOTAL_YEARS; y++) a[y] = 120_000;
  return a;
}

/**
 * Insurance as an annual amount rather than a percentage of CAPEX.
 *
 * The v1 model charged 1.5% per annum of deployed CAPEX. On the seeded 27.2M
 * build that is about 409k a year once fully deployed, which is the figure
 * carried here so the base case does not move when the basis changes. Nothing
 * now recalculates it; edit the amount directly.
 */
function insuranceAmount(): number[] {
  const a = new Array(TOTAL_YEARS).fill(0);
  const firstYear = Math.max(0, Math.floor(OPS_START_PERIOD / 12));
  for (let y = firstYear; y < TOTAL_YEARS; y++) a[y] = 408_535;
  return a;
}
