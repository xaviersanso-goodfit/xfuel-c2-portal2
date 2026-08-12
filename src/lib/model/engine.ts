import { buildPeriods, daysInPeriod, fit, PERIOD_COUNT, MONTHLY_PERIODS } from "./periods";
import { extendSeries, extendYearly } from "./normalise";
import { buildDebtFlows, irr, npv } from "./finance";
import type {
  AnnualSummaryRow,
  ModelOutputs,
  Period,
  PeriodResult,
  ScenarioInputs,
  ValuationResult,
} from "./types";

function emptyResult(): PeriodResult {
  return {
    tons: 0, utilisation: 0, nameplateTonsPerYear: 0,
    revenue: 0, cogsEnergy: 0, cogsMts: 0, cogsReactants: 0, cogsResidue: 0, cogsWater: 0,
    cogsMaintenance: 0, cogs: 0, grossMargin: 0,
    opexPersonnel: 0, opexOther: 0, opexTotal: 0, ebitda: 0,
    depreciation: 0, ebit: 0, interestExpense: 0, grantIncome: 0, pbt: 0, tax: 0, netIncome: 0,
    deltaAr: 0, deltaAp: 0, otherWc: 0, cfo: 0,
    capexSpend: 0, cfi: 0,
    debtDraw: 0, debtRepayment: 0, equityRaise: 0, grantCash: 0, cff: 0,
    netCashFlow: 0, openingCash: 0, closingCash: 0,
    capexCumulative: 0, debtBalance: 0, nolBalance: 0, ar: 0, ap: 0,
    projectFcf: 0, equityFcf: 0,
  };
}

/**
 * Run the full C2 project model.
 *
 * Order of calculation:
 *   CAPEX phasing -> cumulative deployed CAPEX -> depreciation (from ops start)
 *   utilisation x capacity -> tons -> revenue and COGS
 *   personnel + other OPEX -> EBITDA
 *   instruments -> interest, grant income, financing cash
 *   NOL carry-forward -> tax -> net income
 *   DSO/DPO -> working capital -> CFO; CFI from CAPEX; CFF from instruments
 *   project and equity FCF -> IRR / NPV with exit EV/EBITDA terminal value
 */
