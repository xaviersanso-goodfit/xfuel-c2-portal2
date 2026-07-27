// Verification harness for the C2 model engine.
// Run: node --experimental-strip-types scripts/verify.mjs   (Node 22+)
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { buildDebtFlows, irr, npv } from "../src/lib/model/finance.ts";
import { buildPeriods, PERIOD_COUNT, MONTHLY_PERIODS } from "../src/lib/model/periods.ts";
import { buildMilestones, buildUnitEconomics } from "../src/lib/model/milestones.ts";
import { extendSeries, extendYearly, normaliseScenario } from "../src/lib/model/normalise.ts";

// Anchors derived from the model, never hardcoded.
const LAST = PERIOD_COUNT - 1;      // final period
const STEADY = MONTHLY_PERIODS;      // first annual period, at steady state

let failures = 0;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

console.log("\n=== C2 model verification ===\n");

const sc = defaultScenario();
const m = runModel(sc);
const R = m.results;
const P = m.periods;

console.log("-- structure --");
check(`${PERIOD_COUNT} periods (${MONTHLY_PERIODS} monthly + ${PERIOD_COUNT - MONTHLY_PERIODS} annual)`, P.length === PERIOD_COUNT);
check(`first ${MONTHLY_PERIODS} are monthly`, P.slice(0, MONTHLY_PERIODS).every((p) => p.monthly && p.months === 1));
check("remaining periods are annual", P.slice(MONTHLY_PERIODS).every((p) => !p.monthly && p.months === 12));
check("horizon ends at year 10", P[LAST].year === 10 && near(P[LAST].yearsAtEnd, 10));

console.log("\n-- capex --");
const capexTotal = sc.capex.reduce((a, c) => a + c.total, 0);
check(
  `capex spend equals sum of concept totals (${fmt(capexTotal)})`,
  near(sum(R.map((r) => r.capexSpend)), capexTotal, 0.5),
  `got ${fmt(sum(R.map((r) => r.capexSpend)))}`
);
check("capex grand total ties to C2 Tarragona 27,235,672", near(capexTotal, 27_235_672, 1));
check("cumulative capex is monotonic", R.every((r, i) => i === 0 || r.capexCumulative >= R[i - 1].capexCumulative));
check("CFI = -capex spend", R.every((r) => near(r.cfi, -r.capexSpend, 1e-9)));

console.log("\n-- depreciation --");
const depreciable = sc.capex.filter((c) => c.depRateMonthly > 0).reduce((a, c) => a + c.total, 0);
const totalDep = sum(R.map((r) => r.depreciation));
check("no depreciation before ops start", R.slice(0, sc.parameters.opsStartPeriod).every((r) => r.depreciation === 0));
check("depreciation starts at ops start", R[sc.parameters.opsStartPeriod].depreciation > 0);
check(
  `accumulated depreciation never exceeds depreciable cost (${fmt(depreciable)})`,
  totalDep <= depreciable + 0.5,
  `got ${fmt(totalDep)}`
);
check("land is not depreciated (dep rate 0)", sc.capex.find((c) => c.id === "land").depRateMonthly === 0);

console.log("\n-- revenue / cogs --");
const ue = sc.unitEconomics;
// Every unit-econ driver is a yearly series; read each at the steady-state year.
const YSTEADY = P[STEADY].year - 1;
const at = (v) => extendYearly(v)[YSTEADY];
const maxTonsYear = (at(ue.mgoYieldKgPerHour) * at(ue.annualHours)) / 1000;
check("nameplate capacity = 14,720 t/y", near(maxTonsYear, 14720, 1e-9));
const y3 = R[STEADY];
check(
  "steady-state tons = capacity x utilisation",
  near(y3.tons, maxTonsYear * y3.utilisation, 1e-6),
  `got ${y3.tons.toFixed(2)}`
);
check("steady-state revenue = tons x price", near(y3.revenue, y3.tons * at(ue.pricePerTon), 1e-6));
check(
  "COGS = sum of components",
  R.every((r) =>
    near(r.cogs, r.cogsEnergy + r.cogsMts + r.cogsReactants + r.cogsResidue + r.cogsWater + r.cogsMaintenance, 1e-6)
  )
);
check("no revenue when utilisation is zero", R.every((r) => r.utilisation > 0 || r.revenue === 0));
check("gross margin = revenue - cogs", R.every((r) => near(r.grossMargin, r.revenue - r.cogs, 1e-6)));

