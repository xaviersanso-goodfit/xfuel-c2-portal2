// Input -> output wiring tests.
//
// Identity checks (EBITDA = GM - OPEX) pass even when an input is never read.
// These tests perturb EVERY input field and assert that the outputs which SHOULD
// move do move, and that outputs which should NOT move stay put.
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { PERIOD_COUNT, MONTHLY_PERIODS } from "../src/lib/model/periods.ts";
import { BASIS_USES } from "../src/lib/model/components.ts";
const LAST = PERIOD_COUNT - 1;
const STEADY = MONTHLY_PERIODS;

// Unit-economics drivers are yearly series. Scale every year at once, which is
// the equivalent of the old scalar bump.
const scaleAll = (u, key, k) => (u[key] = u[key].map((v) => v * k));
const setAll = (u, key, v) => (u[key] = u[key].map(() => v));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const series = (m, key) => m.results.map((r) => r[key]);
const total = (m, key) => sum(series(m, key));
const changed = (a, b, tol = 0.01) => Math.abs(a - b) > tol;
const same = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const BASE_INPUTS = defaultScenario();
const BASE = runModel(BASE_INPUTS);

/** Apply a mutation to a deep copy of the base scenario and run the model. */
function perturb(mutate) {
  const s = clone(BASE_INPUTS);
  mutate(s);
  return runModel(s);
}

/**
 * Assert that changing an input moves the expected outputs and leaves others alone.
 *   moves:   list of PeriodResult keys whose TOTAL must change
 *   steady:  list of keys whose TOTAL must NOT change
 */
function wired(name, mutate, moves, steady = []) {
  const m = perturb(mutate);
  const badMove = moves.filter((k) => !changed(total(m, k), total(BASE, k)));
  const badSteady = steady.filter((k) => !same(total(m, k), total(BASE, k), 0.01));
  check(
    name,
    badMove.length === 0 && badSteady.length === 0,
    badMove.length ? `did not move: ${badMove.join(", ")}` : `unexpectedly moved: ${badSteady.join(", ")}`
  );
}

console.log("\n=== Input -> output wiring ===\n");

console.log("-- global parameters --");
{
  const m = perturb((s) => (s.parameters.startMonth = "2030-06"));
  check("startMonth changes the period labels", m.periods[0].label !== BASE.periods[0].label, `${m.periods[0].label}`);
}
{
  const later = perturb((s) => (s.parameters.opsStartPeriod = 22));
  const firstDepBase = BASE.results.findIndex((r) => r.depreciation > 0);
  const firstDepLater = later.results.findIndex((r) => r.depreciation > 0);
  check("opsStartPeriod shifts when depreciation begins", firstDepLater > firstDepBase, `${firstDepBase} -> ${firstDepLater}`);
}
wired("citr moves tax and net income", (s) => (s.parameters.citr = 0.5), ["tax", "netIncome"], ["ebitda", "revenue"]);
wired("dso moves receivables and CFO", (s) => (s.parameters.dso = 120), ["deltaAr", "cfo"], ["ebitda", "netIncome"]);
wired("dpo moves payables and CFO", (s) => (s.parameters.dpo = 5), ["deltaAp", "cfo"], ["ebitda", "netIncome"]);
wired(
  "otherWorkingCapital moves CFO",
  (s) => (s.parameters.otherWorkingCapital = s.parameters.otherWorkingCapital.map(() => -50000)),
  ["otherWc", "cfo"],
  ["ebitda"]
);
{
  const m = perturb((s) => (s.parameters.openingCash = 5_000_000));
  check(
    "openingCash shifts closing cash by the same amount",
    Math.abs(m.results[LAST].closingCash - BASE.results[LAST].closingCash - 5_000_000) < 0.01
  );
}
{
  const m = perturb((s) => (s.parameters.wacc = 0.2));
  check("wacc moves project NPV", changed(m.valuation.projectNpv, BASE.valuation.projectNpv));
  check("wacc does NOT move project IRR", same(m.valuation.projectIrr, BASE.valuation.projectIrr, 1e-9));
  check("wacc does NOT move equity NPV", same(m.valuation.equityNpv, BASE.valuation.equityNpv, 0.01));
}
{
  const m = perturb((s) => (s.parameters.costOfEquity = 0.3));
  check("costOfEquity moves equity NPV", changed(m.valuation.equityNpv, BASE.valuation.equityNpv));
  check("costOfEquity does NOT move project NPV", same(m.valuation.projectNpv, BASE.valuation.projectNpv, 0.01));
  check("costOfEquity does NOT move equity IRR", same(m.valuation.equityIrr, BASE.valuation.equityIrr, 1e-9));
}
{
  const m = perturb((s) => (s.parameters.exitMultiple = 16));
  check("exitMultiple moves terminal value", changed(m.valuation.terminalValueEnterprise, BASE.valuation.terminalValueEnterprise));
  check("exitMultiple raises project IRR", (m.valuation.projectIrr ?? -9) > (BASE.valuation.projectIrr ?? -9));
  check("exitMultiple raises equity IRR", (m.valuation.equityIrr ?? -9) > (BASE.valuation.equityIrr ?? -9));
  check("exitMultiple does NOT change EBITDA", same(total(m, "ebitda"), total(BASE, "ebitda"), 0.01));
}