export function runModel(inputs: ScenarioInputs): ModelOutputs {
  const warnings: string[] = [];
  const periods = buildPeriods(inputs.parameters.startMonth);
  const n = periods.length;
  const results: PeriodResult[] = Array.from({ length: n }, emptyResult);

  const p = inputs.parameters;
  const opsStart = Math.min(Math.max(Math.round(p.opsStartPeriod ?? 0), 0), n - 1);

  // ---------- 1. CAPEX phasing and cumulative deployment ----------
  const capexByPeriod = new Array(n).fill(0);
  // Per-concept spend, needed for concept-level depreciation.
  const conceptSpend: Record<string, number[]> = {};

  for (const line of inputs.capex) {
    const spend = new Array(n).fill(0);
    const phasing = line.phasing ?? [];
    const phaseSum = phasing.reduce((a, b) => a + (Number(b) || 0), 0);
    if (line.total > 0 && Math.abs(phaseSum - 1) > 0.005) {
      warnings.push(
        `CAPEX "${line.label}" phasing sums to ${(phaseSum * 100).toFixed(1)}% (should be 100%).`
      );
    }
    const start = Math.min(Math.max(Math.round(line.startPeriod ?? 0), 0), n - 1);
    for (let k = 0; k < phasing.length; k++) {
      const idx = start + k;
      if (idx >= n) break;
      const amount = (Number(line.total) || 0) * (Number(phasing[k]) || 0);
      spend[idx] += amount;
      capexByPeriod[idx] += amount;
    }
    conceptSpend[line.id] = spend;
  }

  let cumCapex = 0;
  for (let i = 0; i < n; i++) {
    cumCapex += capexByPeriod[i];
    results[i].capexSpend = capexByPeriod[i];
    results[i].capexCumulative = cumCapex;
  }

  // ---------- 2. Depreciation (straight line on cost, starts at ops start) ----------
  for (const line of inputs.capex) {
    const spend = conceptSpend[line.id] ?? new Array(n).fill(0);
    const rate = Number(line.depRateMonthly) || 0;
    if (rate <= 0) continue; // land and any non-depreciating concept

    let costBase = 0;
    let accumulated = 0;
    for (let i = 0; i < n; i++) {
      costBase += spend[i];
      if (i < opsStart) continue;
      const months = periods[i].months;
      let dep = costBase * rate * months;
      // Never depreciate below zero net book value.
      const remaining = Math.max(costBase - accumulated, 0);
      dep = Math.min(dep, remaining);
      accumulated += dep;
      results[i].depreciation += dep;
    }
  }

  // ---------- 3. Revenue and COGS from unit economics ----------
  const ue = inputs.unitEconomics;
  // Carry the last supplied value forward rather than zero-padding: a series
  // that stops short means "no further input", not "the plant shuts down".
  const utilisation = extendSeries(ue.utilisation, periods, "rate");

  // Every unit-economics driver varies by plan year, so resolve each one to the
  // year the period falls in. `yr(i)` is the 0-based plan year of period i.
  const Y = {
    price: extendYearly(ue.pricePerTon),
    hours: extendYearly(ue.annualHours),
    mgo: extendYearly(ue.mgoYieldKgPerHour),
    mts: extendYearly(ue.mtsInputKgPerHour),
    react: extendYearly(ue.reactantInputKgPerHour),
    residue: extendYearly(ue.residueYieldKgPerHour),
    water: extendYearly(ue.waterYieldKgPerHour),
    mtsCost: extendYearly(ue.mtsCostPerTon),
    reactCost: extendYearly(ue.reactantCostPerTon),
    residueCost: extendYearly(ue.residueCostPerTon),
    waterCost: extendYearly(ue.waterCostPerTon),
    elecPrice: extendYearly(ue.electricityPricePerKwh),
    elecKwh: extendYearly(ue.electricityKwhPerHour),
    heatPrice: extendYearly(ue.heatPricePerKwh),
    heatKwh: extendYearly(ue.heatKwhPerHour),
    maint: extendYearly(ue.maintenancePctOfCapex),
  };
  const yr = (i: number) => Math.max(0, periods[i].year - 1);

  for (let i = 0; i < n; i++) {
    const r = results[i];
    const months = periods[i].months;
    const u = utilisation[i] || 0;
    const y = yr(i);
    r.utilisation = u;

    // Nameplate is a function of the year's yield and operating hours, so it can
    // step up with a debottlenecking or down with a shorter campaign.
    r.nameplateTonsPerYear = (Y.mgo[y] * Y.hours[y]) / 1000;

    // Tons of MGO produced and sold in the period.
    r.tons = (r.nameplateTonsPerYear / 12) * months * u;
    r.revenue = r.tons * Y.price[y];

    const hours = (Y.hours[y] / 12) * months * u;

    r.cogsEnergy = hours * (Y.elecPrice[y] * Y.elecKwh[y] + Y.heatPrice[y] * Y.heatKwh[y]);
    r.cogsMts = (hours * Y.mts[y] * Y.mtsCost[y]) / 1000;
    r.cogsReactants = (hours * Y.react[y] * Y.reactCost[y]) / 1000;
    r.cogsResidue = (hours * Y.residue[y] * Y.residueCost[y]) / 1000;
    r.cogsWater = (hours * Y.water[y] * Y.waterCost[y]) / 1000;
    // Maintenance: % p.a. of cumulative deployed CAPEX, scaled by utilisation.
    r.cogsMaintenance = (Y.maint[y] * r.capexCumulative * months * u) / 12;

    r.cogs =
      r.cogsEnergy + r.cogsMts + r.cogsReactants + r.cogsResidue + r.cogsWater + r.cogsMaintenance;
    r.grossMargin = r.revenue - r.cogs;
  }

  // ---------- 4. OPEX: personnel and other categories ----------
  // Escalation compounds from year 1, which is the base: a cost quoted in Y1
  // money is unchanged in Y1 and grows at the rate thereafter.
  const opexInf = Number(p.opexInflation) || 0;
  const compInf = Number(p.compensationInflation) || 0;
  const escalate = (rate: number, i: number) => Math.pow(1 + rate, Math.max(0, periods[i].year - 1));

  for (const arch of inputs.personnel) {
    const ftes = extendSeries(arch.ftes, periods, "rate");
    for (let i = 0; i < n; i++) {
      const cost = (Number(arch.annualCost) || 0) * escalate(compInf, i);
      results[i].opexPersonnel += (cost * ftes[i] * periods[i].months) / 12;
    }
  }
  for (const cat of inputs.opex) {
    // Amounts are rescaled by period length, so a monthly run rate carried into
    // an annual period becomes the annual figure.
    const amounts = extendSeries(cat.amounts, periods, "amount");
    for (let i = 0; i < n; i++) {
      // The CAPEX-linked component is not escalated: it already moves with the
      // deployed asset base, so inflating it too would double count.
      let v = amounts[i] * escalate(opexInf, i);
      if (cat.pctOfCapexPerAnnum) {
        v += (cat.pctOfCapexPerAnnum * results[i].capexCumulative * periods[i].months) / 12;
      }
      results[i].opexOther += v;
    }
  }
  for (let i = 0; i < n; i++) {
    const r = results[i];
    r.opexTotal = r.opexPersonnel + r.opexOther;
    r.ebitda = r.grossMargin - r.opexTotal;
    r.ebit = r.ebitda - r.depreciation;
  }

  // ---------- 5. Instruments: interest, grants, financing cash ----------
  const debtBalance = new Array(n).fill(0);
  for (const inst of inputs.instruments) {
    const idx = Math.min(Math.max(Math.round(inst.drawPeriod ?? 0), 0), n - 1);
    if (inst.kind === "debt") {
      const f = buildDebtFlows(inst, periods);
      for (let i = 0; i < n; i++) {
        results[i].debtDraw += f.draw[i];
        results[i].debtRepayment += f.principalRepayment[i];
        results[i].interestExpense += f.interest[i] + f.fees[i];
        debtBalance[i] += f.balance[i];
      }
      // Flag facilities whose maturity falls outside the plan: the residual balance
      // is carried into net debt at exit and depresses the equity terminal value.
      const totalMonths = periods.reduce((a, x) => a + x.months, 0);
      const drawMonth = periods.slice(0, idx).reduce((a, x) => a + x.months, 0);
      const maturityMonth = drawMonth + (inst.tenorMonths ?? 0);
      if (maturityMonth > totalMonths && f.balance[n - 1] > 1) {
        warnings.push(
          `"${inst.label}" matures beyond the plan horizon; ${Math.round(
            f.balance[n - 1]
          ).toLocaleString("en-US")} EUR remains outstanding at exit.`
        );
      }
    } else if (inst.kind === "grant") {
      // Recognised as income below EBITDA when collected, and cash in financing.
      results[idx].grantIncome += Number(inst.amount) || 0;
      results[idx].grantCash += Number(inst.amount) || 0;
    } else {
      results[idx].equityRaise += Number(inst.amount) || 0;
    }
  }
  for (let i = 0; i < n; i++) results[i].debtBalance = debtBalance[i];

  // ---------- 6. Tax with NOL carry-forward ----------
  let nol = 0;
  for (let i = 0; i < n; i++) {
    const r = results[i];
    r.pbt = r.ebit - r.interestExpense + r.grantIncome;
    if (r.pbt <= 0) {
      nol += -r.pbt;
      r.tax = 0;
    } else {
      const offset = Math.min(nol, r.pbt);
      nol -= offset;
      r.tax = (r.pbt - offset) * (Number(p.citr) || 0);
    }
    r.nolBalance = nol;
    r.netIncome = r.pbt - r.tax;
  }

  // ---------- 7. Working capital and cash flow ----------
  // A manual working-capital adjustment is a correction, not a run rate: absence
  // means zero, so this one is not carried forward.
  const otherWc = extendSeries(p.otherWorkingCapital, periods, "none");
  let prevAr = 0;
  let prevAp = 0;
  let cash = Number(p.openingCash) || 0;

  for (let i = 0; i < n; i++) {
    const r = results[i];
    const days = daysInPeriod(periods[i]);
    // Balances implied by DSO/DPO on the period's own run-rate.
    const dailyRevenue = days > 0 ? r.revenue / days : 0;
    const cashCosts = r.cogs + r.opexTotal;
    const dailyCosts = days > 0 ? cashCosts / days : 0;
    r.ar = dailyRevenue * (Number(p.dso) || 0);
    r.ap = dailyCosts * (Number(p.dpo) || 0);

    r.deltaAr = -(r.ar - prevAr); // increase in receivables consumes cash
    r.deltaAp = r.ap - prevAp; // increase in payables releases cash
    r.otherWc = otherWc[i];
    prevAr = r.ar;
    prevAp = r.ap;

    // Indirect method. Grant income is reclassified out of operating into financing,
    // because the grant cash is presented in CFF.
    r.cfo =
      r.netIncome + r.depreciation - r.grantIncome + r.deltaAr + r.deltaAp + r.otherWc;
    r.cfi = -r.capexSpend;
    r.cff = r.debtDraw - r.debtRepayment + r.equityRaise + r.grantCash;
    r.netCashFlow = r.cfo + r.cfi + r.cff;
    r.openingCash = cash;
    cash += r.netCashFlow;
    r.closingCash = cash;
  }

  // ---------- 8. Valuation flows ----------
  // Project (unlevered): EBITDA + grant income - unlevered cash tax - capex - working capital.
  let nolU = 0;
  for (let i = 0; i < n; i++) {
    const r = results[i];
    const pbtU = r.ebit + r.grantIncome; // no interest
    let taxU = 0;
    if (pbtU <= 0) {
      nolU += -pbtU;
    } else {
      const offset = Math.min(nolU, pbtU);
      nolU -= offset;
      taxU = (pbtU - offset) * (Number(p.citr) || 0);
    }
    const wc = r.deltaAr + r.deltaAp + r.otherWc;
    r.projectFcf = r.ebitda + r.grantIncome - taxU - r.capexSpend + wc;
    // Equity (levered): cash available to / required from equity, excluding equity injections.
    r.equityFcf = r.cfo + r.cfi + r.debtDraw - r.debtRepayment + r.grantCash;
  }

  const valuation = computeValuation(inputs, periods, results);

  // ---------- 9. YTD rollups for the monthly years ----------
  const ytd = buildYtd(results, periods);
  const annual = buildAnnual(periods, results);

  if (opsStart >= n) warnings.push("Operations start is beyond the plan horizon; no depreciation booked.");
  const anyRevenue = results.some((r) => r.revenue > 0);
  if (!anyRevenue) warnings.push("No revenue in the plan: check capacity utilisation inputs.");
  const minCash = Math.min(...results.map((r) => r.closingCash));
  if (minCash < 0) {
    warnings.push(`Cash goes negative (low point ${Math.round(minCash).toLocaleString("en-US")} EUR): funding gap.`);
  }

  return { periods, results, ytd, annual, valuation, warnings, capexByConcept: conceptSpend };
}

