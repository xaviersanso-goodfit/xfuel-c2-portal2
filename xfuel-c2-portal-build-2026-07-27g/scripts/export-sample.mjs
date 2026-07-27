// Write a sample workbook and dump the engine's numbers, so the Excel
// recalculation can be compared against the engine cell by cell.
import fs from "node:fs";
import { buildWorkbook } from "../src/lib/excel/export.ts";
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";

const sc = defaultScenario();
const wb = buildWorkbook(sc);
await wb.xlsx.writeFile("/tmp/c2_model.xlsx");

const m = runModel(sc);
const dump = {
  periods: m.periods.map((p) => p.label),
  tons: m.results.map((r) => r.tons),
  nameplate: m.results.map((r) => r.nameplateTonsPerYear),
  opexPersonnel: m.results.map((r) => r.opexPersonnel),
  opexOther: m.results.map((r) => r.opexOther),
  revenue: m.results.map((r) => r.revenue),
  cogs: m.results.map((r) => r.cogs),
  opexTotal: m.results.map((r) => r.opexTotal),
  ebitda: m.results.map((r) => r.ebitda),
  depreciation: m.results.map((r) => r.depreciation),
  pbt: m.results.map((r) => r.pbt),
  tax: m.results.map((r) => r.tax),
  netIncome: m.results.map((r) => r.netIncome),
  cfo: m.results.map((r) => r.cfo),
  cfi: m.results.map((r) => r.cfi),
  cff: m.results.map((r) => r.cff),
  closingCash: m.results.map((r) => r.closingCash),
  capexSpend: m.results.map((r) => r.capexSpend),
  projectFcf: m.results.map((r) => r.projectFcf),
  equityFcf: m.results.map((r) => r.equityFcf),
};
fs.writeFileSync("/tmp/engine_dump.json", JSON.stringify(dump, null, 1));
console.log("wrote /tmp/c2_model.xlsx and /tmp/engine_dump.json");