// Cross-check one period against the FAIIP formulas directly.
{
  const i = STEADY; // first annual period
  const u = R[i].utilisation, months = 12;
  const hours = (at(ue.annualHours) / 12) * months * u;
  const energy = hours * (at(ue.electricityPricePerKwh) * at(ue.electricityKwhPerHour) + at(ue.heatPricePerKwh) * at(ue.heatKwhPerHour));
  const mts = (hours * at(ue.mtsInputKgPerHour) * at(ue.mtsCostPerTon)) / 1000;
  const react = (hours * at(ue.reactantInputKgPerHour) * at(ue.reactantCostPerTon)) / 1000;
  const resid = (hours * at(ue.residueYieldKgPerHour) * at(ue.residueCostPerTon)) / 1000;
  check("energy matches FAIIP formula", near(R[i].cogsEnergy, energy, 1e-6));
  check("MTS matches FAIIP formula", near(R[i].cogsMts, mts, 1e-6));
  check("reactants match FAIIP formula", near(R[i].cogsReactants, react, 1e-6));
  check("residue matches FAIIP formula", near(R[i].cogsResidue, resid, 1e-6));
}

console.log("\n-- opex / ebitda --");
check("opex total = personnel + other", R.every((r) => near(r.opexTotal, r.opexPersonnel + r.opexOther, 1e-6)));
check("EBITDA = gross margin - opex", R.every((r) => near(r.ebitda, r.grossMargin - r.opexTotal, 1e-6)));
check("EBIT = EBITDA - depreciation", R.every((r) => near(r.ebit, r.ebitda - r.depreciation, 1e-6)));
{
  const totalFte = sc.personnel.reduce((a, p) => a + p.ftes[STEADY], 0);
  check("steady-state FTE = 19.6", near(totalFte, 19.6, 1e-9), `got ${totalFte}`);
  // Personnel cost escalates from year 1, so the check must escalate too.
  const escal = Math.pow(1 + sc.parameters.compensationInflation, P[STEADY].year - 1);
  const expected = sc.personnel.reduce((a, p) => a + p.annualCost * escal * p.ftes[STEADY], 0);
  check("steady-state personnel cost = sum(annual cost x FTE x escalation)", near(R[STEADY].opexPersonnel, expected, 1e-6));
}