function computeValuation(
  inputs: ScenarioInputs,
  periods: Period[],
  results: PeriodResult[]
): ValuationResult {
  const p = inputs.parameters;
  const n = periods.length;
  const last = n - 1;

  // Final-year EBITDA: the last annual period (or last 12 monthly periods if horizon is monthly only).
  const finalEbitda = periods[last].monthly
    ? results.slice(Math.max(0, n - 12)).reduce((a, r) => a + r.ebitda, 0)
    : results[last].ebitda;

  const terminalValueEnterprise = Math.max(0, finalEbitda) * (Number(p.exitMultiple) || 0);
  const netDebtAtExit = results[last].debtBalance - results[last].closingCash;
  const terminalValueEquity = terminalValueEnterprise - netDebtAtExit;

  const years = periods.map((x) => x.yearsAtEnd);
  const projectFlows = results.map((r) => r.projectFcf);
  const equityFlows = results.map((r) => r.equityFcf);

  const projectWithTv = projectFlows.slice();
  projectWithTv[last] += terminalValueEnterprise;
  const equityWithTv = equityFlows.slice();
  equityWithTv[last] += terminalValueEquity;

  return {
    terminalValueEnterprise,
    terminalValueEquity,
    netDebtAtExit,
    projectIrr: irr(projectWithTv, years),
    projectNpv: npv(Number(p.wacc) || 0, projectWithTv, years),
    equityIrr: irr(equityWithTv, years),
    equityNpv: npv(Number(p.costOfEquity) || 0, equityWithTv, years),
  };
}

