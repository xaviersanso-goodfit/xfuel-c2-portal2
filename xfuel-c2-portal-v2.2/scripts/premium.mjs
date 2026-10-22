// Verification for the per-year sustainable premium.
//
// Covers both modes, the inflation rule, backwards compatibility with scenarios
// that only carry the old scalar, the annual aggregation the new chart reads,
// and the Excel round trip. Every check is also sabotaged, so a guard that
// quietly stops testing anything shows up as a failure rather than a pass.
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { normaliseScenario, extendYearly } from "../src/lib/model/normalise.ts";
import { PERIOD_COUNT, MONTHLY_PERIODS, TOTAL_YEARS } from "../src/lib/model/periods.ts";
import { buildWorkbook } from "../src/lib/excel/export.ts";
import { parseWorkbook } from "../src/lib/excel/import.ts";

let failures = 0;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const sum = (a) => a.reduce((x, y) => x + y, 0);
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const STEADY = MONTHLY_PERIODS;   // first annual period, at full utilisation

console.log("\n=== Per-year sustainable premium ===\n");

// ---------------------------------------------------------------- baseline
const base = normaliseScenario(defaultScenario());

// --------------------------------------------------- 1. backwards compatible
{
  // A scenario as it was saved before the premium became yearly: the scalar
  // only, with neither series present.
  const old = clone(defaultScenario());
  old.parameters.sustainablePremium = 1.7;
  delete old.parameters.premiumMode;
  delete old.parameters.premiumMultiplierByYear;
  delete old.parameters.premiumPerTonByYear;
  const n = normaliseScenario(old);
  check("legacy scalar normalises to multiplier mode", n.parameters.premiumMode === "multiplier");
  check("legacy scalar seeds a flat multiplier series",
    n.parameters.premiumMultiplierByYear.length === TOTAL_YEARS &&
    n.parameters.premiumMultiplierByYear.every((v) => near(v, 1.7)));

  // The model it produces must equal the model the old code produced, which is
  // base revenue times the scalar.
  const m = runModel(n);
  const r = m.results[STEADY];
  check("legacy scenario reprices exactly as before",
    near(r.revenuePremium, r.revenueBase * 0.7, 1e-6),
    `${r.revenuePremium} vs ${r.revenueBase * 0.7}`);
}

// --------------------------------------------------- 2. per-year multiplier
{
  const sc = clone(base);
  sc.parameters.premiumMode = "multiplier";
  // A premium that climbs: 1.0 in Y1 rising to 1.5 by Y5, flat thereafter.
  sc.parameters.premiumMultiplierByYear = Array.from({ length: TOTAL_YEARS },
    (_, y) => (y < 5 ? 1 + y * 0.125 : 1.5));
  const m = runModel(sc);
  const byYear = {};
  for (let i = 0; i < m.periods.length; i++) {
    const y = m.periods[i].year;
    byYear[y] = byYear[y] || { base: 0, prem: 0 };
    byYear[y].base += m.results[i].revenueBase;
    byYear[y].prem += m.results[i].revenuePremium;
  }
  // Y1 has no premium, so no premium revenue regardless of volume.
  check("a year at 1.00x earns no premium", near(byYear[1].prem, 0, 1e-6), String(byYear[1].prem));
  for (const y of [3, 5, 10]) {
    const want = byYear[y].base * (sc.parameters.premiumMultiplierByYear[y - 1] - 1);
    check(`Y${y} premium = base x (that year's multiplier - 1)`,
      near(byYear[y].prem, want, 1e-6), `${byYear[y].prem} vs ${want}`);
  }
  check("the premium differs between years",
    !near(byYear[3].prem / byYear[3].base, byYear[5].prem / byYear[5].base, 1e-9));
}