console.log("\n-- capex (each concept independently) --");
for (const line of BASE_INPUTS.capex) {
  const i = BASE_INPUTS.capex.findIndex((l) => l.id === line.id);
  wired(
    `capex[${line.id}].total moves spend and CFI`,
    (s) => (s.capex[i].total = s.capex[i].total * 1.5),
    ["capexSpend", "cfi"],
    []
  );
  if (line.depRateMonthly > 0) {
    wired(
      `capex[${line.id}].depRateMonthly moves depreciation only`,
      (s) => (s.capex[i].depRateMonthly = s.capex[i].depRateMonthly * 2),
      [],
      ["ebitda", "revenue", "capexSpend"]
    );
    {
      // Over 20 years the asset fully depreciates on either rate, so the total
      // is unchanged by construction. A faster rate must front-load the charge.
      const fast = perturb((s) => (s.capex[i].depRateMonthly = s.capex[i].depRateMonthly * 2));
      const early = (m) => sum(m.results.slice(0, MONTHLY_PERIODS).map((r) => r.depreciation));
      check(`capex[${line.id}] faster depreciation front-loads the charge`, early(fast) > early(BASE));
    }
  } else {
    const m = perturb((s) => (s.capex[i].depRateMonthly = 0.01));
    check(`capex[${line.id}] is land: raising its rate would depreciate it`, changed(total(m, "depreciation"), total(BASE, "depreciation")));
  }
  {
    // Shifting the start later must move spend out of the original month into a
    // later one, without changing the total. Measuring cumulative at a fixed
    // period is not valid for a single-payment concept such as land, so compare
    // the concept's own spend profile instead.
    const SHIFT = 4;
    const start = line.startPeriod ?? 0;
    const m = perturb((s) => (s.capex[i].startPeriod = start + SHIFT));
    // Isolate this concept by differencing against a run with the concept zeroed.
    const withoutBase = perturb((s) => (s.capex[i].total = 0));
    const conceptBase = BASE.results.map((r, k) => r.capexSpend - withoutBase.results[k].capexSpend);
    const withoutLate = (() => {
      const s = clone(BASE_INPUTS);
      s.capex[i].startPeriod = start + SHIFT;
      s.capex[i].total = 0;
      return runModel(s);
    })();
    const conceptLate = m.results.map((r, k) => r.capexSpend - withoutLate.results[k].capexSpend);

    // A delay means cumulative deployment is never ahead of the base case, and is
    // strictly behind at some point.
    const cum = (arr) => arr.reduce((acc, v) => (acc.push((acc[acc.length - 1] ?? 0) + v), acc), []);
    const cb = cum(conceptBase);
    const cl = cum(conceptLate);
    const neverAhead = cl.every((v, k) => v <= cb[k] + 0.01);
    const behindSomewhere = cl.some((v, k) => v < cb[k] - 0.01);
    check(
      `capex[${line.id}].startPeriod delays deployment`,
      neverAhead && behindSomewhere,
      `cum at period ${start + SHIFT}: ${Math.round(cb[start + SHIFT])} -> ${Math.round(cl[start + SHIFT])}`
    );
    check(
      `capex[${line.id}].startPeriod keeps the total unchanged`,
      same(sum(conceptLate), sum(conceptBase), 1),
      `${Math.round(sum(conceptBase))} vs ${Math.round(sum(conceptLate))}`
    );
  }
}
{
  const m = perturb((s) => {
    s.capex[0].phasing = s.capex[0].phasing.map((_, k) => (k === 0 ? 1 : 0));
  });
  check("capex phasing profile changes the spend timing", changed(m.results[0].capexSpend, BASE.results[0].capexSpend));
}

