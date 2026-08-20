import ExcelJS from "exceljs";
import { BASIS_FIELD_LABELS, BASIS_USES } from "../model/components";
import type { ModelComponent } from "../model/components";
import { PERIOD_COUNT, TOTAL_YEARS } from "../model/periods";
import { defaultScenario } from "../model/defaults";
import { extendYearly } from "../model/normalise";
import type { Instrument, InstrumentKind, RepaymentProfile, ScenarioInputs } from "../model/types";

/**
 * Read a workbook produced by the exporter back into a scenario.
 * Only input rows are read; every calculated row is recomputed by the engine,
 * so a workbook edited in Excel round-trips cleanly.
 */
export async function parseWorkbook(data: ArrayBuffer): Promise<{ inputs: ScenarioInputs; notes: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const notes: string[] = [];
  const base = defaultScenario();

  const sheet = (name: string) => wb.getWorksheet(name);
  const num = (v: ExcelJS.CellValue): number => {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && "result" in v) return Number((v as any).result) || 0;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const text = (v: ExcelJS.CellValue): string => {
    if (v == null) return "";
    if (typeof v === "object" && "result" in v) return String((v as any).result ?? "");
    if (typeof v === "object" && "richText" in v) return (v as any).richText.map((t: any) => t.text).join("");
    return String(v);
  };

  /** Find a row whose column A matches label (case-insensitive, trimmed). */
  const findRow = (ws: ExcelJS.Worksheet | undefined, label: string): ExcelJS.Row | undefined => {
    if (!ws) return undefined;
    let found: ExcelJS.Row | undefined;
    ws.eachRow((row) => {
      if (found) return;
      const a = text(row.getCell(1).value).trim().toLowerCase();
      if (a === label.trim().toLowerCase()) found = row;
    });
    return found;
  };
  /** Read the period series (columns B onward) from a row. */
  const series = (row: ExcelJS.Row | undefined): number[] => {
    const out = new Array(PERIOD_COUNT).fill(0);
    if (!row) return out;
    for (let i = 0; i < PERIOD_COUNT; i++) out[i] = num(row.getCell(i + 2).value);
    return out;
  };
  /**
   * Read a yearly driver (columns B..K) from a row.
   *
   * The UnitEcon sheet carries each driver twice: once as yearly inputs and
   * once expanded across the periods. findRow returns the first match, which is
   * the yearly block, so this reads the inputs rather than the formulas.
   */
  const yearly = (ws: ExcelJS.Worksheet | undefined, label: string, fallback: number[]): number[] => {
    const r = findRow(ws, label);
    if (!r) {
      notes.push(`Missing "${label}" — kept existing value.`);
      return fallback;
    }
    // Read only the cells that actually hold something, then carry the last one
    // forward. A workbook exported before these drivers became yearly has a
    // single value in column B and nothing after it; without this, years 2 to 10
    // would import as zero and silently shut the plant down.
    const supplied: number[] = [];
    for (let y = 0; y < TOTAL_YEARS; y++) {
      const raw = r.getCell(y + 2).value;
      const blank = raw === null || raw === undefined || raw === "";
      if (blank) break;
      supplied.push(num(raw));
    }
    if (supplied.length === 0) {
      notes.push(`"${label}" had no values — kept existing.`);
      return fallback;
    }
    if (supplied.length < TOTAL_YEARS) {
      notes.push(`"${label}" only had ${supplied.length} year(s); carried the last value forward.`);
    }
    return extendYearly(supplied, TOTAL_YEARS);
  };
  const scalar = (ws: ExcelJS.Worksheet | undefined, label: string, fallback: number): number => {
    const r = findRow(ws, label);
    if (!r) {
      notes.push(`Missing "${label}" — kept existing value.`);
      return fallback;
    }
    return num(r.getCell(2).value);
  };

  // ---------- Parameters ----------
  const wsP = sheet("Parameters");
  const nameRow = findRow(wsP, "Scenario name");
  const startRow = findRow(wsP, "Plan start month (YYYY-MM)");
  const inputs: ScenarioInputs = {
    ...base,
    name: nameRow ? text(nameRow.getCell(2).value) || base.name : base.name,
    parameters: {
      ...base.parameters,
      startMonth: startRow ? text(startRow.getCell(2).value) || base.parameters.startMonth : base.parameters.startMonth,
      opsStartPeriod: scalar(wsP, "Operations start (period index, 0-based)", base.parameters.opsStartPeriod),
      citr: scalar(wsP, "Corporate income tax rate", base.parameters.citr),
      dso: scalar(wsP, "DSO (days)", base.parameters.dso),
      dpo: scalar(wsP, "DPO (days)", base.parameters.dpo),
      wacc: scalar(wsP, "WACC (project discount rate)", base.parameters.wacc),
      costOfEquity: scalar(wsP, "Cost of equity", base.parameters.costOfEquity),
      exitMultiple: scalar(wsP, "Exit EV/EBITDA multiple", base.parameters.exitMultiple),
      openingCash: scalar(wsP, "Opening cash", base.parameters.openingCash),
      opexInflation: scalar(wsP, "OPEX inflation (p.a.)", base.parameters.opexInflation),
      compensationInflation: scalar(wsP, "Compensation inflation (p.a.)", base.parameters.compensationInflation),
      revenueInflation: scalar(wsP, "Revenue inflation (p.a.)", base.parameters.revenueInflation),
      cogsInflation: scalar(wsP, "COGS inflation (p.a.)", base.parameters.cogsInflation),
      sustainablePremium: scalar(wsP, "Sustainable premium (multiplier)", base.parameters.sustainablePremium),
      otherWorkingCapital: series(findRow(sheet("Cashflow"), "Other working capital")),
    },
  };

  // ---------- CAPEX ----------
  const wsC = sheet("CAPEX");
  inputs.capex = base.capex.map((line) => {
    const total = scalar(wsC, `${line.label} — total cost`, line.total);
    const rate = scalar(wsC, `${line.label} — monthly depreciation rate`, line.depRateMonthly);
    const phasing = series(findRow(wsC, `${line.label} — phasing %`));
    return { ...line, total, depRateMonthly: rate, startPeriod: 0, phasing };
  });

  // ---------- Unit economics ----------
  // Components are matched by label, because that is all the workbook carries.
  // A line renamed in Excel therefore falls back to the value already in the
  // scenario rather than importing as zero, and the import notes say so.
  const wsU = sheet("UnitEcon");
  const ue = base.unitEconomics;
  inputs.unitEconomics = {
    ...ue,
    annualHours: yearly(wsU, "Annual operating hours at 100%", ue.annualHours),
    utilisation: series(findRow(wsU, "Capacity utilisation %")),
  };

  const readComponents = <T extends ModelComponent>(ws: ExcelJS.Worksheet | undefined, list: T[]): T[] =>
    list.map((c) => {
      const uses = BASIS_USES[c.basis] ?? { quantity: true, unitCost: true };
      const labels = BASIS_FIELD_LABELS[c.basis] ?? { quantity: "Quantity", unitCost: "Unit cost" };
      const next: T = { ...c };
      if (c.yieldKgPerHour) {
        next.yieldKgPerHour = yearly(ws, `${c.name} — yield (kg/h)`, c.yieldKgPerHour);
      }
      if (uses.quantity) next.quantity = yearly(ws, `${c.name} — ${labels.quantity}`, c.quantity);
      if (uses.unitCost) next.unitCost = yearly(ws, `${c.name} — ${labels.unitCost}`, c.unitCost);
      if (!findRow(ws, `${c.name} — ${labels.unitCost}`) && !findRow(ws, `${c.name} — ${labels.quantity}`)) {
        notes.push(`No rows found for "${c.name}" — kept the values already in the scenario.`);
      }
      return next;
    });

  inputs.revenue = readComponents(wsU, base.revenue);
  inputs.cogs = readComponents(wsU, base.cogs);
  inputs.opex = readComponents(wsU, base.opex);

  // ---------- OPEX ----------
  const wsO = sheet("OPEX");
  inputs.personnel = base.personnel.map((a) => ({
    ...a,
    annualCost: scalar(wsO, `${a.label} — annual cost per FTE`, a.annualCost),
    ftes: series(findRow(wsO, `${a.label} — FTEs`)),
  }));

  // ---------- Financing ----------
  const wsF = sheet("Financing");
  if (wsF) {
    const instruments: Instrument[] = [];
    let inTable = false;
    wsF.eachRow((row) => {
      const a = text(row.getCell(1).value).trim();
      if (a.toLowerCase() === "instrument") {
        inTable = true;
        return;
      }
      if (!inTable || !a) return;
      const kind = text(row.getCell(2).value).trim().toLowerCase() as InstrumentKind;
      if (!["debt", "grant", "equity"].includes(kind)) {
        inTable = false; // reached the schedules block
        return;
      }
      const profile = text(row.getCell(8).value).trim().toLowerCase();
      instruments.push({
        id: a.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        kind,
        label: a,
        amount: num(row.getCell(3).value),
        drawPeriod: num(row.getCell(4).value),
        rate: num(row.getCell(5).value) || undefined,
        graceMonths: num(row.getCell(6).value) || undefined,
        tenorMonths: num(row.getCell(7).value) || undefined,
        repayment: (["bullet", "linear", "annuity"].includes(profile) ? profile : "linear") as RepaymentProfile,
        upfrontFeePct: num(row.getCell(9).value) || undefined,
      });
    });
    if (instruments.length) inputs.instruments = instruments;
    else notes.push("No financing instruments found — kept existing set.");
  }

  return { inputs, notes };
}