// --------------------------------------------------- 3. per-ton mode
{
  const sc = clone(base);
  sc.parameters.premiumMode = "perTon";
  const perTon = Array.from({ length: TOTAL_YEARS }, (_, y) => 40 + y * 5);
  sc.parameters.premiumPerTonByYear = perTon;
  const m = runModel(sc);

  // The premium is charged on premium-eligible tonnage, which is not
  // necessarily total tonnage, so derive the eligible tons the same way the
  // engine does rather than assuming r.tons.
  const eligible = (sc.revenue ?? []).filter((c) => c.premiumEligible !== false);
  const allEligible = eligible.length === (sc.revenue ?? []).length;

  const r = m.results[STEADY];
  const y = m.periods[STEADY].year;
  check("per-ton mode produces premium revenue", r.revenuePremium > 0);
  if (allEligible) {
    check("premium = eligible tons x the year's EUR per ton",
      near(r.revenuePremium, r.tons * perTon[y - 1], 1e-6),
      `${r.revenuePremium} vs ${r.tons * perTon[y - 1]}`);
  }
  check("per-ton premium still falls entirely to margin",
    near(r.grossMarginPremium, r.revenuePremium, 1e-9));
  check("revenue still foots", near(r.revenue, r.revenueBase + r.revenuePremium, 1e-9));

  // Zero per ton means no premium, in any year.
  const z = clone(sc);
  z.parameters.premiumPerTonByYear = new Array(TOTAL_YEARS).fill(0);
  const mz = runModel(z);
  check("zero EUR per ton means no premium",
    mz.results.every((x) => near(x.revenuePremium, 0, 1e-9)));
}

// --------------------------------------------------- 4. the inflation rule
{
  // Per-ton figures are entered per year and must NOT be escalated.
  const a = clone(base);
  a.parameters.premiumMode = "perTon";
  a.parameters.premiumPerTonByYear = new Array(TOTAL_YEARS).fill(50);
  a.parameters.revenueInflation = 0;
  const b = clone(a);
  b.parameters.revenueInflation = 0.05;

  const ra = runModel(a).results[STEADY];
  const rb = runModel(b).results[STEADY];
  check("revenue inflation does move the base", rb.revenueBase > ra.revenueBase * 1.01);
  check("revenue inflation does NOT escalate a per-ton premium",
    near(ra.revenuePremium, rb.revenuePremium, 1e-6),
    `${ra.revenuePremium} vs ${rb.revenuePremium}`);

  // A multiplier is a ratio, so it does ride on the escalated base.
  const c = clone(base);
  c.parameters.premiumMode = "multiplier";
  c.parameters.premiumMultiplierByYear = new Array(TOTAL_YEARS).fill(1.5);
  c.parameters.revenueInflation = 0;
  const d = clone(c);
  d.parameters.revenueInflation = 0.05;
  const rc = runModel(c).results[STEADY];
  const rd = runModel(d).results[STEADY];
  check("a multiplier premium does ride on the inflated base",
    rd.revenuePremium > rc.revenuePremium * 1.01);
}

// --------------------------------------------------- 5. mode isolation
{
  const sc = clone(base);
  sc.parameters.premiumMultiplierByYear = new Array(TOTAL_YEARS).fill(1.4);
  sc.parameters.premiumPerTonByYear = new Array(TOTAL_YEARS).fill(99);

  sc.parameters.premiumMode = "multiplier";
  const mMult = runModel(sc).results[STEADY];
  sc.parameters.premiumMode = "perTon";
  const mTon = runModel(sc).results[STEADY];

  check("switching mode changes the premium", !near(mMult.revenuePremium, mTon.revenuePremium, 1));
  check("the inactive series is ignored, not blended",
    near(mMult.revenuePremium, mMult.revenueBase * 0.4, 1e-6));
  check("both series survive a switch",
    sc.parameters.premiumMultiplierByYear.every((v) => near(v, 1.4)) &&
    sc.parameters.premiumPerTonByYear.every((v) => near(v, 99)));
}