/** Cumulative year-to-date within each monthly plan year. Annual periods are returned as-is. */
function buildYtd(results: PeriodResult[], periods: Period[]): PeriodResult[] {
  const out: PeriodResult[] = [];
  const flowKeys: (keyof PeriodResult)[] = [
    "tons", "revenue", "cogsEnergy", "cogsMts", "cogsReactants", "cogsResidue", "cogsWater",
    "cogsMaintenance", "cogs", "grossMargin", "opexPersonnel", "opexOther", "opexTotal", "ebitda",
    "depreciation", "ebit", "interestExpense", "grantIncome", "pbt", "tax", "netIncome",
    "deltaAr", "deltaAp", "otherWc", "cfo", "capexSpend", "cfi", "debtDraw", "debtRepayment",
    "equityRaise", "grantCash", "cff", "netCashFlow", "projectFcf", "equityFcf",
  ];

  let acc = emptyResult();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const startOfYear = periods[i].monthly && i % 12 === 0;
    if (startOfYear) acc = emptyResult();

    if (periods[i].monthly) {
      for (const k of flowKeys) (acc[k] as number) += r[k] as number;
      // Point-in-time values take the current period's value.
      acc.utilisation = r.utilisation;
      acc.openingCash = periods[i].monthly && i % 12 === 0 ? r.openingCash : acc.openingCash;
      acc.closingCash = r.closingCash;
      acc.capexCumulative = r.capexCumulative;
      acc.debtBalance = r.debtBalance;
      acc.nolBalance = r.nolBalance;
      acc.ar = r.ar;
      acc.ap = r.ap;
      out.push({ ...acc });
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function buildAnnual(periods: Period[], results: PeriodResult[]): AnnualSummaryRow[] {
  const byYear = new Map<number, AnnualSummaryRow>();
  for (let i = 0; i < periods.length; i++) {
    const y = periods[i].year;
    const r = results[i];
    let row = byYear.get(y);
    if (!row) {
      row = {
        year: y, label: `Y${y}`,
        revenue: 0, cogs: 0, grossMargin: 0, opexTotal: 0, ebitda: 0, depreciation: 0, ebit: 0,
        interestExpense: 0, grantIncome: 0, pbt: 0, tax: 0, netIncome: 0,
        cfo: 0, cfi: 0, cff: 0, netCashFlow: 0, closingCash: 0,
      };
      byYear.set(y, row);
    }
    row.revenue += r.revenue;
    row.cogs += r.cogs;
    row.grossMargin += r.grossMargin;
    row.opexTotal += r.opexTotal;
    row.ebitda += r.ebitda;
    row.depreciation += r.depreciation;
    row.ebit += r.ebit;
    row.interestExpense += r.interestExpense;
    row.grantIncome += r.grantIncome;
    row.pbt += r.pbt;
    row.tax += r.tax;
    row.netIncome += r.netIncome;
    row.cfo += r.cfo;
    row.cfi += r.cfi;
    row.cff += r.cff;
    row.netCashFlow += r.netCashFlow;
    row.closingCash = r.closingCash; // year-end
  }
  return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
}

export { PERIOD_COUNT, MONTHLY_PERIODS };