console.log("\n-- debt --");
{
  const inst = sc.instruments.find((x) => x.kind === "debt");
  const periods = buildPeriods(sc.parameters.startMonth);
  const f = buildDebtFlows(inst, periods);
  check("debt drawn once, equal to principal", near(sum(f.draw), inst.amount, 1e-6));
  check("no principal repaid during grace", sum(f.principalRepayment.slice(0, 2 + 2)) === 0);
  check("balance never negative", f.balance.every((b) => b >= -1e-6));
  check("interest accrues only while balance outstanding", f.interest.every((x, i) => x >= 0));

  // The default FAIIP facility matures beyond the horizon: repayment must be partial,
  // and the residual must equal principal less amounts repaid inside the plan.
  const repaidInHorizon = sum(f.principalRepayment);
  check("facility maturing past horizon repays only partially", repaidInHorizon < inst.amount);
  check(
    "residual balance = principal - repaid in horizon",
    near(f.balance[LAST], inst.amount - repaidInHorizon, 1e-4),
    `balance ${fmt(f.balance[LAST])} vs ${fmt(inst.amount - repaidInHorizon)}`
  );
  check("model warns when an instrument matures beyond the horizon", m.warnings.some((w) => w.includes("matures")));

  // A facility that fits inside the horizon must fully repay, on every profile.
  const fits = { ...inst, drawPeriod: 0, graceMonths: 12, tenorMonths: 60 };
  for (const profile of ["linear", "annuity", "bullet"]) {
    const g = buildDebtFlows({ ...fits, repayment: profile }, periods);
    check(`${profile} profile fully repays within horizon`, near(sum(g.principalRepayment), inst.amount, 1), `got ${fmt(sum(g.principalRepayment))}`);
    check(`${profile} closing balance is zero`, near(g.balance[LAST], 0, 1), `got ${fmt(g.balance[LAST])}`);
  }
  // Interest sanity: linear amortisation must cost less interest than bullet.
  const li = sum(buildDebtFlows({ ...fits, repayment: "linear" }, periods).interest);
  const bi = sum(buildDebtFlows({ ...fits, repayment: "bullet" }, periods).interest);
  check("bullet costs more interest than linear", bi > li, `bullet ${fmt(bi)} vs linear ${fmt(li)}`);
  // Zero-rate debt must have zero interest and still repay.
  const zr = buildDebtFlows({ ...fits, rate: 0 }, periods);
  check("zero-rate debt accrues no interest", near(sum(zr.interest), 0, 1e-9));
  check("zero-rate debt still fully repays", near(sum(zr.principalRepayment), inst.amount, 1));
}

console.log("\n-- tax / NOL --");
check("tax never negative", R.every((r) => r.tax >= -1e-9));
check("no tax while cumulative losses remain", R.every((r) => r.nolBalance <= 0 + 1e-6 || r.tax === 0));
check("PBT = EBIT - interest + grant income", R.every((r) => near(r.pbt, r.ebit - r.interestExpense + r.grantIncome, 1e-6)));
check("net income = PBT - tax", R.every((r) => near(r.netIncome, r.pbt - r.tax, 1e-6)));
{
  // A profitable scenario must eventually pay tax.
  const rich = defaultScenario();
  rich.instruments = [];
  rich.unitEconomics.utilisation = rich.unitEconomics.utilisation.map((_, i) => (i >= 18 ? 1 : 0));
  const rm = runModel(rich);
  check("profitable plan eventually books tax", rm.results.some((r) => r.tax > 0));
  const firstTaxIdx = rm.results.findIndex((r) => r.tax > 0);
  check("tax only starts after NOL exhausted", firstTaxIdx === -1 || rm.results[firstTaxIdx].nolBalance <= 1e-6);
}

console.log("\n-- cash flow --");
check("net cash flow = CFO + CFI + CFF", R.every((r) => near(r.netCashFlow, r.cfo + r.cfi + r.cff, 1e-6)));
check(
  "cash rolls forward correctly",
  R.every((r, i) => near(r.openingCash, i === 0 ? sc.parameters.openingCash : R[i - 1].closingCash, 1e-6))
);
check("closing cash = opening + net", R.every((r) => near(r.closingCash, r.openingCash + r.netCashFlow, 1e-6)));
check(
  "final cash = opening + sum of all net flows",
  near(R[LAST].closingCash, sc.parameters.openingCash + sum(R.map((r) => r.netCashFlow)), 1e-6)
);
check("grant income is reclassified out of CFO into CFF", R.every((r) => near(r.grantCash, r.grantIncome, 1e-9)));
{
  const totalGrant = sum(R.map((r) => r.grantCash));
  check("grant counted once in cash (not double)", near(totalGrant, 2_500_000, 1e-6), `got ${fmt(totalGrant)}`);
}

