import ExcelJS from "exceljs";
import { buildPeriods, TOTAL_YEARS } from "../model/periods";
import { extendYearly, normaliseGroup } from "../model/normalise";
import { runGroup } from "../model/group";
import { buildDebtFlows } from "../model/finance";
import { runModel } from "../model/engine";
import type { Period, ScenarioInputs } from "../model/types";

/**
 * Export a scenario as a LIVE Excel model.
 *
 * P&L, Cashflow and Summary are written as real Excel formulas that reference the
 * input tabs, so editing price, utilisation, CAPEX phasing, FTEs or OPEX in Excel
 * recalculates the whole model. Debt amortisation schedules are written as values
 * (monthly amortisation cannot be expressed as a single-row formula); this is
 * labelled in the workbook.
 *
 * Layout: column A = label, period i occupies column i + 2 (B onwards).
 */

const FIRST_COL = 2;
const BRAND = "0B7BFF";
const BRAND_LIGHT = "E6F1FF";
const NUM = "#,##0";
const PCT = "0.0%";

/** Zero-based column offset from B -> Excel column letter (0 -> B, 9 -> K). */
export function colAt(i: number): string {
  return col(i);
}

/** Period index -> Excel column letter. */
export function col(i: number): string {
  let n = i + FIRST_COL;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface RowRef {
  sheet: string;
  row: number;
}

class Book {
  private refs = new Map<string, RowRef>();
  constructor(public wb: ExcelJS.Workbook, public periods: Period[]) {}
  get n() {
    return this.periods.length;
  }
  set(key: string, sheet: string, row: number) {
    this.refs.set(key, { sheet, row });
  }
  /** Reference to a period cell, e.g. 'P&L'!D12 */
  at(key: string, i: number): string {
    const e = this.refs.get(key);
    if (!e) throw new Error(`Unknown row: ${key}`);
    return `'${e.sheet}'!${col(i)}${e.row}`;
  }
  /** Reference to a scalar in column B, e.g. 'Parameters'!B5 */
  scalar(key: string): string {
    const e = this.refs.get(key);
    if (!e) throw new Error(`Unknown row: ${key}`);
    return `'${e.sheet}'!$B$${e.row}`;
  }
  row(key: string): number {
    const e = this.refs.get(key);
    if (!e) throw new Error(`Unknown row: ${key}`);
    return e.row;
  }
}

function header(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND}` } };
    c.alignment = { horizontal: "center" };
  });
}
function subtotal(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND_LIGHT}` } };
  });
}
function titleRow(ws: ExcelJS.Worksheet, text: string) {
  const r = ws.addRow([text]);
  r.font = { bold: true, size: 12, color: { argb: `FF${BRAND}` } };
  return r;
}
function fitArr(values: number[] | undefined, n: number): number[] {
  const out = new Array(n).fill(0);
  if (!values) return out;
  for (let i = 0; i < Math.min(values.length, n); i++) out[i] = Number(values[i]) || 0;
  return out;
}

/** Add a row of formulas across all periods. */
function formulaRow(
  ws: ExcelJS.Worksheet,
  label: string,
  n: number,
  make: (i: number) => string,
  fmt = NUM
): ExcelJS.Row {
  const row = ws.addRow([label]);
  for (let i = 0; i < n; i++) {
    const cell = row.getCell(i + FIRST_COL);
    cell.value = { formula: make(i) } as ExcelJS.CellFormulaValue;
    cell.numFmt = fmt;
  }
  return row;
}

