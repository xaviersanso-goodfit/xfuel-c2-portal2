// Invariance of the unlevered project return.
// The property under test is not three specific percentages but that the
// project IRR cannot be moved by any source of funding, while the equity IRR
// still responds to grants.
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { normaliseScenario } from "../src/lib/model/normalise.ts";

const clone = (o) => JSON.parse(JSON.stringify(o));
const pct = (x) => (x === null ? "n/a" : (x * 100).toFixed(4) + "%");
const base = normaliseScenario(defaultScenario());
const V = (sc) => runModel(sc).valuation;

let fails = 0;
const near = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= tol;
const check = (n, c, d = "") => { console.log((c ? "  PASS  " : "  FAIL  ") + n + " " + d); if (!c) fails++; };

const b = V(base);
console.log("\n=== Unlevered project return, invariance to funding ===\n");
console.log(`  base   project ${pct(b.projectIrr)}   incl. grants ${pct(b.projectIrrInclGrants)}   equity ${pct(b.equityIrr)}`);

const kinds = (sc, k) => sc.instruments.filter((i) => String(i.kind ?? i.type ?? "").toLowerCase().includes(k));

// --- grants -----------------------------------------------------------
for (const amt of [0, 5_000_000, 20_000_000]) {
  const sc = clone(base);
  for (const i of kinds(sc, "grant")) i.amount = amt;
  const v = V(sc);
  check(`project IRR unmoved by a grant of ${amt.toLocaleString("en-US")}`,
    near(v.projectIrr, b.projectIrr), `${pct(v.projectIrr)} vs ${pct(b.projectIrr)}`);
  if (amt > 0) {
    check(`  equity IRR DOES rise with that grant`,
      v.equityIrr > b.equityIrr, `${pct(v.equityIrr)} vs ${pct(b.equityIrr)}`);
    check(`  incl. grants IRR DOES rise with that grant`,
      v.projectIrrInclGrants > b.projectIrrInclGrants,
      `${pct(v.projectIrrInclGrants)} vs ${pct(b.projectIrrInclGrants)}`);
  }
}

// --- debt -------------------------------------------------------------
{
  const sc = clone(base);
  for (const i of kinds(sc, "debt")) { i.amount = (Number(i.amount) || 0) * 2 + 1_000_000; }
  const v = V(sc);
  check("project IRR unmoved by doubling debt", near(v.projectIrr, b.projectIrr),
    `${pct(v.projectIrr)} vs ${pct(b.projectIrr)}`);
}

// --- equity -----------------------------------------------------------
{
  const sc = clone(base);
  for (const i of kinds(sc, "equity")) { i.amount = (Number(i.amount) || 0) * 2 + 1_000_000; }
  const v = V(sc);
  check("project IRR unmoved by doubling equity rounds", near(v.projectIrr, b.projectIrr),
    `${pct(v.projectIrr)} vs ${pct(b.projectIrr)}`);
}

// --- it must still respond to the asset -------------------------------
{
  const sc = clone(base);
  sc.revenue[0].unitCost = sc.revenue[0].unitCost.map((v) => v * 1.1);
  const v = V(sc);
  check("SABOTAGE: project IRR DOES move when the asset's price moves",
    v.projectIrr > b.projectIrr, `${pct(v.projectIrr)} vs ${pct(b.projectIrr)}`);
}

// --- the two measures must differ when a grant exists -----------------
{
  const sc = clone(base);
  for (const i of kinds(sc, "grant")) i.amount = 5_000_000;
  const v = V(sc);
  check("the two project measures differ once a grant is present",
    !near(v.projectIrr, v.projectIrrInclGrants, 1e-6),
    `${pct(v.projectIrr)} vs ${pct(v.projectIrrInclGrants)}`);
  const z = clone(base);
  for (const i of kinds(z, "grant")) i.amount = 0;
  const vz = V(z);
  check("and agree exactly when there is none",
    near(vz.projectIrr, vz.projectIrrInclGrants, 1e-9),
    `${pct(vz.projectIrr)} vs ${pct(vz.projectIrrInclGrants)}`);
}

console.log(`\n=== ${fails === 0 ? "ALL INVARIANCE CHECKS PASS" : fails + " CHECK(S) FAILED"} ===\n`);
process.exit(fails ? 1 : 0);