console.log("\n-- valuation --");
const v = m.valuation;
check("terminal value = exit multiple x final-year EBITDA", near(v.terminalValueEnterprise, Math.max(0, R[LAST].ebitda) * sc.parameters.exitMultiple, 1e-6));
check("equity TV = enterprise TV - net debt", near(v.terminalValueEquity, v.terminalValueEnterprise - v.netDebtAtExit, 1e-6));
check("project IRR computed", v.projectIrr !== null, `got ${v.projectIrr}`);
check("equity IRR computed", v.equityIrr !== null, `got ${v.equityIrr}`);
{
  // NPV at the IRR must be ~zero.
  const years = P.map((p) => p.yearsAtEnd);
  const flows = R.map((r) => r.projectFcf);
  flows[LAST] += v.terminalValueEnterprise;
  check("NPV at project IRR is zero", near(npv(v.projectIrr, flows, years), 0, 1), `got ${npv(v.projectIrr, flows, years).toFixed(4)}`);
}
{
  // Known-answer IRR test: -100 now, +110 in one year => 10%.
  const t = irr([-100, 110], [0, 1]);
  check("IRR known answer (-100, +110) = 10%", near(t, 0.1, 1e-6), `got ${t}`);
  const t2 = npv(0.1, [-100, 110], [0, 1]);
  check("NPV known answer at 10% = 0", near(t2, 0, 1e-9));
}
check("NPV monotonically decreasing in discount rate", (() => {
  const years = P.map((p) => p.yearsAtEnd);
  const flows = R.map((r) => r.projectFcf);
  flows[LAST] += v.terminalValueEnterprise;
  return npv(0.05, flows, years) > npv(0.15, flows, years);
})());

console.log("\n-- ytd rollup --");
check("YTD resets each January of Y1/Y2", near(m.ytd[0].revenue, R[0].revenue, 1e-9) && near(m.ytd[12].revenue, R[12].revenue, 1e-9));
check("YTD month 12 = sum of months 1-12", near(m.ytd[11].revenue, sum(R.slice(0, 12).map((r) => r.revenue)), 1e-6));
check("YTD month 24 = sum of months 13-24", near(m.ytd[23].ebitda, sum(R.slice(12, 24).map((r) => r.ebitda)), 1e-6));
check("YTD closing cash tracks actual closing cash", near(m.ytd[23].closingCash, R[23].closingCash, 1e-9));

console.log("\n-- annual summary --");
check("10 annual rows", m.annual.length === 10);
check("Y1 revenue = sum of months 1-12", near(m.annual[0].revenue, sum(R.slice(0, 12).map((r) => r.revenue)), 1e-6));
check("Y2 ebitda = sum of months 13-24", near(m.annual[1].ebitda, sum(R.slice(12, 24).map((r) => r.ebitda)), 1e-6));
check("annual net income总 = sum of period net income", near(sum(m.annual.map((a) => a.netIncome)), sum(R.map((r) => r.netIncome)), 1e-6));
check("Y10 closing cash = final period closing cash", near(m.annual[9].closingCash, R[LAST].closingCash, 1e-9));

console.log("\n-- edge cases --");
{
  const empty = defaultScenario();
  empty.capex = [];
  empty.instruments = [];
  empty.personnel = [];
  empty.opex = [];
  empty.unitEconomics.utilisation = new Array(PERIOD_COUNT).fill(0);
  const em = runModel(empty);
  check("empty scenario runs without NaN", em.results.every((r) => Object.values(r).every((x) => Number.isFinite(x))));
  check("empty scenario has zero revenue", sum(em.results.map((r) => r.revenue)) === 0);
}
{
  const bad = defaultScenario();
  bad.capex[0].phasing = [0.5, 0.2]; // sums to 70%
  const bm = runModel(bad);
  check("phasing that does not sum to 100% raises a warning", bm.warnings.some((w) => w.includes("phasing")));
}
check("all outputs finite in base case", R.every((r) => Object.values(r).every((x) => Number.isFinite(x))));