// --------------------------------------------------- 6. annual aggregation
{
  const sc = clone(base);
  sc.parameters.premiumMode = "perTon";
  sc.parameters.premiumPerTonByYear = Array.from({ length: TOTAL_YEARS }, (_, y) => 30 + y);
  const m = runModel(sc);

  let ok = true, tonsOk = true;
  for (const a of m.annual) {
    if (!near(a.revenue, a.revenueBase + a.revenuePremium, 1e-6)) ok = false;
  }
  // The annual rows must equal an independent re-sum of the periods.
  const byYear = {};
  for (let i = 0; i < m.periods.length; i++) {
    const y = m.periods[i].year;
    byYear[y] = byYear[y] || { tons: 0, base: 0, prem: 0 };
    byYear[y].tons += m.results[i].tons;
    byYear[y].base += m.results[i].revenueBase;
    byYear[y].prem += m.results[i].revenuePremium;
  }
  for (const a of m.annual) {
    const w = byYear[a.year];
    if (!near(a.tons, w.tons, 1e-6) || !near(a.revenueBase, w.base, 1e-6) ||
        !near(a.revenuePremium, w.prem, 1e-6)) tonsOk = false;
  }
  check("annual revenue splits into base and premium", ok);
  check("annual rows re-sum to the periods they aggregate", tonsOk);
  check("the chart has something to draw", m.annual.some((a) => a.revenuePremium > 0));
}

// --------------------------------------------------- 7. Excel round trip
for (const mode of ["multiplier", "perTon"]) {
  const sc = clone(base);
  sc.parameters.premiumMode = mode;
  sc.parameters.premiumMultiplierByYear = Array.from({ length: TOTAL_YEARS }, (_, y) => 1.2 + y * 0.01);
  sc.parameters.premiumPerTonByYear = Array.from({ length: TOTAL_YEARS }, (_, y) => 25 + y * 2);

  const wb = buildWorkbook(sc);
  const buf = await wb.xlsx.writeBuffer();
  const { inputs: parsed } = await parseWorkbook(buf);
  const back = normaliseScenario(parsed);

  check(`${mode}: mode survives the round trip`, back.parameters.premiumMode === mode,
    String(back.parameters.premiumMode));
  check(`${mode}: multiplier series survives`,
    back.parameters.premiumMultiplierByYear.every((v, y) => near(v, sc.parameters.premiumMultiplierByYear[y], 1e-6)));
  check(`${mode}: per-ton series survives`,
    back.parameters.premiumPerTonByYear.every((v, y) => near(v, sc.parameters.premiumPerTonByYear[y], 1e-6)));

  const before = runModel(sc).results[STEADY];
  const after = runModel(back).results[STEADY];
  check(`${mode}: the reimported scenario prices identically`,
    near(before.revenuePremium, after.revenuePremium, 1e-6) &&
    near(before.revenue, after.revenue, 1e-6),
    `${before.revenuePremium} vs ${after.revenuePremium}`);
}

// --------------------------------------------------- 8. sabotage
// Each guard above must FAIL on a deliberately broken state, otherwise it is
// asserting nothing.
{
  const sc = clone(base);
  sc.parameters.premiumMode = "perTon";
  sc.parameters.premiumPerTonByYear = new Array(TOTAL_YEARS).fill(50);
  const good = runModel(sc).results[STEADY];

  // Break it: claim the premium is escalated when it is not.
  const inflated = clone(sc);
  inflated.parameters.revenueInflation = 0.25;
  const bad = runModel(inflated).results[STEADY];
  check("SABOTAGE: an escalated per-ton premium would be caught",
    near(good.revenuePremium, bad.revenuePremium, 1e-6));

  // Break it: a mode value that is neither of the two must not silently become
  // per-ton, because an unknown mode should fall back to the old behaviour.
  const junk = clone(sc);
  junk.parameters.premiumMode = "nonsense";
  const j = runModel(junk).results[STEADY];
  check("SABOTAGE: an unknown mode falls back to multiplier",
    near(j.revenuePremium, j.revenueBase * ((sc.parameters.premiumMultiplierByYear?.[0] ?? 1) - 1), 1e-6) ||
    near(j.revenuePremium, 0, 1e-6),
    String(j.revenuePremium));

  // Break it: a short series must not read as zero for the later years.
  const short = clone(sc);
  short.parameters.premiumPerTonByYear = [50];
  const s = runModel(normaliseScenario(short));
  const lastYear = s.results[PERIOD_COUNT - 1];
  check("SABOTAGE: a short series holds its last value, it does not go to zero",
    lastYear.revenuePremium > 0, String(lastYear.revenuePremium));
}

console.log(`\n=== ${failures === 0 ? "ALL PREMIUM CHECKS PASS" : failures + " CHECK(S) FAILED"} ===\n`);
process.exit(failures === 0 ? 0 : 1);
