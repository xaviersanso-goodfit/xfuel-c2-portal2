// XFuel group cash flow verification.
//
// The group tab restates the C2 model on a calendar grid and adds manual lines.
// Two things can silently go wrong: C2 flows landing in the wrong month, and the
// bridge blocks failing to reconcile the opening balance to the closing one.
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { buildGroupMonths, defaultGroupInputs, groupZeroes, runGroup, GROUP_MONTHS } from "../src/lib/model/group.ts";
import { normaliseGroup } from "../src/lib/model/normalise.ts";

let failures = 0;
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log("\n=== XFuel group cash flow ===\n");

const sc = defaultScenario();
const m = runModel(sc);
const gi = defaultGroupInputs();
const g = runGroup(sc, m, gi);

console.log("-- grid --");
const months = buildGroupMonths();
check("grid runs Jul-2026 to Dec-2028", months[0].label === "Jul-26" && months[months.length - 1].label === "Dec-28");
check("grid is 30 months", months.length === 30 && GROUP_MONTHS === 30, `${months.length}`);
check("months are consecutive", months.every((x, i) => i === 0 || (x.year * 12 + x.month) === (months[i - 1].year * 12 + months[i - 1].month) + 1));

console.log("\n-- opening and roll-forward --");
check("opening cash is 14,282,756 less 1,336,128", near(g.openingCash, 14_282_756 - 1_336_128, 1e-9), `${fmt(g.openingCash)}`);
check("first month opens on the opening cash", near(g.results[0].openingCash, g.openingCash, 1e-9));
check("each month opens where the previous closed", g.results.every((r, i) => i === 0 || near(r.openingCash, g.results[i - 1].closingCash, 1e-9)));
check("closing = opening + net every month", g.results.every((r) => near(r.closingCash, r.openingCash + r.netCashFlow, 1e-9)));
check("net = CFO + CFI + CFF", g.results.every((r) => near(r.netCashFlow, r.cfo + r.cfi + r.cff, 1e-9)));
check("section totals = C2 + rest", g.results.every((r) =>
  near(r.cfo, r.cfoC2 + r.cfoRest, 1e-9) && near(r.cfi, r.cfiC2 + r.cfiRest, 1e-9) && near(r.cff, r.cffC2 + r.cffRest, 1e-9)));
check("final closing equals the reported closing", near(g.results[g.results.length - 1].closingCash, g.closingCash, 1e-9));

console.log("\n-- calendar alignment --");
{
  // C2 starts 2027-01, which is the 7th month of the group grid (index 6).
  const firstC2 = g.results.findIndex((r) => Math.abs(r.cfiC2) > 0.5 || Math.abs(r.cfoC2) > 0.5 || Math.abs(r.cffC2) > 0.5);
  check("nothing from C2 before the plan starts", firstC2 === 6, `first C2 flow at index ${firstC2} (${months[firstC2]?.label})`);
  check("Jul-Dec 2026 carry no C2 flows", g.results.slice(0, 6).every((r) => r.cfoC2 === 0 && r.cfiC2 === 0 && r.cffC2 === 0));

  // Shifting the plan start must shift the C2 flows by the same number of months.
  const later = clone(sc);
  later.parameters.startMonth = "2027-04";
  const gl = runGroup(later, runModel(later), gi);
  const firstLater = gl.results.findIndex((r) => Math.abs(r.cfiC2) > 0.5);
  check("moving the plan start moves the C2 flows with it", firstLater === firstC2 + 3, `${firstC2} -> ${firstLater}`);

  // C2 CAPEX inside the window must equal the project's own spend over the same months.
  const inWindow = m.periods.reduce((acc, p, i) => {
    // Periods Jan-27 .. Dec-28 are the first 24 monthly periods.
    return i < 24 ? acc + m.results[i].capexSpend : acc;
  }, 0);
  check("C2 CAPEX in the window ties to the project", near(-sum(g.results.map((r) => r.cfiC2)), inWindow, 1), `${fmt(-sum(g.results.map((r) => r.cfiC2)))} vs ${fmt(inWindow)}`);
}

console.log("\n-- intercompany elimination --");
{
  const equityTotal = sc.instruments.filter((i) => i.kind === "equity").reduce((a, i) => a + i.amount, 0);
  const withEquity = runGroup(sc, m, { ...gi, eliminateIntercompanyEquity: false });
  const diff = withEquity.closingCash - g.closingCash;
  check("eliminating equity removes exactly the equity ticket", near(diff, equityTotal, 1), `${fmt(diff)} vs ${fmt(equityTotal)}`);
  check("debt and grant survive elimination", g.blocks.find((b) => b.key === "cffC2").items.some((it) => it.key === "draw"));
  check("no equity item when eliminated", !g.blocks.find((b) => b.key === "cffC2").items.some((it) => it.key === "equity"));
  check("equity item appears when not eliminated", withEquity.blocks.find((b) => b.key === "cffC2").items.some((it) => it.key === "equity"));
}

