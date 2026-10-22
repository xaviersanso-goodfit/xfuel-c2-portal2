// Changelog tests.
//
// The audit trail is only worth having if it is complete and readable. These
// tests prove that every kind of edit produces exactly one sensible entry, that
// a save which changes nothing writes nothing, and that a rename reads as a
// rename rather than as a deletion and an addition.
import { diffScenarios, formatCet } from "../src/lib/model/diff.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { TOTAL_YEARS } from "../src/lib/model/periods.ts";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const BASE = defaultScenario();
/** Diff the base scenario against a mutated copy of it. */
const after = (mutate) => {
  const s = clone(BASE);
  mutate(s);
  return diffScenarios(BASE, s);
};
const one = (changes) => (changes.length === 1 ? changes[0] : null);

console.log("\n=== Changelog ===\n");

console.log("-- nothing changed --");
check("an unchanged scenario logs nothing", diffScenarios(BASE, clone(BASE)).length === 0);
check("a null before logs nothing", diffScenarios(null, BASE).length === 0);

console.log("\n-- parameters --");
{
  const c = one(after((s) => (s.parameters.wacc = 0.11)));
  check("a parameter change logs one entry", !!c, JSON.stringify(after((s) => (s.parameters.wacc = 0.11))));
  check("the entry names the parameter in words", c?.label === "WACC", c?.label);
  check("the entry carries the old and new value", c?.from === "0.09" && c?.to === "0.11", `${c?.from} -> ${c?.to}`);

  const p = one(after((s) => (s.parameters.sustainablePremium = 1.7)));
  check("the sustainable premium is logged", p?.label === "Sustainable premium" && p?.to === "1.7", JSON.stringify(p));
  const r = one(after((s) => (s.parameters.revenueInflation = 0.03)));
  check("revenue inflation is logged", r?.label === "Revenue inflation");
  const g = one(after((s) => (s.parameters.cogsInflation = 0.03)));
  check("COGS inflation is logged", g?.label === "COGS inflation");
  const n = one(after((s) => (s.name = "Downside")));
  check("a scenario rename is logged", n?.label === "Scenario name" && n?.to === "Downside");
}

console.log("\n-- components --");
{
  const target = BASE.cogs.find((c) => c.id === "water");
  const c = one(after((s) => (s.cogs.find((x) => x.id === "water").name = "H2O")));
  check("a rename logs one entry, not a delete and an add", !!c, JSON.stringify(c));
  check("the rename shows both names", c?.from === target.name && c?.to === "H2O", `${c?.from} -> ${c?.to}`);

  const d = one(after((s) => (s.cogs.find((x) => x.id === "water").description = "Process make-up water")));
  check("a description change is logged", d?.to === "Process make-up water", JSON.stringify(d));

  const b = one(after((s) => (s.cogs.find((x) => x.id === "water").basis = "fixedAnnual")));
  check("a basis change is logged", b?.from === "perHour" && b?.to === "fixedAnnual", `${b?.from} -> ${b?.to}`);

  const p = one(after((s) => (s.revenue[0].premiumEligible = false)));
  check("a premium flag change is logged", p?.from === "yes" && p?.to === "no", `${p?.from} -> ${p?.to}`);

  const add = one(after((s) =>
    s.cogs.push({
      id: "catalyst", name: "Catalyst", description: "", basis: "perTon",
      quantity: new Array(TOTAL_YEARS).fill(0), unitCost: new Array(TOTAL_YEARS).fill(10),
    })
  ));
  check("adding a line logs one entry", !!add && add.to === "Catalyst", JSON.stringify(add));
  const del = one(after((s) => (s.cogs = s.cogs.filter((c) => c.id !== "water"))));
  check("removing a line logs one entry", !!del && del.to === "(removed)", JSON.stringify(del));
}

console.log("\n-- yearly and per-period series --");
{
  const c = one(after((s) => (s.revenue[0].unitCost[2] = 900)));
  check("a single-year edit logs one entry", !!c, JSON.stringify(c));
  check("the entry names the year", c?.label.endsWith(", Y3"), c?.label);
  check("the entry names the line", c?.label.startsWith(BASE.revenue[0].name), c?.label);

  const all = after((s) => (s.revenue[0].unitCost = s.revenue[0].unitCost.map(() => 900)));
  check("an edit to every year collapses to one entry", all.length === 1, `${all.length}`);
  check("the collapsed entry says all years", all[0]?.label.endsWith("all years"), all[0]?.label);

  const three = after((s) => {
    s.revenue[0].unitCost[0] = 700;
    s.revenue[0].unitCost[1] = 710;
    s.revenue[0].unitCost[2] = 720;
  });
  check("three changed years log three entries", three.length === 3, `${three.length}`);

  // A per-period series is reported as a count, not as 53 separate rows.
  const util = one(after((s) => (s.unitEconomics.utilisation = s.unitEconomics.utilisation.map((v) => v * 0.5))));
  check("a whole-plan utilisation change logs one entry", !!util, JSON.stringify(util));
  check("the entry reports how many periods moved", /\(\d+ periods\)/.test(util?.label ?? ""), util?.label);
  const oneCell = one(after((s) => (s.unitEconomics.utilisation[30] = 0.5)));
  check("a single-period change does not report a count", oneCell?.label === "Capacity utilisation", oneCell?.label);
}

console.log("\n-- capex, personnel and financing --");
{
  const c = one(after((s) => (s.capex[0].total *= 2)));
  check("a CAPEX total change is logged", !!c && c.label.includes("total cost"), JSON.stringify(c));
  const f = one(after((s) => (s.personnel[0].ftes = s.personnel[0].ftes.map((v) => v + 1))));
  check("an FTE change is logged", !!f && f.label.includes("FTE"), JSON.stringify(f));
  const d = one(after((s) => (s.instruments.find((x) => x.kind === "debt").rate = 0.09)));
  check("a debt rate change is logged", !!d, JSON.stringify(d));
}

console.log("\n-- several edits at once --");
{
  const many = after((s) => {
    s.parameters.wacc = 0.12;
    s.parameters.sustainablePremium = 1.7;
    s.cogs.find((x) => x.id === "water").name = "H2O";
    s.revenue[0].unitCost[4] = 750;
  });
  check("four edits log four entries", many.length === 4, `${many.length}: ${many.map((c) => c.label).join(" | ")}`);
  check("every entry has a key, a label and both values",
    many.every((c) => c.key && c.label && c.from !== undefined && c.to !== undefined));
  check("keys are unique, so nothing overwrites anything",
    new Set(many.map((c) => c.key)).size === many.length);
}

console.log("\n-- timestamps --");
{
  // 17 August 2026, 09:34 UTC is 11:34 in Madrid, which is what the log shows.
  const t = formatCet("2026-08-17T09:34:00.000Z");
  check("a timestamp renders in Madrid local time", t.includes("11:34"), t);
  check("a timestamp carries the date", t.includes("17") && t.includes("2026"), t);
  check("an unparseable timestamp does not throw", typeof formatCet("not a date") === "string");
}

console.log(failures === 0 ? "\n=== ALL CHANGELOG CHECKS PASS ===\n" : `\n=== ${failures} CHECK(S) FAILED ===\n`);
process.exit(failures ? 1 : 0);