console.log("\n-- unit economics (every driver) --");

/** Total of one component's contribution across the plan. */
const compTotal = (m, bucket, id) => sum(m.results.map((r) => r[bucket][id] ?? 0));

// Every component, every driver it uses. Adding a line to the seeded scenario
// automatically adds its own cases here, so a new basis cannot go untested.
for (const c of BASE_INPUTS.cogs) {
  const uses = BASIS_USES[c.basis];
  const fields = [uses.quantity ? "quantity" : null, uses.unitCost ? "unitCost" : null].filter(Boolean);
  for (const field of fields) {
    // A line seeded at zero stays zero however its drivers are scaled, so the
    // comparison is against a control where the line is switched on.
    const wake = (t) => {
      for (const f of fields) t[f] = t[f].map((v) => (v === 0 ? 1 : v));
    };
    const ctrl = perturb((s2) => wake(s2.cogs.find((x) => x.id === c.id)));
    const m = perturb((s2) => {
      const t = s2.cogs.find((x) => x.id === c.id);
      wake(t);
      t[field] = t[field].map((v) => v * 1.2);
    });
    check(
      `cogs[${c.id}].${field} moves its own line and total COGS`,
      changed(compTotal(m, "cogsByComponent", c.id), compTotal(ctrl, "cogsByComponent", c.id)) &&
        changed(total(m, "cogs"), total(ctrl, "cogs")) &&
        same(total(m, "revenue"), total(ctrl, "revenue"), 0.01)
    );
    check(`raising cogs[${c.id}].${field} reduces EBITDA`, total(m, "ebitda") < total(ctrl, "ebitda"));
    // No other line may move: a shared driver would be a wiring bug.
    const bled = BASE_INPUTS.cogs
      .filter((o) => o.id !== c.id)
      .filter((o) => changed(compTotal(m, "cogsByComponent", o.id), compTotal(ctrl, "cogsByComponent", o.id)));
    check(`cogs[${c.id}].${field} does not bleed into other lines`, bled.length === 0, bled.map((o) => o.id).join(", "));
  }
}

for (const c of BASE_INPUTS.revenue) {
  wired(
    `revenue[${c.id}].unitCost moves revenue and margin, not cost`,
    (s2) => {
      const t = s2.revenue.find((x) => x.id === c.id);
      t.unitCost = t.unitCost.map((v) => v * 1.2);
    },
    ["revenue", "revenueBase", "grossMargin"],
    ["cogs", "opexTotal"]
  );
  wired(
    `revenue[${c.id}].yieldKgPerHour moves volume and revenue`,
    (s2) => {
      const t = s2.revenue.find((x) => x.id === c.id);
      t.yieldKgPerHour = t.yieldKgPerHour.map((v) => v * 1.1);
    },
    ["revenue", "tons"],
    []
  );
}

for (const c of BASE_INPUTS.opex) {
  const uses = BASIS_USES[c.basis];
  const field = uses.unitCost ? "unitCost" : "quantity";
  wired(
    `opex[${c.id}].${field} moves other OPEX only`,
    (s2) => {
      const t = s2.opex.find((x) => x.id === c.id);
      t[field] = t[field].map((v) => (v === 0 ? 1000 : v * 1.5));
    },
    ["opexOther", "opexTotal"],
    ["revenue", "cogs", "opexPersonnel"]
  );
}