console.log("\n-- bridge --");
check("bridge reconciles opening to closing", near(g.bridgeCheck, 0, 0.5), `off by ${fmt(g.bridgeCheck)}`);
check("six blocks in the stated order",
  g.blocks.map((b) => b.key).join(",") === "cfoC2,cfoRest,cffC2,cffRest,cfiC2,cfiRest",
  g.blocks.map((b) => b.key).join(","));
check("blocks sum to the movement", near(sum(g.blocks.map((b) => b.amount)), g.closingCash - g.openingCash, 0.5));
check("every block's items sum to the block", g.blocks.every((b) => b.items.length === 0 || near(sum(b.items.map((i) => i.amount)), b.amount, 1)),
  g.blocks.filter((b) => b.items.length && !near(sum(b.items.map((i) => i.amount)), b.amount, 1)).map((b) => b.key).join(","));
check("CFI C2 is itemised by CAPEX concept", g.blocks.find((b) => b.key === "cfiC2").items.length >= 3);
check("CFI C2 items are outflows", g.blocks.find((b) => b.key === "cfiC2").items.every((i) => i.amount < 0));

console.log("\n-- manual lines --");
{
  const withLine = clone(gi);
  const amounts = groupZeroes();
  amounts[0] = -250_000;
  amounts[12] = -400_000;
  withLine.lines = [...withLine.lines, { id: "test", label: "Head office", section: "cfo", amounts }];
  const g2 = runGroup(sc, m, withLine);
  check("a manual line moves group cash", near(g2.closingCash, g.closingCash - 650_000, 0.5), `${fmt(g2.closingCash)} vs ${fmt(g.closingCash - 650_000)}`);
  check("a manual line lands in the month it was entered", near(g2.results[0].cfoRest, g.results[0].cfoRest - 250_000, 0.5));
  check("a manual line does not touch the C2 rows", g2.results.every((r, i) => near(r.cfoC2, g.results[i].cfoC2, 1e-9)));
  check("bridge still reconciles with manual lines", near(g2.bridgeCheck, 0, 0.5));
  check("the manual line appears in the CFO rest block",
    g2.blocks.find((b) => b.key === "cfoRest").items.some((it) => it.label === "Head office" && near(it.amount, -650_000, 0.5)));

  // Lines in each section must reach the right total.
  for (const section of ["cfo", "cfi", "cff"]) {
    const s = clone(gi);
    const a = groupZeroes();
    a[5] = 100_000;
    s.lines = [{ id: "x", label: "X", section, amounts: a }];
    const gs = runGroup(sc, m, s);
    const key = section === "cfo" ? "cfoRest" : section === "cfi" ? "cfiRest" : "cffRest";
    check(`a ${section} line reaches the ${key} block`, near(gs.blocks.find((b) => b.key === key).amount, 100_000, 0.5));
    check(`a ${section} line reaches group cash`, near(gs.results[5][section], gs.results[5][`${section}C2`] + 100_000, 0.5));
  }
}

console.log("\n-- robustness --");
{
  check("a missing group block falls back to defaults", normaliseGroup(undefined).lines.length === 9);
  const short = clone(gi);
  short.lines[0].amounts = [1000, 2000];
  const gn = normaliseGroup(short);
  check("a short line is padded to the grid", gn.lines[0].amounts.length === GROUP_MONTHS);
  check("a short line keeps the values supplied", gn.lines[0].amounts[0] === 1000 && gn.lines[0].amounts[1] === 2000);
  check("a short line pads with zero, not a carry", gn.lines[0].amounts[2] === 0);
  const g3 = runGroup(sc, m, gn);
  check("all group outputs are finite", g3.results.every((r) => Object.values(r).every((v) => Number.isFinite(v))));
  check("zero opening cash still rolls", near(runGroup(sc, m, { ...gi, openingCash: 0 }).results[0].openingCash, 0, 1e-9));
}

console.log("\n-- headline --");
console.log(`  Opening 30/06/2026   ${fmt(g.openingCash)} EUR`);
for (const b of g.blocks) console.log(`  ${b.label.padEnd(20)} ${fmt(b.amount).padStart(14)} EUR`);
console.log(`  Closing 31/12/2028   ${fmt(g.closingCash)} EUR`);
console.log(`  Lowest cash          ${fmt(Math.min(...g.results.map((r) => r.closingCash)))} EUR`);
if (g.warnings.length) console.log("  Warnings: " + g.warnings.join(" | "));

console.log(`\n=== ${failures === 0 ? "ALL GROUP CHECKS PASS" : failures + " CHECK(S) FAILED"} ===\n`);
process.exit(failures === 0 ? 0 : 1);