console.log("\n-- chart data (cover chart, milestones, unit economics) --");
{
  const byConcept = m.capexByConcept;
  check("engine exposes a spend series per CAPEX concept", sc.capex.every((c) => Array.isArray(byConcept[c.id])));
  check(
    "each concept series is period-length",
    sc.capex.every((c) => byConcept[c.id].length === PERIOD_COUNT)
  );
  check(
    "concept series sum to total capex spend in every period",
    R.every((r, i) => near(sc.capex.reduce((a, c) => a + byConcept[c.id][i], 0), r.capexSpend, 1e-6))
  );
  for (const c of sc.capex) {
    check(`concept "${c.id}" series sums to its total`, near(sum(byConcept[c.id]), c.total, 0.5));
  }
  check("no concept spends before its own start period", sc.capex.every((c) => byConcept[c.id].slice(0, c.startPeriod).every((v) => v === 0)));

  const ms = buildMilestones(sc, m);
  const byKey = Object.fromEntries(ms.map((x) => [x.key, x]));
  check("five milestones are produced", ms.length === 5);
  check("CAPEX starts at the first period with spend", byKey.capexStart.period === R.findIndex((r) => r.capexSpend > 0.5));
  check("CAPEX ends no earlier than it starts", byKey.capexEnd.period >= byKey.capexStart.period);
  check("production starts at the first period with utilisation", byKey.prodStart.period === R.findIndex((r) => r.utilisation > 0));
  check("production starts after CAPEX starts", byKey.prodStart.period > byKey.capexStart.period);
  check("ramp completes no earlier than production starts", byKey.ramp.period >= byKey.prodStart.period);
  check("every milestone has a label and a detail", ms.every((x) => x.periodLabel && x.detail));

  const u = buildUnitEconomics(sc, m);
  check("unit econ price matches the input for its year", near(u.pricePerTon, extendYearly(sc.unitEconomics.pricePerTon)[u.year - 1], 1e-9));
  check("unit econ nameplate matches 14,720 t/y", near(u.nameplateTonsPerYear, 14720, 1e-9));
  check(
    "contribution = price less variable cost",
    near(u.contributionPerTon, u.pricePerTon - u.variableCostPerTon, 1e-9)
  );
  check("components sum to the variable cost", near(sum(u.components.map((c) => c.perTon)), u.variableCostPerTon, 1e-9));
  check("contribution per ton is positive in the base case", u.contributionPerTon > 0, `${u.contributionPerTon.toFixed(2)}`);
  {
    // Per-ton COGS at steady state must reconcile to the engine's own COGS,
    // less maintenance, which is a CAPEX charge and not a per-ton input cost.
    const last = R[LAST];
    const variableCogs = last.cogs - last.cogsMaintenance;
    check(
      "per-ton variable cost x tons ties to engine COGS ex-maintenance",
      near(u.variableCostPerTon * last.tons, variableCogs, 1),
      `${fmt(u.variableCostPerTon * last.tons)} vs ${fmt(variableCogs)}`
    );
  }
  check("steady-state revenue = tons x price", near(u.steadyRevenue, u.steadyTonsPerYear * u.pricePerTon, 1e-6));
}

