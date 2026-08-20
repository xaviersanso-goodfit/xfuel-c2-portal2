import { TOTAL_YEARS } from "./periods";
import type { ModelComponent } from "./components";
import type { ScenarioInputs } from "./types";

/**
 * Field-level diff between two versions of a scenario.
 *
 * This is what feeds the changelog. It walks the inputs and reports every
 * changed field with a human-readable path, so the log reads "MGO price per ton,
 * Y3" rather than "revenue[0].unitCost[2]".
 *
 * Components are matched by id, never by position or name. Rename a line and
 * the log records a name change on one line rather than a deletion and an
 * addition, which is the whole reason ids exist.
 */

export interface FieldChange {
  /** Machine key, stable across renames. */
  key: string;
  /** What a person reads in the log. */
  label: string;
  from: string;
  to: string;
}

const YEAR_LABEL = (y: number) => `Y${y + 1}`;

/** Format a value for the log. Percentages and money are left as entered. */
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "(invalid)";
    return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toFixed(6)));
  }
  return String(v);
}

const near = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9;

/** Compare two yearly series and report each changed year separately. */
function diffYearly(
  key: string,
  label: string,
  a: number[] | undefined,
  b: number[] | undefined,
  out: FieldChange[]
) {
  const A = a ?? [];
  const B = b ?? [];
  const n = Math.max(A.length, B.length, TOTAL_YEARS);
  // A change applied to every year is reported once, not twenty times.
  const changed: number[] = [];
  for (let y = 0; y < n; y++) if (!near(A[y] ?? 0, B[y] ?? 0)) changed.push(y);
  if (changed.length === 0) return;
  if (changed.length >= TOTAL_YEARS) {
    out.push({ key, label: `${label}, all years`, from: fmt(A[0] ?? 0), to: fmt(B[0] ?? 0) });
    return;
  }
  for (const y of changed) {
    out.push({ key: `${key}.${y}`, label: `${label}, ${YEAR_LABEL(y)}`, from: fmt(A[y] ?? 0), to: fmt(B[y] ?? 0) });
  }
}

/** Compare a per-period series, reporting a count rather than every cell. */
function diffSeries(key: string, label: string, a: number[] | undefined, b: number[] | undefined, out: FieldChange[]) {
  const A = a ?? [];
  const B = b ?? [];
  const n = Math.max(A.length, B.length);
  let count = 0;
  let firstFrom = 0;
  let firstTo = 0;
  for (let i = 0; i < n; i++) {
    if (!near(A[i] ?? 0, B[i] ?? 0)) {
      if (count === 0) {
        firstFrom = A[i] ?? 0;
        firstTo = B[i] ?? 0;
      }
      count++;
    }
  }
  if (count === 0) return;
  out.push({
    key,
    label: count === 1 ? label : `${label} (${count} periods)`,
    from: fmt(firstFrom),
    to: fmt(firstTo),
  });
}

function diffComponents(
  kind: string,
  a: ModelComponent[] | undefined,
  b: ModelComponent[] | undefined,
  out: FieldChange[]
) {
  const A = new Map((a ?? []).map((c) => [c.id, c]));
  const B = new Map((b ?? []).map((c) => [c.id, c]));

  for (const [id, before] of A) {
    const after = B.get(id);
    if (!after) {
      out.push({ key: `${kind}.${id}`, label: `${kind}: removed "${before.name}"`, from: before.name, to: "(removed)" });
      continue;
    }
    const n = after.name;
    if (before.name !== after.name) {
      out.push({ key: `${kind}.${id}.name`, label: `${kind} line name`, from: before.name, to: after.name });
    }
    if ((before.description ?? "") !== (after.description ?? "")) {
      out.push({ key: `${kind}.${id}.description`, label: `${n} description`, from: fmt(before.description), to: fmt(after.description) });
    }
    if (before.basis !== after.basis) {
      out.push({ key: `${kind}.${id}.basis`, label: `${n} basis`, from: String(before.basis), to: String(after.basis) });
    }
    if ((before.premiumEligible ?? false) !== (after.premiumEligible ?? false)) {
      out.push({ key: `${kind}.${id}.premium`, label: `${n} premium eligible`, from: fmt(before.premiumEligible ?? false), to: fmt(after.premiumEligible ?? false) });
    }
    diffYearly(`${kind}.${id}.quantity`, `${n} quantity`, before.quantity, after.quantity, out);
    diffYearly(`${kind}.${id}.unitCost`, `${n} unit cost`, before.unitCost, after.unitCost, out);
    diffYearly(`${kind}.${id}.yield`, `${n} yield`, before.yieldKgPerHour, after.yieldKgPerHour, out);
  }
  for (const [id, after] of B) {
    if (!A.has(id)) {
      out.push({ key: `${kind}.${id}`, label: `${kind}: added "${after.name}"`, from: "(none)", to: after.name });
    }
  }
}

const PARAM_LABELS: Record<string, string> = {
  startMonth: "Plan start month",
  opsStartPeriod: "Operations start period",
  citr: "Corporate income tax rate",
  dso: "DSO (days)",
  dpo: "DPO (days)",
  wacc: "WACC",
  costOfEquity: "Cost of equity",
  exitMultiple: "Exit EV/EBITDA multiple",
  openingCash: "Opening cash",
  opexInflation: "OPEX inflation",
  compensationInflation: "Compensation inflation",
  revenueInflation: "Revenue inflation",
  cogsInflation: "COGS inflation",
  sustainablePremium: "Sustainable premium",
};