wired("unitEconomics.annualHours moves revenue and COGS", (s2) => scaleAll(s2.unitEconomics, "annualHours", 1.1), ["revenue", "cogs"], []);
wired(
  "unitEconomics.utilisation moves volume, revenue and COGS",
  (s) => (s.unitEconomics.utilisation = s.unitEconomics.utilisation.map((v) => (v > 0 ? v * 0.5 : v))),
  ["tons", "revenue", "cogs", "ebitda"],
  ["depreciation"]
);
{
  const up = perturb((s2) => {
    s2.revenue = s2.revenue.map((c) => ({ ...c, unitCost: c.unitCost.map((v) => v * 1.2) }));
  });
  check("raising price increases EBITDA", total(up, "ebitda") > total(BASE, "ebitda"));
}

{
  // A yearly driver must be wired year by year, not just in aggregate.
  const y6 = perturb((s2) => {
    s2.revenue = s2.revenue.map((c) => ({ ...c, unitCost: c.unitCost.map((v, y) => (y === 5 ? v * 2 : v)) }));
  });
  const movedYears = new Set(y6.results.map((r, i) => (changed(r.revenue, BASE.results[i].revenue) ? y6.periods[i].year : null)).filter(Boolean));
  check("a single-year price change moves only that year", movedYears.size === 1 && movedYears.has(6), `${[...movedYears]}`);
}

console.log("\n-- premium and inflation --");
wired(
  "sustainablePremium moves revenue and margin, not cost",
  (s2) => (s2.parameters.sustainablePremium = 1.7),
  ["revenue", "revenuePremium", "grossMargin", "grossMarginPremium", "ebitda"],
  ["cogs", "revenueBase", "grossMarginBase", "opexTotal", "tons"]
);
wired(
  "revenueInflation moves revenue only",
  (s2) => (s2.parameters.revenueInflation = 0.06),
  ["revenue", "revenueBase", "grossMargin"],
  ["cogs", "opexTotal", "tons"]
);
wired(
  "cogsInflation moves COGS only",
  (s2) => (s2.parameters.cogsInflation = 0.06),
  ["cogs", "grossMargin"],
  ["revenue", "opexTotal", "tons"]
);
{
  const m = perturb((s2) => (s2.parameters.sustainablePremium = 1.7));
  check("a higher premium raises project IRR", (m.valuation.projectIrr ?? -9) > (BASE.valuation.projectIrr ?? -9));
}

wired("opexInflation moves other OPEX only", (s) => (s.parameters.opexInflation = 0.15), ["opexOther", "opexTotal", "ebitda"], ["revenue", "cogs", "opexPersonnel"]);
wired("compensationInflation moves personnel only", (s) => (s.parameters.compensationInflation = 0.15), ["opexPersonnel", "opexTotal", "ebitda"], ["revenue", "cogs", "opexOther"]);
{
  const m = perturb((s) => (s.parameters.opexInflation = 0.15));
  // An IRR that stops solving because the plan no longer pays back is itself a
  // fall, so a null reads as worse than any number.
  const worse =
    m.valuation.projectIrr === null || m.valuation.projectIrr === undefined
      ? true
      : m.valuation.projectIrr < BASE.valuation.projectIrr;
  check("higher OPEX inflation lowers project IRR", worse, `${m.valuation.projectIrr} vs ${BASE.valuation.projectIrr}`);
}