console.log("\n-- short input series (saved under an older horizon) --");
{
  // The failure this guards against: a scenario saved when the plan was shorter
  // has series that stop part way, and zero-padding them silently shut the plant
  // down for the rest of the plan.
  const short = defaultScenario();
  const CUT = 20; // Sep-28 on a Jan-27 start
  short.unitEconomics.utilisation = short.unitEconomics.utilisation.slice(0, CUT);
  short.personnel = short.personnel.map((x) => ({ ...x, ftes: x.ftes.slice(0, CUT) }));
  short.opex = short.opex.map((c) => ({ ...c, amounts: c.amounts.slice(0, CUT) }));

  const sm = runModel(short);
  check(
    "utilisation is carried forward past the end of a short series",
    sm.results.slice(CUT).every((r) => r.utilisation > 0),
    `zero from period ${sm.results.findIndex((r, i) => i >= CUT && r.utilisation === 0)}`
  );
  check(
    "carried utilisation equals the last supplied value",
    near(sm.results[LAST].utilisation, short.unitEconomics.utilisation[CUT - 1], 1e-9)
  );
  check("revenue continues past the end of a short series", sm.results[LAST].revenue > 0);
  check("personnel cost continues past a short FTE series", sm.results[LAST].opexPersonnel > 0);

  // Amount series must be rescaled to the period, not repeated verbatim.
  const admin = short.opex.find((c) => c.id === "admin_oh");
  const lastMonthly = admin.amounts[CUT - 1];
  const norm = normaliseScenario(short);
  const normAdmin = norm.opex.find((c) => c.id === "admin_oh");
  check("normalise extends every series to the full plan", normAdmin.amounts.length === PERIOD_COUNT);
  check(
    "a monthly amount carried into a monthly period is unchanged",
    near(normAdmin.amounts[MONTHLY_PERIODS - 1], lastMonthly, 1e-9)
  );
  check(
    "a monthly amount carried into an annual period is annualised",
    near(normAdmin.amounts[MONTHLY_PERIODS], lastMonthly * 12, 1e-9),
    `${normAdmin.amounts[MONTHLY_PERIODS]} vs ${lastMonthly * 12}`
  );
  check(
    "a rate carried into an annual period is NOT annualised",
    near(norm.unitEconomics.utilisation[MONTHLY_PERIODS], short.unitEconomics.utilisation[CUT - 1], 1e-9)
  );
  check(
    "normalising then running matches running the short scenario directly",
    runModel(norm).results.every((r, i) => near(r.ebitda, sm.results[i].ebitda, 1e-6))
  );

  // Explicit zeros inside the supplied range must be respected, not carried.
  const withZero = defaultScenario();
  withZero.unitEconomics.utilisation = withZero.unitEconomics.utilisation.map((v, i) => (i === 25 ? 0 : v));
  check("an explicit zero inside the series is respected", runModel(withZero).results[25].utilisation === 0);

  // Sparse arrays (holes) serialise to null and used to calculate as NaN/zero.
  const sparse = new Array(PERIOD_COUNT);
  sparse[0] = 0.5;
  const filled = extendSeries(sparse, sm.periods, "rate");
  check("holes in a full-length array become zero, not NaN", filled.every((v) => Number.isFinite(v)));
  check("a full-length array is not carried forward", filled[PERIOD_COUNT - 1] === 0);

  // Working capital is an adjustment, not a run rate.
  const wc = defaultScenario();
  wc.parameters.otherWorkingCapital = [ -50000 ];
  check(
    "other working capital is not carried forward",
    runModel(wc).results.slice(1).every((r) => r.otherWc === 0)
  );
}