/** Every field-level difference between two scenarios. */
export function diffScenarios(before: ScenarioInputs, after: ScenarioInputs): FieldChange[] {
  const out: FieldChange[] = [];
  if (!before || !after) return out;

  if (before.name !== after.name) {
    out.push({ key: "name", label: "Scenario name", from: fmt(before.name), to: fmt(after.name) });
  }

  const pa = before.parameters ?? ({} as ScenarioInputs["parameters"]);
  const pb = after.parameters ?? ({} as ScenarioInputs["parameters"]);
  for (const [k, label] of Object.entries(PARAM_LABELS)) {
    const va = (pa as unknown as Record<string, unknown>)[k];
    const vb = (pb as unknown as Record<string, unknown>)[k];
    if (typeof va === "number" && typeof vb === "number") {
      if (!near(va, vb)) out.push({ key: `parameters.${k}`, label, from: fmt(va), to: fmt(vb) });
    } else if (va !== vb) {
      out.push({ key: `parameters.${k}`, label, from: fmt(va), to: fmt(vb) });
    }
  }
  diffSeries("parameters.otherWorkingCapital", "Other working capital", pa.otherWorkingCapital, pb.otherWorkingCapital, out);

  diffYearly("unitEconomics.annualHours", "Annual operating hours", before.unitEconomics?.annualHours, after.unitEconomics?.annualHours, out);
  diffSeries("unitEconomics.utilisation", "Capacity utilisation", before.unitEconomics?.utilisation, after.unitEconomics?.utilisation, out);

  diffComponents("Revenue", before.revenue, after.revenue, out);
  diffComponents("COGS", before.cogs, after.cogs, out);
  diffComponents("OPEX", before.opex, after.opex, out);

  // CAPEX.
  const ca = new Map((before.capex ?? []).map((c) => [c.id, c]));
  for (const line of after.capex ?? []) {
    const b = ca.get(line.id);
    if (!b) continue;
    if (b.label !== line.label) out.push({ key: `capex.${line.id}.label`, label: "CAPEX concept name", from: b.label, to: line.label });
    if (!near(b.total, line.total)) out.push({ key: `capex.${line.id}.total`, label: `${line.label} total cost`, from: fmt(b.total), to: fmt(line.total) });
    if (!near(b.depRateMonthly, line.depRateMonthly)) out.push({ key: `capex.${line.id}.dep`, label: `${line.label} depreciation rate`, from: fmt(b.depRateMonthly), to: fmt(line.depRateMonthly) });
    diffSeries(`capex.${line.id}.phasing`, `${line.label} phasing`, b.phasing, line.phasing, out);
  }

  // Personnel.
  const na = new Map((before.personnel ?? []).map((c) => [c.id, c]));
  for (const arch of after.personnel ?? []) {
    const b = na.get(arch.id);
    if (!b) {
      out.push({ key: `personnel.${arch.id}`, label: `Personnel: added "${arch.label}"`, from: "(none)", to: arch.label });
      continue;
    }
    if (b.label !== arch.label) out.push({ key: `personnel.${arch.id}.label`, label: "Personnel role name", from: b.label, to: arch.label });
    if (!near(b.annualCost, arch.annualCost)) out.push({ key: `personnel.${arch.id}.cost`, label: `${arch.label} annual cost`, from: fmt(b.annualCost), to: fmt(arch.annualCost) });
    diffSeries(`personnel.${arch.id}.ftes`, `${arch.label} FTEs`, b.ftes, arch.ftes, out);
  }
  for (const arch of before.personnel ?? []) {
    if (!(after.personnel ?? []).some((x) => x.id === arch.id)) {
      out.push({ key: `personnel.${arch.id}`, label: `Personnel: removed "${arch.label}"`, from: arch.label, to: "(removed)" });
    }
  }

  // Instruments.
  const ia = new Map((before.instruments ?? []).map((c) => [c.id, c]));
  for (const inst of after.instruments ?? []) {
    const b = ia.get(inst.id);
    if (!b) {
      out.push({ key: `instruments.${inst.id}`, label: `Financing: added "${inst.label}"`, from: "(none)", to: inst.label });
      continue;
    }
    for (const f of ["label", "amount", "drawPeriod", "rate", "graceMonths", "tenorMonths", "repayment", "upfrontFeePct"] as const) {
      const va = b[f];
      const vb = inst[f];
      const changed = typeof va === "number" && typeof vb === "number" ? !near(va, vb) : va !== vb;
      if (changed) out.push({ key: `instruments.${inst.id}.${f}`, label: `${inst.label} ${f}`, from: fmt(va), to: fmt(vb) });
    }
  }
  for (const inst of before.instruments ?? []) {
    if (!(after.instruments ?? []).some((x) => x.id === inst.id)) {
      out.push({ key: `instruments.${inst.id}`, label: `Financing: removed "${inst.label}"`, from: inst.label, to: "(removed)" });
    }
  }

  return out;
}

/** "17/08/2026 11:34 CET" */
export function formatCet(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  // Europe/Madrid is CET in winter and CEST in summer; label it accordingly.
  const summer = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", timeZoneName: "short" })
    .formatToParts(d)
    .find((x) => x.type === "timeZoneName")?.value;
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} ${summer ?? "CET"}`;
}