console.log("\n-- opex and personnel --");
for (let i = 0; i < BASE_INPUTS.personnel.length; i++) {
  const label = BASE_INPUTS.personnel[i].label;
  wired(
    `personnel[${label}].annualCost moves personnel cost`,
    (s) => (s.personnel[i].annualCost *= 1.5),
    ["opexPersonnel", "opexTotal"],
    ["revenue", "cogs"]
  );
  wired(
    `personnel[${label}].ftes moves personnel cost`,
    (s) => (s.personnel[i].ftes = s.personnel[i].ftes.map((v) => v + 1)),
    ["opexPersonnel", "opexTotal"],
    ["revenue"]
  );
}
{
  const m = perturb((s) => (s.personnel[4].ftes = s.personnel[4].ftes.map((v) => v + 0.5)));
  check("fractional FTEs are honoured (0.5 FTE moves cost)", changed(total(m, "opexPersonnel"), total(BASE, "opexPersonnel")));
}
{
  const m = perturb((s) =>
    s.personnel.push({ id: "new", label: "New role", annualCost: 100000, ftes: BASE_INPUTS.personnel[0].ftes.map(() => 2) })
  );
  check("adding an archetype increases personnel cost", total(m, "opexPersonnel") > total(BASE, "opexPersonnel"));
  const less = perturb((s) => s.personnel.splice(0, 1));
  check("removing an archetype decreases personnel cost", total(less, "opexPersonnel") < total(BASE, "opexPersonnel"));
}
console.log("\n-- financing instruments --");
{
  const di = BASE_INPUTS.instruments.findIndex((x) => x.kind === "debt");
  wired("debt.amount moves draw and interest", (s) => (s.instruments[di].amount *= 1.5), ["debtDraw", "interestExpense"], ["ebitda"]);
  {
    // Over the full life a facility drawn and repaid nets out, so the total CFF
    // barely moves. What must move is the cash in the year it is drawn.
    const m = perturb((s) => (s.instruments[di].amount *= 1.5));
    const drawYear = sum(series(m, "cff").slice(0, 12));
    check("debt.amount moves CFF in the drawdown year", changed(drawYear, sum(series(BASE, "cff").slice(0, 12))));
  }
  wired("debt.rate moves interest only", (s) => (s.instruments[di].rate = 0.12), ["interestExpense", "pbt"], ["ebitda", "cff", "debtDraw"]);
  wired("debt.upfrontFeePct moves interest", (s) => (s.instruments[di].upfrontFeePct = 0.02), ["interestExpense"], ["ebitda"]);
  {
    const m = perturb((s) => (s.instruments[di].graceMonths = 0));
    check("debt.graceMonths changes repayment timing", changed(sum(series(m, "debtRepayment").slice(0, 12)), sum(series(BASE, "debtRepayment").slice(0, 12))));
  }
  {
    const m = perturb((s) => (s.instruments[di].tenorMonths = 60));
    // Both tenors repay in full inside a 20-year plan, so the total is the same
    // by construction. A shorter tenor must repay sooner and cost less interest.
    const early = (x) => sum(series(x, "debtRepayment").slice(0, MONTHLY_PERIODS));
    check("debt.tenorMonths changes the repayment schedule", early(m) > early(BASE));
    check("a shorter tenor costs less interest", total(m, "interestExpense") < total(BASE, "interestExpense"));
  }
  for (const profile of ["annuity", "bullet"]) {
    const m = perturb((s) => (s.instruments[di].repayment = profile));
    check(`debt.repayment="${profile}" changes the schedule`, changed(total(m, "debtRepayment"), total(BASE, "debtRepayment")) || changed(total(m, "interestExpense"), total(BASE, "interestExpense")));
  }
  {
    const m = perturb((s) => (s.instruments[di].drawPeriod = 10));
    check("debt.drawPeriod moves when cash arrives", changed(m.results[2].debtDraw, BASE.results[2].debtDraw));
  }
}
{
  const gi = BASE_INPUTS.instruments.findIndex((x) => x.kind === "grant");
  wired("grant.amount moves grant income, PBT and CFF", (s) => (s.instruments[gi].amount *= 2), ["grantIncome", "grantCash", "pbt", "cff"], ["ebitda"]);
  const m = perturb((s) => (s.instruments[gi].drawPeriod = 20));
  check("grant.drawPeriod moves the collection period", changed(m.results[6].grantCash, BASE.results[6].grantCash));
  check("grant income sits below EBITDA (EBITDA unchanged)", same(total(m, "ebitda"), total(BASE, "ebitda"), 0.01));
}
{
  const ei = BASE_INPUTS.instruments.findIndex((x) => x.kind === "equity");
  wired("equity.amount moves equity raise and CFF", (s) => (s.instruments[ei].amount *= 1.5), ["equityRaise", "cff"], ["ebitda", "pbt", "interestExpense"]);
  const m = perturb((s) => (s.instruments[ei].amount *= 1.5));
  check("equity increases final cash", m.results[LAST].closingCash > BASE.results[LAST].closingCash);
  const add = perturb((s) => s.instruments.push({ id: "x", kind: "equity", label: "Series B", amount: 5_000_000, drawPeriod: 12 }));
  check("adding an instrument feeds through to cash", add.results[LAST].closingCash > BASE.results[LAST].closingCash);
  const rm = perturb((s) => s.instruments.splice(ei, 1));
  check("removing an instrument reduces cash", rm.results[LAST].closingCash < BASE.results[LAST].closingCash);
}