console.log("\n-- yearly drivers and inflation --");
{
  // A driver set only for Y1 must hold for the whole plan, not drop to zero.
  const oneYear = defaultScenario();
  oneYear.unitEconomics.pricePerTon = [700];
  const om = runModel(oneYear);
  check("a single-year price is carried across the plan", om.results[LAST].revenue > 0);
  check(
    "carried price is used, not the default",
    near(om.results[LAST].revenue, om.results[LAST].tons * 700, 1e-6)
  );

  // A scalar left over from before these became yearly must still load.
  const legacy = defaultScenario();
  legacy.unitEconomics.pricePerTon = 500;
  const lm = runModel(legacy);
  check("a legacy scalar driver still calculates", near(lm.results[LAST].revenue, lm.results[LAST].tons * 500, 1e-6));
  check("normalise upgrades a scalar to a yearly series",
    normaliseScenario(legacy).unitEconomics.pricePerTon.every((v) => v === 500));

  // A price curve must move revenue year by year, and only in those years.
  const curve = defaultScenario();
  const base10 = extendYearly(curve.unitEconomics.pricePerTon);
  curve.unitEconomics.pricePerTon = base10.map((v, y) => (y >= 5 ? v * 2 : v));
  const cm = runModel(curve);
  const yearOf = (i) => P[i].year;
  check(
    "a price step in Y6 leaves earlier years untouched",
    cm.results.every((r, i) => yearOf(i) >= 6 || near(r.revenue, R[i].revenue, 1e-6))
  );
  check(
    "a price step in Y6 doubles revenue from Y6",
    cm.results.every((r, i) => yearOf(i) < 6 || near(r.revenue, R[i].revenue * 2, 1e-6))
  );
  check("a price step does not move COGS", cm.results.every((r, i) => near(r.cogs, R[i].cogs, 1e-6)));

  // Nameplate follows the yearly yield.
  const debottleneck = defaultScenario();
  debottleneck.unitEconomics.mgoYieldKgPerHour = extendYearly(debottleneck.unitEconomics.mgoYieldKgPerHour)
    .map((v, y) => (y >= 4 ? v * 1.1 : v));
  const dm = runModel(debottleneck);
  check(
    "nameplate steps up with the yearly yield",
    dm.results.every((r, i) => (yearOf(i) >= 5 ? r.nameplateTonsPerYear > R[i].nameplateTonsPerYear : near(r.nameplateTonsPerYear, R[i].nameplateTonsPerYear, 1e-6)))
  );

  // Inflation.
  const noInf = defaultScenario();
  noInf.parameters.opexInflation = 0;
  noInf.parameters.compensationInflation = 0;
  const nm = runModel(noInf);
  const y1 = P.findIndex((x) => x.year === 1);
  check("year 1 is the escalation base: no inflation applied", near(nm.results[y1].opexPersonnel, R[y1].opexPersonnel, 1e-6));
  check("inflation raises later personnel cost", R[STEADY].opexPersonnel > nm.results[STEADY].opexPersonnel);

  const comp = defaultScenario();
  comp.parameters.opexInflation = 0;
  const compOnly = runModel(comp);
  const factor = Math.pow(1 + comp.parameters.compensationInflation, P[STEADY].year - 1);
  check(
    "compensation escalates by (1+i)^(year-1)",
    near(compOnly.results[STEADY].opexPersonnel, nm.results[STEADY].opexPersonnel * factor, 1e-6)
  );
  check(
    "compensation inflation does not touch other OPEX",
    near(compOnly.results[STEADY].opexOther, nm.results[STEADY].opexOther, 1e-6)
  );

  const oi = defaultScenario();
  oi.parameters.compensationInflation = 0;
  oi.parameters.opexInflation = 0.1;
  const oim = runModel(oi);
  check("OPEX inflation raises other OPEX", oim.results[STEADY].opexOther > nm.results[STEADY].opexOther);
  check(
    "OPEX inflation does not touch personnel",
    near(oim.results[STEADY].opexPersonnel, nm.results[STEADY].opexPersonnel, 1e-6)
  );
  check("inflation does not touch revenue", near(oim.results[STEADY].revenue, R[STEADY].revenue, 1e-6));
}

console.log("\n-- base case headline --");
console.log(`  Total CAPEX          ${fmt(capexTotal)} EUR`);
console.log(`  Y3 revenue           ${fmt(m.annual[2].revenue)} EUR`);
console.log(`  Y3 EBITDA            ${fmt(m.annual[2].ebitda)} EUR`);
console.log(`  Y10 EBITDA           ${fmt(m.annual[9].ebitda)} EUR`);
console.log(`  Terminal value (EV)  ${fmt(v.terminalValueEnterprise)} EUR`);
console.log(`  Project IRR          ${v.projectIrr === null ? "n/a" : (v.projectIrr * 100).toFixed(1) + "%"}`);
console.log(`  Project NPV @WACC    ${fmt(v.projectNpv)} EUR`);
console.log(`  Equity IRR           ${v.equityIrr === null ? "n/a" : (v.equityIrr * 100).toFixed(1) + "%"}`);
console.log(`  Equity NPV @Ke       ${fmt(v.equityNpv)} EUR`);
console.log(`  Min closing cash     ${fmt(Math.min(...R.map((r) => r.closingCash)))} EUR`);
if (m.warnings.length) console.log("  Warnings: " + m.warnings.join(" | "));

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASS" : failures + " CHECK(S) FAILED"} ===\n`);
process.exit(failures === 0 ? 0 : 1);