export function buildWorkbook(inputs: ScenarioInputs): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "XFuel C2 portal";
  wb.created = new Date();

  const periods = buildPeriods(inputs.parameters.startMonth);
  const n = periods.length;
  const B = new Book(wb, periods);
  const p = inputs.parameters;

  const periodHeader = (ws: ExcelJS.Worksheet, first = "Line") =>
    header(ws.addRow([first, ...periods.map((x) => x.label)]));

  // ======================= Parameters =======================
  const wsP = wb.addWorksheet("Parameters");
  wsP.columns = [{ width: 44 }, { width: 18 }];
  titleRow(wsP, "XFuel C2 — global parameters (inputs)");
  wsP.addRow([]);
  const scalars: [string, string, string | number, string?][] = [
    ["Scenario name", "scenario_name", inputs.name],
    ["Plan start month (YYYY-MM)", "start_month", p.startMonth],
    ["Operations start (period index, 0-based)", "ops_start", p.opsStartPeriod],
    ["Corporate income tax rate", "citr", p.citr, PCT],
    ["DSO (days)", "dso", p.dso],
    ["DPO (days)", "dpo", p.dpo],
    ["WACC (project discount rate)", "wacc", p.wacc, PCT],
    ["Cost of equity", "koe", p.costOfEquity, PCT],
    ["Exit EV/EBITDA multiple", "exit_multiple", p.exitMultiple, '0.0"x"'],
    ["Opening cash", "opening_cash", p.openingCash, NUM],
    ["OPEX inflation (p.a.)", "opex_infl", p.opexInflation, PCT],
    ["Compensation inflation (p.a.)", "comp_infl", p.compensationInflation, PCT],
  ];
  for (const [label, key, value, fmt] of scalars) {
    const r = wsP.addRow([label, value]);
    if (fmt) r.getCell(2).numFmt = fmt;
    B.set(key, "Parameters", r.number);
  }
  wsP.addRow([]);
  const note = wsP.addRow([
    "Live workbook: P&L, Cashflow and Summary are Excel formulas driven by the input tabs. Edit an input and Excel recalculates.",
  ]);
  note.font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // ======================= CAPEX =======================
  const wsC = wb.addWorksheet("CAPEX");
  wsC.columns = [{ width: 40 }, ...periods.map(() => ({ width: 13 }))];
  titleRow(wsC, "CAPEX — phasing, spend and depreciation");
  wsC.addRow([]);
  periodHeader(wsC, "Concept");

  const monthsRowC = wsC.addRow(["Months in period", ...periods.map((x) => x.months)]);
  B.set("months", "CAPEX", monthsRowC.number);
  // Plan year of each period. Yearly drivers are expanded to periods with
  // INDEX(<yearly row>, 1, <this cell>), which keeps the link live: editing a
  // year on the UnitEcon sheet recalculates every month in that year.
  const yearRowC = wsC.addRow(["Plan year", ...periods.map((x) => x.year)]);
  B.set("plan_year", "CAPEX", yearRowC.number);
  wsC.addRow([]);

  const spendRows: number[] = [];
  const depRows: number[] = [];

  for (const line of inputs.capex) {
    const totalRow = wsC.addRow([`${line.label} — total cost`, line.total]);
    totalRow.getCell(2).numFmt = NUM;
    totalRow.font = { bold: true };
    B.set(`capex_total_${line.id}`, "CAPEX", totalRow.number);

    const rateRow = wsC.addRow([`${line.label} — monthly depreciation rate`, line.depRateMonthly]);
    rateRow.getCell(2).numFmt = "0.0000%";
    B.set(`capex_rate_${line.id}`, "CAPEX", rateRow.number);

    const phasing = new Array(n).fill(0);
    const start = Math.min(Math.max(line.startPeriod ?? 0, 0), n - 1);
    (line.phasing ?? []).forEach((v, k) => {
      if (start + k < n) phasing[start + k] = Number(v) || 0;
    });
    const phaseRow = wsC.addRow([`${line.label} — phasing %`, ...phasing]);
    for (let i = 0; i < n; i++) phaseRow.getCell(i + FIRST_COL).numFmt = PCT;

    const spend = formulaRow(wsC, `${line.label} — spend`, n, (i) => `$B$${totalRow.number}*${col(i)}${phaseRow.number}`);
    spendRows.push(spend.number);

    const cumCost = formulaRow(wsC, `${line.label} — cumulative cost`, n, (i) =>
      i === 0 ? `${col(i)}${spend.number}` : `${col(i - 1)}${spend.number + 1}+${col(i)}${spend.number}`
    );

    // depreciation row, and the accumulated row that follows it
    const depRow = wsC.addRow([`${line.label} — depreciation`]);
    const accRowNumber = depRow.number + 1;
    for (let i = 0; i < n; i++) {
      const cell = depRow.getCell(i + FIRST_COL);
      const cost = `${col(i)}${cumCost.number}`;
      const prevAcc = i === 0 ? "0" : `${col(i - 1)}${accRowNumber}`;
      cell.value = {
        formula: `IF(${i}<${B.scalar("ops_start")},0,MAX(0,MIN(${cost}*$B$${rateRow.number}*${col(i)}${monthsRowC.number},${cost}-${prevAcc})))`,
      } as ExcelJS.CellFormulaValue;
      cell.numFmt = NUM;
    }
    depRows.push(depRow.number);

    formulaRow(wsC, `${line.label} — accumulated depreciation`, n, (i) =>
      i === 0 ? `${col(i)}${depRow.number}` : `${col(i - 1)}${accRowNumber}+${col(i)}${depRow.number}`
    );
    wsC.addRow([]);
  }

  const totalSpend = formulaRow(wsC, "Total CAPEX spend", n, (i) =>
    spendRows.length ? spendRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  subtotal(totalSpend);
  B.set("capex_spend", "CAPEX", totalSpend.number);

  const cumDeployed = formulaRow(wsC, "Cumulative deployed CAPEX", n, (i) =>
    i === 0 ? `${col(i)}${totalSpend.number}` : `${col(i - 1)}${totalSpend.number + 1}+${col(i)}${totalSpend.number}`
  );
  subtotal(cumDeployed);
  B.set("capex_cum", "CAPEX", cumDeployed.number);

  const totalDep = formulaRow(wsC, "Total depreciation", n, (i) =>
    depRows.length ? depRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  subtotal(totalDep);
  B.set("dep_total", "CAPEX", totalDep.number);

  // ======================= Unit economics =======================
  const wsU = wb.addWorksheet("UnitEcon");
  wsU.columns = [{ width: 42 }, ...periods.map(() => ({ width: 13 }))];
  titleRow(wsU, "Unit economics — revenue and COGS drivers");
  wsU.addRow([]);
  const ue = inputs.unitEconomics;
  const YEARS = TOTAL_YEARS;
  const lastYearCol = colAt(YEARS - 1); // yearly block occupies B..K for 10 years

  // Yearly inputs. Each driver gets one row across Y1..Y10.
  const yearHead = wsU.addRow(["Driver — by plan year", ...Array.from({ length: YEARS }, (_, y) => `Y${y + 1}`)]);
  header(yearHead);
  const ueYearly: [string, string, number[], string?][] = [
    ["Price per ton MGO (EUR)", "price", extendYearly(ue.pricePerTon), "#,##0.00"],
    ["Annual operating hours at 100%", "hours_year", extendYearly(ue.annualHours)],
    ["MGO yield (kg/h)", "mgo_kgh", extendYearly(ue.mgoYieldKgPerHour)],
    ["MTS input (kg/h)", "mts_kgh", extendYearly(ue.mtsInputKgPerHour)],
    ["Reactant input (kg/h)", "react_kgh", extendYearly(ue.reactantInputKgPerHour)],
    ["Residue yield (kg/h)", "residue_kgh", extendYearly(ue.residueYieldKgPerHour)],
    ["Water yield (kg/h)", "water_kgh", extendYearly(ue.waterYieldKgPerHour)],
    ["MTS cost per ton", "mts_cost", extendYearly(ue.mtsCostPerTon), "#,##0.00"],
    ["Reactant cost per ton", "react_cost", extendYearly(ue.reactantCostPerTon), "#,##0.00"],
    ["Residue cost per ton", "residue_cost", extendYearly(ue.residueCostPerTon), "#,##0.00"],
    ["Water cost per ton", "water_cost", extendYearly(ue.waterCostPerTon), "#,##0.00"],
    ["Electricity price per kWh", "elec_price", extendYearly(ue.electricityPricePerKwh), "#,##0.0000"],
    ["Electricity consumption (kWh/h)", "elec_kwh", extendYearly(ue.electricityKwhPerHour), "#,##0.00"],
    ["Heat price per kWh", "heat_price", extendYearly(ue.heatPricePerKwh), "#,##0.0000"],
    ["Heat consumption (kWh/h)", "heat_kwh", extendYearly(ue.heatKwhPerHour), "#,##0.00"],
    ["Maintenance % p.a. of deployed CAPEX", "maint_pct", extendYearly(ue.maintenancePctOfCapex), PCT],
  ];
  const yearlyRowNo: Record<string, number> = {};
  for (const [label, key, values, fmt] of ueYearly) {
    const r = wsU.addRow([label, ...values]);
    if (fmt) for (let y = 0; y < YEARS; y++) r.getCell(y + FIRST_COL).numFmt = fmt;
    yearlyRowNo[key] = r.number;
  }

  wsU.addRow([]);
  periodHeader(wsU, "Driver — expanded to periods");
  for (const [label, key, , fmt] of ueYearly) {
    const rowNo = yearlyRowNo[key];
    const r = formulaRow(
      wsU, label, n,
      (i) => `INDEX($B$${rowNo}:$${lastYearCol}$${rowNo},1,${B.at("plan_year", i)})`,
      fmt ?? NUM
    );
    B.set(key, "UnitEcon", r.number);
  }

  const capacity = formulaRow(
    wsU, "Nameplate capacity (t/y)", n,
    (i) => `${B.at("mgo_kgh", i)}*${B.at("hours_year", i)}/1000`,
    "#,##0.0"
  );
  B.set("capacity", "UnitEcon", capacity.number);

  wsU.addRow([]);
  periodHeader(wsU, "Volume");
  const utilRow = wsU.addRow(["Capacity utilisation %", ...fitArr(ue.utilisation, n)]);
  for (let i = 0; i < n; i++) utilRow.getCell(i + FIRST_COL).numFmt = PCT;
  B.set("util", "UnitEcon", utilRow.number);

  const hoursRow = formulaRow(
    wsU, "Operating hours", n,
    (i) => `${B.at("hours_year", i)}/12*${B.at("months", i)}*${col(i)}${utilRow.number}`,
    "#,##0.0"
  );
  B.set("hours", "UnitEcon", hoursRow.number);

  const tonsRow = formulaRow(
    wsU, "Tons produced", n,
    (i) => `${B.at("capacity", i)}/12*${B.at("months", i)}*${col(i)}${utilRow.number}`,
    "#,##0.0"
  );
  B.set("tons", "UnitEcon", tonsRow.number);

  // ======================= OPEX =======================
  const wsO = wb.addWorksheet("OPEX");
  wsO.columns = [{ width: 42 }, ...periods.map(() => ({ width: 13 }))];
  titleRow(wsO, "OPEX — personnel and other categories");
  wsO.addRow([]);
  periodHeader(wsO, "Line");

  // Escalation factors, expanded per period so every downstream formula stays
  // live: change the rate on the Parameters sheet and the whole plan reprices.
  const compFactor = formulaRow(
    wsO, "Compensation escalation factor", n,
    (i) => `POWER(1+${B.scalar("comp_infl")},${B.at("plan_year", i)}-1)`,
    "0.000"
  );
  const opexFactor = formulaRow(
    wsO, "OPEX escalation factor", n,
    (i) => `POWER(1+${B.scalar("opex_infl")},${B.at("plan_year", i)}-1)`,
    "0.000"
  );
  wsO.addRow([]);

  const personnelRows: number[] = [];
  for (const arch of inputs.personnel) {
    const costRow = wsO.addRow([`${arch.label} — annual cost per FTE`, arch.annualCost]);
    costRow.getCell(2).numFmt = NUM;
    const fteRow = wsO.addRow([`${arch.label} — FTEs`, ...fitArr(arch.ftes, n)]);
    for (let i = 0; i < n; i++) fteRow.getCell(i + FIRST_COL).numFmt = "0.00";
    const out = formulaRow(
      wsO, `${arch.label} — cost`, n,
      (i) =>
        `$B$${costRow.number}*${col(i)}${compFactor.number}*${col(i)}${fteRow.number}*${B.at("months", i)}/12`
    );
    personnelRows.push(out.number);
  }
  const personnelTotal = formulaRow(wsO, "Total personnel", n, (i) =>
    personnelRows.length ? personnelRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  subtotal(personnelTotal);
  B.set("opex_personnel", "OPEX", personnelTotal.number);

  wsO.addRow([]);
  const otherRows: number[] = [];
  for (const cat of inputs.opex) {
    const amtRow = wsO.addRow([`${cat.label} — amount`, ...fitArr(cat.amounts, n)]);
    for (let i = 0; i < n; i++) amtRow.getCell(i + FIRST_COL).numFmt = NUM;
    if (cat.pctOfCapexPerAnnum) {
      const pctRow = wsO.addRow([`${cat.label} — % p.a. of deployed CAPEX`, cat.pctOfCapexPerAnnum]);
      pctRow.getCell(2).numFmt = PCT;
      // The CAPEX-linked component is not escalated: it already moves with the
      // deployed asset base, so inflating it too would double count.
      const out = formulaRow(
        wsO, `${cat.label} — total`, n,
        (i) =>
          `${col(i)}${amtRow.number}*${col(i)}${opexFactor.number}` +
          `+$B$${pctRow.number}*${B.at("capex_cum", i)}*${B.at("months", i)}/12`
      );
      otherRows.push(out.number);
    } else {
      const out = formulaRow(
        wsO, `${cat.label} — total`, n,
        (i) => `${col(i)}${amtRow.number}*${col(i)}${opexFactor.number}`
      );
      otherRows.push(out.number);
    }
  }
  const otherTotal = formulaRow(wsO, "Total other OPEX", n, (i) =>
    otherRows.length ? otherRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  subtotal(otherTotal);
  B.set("opex_other", "OPEX", otherTotal.number);

  // ======================= Financing =======================
  const wsF = wb.addWorksheet("Financing");
  wsF.columns = [
    { width: 32 }, { width: 12 }, { width: 15 }, { width: 13 }, { width: 10 },
    { width: 11 }, { width: 11 }, { width: 12 }, { width: 12 },
  ];
  titleRow(wsF, "Financing instruments");
  wsF.addRow([]);
  header(
    wsF.addRow(["Instrument", "Type", "Amount", "Draw period", "Rate", "Grace (m)", "Tenor (m)", "Profile", "Upfront fee"])
  );
  for (const inst of inputs.instruments) {
    const r = wsF.addRow([
      inst.label, inst.kind, inst.amount, inst.drawPeriod,
      inst.rate ?? "", inst.graceMonths ?? "", inst.tenorMonths ?? "",
      inst.repayment ?? "", inst.upfrontFeePct ?? "",
    ]);
    r.getCell(3).numFmt = NUM;
    r.getCell(5).numFmt = PCT;
    r.getCell(9).numFmt = PCT;
  }
  wsF.addRow([]);
  const fnote = wsF.addRow([
    "Schedules below are computed by the portal engine and written as values: monthly amortisation cannot be expressed as one row of Excel formulas. Change an instrument in the portal and re-export.",
  ]);
  fnote.font = { italic: true, size: 9, color: { argb: "FF666666" } };
  wsF.addRow([]);
  periodHeader(wsF, "Schedule");

  // Aggregate instrument flows from the engine.
  const draws = new Array(n).fill(0);
  const repayments = new Array(n).fill(0);
  const interest = new Array(n).fill(0);
  const balances = new Array(n).fill(0);
  const equity = new Array(n).fill(0);
  const grants = new Array(n).fill(0);
  for (const inst of inputs.instruments) {
    const idx = Math.min(Math.max(Math.round(inst.drawPeriod ?? 0), 0), n - 1);
    if (inst.kind === "debt") {
      const f = buildDebtFlows(inst, periods);
      for (let i = 0; i < n; i++) {
        draws[i] += f.draw[i];
        repayments[i] += f.principalRepayment[i];
        interest[i] += f.interest[i] + f.fees[i];
        balances[i] += f.balance[i];
      }
    } else if (inst.kind === "grant") {
      grants[idx] += inst.amount;
    } else {
      equity[idx] += inst.amount;
    }
  }
  const addValueRow = (label: string, values: number[], key?: string) => {
    const r = wsF.addRow([label, ...values]);
    for (let i = 0; i < n; i++) r.getCell(i + FIRST_COL).numFmt = NUM;
    if (key) B.set(key, "Financing", r.number);
    return r;
  };
  addValueRow("Debt drawdown", draws, "debt_draw");
  addValueRow("Debt repayment", repayments, "debt_repay");
  addValueRow("Interest expense (incl. fees)", interest, "interest");
  addValueRow("Debt balance (closing)", balances, "debt_balance");
  addValueRow("Equity raised", equity, "equity_raise");
  addValueRow("Grants collected", grants, "grant_cash");

  // ======================= P&L =======================
  const wsPL = wb.addWorksheet("P&L");
  wsPL.columns = [{ width: 42 }, ...periods.map(() => ({ width: 13 }))];
  titleRow(wsPL, "Profit & loss (EUR)");
  wsPL.addRow([]);
  periodHeader(wsPL, "P&L");

  const revenue = formulaRow(wsPL, "Revenue", n, (i) => `${B.at("tons", i)}*${B.at("price", i)}`);
  B.set("revenue", "P&L", revenue.number);

  const energy = formulaRow(wsPL, "COGS — energy", n, (i) =>
    `${B.at("hours", i)}*(${B.at("elec_price", i)}*${B.at("elec_kwh", i)}+${B.at("heat_price", i)}*${B.at("heat_kwh", i)})`
  );
  const mts = formulaRow(wsPL, "COGS — MTS feedstock", n, (i) =>
    `${B.at("hours", i)}*${B.at("mts_kgh", i)}*${B.at("mts_cost", i)}/1000`
  );
  const reactants = formulaRow(wsPL, "COGS — reactants", n, (i) =>
    `${B.at("hours", i)}*${B.at("react_kgh", i)}*${B.at("react_cost", i)}/1000`
  );
  const residue = formulaRow(wsPL, "COGS — residue disposal", n, (i) =>
    `${B.at("hours", i)}*${B.at("residue_kgh", i)}*${B.at("residue_cost", i)}/1000`
  );
  const water = formulaRow(wsPL, "COGS — water", n, (i) =>
    `${B.at("hours", i)}*${B.at("water_kgh", i)}*${B.at("water_cost", i)}/1000`
  );
  const maintenance = formulaRow(wsPL, "COGS — maintenance", n, (i) =>
    `${B.at("maint_pct", i)}*${B.at("capex_cum", i)}*${B.at("months", i)}*${B.at("util", i)}/12`
  );
  const cogs = formulaRow(wsPL, "Total COGS", n, (i) =>
    [energy, mts, reactants, residue, water, maintenance].map((r) => `${col(i)}${r.number}`).join("+")
  );
  subtotal(cogs);
  const grossMargin = formulaRow(wsPL, "Gross margin", n, (i) => `${col(i)}${revenue.number}-${col(i)}${cogs.number}`);
  subtotal(grossMargin);

  const opexPers = formulaRow(wsPL, "OPEX — personnel", n, (i) => B.at("opex_personnel", i));
  const opexOth = formulaRow(wsPL, "OPEX — other", n, (i) => B.at("opex_other", i));
  const opexTot = formulaRow(wsPL, "Total OPEX", n, (i) => `${col(i)}${opexPers.number}+${col(i)}${opexOth.number}`);
  subtotal(opexTot);

  const ebitda = formulaRow(wsPL, "EBITDA", n, (i) => `${col(i)}${grossMargin.number}-${col(i)}${opexTot.number}`);
  subtotal(ebitda);
  B.set("ebitda", "P&L", ebitda.number);

  const dep = formulaRow(wsPL, "Depreciation", n, (i) => B.at("dep_total", i));
  const ebit = formulaRow(wsPL, "EBIT", n, (i) => `${col(i)}${ebitda.number}-${col(i)}${dep.number}`);
  subtotal(ebit);

  const intRow = formulaRow(wsPL, "Interest expense", n, (i) => B.at("interest", i));
  const grantInc = formulaRow(wsPL, "Grant income", n, (i) => B.at("grant_cash", i));
  const pbt = formulaRow(wsPL, "Profit before tax", n, (i) =>
    `${col(i)}${ebit.number}-${col(i)}${intRow.number}+${col(i)}${grantInc.number}`
  );
  subtotal(pbt);
  B.set("pbt", "P&L", pbt.number);

  // NOL carry-forward: pool row then tax row.
  const nolRow = wsPL.addRow(["Loss carry-forward pool (closing)"]);
  const taxRow = wsPL.addRow(["Income tax"]);
  for (let i = 0; i < n; i++) {
    const prevPool = i === 0 ? "0" : `${col(i - 1)}${nolRow.number}`;
    const pbtCell = `${col(i)}${pbt.number}`;
    // pool = MAX(0, prevPool - PBT)  (grows on losses, shrinks on profits)
    nolRow.getCell(i + FIRST_COL).value = {
      formula: `MAX(0,${prevPool}-${pbtCell})`,
    } as ExcelJS.CellFormulaValue;
    nolRow.getCell(i + FIRST_COL).numFmt = NUM;
    // tax = MAX(0, PBT - prevPool) * CITR
    taxRow.getCell(i + FIRST_COL).value = {
      formula: `MAX(0,${pbtCell}-${prevPool})*${B.scalar("citr")}`,
    } as ExcelJS.CellFormulaValue;
    taxRow.getCell(i + FIRST_COL).numFmt = NUM;
  }
  B.set("tax", "P&L", taxRow.number);

  const netIncome = formulaRow(wsPL, "Net income", n, (i) => `${col(i)}${pbt.number}-${col(i)}${taxRow.number}`);
  subtotal(netIncome);
  B.set("net_income", "P&L", netIncome.number);
  B.set("dep_pl", "P&L", dep.number);
  B.set("grant_income", "P&L", grantInc.number);
  B.set("cogs_pl", "P&L", cogs.number);
  B.set("opex_pl", "P&L", opexTot.number);
  B.set("revenue_pl", "P&L", revenue.number);
  B.set("ebit_pl", "P&L", ebit.number);
  B.set("interest_pl", "P&L", intRow.number);

  // ======================= Cashflow =======================
  const wsCF = wb.addWorksheet("Cashflow");
  wsCF.columns = [{ width: 42 }, ...periods.map(() => ({ width: 13 }))];
  titleRow(wsCF, "Cash flow (EUR)");
  wsCF.addRow([]);
  periodHeader(wsCF, "Cash flow");

  const daysRow = wsCF.addRow(["Days in period", ...periods.map((x) => x.months * (365 / 12))]);
  for (let i = 0; i < n; i++) daysRow.getCell(i + FIRST_COL).numFmt = "#,##0.0";

  const arRow = formulaRow(wsCF, "Accounts receivable (closing)", n, (i) =>
    `IF(${col(i)}${daysRow.number}=0,0,${B.at("revenue_pl", i)}/${col(i)}${daysRow.number}*${B.scalar("dso")})`
  );
  const apRow = formulaRow(wsCF, "Accounts payable (closing)", n, (i) =>
    `IF(${col(i)}${daysRow.number}=0,0,(${B.at("cogs_pl", i)}+${B.at("opex_pl", i)})/${col(i)}${daysRow.number}*${B.scalar("dpo")})`
  );
  const dAr = formulaRow(wsCF, "Change in receivables", n, (i) =>
    i === 0 ? `-${col(i)}${arRow.number}` : `-(${col(i)}${arRow.number}-${col(i - 1)}${arRow.number})`
  );
  const dAp = formulaRow(wsCF, "Change in payables", n, (i) =>
    i === 0 ? `${col(i)}${apRow.number}` : `${col(i)}${apRow.number}-${col(i - 1)}${apRow.number}`
  );
  const owc = wsCF.addRow(["Other working capital", ...fitArr(p.otherWorkingCapital, n)]);
  for (let i = 0; i < n; i++) owc.getCell(i + FIRST_COL).numFmt = NUM;

  const cfo = formulaRow(wsCF, "Operating cash flow (CFO)", n, (i) =>
    `${B.at("net_income", i)}+${B.at("dep_pl", i)}-${B.at("grant_income", i)}+${col(i)}${dAr.number}+${col(i)}${dAp.number}+${col(i)}${owc.number}`
  );
  subtotal(cfo);

  const cfi = formulaRow(wsCF, "Investing cash flow (CFI)", n, (i) => `-${B.at("capex_spend", i)}`);
  subtotal(cfi);

  const cffDraw = formulaRow(wsCF, "  Debt drawdown", n, (i) => B.at("debt_draw", i));
  const cffRepay = formulaRow(wsCF, "  Debt repayment", n, (i) => `-${B.at("debt_repay", i)}`);
  const cffEq = formulaRow(wsCF, "  Equity raised", n, (i) => B.at("equity_raise", i));
  const cffGrant = formulaRow(wsCF, "  Grants collected", n, (i) => B.at("grant_cash", i));
  const cff = formulaRow(wsCF, "Financing cash flow (CFF)", n, (i) =>
    [cffDraw, cffRepay, cffEq, cffGrant].map((r) => `${col(i)}${r.number}`).join("+")
  );
  subtotal(cff);

  const netCf = formulaRow(wsCF, "Net cash flow", n, (i) =>
    `${col(i)}${cfo.number}+${col(i)}${cfi.number}+${col(i)}${cff.number}`
  );
  subtotal(netCf);

  const openCash = wsCF.addRow(["Opening cash"]);
  const closeCash = wsCF.addRow(["Closing cash"]);
  for (let i = 0; i < n; i++) {
    openCash.getCell(i + FIRST_COL).value = {
      formula: i === 0 ? B.scalar("opening_cash") : `${col(i - 1)}${closeCash.number}`,
    } as ExcelJS.CellFormulaValue;
    openCash.getCell(i + FIRST_COL).numFmt = NUM;
    closeCash.getCell(i + FIRST_COL).value = {
      formula: `${col(i)}${openCash.number}+${col(i)}${netCf.number}`,
    } as ExcelJS.CellFormulaValue;
    closeCash.getCell(i + FIRST_COL).numFmt = NUM;
  }
  subtotal(closeCash);
  B.set("closing_cash", "Cashflow", closeCash.number);
  B.set("cfo", "Cashflow", cfo.number);
  B.set("cfi", "Cashflow", cfi.number);
  B.set("cff", "Cashflow", cff.number);
  B.set("net_cf", "Cashflow", netCf.number);

  // Valuation flows.
  // Project FCF is taxed on an unlevered basis: no interest shield, and its own
  // loss carry-forward pool, so it must not reuse the levered tax line.
  wsCF.addRow([]);
  const pbtU = formulaRow(wsCF, "Unlevered PBT (EBIT + grants)", n, (i) =>
    `${B.at("ebit_pl", i)}+${B.at("grant_income", i)}`
  );
  const nolU = wsCF.addRow(["Unlevered loss carry-forward pool"]);
  const taxU = wsCF.addRow(["Unlevered tax"]);
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? "0" : `${col(i - 1)}${nolU.number}`;
    const pbtCell = `${col(i)}${pbtU.number}`;
    nolU.getCell(i + FIRST_COL).value = { formula: `MAX(0,${prev}-${pbtCell})` } as ExcelJS.CellFormulaValue;
    nolU.getCell(i + FIRST_COL).numFmt = NUM;
    taxU.getCell(i + FIRST_COL).value = {
      formula: `MAX(0,${pbtCell}-${prev})*${B.scalar("citr")}`,
    } as ExcelJS.CellFormulaValue;
    taxU.getCell(i + FIRST_COL).numFmt = NUM;
  }

  const projFcf = formulaRow(wsCF, "Project FCF (unlevered)", n, (i) =>
    `${B.at("ebitda", i)}+${B.at("grant_income", i)}-${col(i)}${taxU.number}-${B.at("capex_spend", i)}+${col(i)}${dAr.number}+${col(i)}${dAp.number}+${col(i)}${owc.number}`
  );
  const eqFcf = formulaRow(wsCF, "Equity FCF (levered)", n, (i) =>
    `${col(i)}${cfo.number}+${col(i)}${cfi.number}+${B.at("debt_draw", i)}-${B.at("debt_repay", i)}+${B.at("grant_cash", i)}`
  );
  B.set("proj_fcf", "Cashflow", projFcf.number);
  B.set("eq_fcf", "Cashflow", eqFcf.number);

  // ======================= Summary =======================
  const model = runModel(inputs);
  const wsS = wb.addWorksheet("Summary");
  wsS.columns = [{ width: 40 }, ...Array.from({ length: 12 }, () => ({ width: 15 }))];
  titleRow(wsS, "Summary — annual P&L, cash flow and returns");
  wsS.addRow([]);

  const years = model.annual.map((a) => a.label);
  header(wsS.addRow(["Annual P&L", ...years]));
  const yearCols = model.annual.map((_, k) => col(k));
  // Sum the period columns belonging to each year.
  const yearRanges = model.annual.map((a) => {
    const idx = periods.map((pp, i) => (pp.year === a.year ? i : -1)).filter((i) => i >= 0);
    return { from: idx[0], to: idx[idx.length - 1] };
  });
  const annualRow = (label: string, key: string, fmt = NUM) => {
    const r = wsS.addRow([label]);
    yearRanges.forEach((range, k) => {
      const e = B.at(key, range.from);
      const sheet = e.split("!")[0];
      const rowNo = e.split("!")[1].replace(/[A-Z]+/, "");
      const cell = r.getCell(k + FIRST_COL);
      cell.value = {
        formula: `SUM(${sheet}!${col(range.from)}${rowNo}:${col(range.to)}${rowNo})`,
      } as ExcelJS.CellFormulaValue;
      cell.numFmt = fmt;
    });
    return r;
  };
  annualRow("Revenue", "revenue_pl");
  annualRow("COGS", "cogs_pl");
  annualRow("Total OPEX", "opex_pl");
  subtotal(annualRow("EBITDA", "ebitda"));
  annualRow("Depreciation", "dep_pl");
  subtotal(annualRow("EBIT", "ebit_pl"));
  annualRow("Interest expense", "interest_pl");
  annualRow("Grant income", "grant_income");
  subtotal(annualRow("Profit before tax", "pbt"));
  annualRow("Income tax", "tax");
  subtotal(annualRow("Net income", "net_income"));

  wsS.addRow([]);
  header(wsS.addRow(["Annual cash flow", ...years]));
  annualRow("CFO", "cfo");
  annualRow("CFI", "cfi");
  annualRow("CFF", "cff");
  subtotal(annualRow("Net cash flow", "net_cf"));
  const closingRow = wsS.addRow(["Closing cash"]);
  yearRanges.forEach((range, k) => {
    const cell = closingRow.getCell(k + FIRST_COL);
    cell.value = { formula: `'Cashflow'!${col(range.to)}${B.row("closing_cash")}` } as ExcelJS.CellFormulaValue;
    cell.numFmt = NUM;
  });
  subtotal(closingRow);

  // Returns block: computed by the engine, written as values with the inputs beside them.
  wsS.addRow([]);
  header(wsS.addRow(["Returns", "Value"]));
  const v = model.valuation;
  const returns: [string, number | string, string?][] = [
    ["Exit EV/EBITDA multiple", p.exitMultiple, '0.0"x"'],
    ["OPEX inflation (p.a.)", p.opexInflation, PCT],
    ["Compensation inflation (p.a.)", p.compensationInflation, PCT],
    ["Terminal value — enterprise", v.terminalValueEnterprise, NUM],
    ["Net debt at exit", v.netDebtAtExit, NUM],
    ["Terminal value — equity", v.terminalValueEquity, NUM],
    ["Project IRR (unlevered)", v.projectIrr ?? "n/a", PCT],
    ["Project NPV at WACC", v.projectNpv, NUM],
    ["Equity IRR (levered)", v.equityIrr ?? "n/a", PCT],
    ["Equity NPV at cost of equity", v.equityNpv, NUM],
  ];
  for (const [label, value, fmt] of returns) {
    const r = wsS.addRow([label, value]);
    if (fmt && typeof value === "number") r.getCell(2).numFmt = fmt;
  }
  const rnote = wsS.addRow([
    "IRR and NPV are computed by the portal engine (Excel cannot express the period-weighted discounting in one cell). All other Summary figures are live formulas.",
  ]);
  rnote.font = { italic: true, size: 9, color: { argb: "FF666666" } };

  if (model.warnings.length) {
    wsS.addRow([]);
    const wr = wsS.addRow(["Warnings"]);
    wr.font = { bold: true, color: { argb: "FFB00020" } };
    for (const w of model.warnings) wsS.addRow([w]).font = { size: 9, color: { argb: "FFB00020" } };
  }

  // ======================= XFuel group =======================
  // Values rather than formulas: the group view restates the C2 model on a
  // different (calendar) grid, and the period-to-month mapping is not something
  // a single-row Excel formula can express without a lookup table per period.
  // The sheet is labelled so nobody edits it expecting a recalculation.
  {
    const group = normaliseGroup(inputs.group);
    const g = runGroup(inputs, model, group);
    const wsG = wb.addWorksheet("XFuelTotal");
    wsG.columns = [{ width: 42 }, ...g.months.map(() => ({ width: 13 })), { width: 15 }];
    titleRow(wsG, "XFuel group cash flow — values, not formulas");
    wsG.addRow(["C2 flows are mapped onto the calendar grid; edit inputs on the other tabs and re-export."]);
    wsG.addRow([]);

    const gHead = wsG.addRow(["Line", ...g.months.map((mm) => mm.label), "Total"]);
    header(gHead);
    const gRow = (label: string, values: number[], bold = false) => {
      const r = wsG.addRow([label, ...values, values.reduce((a, b) => a + b, 0)]);
      for (let i = 0; i < values.length + 1; i++) r.getCell(i + FIRST_COL).numFmt = NUM;
      if (bold) subtotal(r);
      return r;
    };

    gRow("Opening cash", g.results.map((r) => r.openingCash), true);
    for (const [key, label] of [["cfo", "Operating"], ["cfi", "Investing"], ["cff", "Financing"]] as const) {
      wsG.addRow([label]);
      gRow(`  ${label} — C2`, g.results.map((r) => r[`${key}C2` as "cfoC2"]));
      for (const line of group.lines.filter((l) => l.section === key)) {
        gRow(`  ${line.label}`, line.amounts);
      }
      gRow(`  Total ${label.toLowerCase()}`, g.results.map((r) => r[key]), true);
    }
    gRow("Net cash flow", g.results.map((r) => r.netCashFlow), true);
    gRow("Closing cash", g.results.map((r) => r.closingCash), true);

    wsG.addRow([]);
    const bHead = wsG.addRow(["Cash bridge", "Amount"]);
    header(bHead);
    const bRow = (label: string, amount: number, bold = false) => {
      const r = wsG.addRow([label, amount]);
      r.getCell(2).numFmt = NUM;
      if (bold) subtotal(r);
    };
    bRow(`Cash 30/06/${g.months[0].year}`, g.openingCash, true);
    for (const b of g.blocks) {
      bRow(b.label, b.amount, true);
      for (const it of b.items) bRow(`    ${it.label}`, it.amount);
    }
    bRow(`Cash 31/12/${g.months[g.months.length - 1].year}`, g.closingCash, true);
    bRow("Reconciliation check (should be zero)", g.bridgeCheck);
  }

  return wb;
}

export async function workbookToBuffer(inputs: ScenarioInputs): Promise<ArrayBuffer> {
  const wb = buildWorkbook(inputs);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
