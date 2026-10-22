import fs from "node:fs";
import { buildWorkbook } from "../src/lib/excel/export.ts";
import { parseWorkbook } from "../src/lib/excel/import.ts";
import { runModel } from "../src/lib/model/engine.ts";
import { defaultScenario } from "../src/lib/model/defaults.ts";
import { MONTHLY_PERIODS } from "../src/lib/model/periods.ts";
const STEADY = MONTHLY_PERIODS;

let fails=0;
const chk=(n,c,d="")=>{ console.log((c?"  PASS  ":"  FAIL  ")+n+" "+d); if(!c)fails++; };

const sc = defaultScenario();
const wb = buildWorkbook(sc);
const buf = await wb.xlsx.writeBuffer();
const { inputs, notes } = await parseWorkbook(buf);

console.log("Excel round-trip (export -> import -> re-run):");
chk("scenario name preserved", inputs.name === sc.name, `"${inputs.name}"`);
chk("start month preserved", inputs.parameters.startMonth === sc.parameters.startMonth);
chk("CITR preserved", Math.abs(inputs.parameters.citr - sc.parameters.citr) < 1e-12);
chk("exit multiple preserved", inputs.parameters.exitMultiple === sc.parameters.exitMultiple);
chk("DSO/DPO preserved", inputs.parameters.dso===sc.parameters.dso && inputs.parameters.dpo===sc.parameters.dpo);
chk("capex totals preserved", sc.capex.every((l,i)=>Math.abs(inputs.capex[i].total-l.total)<0.01));
chk("capex phasing preserved", Math.abs(inputs.capex[0].phasing.reduce((a,b)=>a+b,0)-1)<1e-9);
const priceLabel = `${sc.revenue[0].name} — Amount per ton`;
chk(
  "price per ton preserved for every year",
  inputs.revenue[0].unitCost.every((v, y) => Math.abs(v - sc.revenue[0].unitCost[y]) < 1e-9),
  `got ${inputs.revenue[0].unitCost}`
);
chk(
  "every component survives the round trip",
  inputs.revenue.length === sc.revenue.length &&
    inputs.cogs.length === sc.cogs.length &&
    inputs.opex.length === sc.opex.length
);
chk(
  "component names and descriptions survive",
  sc.cogs.every((c, i) => inputs.cogs[i].name === c.name && inputs.cogs[i].description === c.description)
);
chk(
  "component bases survive",
  sc.cogs.every((c, i) => inputs.cogs[i].basis === c.basis) &&
    sc.opex.every((c, i) => inputs.opex[i].basis === c.basis)
);
chk(
  "premium eligibility survives",
  sc.revenue.every((c, i) => !!inputs.revenue[i].premiumEligible === !!c.premiumEligible)
);
chk(
  "every COGS driver survives for every year",
  sc.cogs.every((c, i) => c.unitCost.every((v, y) => Math.abs(v - inputs.cogs[i].unitCost[y]) < 1e-9)),
);
chk("utilisation preserved", inputs.unitEconomics.utilisation.every((v,i)=>Math.abs(v-(sc.unitEconomics.utilisation[i]||0))<1e-12));
chk("personnel count preserved", inputs.personnel.length===sc.personnel.length);
chk("FTEs preserved", Math.abs(inputs.personnel[4].ftes[STEADY]-7.8)<1e-9, `got ${inputs.personnel[4].ftes[STEADY]}`);
chk("instruments preserved", inputs.instruments.length===sc.instruments.length, `got ${inputs.instruments.length}`);
chk("debt terms preserved", (()=>{const d=inputs.instruments.find(x=>x.kind==="debt"); return d && d.amount===10_000_000 && d.tenorMonths===120 && d.graceMonths===24;})());
chk("grant preserved", (()=>{const g=inputs.instruments.find(x=>x.kind==="grant"); return g && g.amount===2_500_000;})());

const a = runModel(sc), b = runModel(inputs);
const keys=["revenue","cogs","ebitda","depreciation","netIncome","cfo","cfi","cff","closingCash","projectFcf","equityFcf"];
let maxd=0;
for(const k of keys) for(let i=0;i<a.results.length;i++) maxd=Math.max(maxd, Math.abs(a.results[i][k]-b.results[i][k]));
chk("re-run reproduces every period to the cent", maxd<0.01, `max diff ${maxd.toExponential(2)}`);
chk("IRR identical after round-trip", Math.abs((a.valuation.projectIrr??0)-(b.valuation.projectIrr??0))<1e-12);
chk("NPV identical after round-trip", Math.abs(a.valuation.projectNpv-b.valuation.projectNpv)<0.01);