console.log("\n-- end-to-end chains --");
{
  // CAPEX must flow all the way to depreciation, maintenance, insurance and EBITDA.
  const m = perturb((s) => s.capex.forEach((l) => (l.total *= 2)));
  check("CAPEX -> depreciation", total(m, "depreciation") > total(BASE, "depreciation"));
  const maint = (x) => sum(x.results.map((r) => r.cogsByComponent.maintenance ?? 0));
  check("CAPEX -> maintenance COGS", maint(m) > maint(BASE));
  // Insurance is a fixed annual amount, not a percentage of CAPEX, so doubling
  // the asset base must leave OPEX exactly where it was.
  check("CAPEX does not move OPEX", same(total(m, "opexOther"), total(BASE, "opexOther"), 0.01));
  check("CAPEX -> EBITDA (via maintenance)", total(m, "ebitda") < total(BASE, "ebitda"));
  check("CAPEX -> CFI", total(m, "cfi") < total(BASE, "cfi"));
  check("CAPEX -> final cash", m.results[LAST].closingCash < BASE.results[LAST].closingCash);
  check("CAPEX -> project IRR", changed(m.valuation.projectIrr ?? 0, BASE.valuation.projectIrr ?? 0, 1e-6));
}
{
  // Price must flow to revenue, EBITDA, tax, cash and both IRRs.
  const m = perturb((s) => {
    s.revenue = s.revenue.map((c) => ({ ...c, unitCost: c.unitCost.map((v) => v * 1.5) }));
  });
  check("price -> revenue", total(m, "revenue") > total(BASE, "revenue"));
  check("price -> EBITDA", total(m, "ebitda") > total(BASE, "ebitda"));
  check("price -> tax", total(m, "tax") > total(BASE, "tax"));
  check("price -> final cash", m.results[LAST].closingCash > BASE.results[LAST].closingCash);
  check("price -> project IRR", (m.valuation.projectIrr ?? -9) > (BASE.valuation.projectIrr ?? -9));
  check("price -> equity IRR", (m.valuation.equityIrr ?? -9) > (BASE.valuation.equityIrr ?? -9));
  check("price -> terminal value", m.valuation.terminalValueEnterprise > BASE.valuation.terminalValueEnterprise);
}
{
  // YTD and annual views must react to a driver change too.
  const m = perturb((s) => (s.unitEconomics.utilisation = s.unitEconomics.utilisation.map((v) => (v > 0 ? 1 : 0))));
  check("utilisation -> YTD view updates", changed(m.ytd[23].revenue, BASE.ytd[23].revenue));
  check("utilisation -> annual summary updates", changed(m.annual[2].revenue, BASE.annual[2].revenue));
  check("utilisation -> annual EBITDA updates", changed(m.annual[9].ebitda, BASE.annual[9].ebitda));
}
{
  // No input should be able to produce NaN.
  const wild = perturb((s) => {
    s.parameters.dso = 0;
    s.parameters.dpo = 0;
    s.parameters.citr = 0;
    s.unitEconomics.annualHours = 0;
    s.capex.forEach((l) => (l.total = 0));
    s.instruments = [];
  });
  // Component breakdowns are objects, so the check has to look inside them.
  const allFinite = (r) =>
    Object.values(r).every((x) =>
      typeof x === "object" && x !== null
        ? Object.values(x).every((y) => Number.isFinite(y))
        : Number.isFinite(x)
    );
  check("degenerate inputs never produce NaN", wild.results.every(allFinite));
}

console.log(`\n=== ${failures === 0 ? "ALL WIRING CHECKS PASS" : failures + " CHECK(S) FAILED"} ===\n`);
process.exit(failures === 0 ? 0 : 1);
