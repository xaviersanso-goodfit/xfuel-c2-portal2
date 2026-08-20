import ExcelJS from "exceljs";
import { buildPeriods, parseStartMonth, TOTAL_YEARS } from "../model/periods";
import { extendYearly, normaliseGroup } from "../model/normalise";
import { runGroup } from "../model/group";
import { buildDebtFlows } from "../model/finance";
import { runModel } from "../model/engine";
import { BASIS_FIELD_LABELS, BASIS_USES } from "../model/components";
import type { ModelComponent } from "../model/components";
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

/**
 * Excel expression for one component in one period, mirroring the engine's
 * evaluate(). The two must agree line for line: a divergence here shows up as
 * an exported workbook that disagrees with the portal it came from.
 *
 * `tons` is passed in because revenue lines are driven by their own stream
 * tonnage while COGS and OPEX lines are driven by total production.
 */
function componentExpr(
  B: Book, c: ModelComponent, prefix: string, i: number, tons: string
): string {
  // Looked up lazily: a basis that does not use a field has no row for it.
  const q = () => B.at(`${prefix}_${c.id}_q`, i);
  const u = () => B.at(`${prefix}_${c.id}_u`, i);
  switch (c.basis) {
    case "perHour":
      return `${B.at("hours", i)}*${q()}*${u()}/1000`;
    case "perKwh":
      return `${B.at("hours", i)}*${q()}*${u()}`;
    case "perTon":
      return `${tons}*${u()}`;
    case "pctOfCapex":
      return `${q()}*${B.at("capex_cum", i)}*${B.at("months", i)}*${B.at("util", i)}/12`;
    case "fixedAnnual":
      return `${u()}*${B.at("months", i)}/12`;
    default:
      return "0";
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
    ["Revenue inflation (p.a.)", "rev_infl", p.revenueInflation, PCT],
    ["COGS inflation (p.a.)", "cogs_infl", p.cogsInflation, PCT],
    ["Sustainable premium (multiplier)", "premium", p.sustainablePremium, '0.00"x"'],
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
  const lastYearCol = colAt(YEARS - 1); // the yearly block occupies B..<lastYearCol>

  // Yearly drivers. Every component contributes its own rows, so renaming a
  // line or adding one changes the workbook without changing this code. The
  // component id, not the label, is the key, so a rename does not break the
  // round trip.
  const yearHead = wsU.addRow(["Driver — by plan year", ...Array.from({ length: YEARS }, (_, y) => `Y${y + 1}`)]);
  header(yearHead);

  const yearly: [string, string, number[], string?][] = [
    ["Annual operating hours at 100%", "hours_year", extendYearly(ue.annualHours)],
  ];
  for (const c of inputs.revenue) {
    yearly.push([`${c.name} — yield (kg/h)`, `rev_${c.id}_y`, extendYearly(c.yieldKgPerHour ?? [])]);
    if (BASIS_USES[c.basis].quantity) {
      yearly.push([`${c.name} — ${BASIS_FIELD_LABELS[c.basis].quantity}`, `rev_${c.id}_q`, extendYearly(c.quantity)]);
    }
    yearly.push([
      `${c.name} — ${BASIS_FIELD_LABELS[c.basis].unitCost}`, `rev_${c.id}_u`, extendYearly(c.unitCost), "#,##0.00",
    ]);
  }
  for (const c of inputs.cogs) {
    if (BASIS_USES[c.basis].quantity) {
      yearly.push([
        `${c.name} — ${BASIS_FIELD_LABELS[c.basis].quantity}`, `cogs_${c.id}_q`, extendYearly(c.quantity),
        c.basis === "pctOfCapex" ? PCT : "#,##0.00",
      ]);
    }
    if (BASIS_USES[c.basis].unitCost) {
      yearly.push([
        `${c.name} — ${BASIS_FIELD_LABELS[c.basis].unitCost}`, `cogs_${c.id}_u`, extendYearly(c.unitCost), "#,##0.0000",
      ]);
    }
  }
  for (const c of inputs.opex) {
    if (BASIS_USES[c.basis].quantity) {
      yearly.push([
        `${c.name} — ${BASIS_FIELD_LABELS[c.basis].quantity}`, `opex_${c.id}_q`, extendYearly(c.quantity),
        c.basis === "pctOfCapex" ? PCT : "#,##0.00",
      ]);
    }
    if (BASIS_USES[c.basis].unitCost) {
      yearly.push([
        `${c.name} — ${BASIS_FIELD_LABELS[c.basis].unitCost}`, `opex_${c.id}_u`, extendYearly(c.unitCost), NUM,
      ]);
    }
  }

  const yearlyRowNo: Record<string, number> = {};
  for (const [label, key, values, fmt] of yearly) {
    const r = wsU.addRow([label, ...values]);
    if (fmt) for (let y = 0; y < YEARS; y++) r.getCell(y + FIRST_COL).numFmt = fmt;
    yearlyRowNo[key] = r.number;
  }

  wsU.addRow([]);
  periodHeader(wsU, "Driver — expanded to periods");
  for (const [label, key, , fmt] of yearly) {
    const rowNo = yearlyRowNo[key];
    const r = formulaRow(
      wsU, label, n,
      (i) => `INDEX($B$${rowNo}:$${lastYearCol}$${rowNo},1,${B.at("plan_year", i)})`,
      fmt ?? NUM
    );
    B.set(key, "UnitEcon", r.number);
  }

  wsU.addRow([]);
  periodHeader(wsU, "Escalation");
  // Year 1 is the base, so the exponent is (plan year - 1). Quantities are
  // physical and never inflate; only the money does.
  const revFactor = formulaRow(
    wsU, "Revenue escalation factor", n,
    (i) => `POWER(1+${B.scalar("rev_infl")},${B.at("plan_year", i)}-1)`, "0.000"
  );
  B.set("rev_factor", "UnitEcon", revFactor.number);
  const cogsFactor = formulaRow(
    wsU, "COGS escalation factor", n,
    (i) => `POWER(1+${B.scalar("cogs_infl")},${B.at("plan_year", i)}-1)`, "0.000"
  );
  B.set("cogs_factor", "UnitEcon", cogsFactor.number);

  wsU.addRow([]);
  periodHeader(wsU, "Volume");
  // Nameplate capacity comes from the first revenue line, which is the primary
  // product by definition. With no revenue lines there is no capacity.
  const primary = inputs.revenue[0];
  const capacity = formulaRow(
    wsU, "Nameplate capacity (t/y)", n,
    (i) => (primary ? `${B.at(`rev_${primary.id}_y`, i)}*${B.at("hours_year", i)}/1000` : "0"),
    "#,##0.0"
  );
  B.set("capacity", "UnitEcon", capacity.number);

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
  for (const c of inputs.opex) {
    // The CAPEX-linked basis is not escalated: it already moves with the
    // deployed asset base, so inflating it too would double count.
    const out = formulaRow(
      wsO, `${c.name} — total`, n,
      (i) =>
        c.basis === "pctOfCapex"
          ? componentExpr(B, c, "opex", i, B.at("tons", i))
          : `(${componentExpr(B, c, "opex", i, B.at("tons", i))})*${col(i)}${opexFactor.number}`
    );
    otherRows.push(out.number);
  }
  const otherTotal = formulaRow(wsO, "Total other OPEX", n, (i) =>
    otherRows.length ? otherRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  subtotal(otherTotal);
  B.set("opex_other", "OPEX", otherTotal.number);

  // ======================= Financing =======================
  const wsF = wb.addWorksheet("Financing");
  wsF.columns = [
    { width: 34 }, { width: 13 }, { width: 15 }, { width: 13 }, { width: 10 },
    { width: 11 }, { width: 11 }, { width: 12 }, { width: 12 },
  ];
  titleRow(wsF, "Financing instruments");
  wsF.addRow([]);
  header(
    wsF.addRow(["Instrument", "Type", "Amount", "Draw period", "Rate", "Grace (m)", "Tenor (m)", "Profile", "Upfront fee"])
  );
  // Row number of each instrument's parameter row, so the schedules below can
  // point at them. This is what makes rate, grace, tenor and profile live.
  const instRow: Record<string, number> = {};
  for (const inst of inputs.instruments) {
    const r = wsF.addRow([
      inst.label, inst.kind, inst.amount, inst.drawPeriod,
      inst.rate ?? 0, inst.graceMonths ?? 0, inst.tenorMonths ?? 0,
      inst.repayment ?? "linear", inst.upfrontFeePct ?? 0,
    ]);
    r.getCell(3).numFmt = NUM;
    r.getCell(5).numFmt = "0.00%";
    r.getCell(9).numFmt = "0.00%";
    instRow[inst.id] = r.number;
  }
  wsF.addRow([]);
  const fnote = wsF.addRow([
    "The schedules below are live: they amortise month by month from the parameters above. Change a rate, grace, tenor or profile and the whole model reprices.",
  ]);
  fnote.font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // ---- monthly month-map -------------------------------------------------
  // Each period occupies a contiguous run of months. The layout is structural
  // (fixed by the plan grid, not by any input), so the ranges can be resolved
  // at export time; the values inside them are all formulas.
  const monthStart: number[] = [];
  {
    let cur = 0;
    for (const pd of periods) {
      monthStart.push(cur);
      cur += pd.months;
    }
  }
  const TOTAL_MONTHS = monthStart[n - 1] + periods[n - 1].months;
  /** Month index -> column letter on the monthly schedule sheet. */
  const mcol = (m: number) => col(m);

  // ---- one monthly amortisation block per debt instrument ----------------
  const wsD = wb.addWorksheet("DebtSchedule");
  wsD.columns = [{ width: 38 }, ...new Array(TOTAL_MONTHS).fill({ width: 11 })];
  titleRow(wsD, "Monthly debt amortisation — live formulas");
  wsD.addRow([
    "One column per month. Everything here is driven by the instrument parameters on the Financing sheet, so changing a rate or tenor reprices the plan.",
  ]).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  wsD.addRow([]);
  const mHead = wsD.addRow(["Month (0-based)", ...Array.from({ length: TOTAL_MONTHS }, (_, m) => m)]);
  header(mHead);

  const debtInstruments = inputs.instruments.filter((i) => i.kind === "debt");
  /** Per instrument: the row numbers of its aggregated monthly series. */
  const debtRows: { drawRow: number; intRow: number; prinRow: number; balRow: number }[] = [];

  for (const inst of debtInstruments) {
    const ir = instRow[inst.id];
    const A = `'Financing'!$C$${ir}`; // amount
    const DP = `'Financing'!$D$${ir}`; // draw period index
    const RT = `'Financing'!$E$${ir}`; // annual rate
    const GR = `'Financing'!$F$${ir}`; // grace months
    const TN = `'Financing'!$G$${ir}`; // tenor months
    const PR = `'Financing'!$H$${ir}`; // profile

    wsD.addRow([]);
    const title = wsD.addRow([inst.label]);
    title.font = { bold: true, color: { argb: `FF${BRAND}` } };

    // Draw month is derived from the draw period via the month-map, which is
    // written out so the lookup stays inside the workbook.
    const mapRow = wsD.addRow(["  Period start month (map)", ...monthStart]);
    mapRow.font = { size: 9, color: { argb: "FF999999" } };
    const drawMonthRow = wsD.addRow(["  Draw month"]);
    drawMonthRow.getCell(2).value = {
      formula: `INDEX(${mcol(0)}${mapRow.number}:${mcol(TOTAL_MONTHS - 1)}${mapRow.number},1,MIN(MAX(${DP}+1,1),${n}))`,
    } as ExcelJS.CellFormulaValue;
    const DM = `$B$${drawMonthRow.number}`;

    const amortRow = wsD.addRow(["  Amortisation months"]);
    amortRow.getCell(2).value = { formula: `MAX(1,${TN}-${GR})` } as ExcelJS.CellFormulaValue;
    const AM = `$B$${amortRow.number}`;

    const annuityRow = wsD.addRow(["  Annuity payment (monthly)"]);
    annuityRow.getCell(2).value = {
      formula: `IF(${RT}>0,${A}*(${RT}/12)/(1-(1+${RT}/12)^(-${AM})),${A}/${AM})`,
    } as ExcelJS.CellFormulaValue;
    annuityRow.getCell(2).numFmt = NUM;
    const AP = `$B$${annuityRow.number}`;

    const mrow = (label: string, make: (m: number) => string, fmt = NUM) => {
      const r = wsD.addRow([label]);
      for (let m = 0; m < TOTAL_MONTHS; m++) {
        const c = r.getCell(m + FIRST_COL);
        c.value = { formula: make(m) } as ExcelJS.CellFormulaValue;
        c.numFmt = fmt;
      }
      return r;
    };

    const sinceRow = mrow("  Months since draw", (m) => `${m}-${DM}`, "0");
    const drawR = mrow("  Drawdown", (m) => `IF(${m}=${DM},${A},0)`);
    // Opening = previous closing + this month's draw. Placeholder for the
    // closing row number, patched after the row exists.
    const openR = wsD.addRow(["  Opening balance"]);
    const intR = mrow("  Interest", (m) => `${mcol(m)}${openR.number}*${RT}/12`);
    const rawR = mrow(
      "  Principal (raw)",
      (m) =>
        `IF(AND(${mcol(m)}${sinceRow.number}>=${GR},${mcol(m)}${sinceRow.number}<${TN},${mcol(m)}${openR.number}>0),` +
        `IF(${PR}="linear",${A}/${AM},` +
        `IF(${PR}="annuity",${AP}-${mcol(m)}${intR.number},` +
        `IF(${mcol(m)}${sinceRow.number}=${TN}-1,${mcol(m)}${openR.number},0))),0)`
    );
    const prinR = mrow(
      "  Principal repaid",
      (m) => `MIN(MAX(${mcol(m)}${rawR.number},0),${mcol(m)}${openR.number})`
    );
    const closeR = mrow(
      "  Closing balance",
      (m) => `${mcol(m)}${openR.number}-${mcol(m)}${prinR.number}`
    );
    // Now the closing row exists, fill opening.
    for (let m = 0; m < TOTAL_MONTHS; m++) {
      const c = openR.getCell(m + FIRST_COL);
      c.value = {
        formula: m === 0 ? `${mcol(0)}${drawR.number}` : `${mcol(m - 1)}${closeR.number}+${mcol(m)}${drawR.number}`,
      } as ExcelJS.CellFormulaValue;
      c.numFmt = NUM;
    }
    subtotal(closeR);

    debtRows.push({ drawRow: drawR.number, intRow: intR.number, prinRow: prinR.number, balRow: closeR.number });
  }

  // ---- aggregate the monthly blocks onto the period grid ------------------
  wsF.addRow([]);
  periodHeader(wsF, "Schedule (live, aggregated from DebtSchedule)");

  const sumMonths = (rowNo: number, i: number) => {
    const from = monthStart[i];
    const to = from + periods[i].months - 1;
    return `SUM('DebtSchedule'!${mcol(from)}${rowNo}:${mcol(to)}${rowNo})`;
  };
  const lastMonthCell = (rowNo: number, i: number) =>
    `'DebtSchedule'!${mcol(monthStart[i] + periods[i].months - 1)}${rowNo}`;

  const zeroIfNone = (parts: string[]) => (parts.length ? parts.join("+") : "0");

  const drawRow = formulaRow(wsF, "Debt drawdown", n, (i) =>
    zeroIfNone(debtRows.map((d) => sumMonths(d.drawRow, i)))
  );
  B.set("debt_draw", "Financing", drawRow.number);

  const repayRow = formulaRow(wsF, "Debt repayment", n, (i) =>
    zeroIfNone(debtRows.map((d) => sumMonths(d.prinRow, i)))
  );
  B.set("debt_repay", "Financing", repayRow.number);

  // Interest carries the upfront fee in the draw period, matching the engine.
  const feeParts = (i: number) =>
    debtInstruments
      .map((inst) => `IF(${i}='Financing'!$D$${instRow[inst.id]},'Financing'!$C$${instRow[inst.id]}*'Financing'!$I$${instRow[inst.id]},0)`)
      .join("+");
  const intRow2 = formulaRow(wsF, "Interest expense (incl. fees)", n, (i) => {
    const base = zeroIfNone(debtRows.map((d) => sumMonths(d.intRow, i)));
    return debtInstruments.length ? `${base}+${feeParts(i)}` : "0";
  });
  B.set("interest", "Financing", intRow2.number);

  const balRow = formulaRow(wsF, "Debt balance (closing)", n, (i) =>
    zeroIfNone(debtRows.map((d) => lastMonthCell(d.balRow, i)))
  );
  B.set("debt_balance", "Financing", balRow.number);

  // Equity and grants are single-date events, so they read straight off the
  // instrument table rather than needing a schedule.
  const equityInsts = inputs.instruments.filter((x) => x.kind === "equity");
  const grantInsts = inputs.instruments.filter((x) => x.kind === "grant");
  const eventRow = (label: string, list: typeof equityInsts, key: string) => {
    const r = formulaRow(wsF, label, n, (i) =>
      list.length
        ? list
            .map((inst) => `IF(${i}='Financing'!$D$${instRow[inst.id]},'Financing'!$C$${instRow[inst.id]},0)`)
            .join("+")
        : "0"
    );
    B.set(key, "Financing", r.number);
    return r;
  };
  eventRow("Equity raised", equityInsts, "equity_raise");
  eventRow("Grants collected", grantInsts, "grant_cash");

  // ======================= P&L =======================
  const wsPL = wb.addWorksheet("P&L");
  wsPL.columns = [{ width: 42 }, ...periods.map(() => ({ width: 13 }))];
  titleRow(wsPL, "Profit & loss (EUR)");
  wsPL.addRow([]);
  periodHeader(wsPL, "P&L");

  // Revenue, one row per line, split into the base price and the sustainable
  // premium so the two are auditable separately in the workbook.
  const streamTons = (c: ModelComponent, i: number) =>
    `${B.at(`rev_${c.id}_y`, i)}*${B.at("hours_year", i)}/1000/12*${B.at("months", i)}*${B.at("util", i)}`;

  const revBaseRows: number[] = [];
  const revPremRows: number[] = [];
  for (const c of inputs.revenue) {
    const baseRow = formulaRow(
      wsPL, `Revenue — ${c.name} (base price)`, n,
      (i) => `(${componentExpr(B, c, "rev", i, streamTons(c, i))})*${B.at("rev_factor", i)}`
    );
    revBaseRows.push(baseRow.number);
    const premRow = formulaRow(
      wsPL, `Revenue — ${c.name} (sustainable premium)`, n,
      // The premium multiplies the base price, so the uplift is (premium - 1).
      (i) => (c.premiumEligible ? `${col(i)}${baseRow.number}*(${B.scalar("premium")}-1)` : "0")
    );
    revPremRows.push(premRow.number);
  }
  const revenueBase = formulaRow(wsPL, "Revenue — base price", n, (i) =>
    revBaseRows.length ? revBaseRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  B.set("revenue_base", "P&L", revenueBase.number);
  const revenuePrem = formulaRow(wsPL, "Revenue — sustainable premium", n, (i) =>
    revPremRows.length ? revPremRows.map((r) => `${col(i)}${r}`).join("+") : "0"
  );
  B.set("revenue_premium", "P&L", revenuePrem.number);
  const revenue = formulaRow(
    wsPL, "Total revenue", n,
    (i) => `${col(i)}${revenueBase.number}+${col(i)}${revenuePrem.number}`
  );
  subtotal(revenue);
  B.set("revenue", "P&L", revenue.number);

  const cogsRows: number[] = [];
  for (const c of inputs.cogs) {
    const r = formulaRow(
      wsPL, `COGS — ${c.name}`, n,
      (i) => `(${componentExpr(B, c, "cogs", i, B.at("tons", i))})*${B.at("cogs_factor", i)}`
    );
    cogsRows.push(r.number);
  }
  const cogs = formulaRow(wsPL, "Total COGS", n, (i) =>
    cogsRows.length ? cogsRows.map((r) => `${col(i)}${r}`).join("+") : "0"
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

  // ---- valuation flows, live -------------------------------------------
  // Terminal value, the FCF series including it, discount factors and the
  // discounted series all sit on the Cashflow sheet so NPV and IRR upstream are
  // real formulas rather than pasted results.
  wsCF.addRow([]);
  const vHead = wsCF.addRow(["Valuation (live)"]);
  vHead.font = { bold: true, color: { argb: `FF${BRAND}` } };

  const finalEbitdaRef = B.at("ebitda", n - 1);
  const tvEnt = wsCF.addRow(["Terminal value — enterprise"]);
  tvEnt.getCell(2).value = {
    formula: `MAX(0,${finalEbitdaRef})*${B.scalar("exit_multiple")}`,
  } as ExcelJS.CellFormulaValue;
  tvEnt.getCell(2).numFmt = NUM;

  const netDebtExit = wsCF.addRow(["Net debt at exit"]);
  netDebtExit.getCell(2).value = {
    formula: `${B.at("debt_balance", n - 1)}-${col(n - 1)}${closeCash.number}`,
  } as ExcelJS.CellFormulaValue;
  netDebtExit.getCell(2).numFmt = NUM;

  const tvEq = wsCF.addRow(["Terminal value — equity"]);
  tvEq.getCell(2).value = {
    formula: `$B$${tvEnt.number}-$B$${netDebtExit.number}`,
  } as ExcelJS.CellFormulaValue;
  tvEq.getCell(2).numFmt = NUM;

  // Years from plan start to each period end. Structural, not an input.
  const yearsRow = wsCF.addRow(["Years at period end", ...periods.map((x) => x.yearsAtEnd)]);
  for (let i = 0; i < n; i++) yearsRow.getCell(i + FIRST_COL).numFmt = "0.000";
  yearsRow.font = { size: 9, color: { argb: "FF999999" } };

  // Period end dates, for XIRR.
  const [sy0, sm0] = parseStartMonth(inputs.parameters.startMonth);
  const endDates = periods.map((_, i) => {
    const monthsElapsed = periods.slice(0, i + 1).reduce((a, x) => a + x.months, 0);
    const abs = sm0 + monthsElapsed; // first day of the month after the period
    return new Date(Date.UTC(sy0 + Math.floor(abs / 12), ((abs % 12) + 12) % 12, 1));
  });
  const datesRow = wsCF.addRow(["Period end date", ...endDates]);
  for (let i = 0; i < n; i++) datesRow.getCell(i + FIRST_COL).numFmt = "dd/mm/yyyy";
  datesRow.font = { size: 9, color: { argb: "FF999999" } };

  const projTv = formulaRow(wsCF, "Project FCF incl. terminal value", n, (i) =>
    i === n - 1 ? `${col(i)}${projFcf.number}+$B$${tvEnt.number}` : `${col(i)}${projFcf.number}`
  );
  const eqTv = formulaRow(wsCF, "Equity FCF incl. terminal value", n, (i) =>
    i === n - 1 ? `${col(i)}${eqFcf.number}+$B$${tvEq.number}` : `${col(i)}${eqFcf.number}`
  );

  const dfWacc = formulaRow(wsCF, "Discount factor at WACC", n,
    (i) => `1/(1+${B.scalar("wacc")})^${col(i)}${yearsRow.number}`, "0.0000");
  const dfKoe = formulaRow(wsCF, "Discount factor at cost of equity", n,
    (i) => `1/(1+${B.scalar("koe")})^${col(i)}${yearsRow.number}`, "0.0000");

  B.set("proj_tv", "Cashflow", projTv.number);
  B.set("eq_tv", "Cashflow", eqTv.number);
  B.set("df_wacc", "Cashflow", dfWacc.number);
  B.set("df_koe", "Cashflow", dfKoe.number);
  B.set("cf_dates", "Cashflow", datesRow.number);
  B.set("tv_ent", "Cashflow", tvEnt.number);
  B.set("tv_eq", "Cashflow", tvEq.number);
  B.set("net_debt_exit", "Cashflow", netDebtExit.number);

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

  // ---- Returns block, live ----------------------------------------------
  // Every figure here is a formula over the Cashflow sheet, so flexing the rate,
  // the tenor, the WACC or the exit multiple reprices the returns in place.
  wsS.addRow([]);
  header(wsS.addRow(["Returns (live)", "Value"]));
  const v = model.valuation;
  const rng = (key: string) =>
    `'Cashflow'!${col(0)}${B.row(key)}:${col(n - 1)}${B.row(key)}`;

  const retFormula = (label: string, formula: string, fmt: string) => {
    const r = wsS.addRow([label]);
    r.getCell(2).value = { formula } as ExcelJS.CellFormulaValue;
    r.getCell(2).numFmt = fmt;
    return r;
  };

  retFormula("Terminal value — enterprise", `'Cashflow'!$B$${B.row("tv_ent")}`, NUM);
  retFormula("Net debt at exit", `'Cashflow'!$B$${B.row("net_debt_exit")}`, NUM);
  retFormula("Terminal value — equity", `'Cashflow'!$B$${B.row("tv_eq")}`, NUM);

  retFormula("Project NPV at WACC", `SUMPRODUCT(${rng("proj_tv")},${rng("df_wacc")})`, NUM);
  retFormula("Equity NPV at cost of equity", `SUMPRODUCT(${rng("eq_tv")},${rng("df_koe")})`, NUM);

  // XIRR rather than IRR: the grid is monthly then annual, so the cash flows are
  // not equally spaced and plain IRR would be wrong. XIRR discounts on actual
  // days; the portal engine discounts on exact year fractions, so the two agree
  // to a fraction of a basis point rather than exactly. Both are shown.
  retFormula(
    "Project IRR (unlevered, XIRR)",
    `IFERROR(XIRR(${rng("proj_tv")},${rng("cf_dates")},${(v.projectIrr ?? 0.1).toFixed(4)}),"n/a")`,
    PCT
  );
  retFormula(
    "Equity IRR (levered, XIRR)",
    `IFERROR(XIRR(${rng("eq_tv")},${rng("cf_dates")},${(v.equityIrr ?? 0.1).toFixed(4)}),"n/a")`,
    PCT
  );

  wsS.addRow([]);
  const refHead = wsS.addRow(["Portal engine reference (values)", "Value"]);
  refHead.font = { bold: true, size: 9, color: { argb: "FF666666" } };
  for (const [label, value, fmt] of [
    ["Project IRR — engine (exact year fractions)", v.projectIrr ?? "n/a", PCT],
    ["Equity IRR — engine (exact year fractions)", v.equityIrr ?? "n/a", PCT],
    ["Project NPV — engine", v.projectNpv, NUM],
    ["Equity NPV — engine", v.equityNpv, NUM],
  ] as [string, number | string, string][]) {
    const r = wsS.addRow([label, value]);
    if (typeof value === "number") r.getCell(2).numFmt = fmt;
    r.font = { size: 9, color: { argb: "FF666666" } };
  }

  const rnote = wsS.addRow([
    "All Returns figures above are live formulas over the Cashflow sheet. The engine reference rows are the values as computed in the portal at export time; NPV should match to the cent, IRR to well under a tenth of a basis point, the residual being XIRR's actual/365 day counting against the engine's exact year fractions.",
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