// Simulate a user editing the workbook in Excel: change the price for every year.
// The UnitEcon sheet carries each driver twice, as yearly inputs and as a
// per-period expansion, so only the first (input) row is touched.
const TOTAL_YEARS = 20;
const wb2 = buildWorkbook(sc);
const ws = wb2.getWorksheet("UnitEcon");
let priceRow = null;
ws.eachRow(r => { if (priceRow === null && String(r.getCell(1).value) === priceLabel) priceRow = r; });
for (let y = 0; y < TOTAL_YEARS; y++) priceRow.getCell(y + 2).value = 800;
const buf2 = await wb2.xlsx.writeBuffer();
const { inputs: edited } = await parseWorkbook(buf2);
chk("edited price is picked up on import", edited.revenue[0].unitCost.every(v => v === 800), `got ${edited.revenue[0].unitCost}`);
const m2 = runModel(edited);
chk("edited price changes revenue", m2.results[STEADY].revenue > a.results[STEADY].revenue);
chk("revenue scales exactly with price", Math.abs(m2.results[STEADY].revenue - a.results[STEADY].revenue*800/sc.revenue[0].unitCost[0])<0.01);

// A single-year edit must survive the round trip as a single-year change.
const wb3 = buildWorkbook(sc);
const ws3 = wb3.getWorksheet("UnitEcon");
let priceRow3 = null;
ws3.eachRow(r => { if (priceRow3 === null && String(r.getCell(1).value) === priceLabel) priceRow3 = r; });
priceRow3.getCell(2 + 5).value = 900; // Y6
const { inputs: oneYear } = await parseWorkbook(await wb3.xlsx.writeBuffer());
chk("a single-year price edit round-trips to that year only",
  oneYear.revenue[0].unitCost[5] === 900 &&
  oneYear.revenue[0].unitCost.filter(v => v === 900).length === 1,
  `got ${oneYear.revenue[0].unitCost}`);
const m3 = runModel(oneYear);
chk("a single-year price edit moves only that year's revenue",
  m3.results.every((r, i) => (m3.periods[i].year === 6 ? r.revenue > a.results[i].revenue : Math.abs(r.revenue - a.results[i].revenue) < 1e-6)));

// A workbook in the OLD format, with a single value in column B and nothing
// after it, must import as a flat series rather than zeroing years 2 to 10.
{
  const wbOld = buildWorkbook(sc);
  const wsOld = wbOld.getWorksheet("UnitEcon");
  let row = null;
  wsOld.eachRow(r => { if (row === null && String(r.getCell(1).value) === priceLabel) row = r; });
  for (let y = 1; y < TOTAL_YEARS; y++) row.getCell(y + 2).value = null; // leave only Y1
  const { inputs: legacy, notes: legacyNotes } = await parseWorkbook(await wbOld.xlsx.writeBuffer());
  chk("a single-value driver row imports as a flat series",
    legacy.revenue[0].unitCost.every(v => Math.abs(v - sc.revenue[0].unitCost[0]) < 1e-9),
    `got ${legacy.revenue[0].unitCost}`);
  chk("importing a short driver row is reported in the notes",
    legacyNotes.some(n => n.includes("carried the last value forward")));
  const mOld = runModel(legacy);
  chk("a legacy workbook still produces revenue in the final year", mOld.results[mOld.results.length - 1].revenue > 0);
}

// Inflation parameters must survive the round trip.
chk("opex inflation round-trips", Math.abs(inputs.parameters.opexInflation - sc.parameters.opexInflation) < 1e-12);
chk("compensation inflation round-trips", Math.abs(inputs.parameters.compensationInflation - sc.parameters.compensationInflation) < 1e-12);
chk("revenue inflation round-trips", Math.abs(inputs.parameters.revenueInflation - sc.parameters.revenueInflation) < 1e-12);
chk("COGS inflation round-trips", Math.abs(inputs.parameters.cogsInflation - sc.parameters.cogsInflation) < 1e-12);
chk("sustainable premium round-trips", Math.abs(inputs.parameters.sustainablePremium - sc.parameters.sustainablePremium) < 1e-12);

// The premium must survive as a live formula, not as a baked number: editing it
// in Excel has to reprice revenue.
{
  const wbP = buildWorkbook({ ...sc, parameters: { ...sc.parameters, sustainablePremium: 1.7 } });
  const { inputs: withPrem } = await parseWorkbook(await wbP.xlsx.writeBuffer());
  chk("a premium set before export round-trips", Math.abs(withPrem.parameters.sustainablePremium - 1.7) < 1e-12);
  const mp = runModel(withPrem);
  chk("the imported premium reprices revenue", Math.abs(mp.results[STEADY].revenue - a.results[STEADY].revenue * 1.7) < 0.01);
}

if(notes.length) console.log("  notes: "+notes.join(" | "));
console.log(fails===0 ? "\nROUND-TRIP OK\n" : `\n${fails} FAILED\n`);
process.exit(fails?1:0);
