import { parseStartMonth } from "./periods";
import type { ModelOutputs, ScenarioInputs } from "./types";

/**
 * XFuel group cash flow.
 *
 * The C2 model is a project view: it starts when the project starts and knows
 * nothing about the rest of the company. This layer puts C2 inside the group's
 * own cash position, on a calendar grid that begins before the project does.
 *
 * Two things it must get right:
 *
 *   Calendar alignment. C2 periods are indexed from the plan start month, so
 *   they are mapped onto the group grid by actual year and month rather than by
 *   index. Move the C2 start month and its flows move with it; they do not
 *   silently land in the wrong group month.
 *
 *   Intercompany elimination. If the group funds C2's equity, that cash never
 *   leaves the group: it goes out as CAPEX and comes back as an equity
 *   subscription. Counting both would overstate group cash by the ticket size.
 *   Equity is therefore excluded by default. Debt drawdowns, repayments and
 *   grants are third-party cash and stay.
 */

/** Group grid runs from this month, inclusive, to GROUP_END. */
export const GROUP_START = "2026-07";
export const GROUP_END = "2028-12";

export interface GroupMonth {
  index: number;
  /** Calendar year and 0-based month. */
  year: number;
  month: number;
  /** "Jul-26" */
  label: string;
  /** Plan year of the group grid, 1-based, used by the annual bridge. */
  calendarYear: number;
}

/** A manual cash flow line the user adds under one of the three sections. */
export interface GroupLine {
  id: string;
  label: string;
  section: "cfo" | "cfi" | "cff";
  /** One amount per group month. Positive = cash in. */
  amounts: number[];
}

export interface GroupInputs {
  /** Cash held by the group at the start of the grid. */
  openingCash: number;
  /** Whether C2's equity subscription is treated as intercompany and removed. */
  eliminateIntercompanyEquity: boolean;
  lines: GroupLine[];
}

export interface GroupMonthResult {
  /** C2 contribution, already intercompany-adjusted. */
  cfoC2: number;
  cfiC2: number;
  cffC2: number;
  /** Everything else, from the manual lines. */
  cfoRest: number;
  cfiRest: number;
  cffRest: number;
  cfo: number;
  cfi: number;
  cff: number;
  netCashFlow: number;
  openingCash: number;
  closingCash: number;
}

/** One step of the annual bridge. */
export interface BridgeItem {
  key: string;
  label: string;
  amount: number;
}
export interface BridgeBlock {
  key: string;
  label: string;
  amount: number;
  items: BridgeItem[];
}

export interface GroupOutputs {
  months: GroupMonth[];
  results: GroupMonthResult[];
  openingCash: number;
  closingCash: number;
  blocks: BridgeBlock[];
  /** Sum of blocks; must equal closing less opening. */
  bridgeCheck: number;
  warnings: string[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Build the calendar grid from GROUP_START to GROUP_END inclusive. */
export function buildGroupMonths(): GroupMonth[] {
  const [sy, sm] = parseStartMonth(GROUP_START);
  const [ey, em] = parseStartMonth(GROUP_END);
  const count = (ey - sy) * 12 + (em - sm) + 1;
  const out: GroupMonth[] = [];
  for (let i = 0; i < count; i++) {
    const abs = sm + i;
    const year = sy + Math.floor(abs / 12);
    const month = ((abs % 12) + 12) % 12;
    out.push({
      index: i,
      year,
      month,
      label: `${MONTH_LABELS[month]}-${String(year).slice(2)}`,
      calendarYear: year,
    });
  }
  return out;
}

export const GROUP_MONTHS = buildGroupMonths().length;

/** Zero-filled array sized to the group grid. */
export function groupZeroes(): number[] {
  return new Array(GROUP_MONTHS).fill(0);
}

/** Coerce a line's amounts to exactly the group length, treating holes as zero. */
function fitGroup(values: number[] | undefined): number[] {
  const out = groupZeroes();
  if (!values) return out;
  for (let i = 0; i < Math.min(values.length, GROUP_MONTHS); i++) {
    const v = Number(values[i]);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

export function defaultGroupInputs(): GroupInputs {
  return {
    // Cash at 30/06/2026, net of the amount carved out below it.
    openingCash: 14_282_756 - 1_336_128,
    eliminateIntercompanyEquity: true,
    lines: [
      { id: "cfo_1", label: "Corporate overhead", section: "cfo", amounts: groupZeroes() },
      { id: "cfo_2", label: "Other operating", section: "cfo", amounts: groupZeroes() },
      { id: "cfo_3", label: "Working capital", section: "cfo", amounts: groupZeroes() },
      { id: "cfi_1", label: "Other CAPEX", section: "cfi", amounts: groupZeroes() },
      { id: "cfi_2", label: "Investments / disposals", section: "cfi", amounts: groupZeroes() },
      { id: "cfi_3", label: "Other investing", section: "cfi", amounts: groupZeroes() },
      { id: "cff_1", label: "Equity raised (group)", section: "cff", amounts: groupZeroes() },
      { id: "cff_2", label: "Corporate debt", section: "cff", amounts: groupZeroes() },
      { id: "cff_3", label: "Other financing", section: "cff", amounts: groupZeroes() },
    ],
  };
}

/**
 * Map each C2 period onto a group month index.
 *
 * Monthly C2 periods land on their own calendar month. Annual C2 periods are
 * spread evenly across the twelve months they represent, so an annual period
 * that only partly overlaps the group window still contributes the right share.
 * Returns -1 for anything outside the window.
 */
function c2PeriodToGroupMonths(
  model: ModelOutputs,
  startMonth: string,
  months: GroupMonth[]
): { idx: number; weight: number }[][] {
  const [sy, sm] = parseStartMonth(startMonth);
  const first = months[0];
  const offset = (mIdx: number) => {
    // Absolute month number of the group grid start.
    const groupAbs = first.year * 12 + first.month;
    return mIdx - groupAbs;
  };

  let cursor = 0; // months elapsed since the C2 plan start
  return model.periods.map((p) => {
    const spread: { idx: number; weight: number }[] = [];
    for (let k = 0; k < p.months; k++) {
      const abs = sy * 12 + sm + cursor + k;
      const idx = offset(abs);
      if (idx >= 0 && idx < months.length) spread.push({ idx, weight: 1 / p.months });
    }
    cursor += p.months;
    return spread;
  });
}

export function runGroup(
  inputs: ScenarioInputs,
  model: ModelOutputs,
  group: GroupInputs
): GroupOutputs {
  const months = buildGroupMonths();
  const n = months.length;
  const warnings: string[] = [];

  const zero = () => new Array(n).fill(0);
  const cfoC2 = zero();
  const cfiC2 = zero();
  const cffC2 = zero();
  // CFF components, kept separately so the bridge can itemise them.
  const debtDraw = zero();
  const debtRepay = zero();
  const grant = zero();
  const equityExcluded = zero();
  // CFI components by CAPEX concept.
  const capexByConcept: Record<string, number[]> = {};
  for (const line of inputs.capex) capexByConcept[line.id] = zero();

  const map = c2PeriodToGroupMonths(model, inputs.parameters.startMonth, months);

  model.results.forEach((r, i) => {
    for (const { idx, weight } of map[i]) {
      cfoC2[idx] += r.cfo * weight;
      cfiC2[idx] += r.cfi * weight;
      debtDraw[idx] += r.debtDraw * weight;
      debtRepay[idx] += r.debtRepayment * weight;
      grant[idx] += r.grantCash * weight;
      equityExcluded[idx] += r.equityRaise * weight;
      for (const line of inputs.capex) {
        capexByConcept[line.id][idx] -= (model.capexByConcept?.[line.id]?.[i] ?? 0) * weight;
      }
    }
  });

  const keepEquity = !group.eliminateIntercompanyEquity;
  for (let i = 0; i < n; i++) {
    cffC2[i] = debtDraw[i] - debtRepay[i] + grant[i] + (keepEquity ? equityExcluded[i] : 0);
  }

  // Manual lines.
  const bySection = { cfo: zero(), cfi: zero(), cff: zero() };
  const fitted = (group.lines ?? []).map((l) => ({ ...l, amounts: fitGroup(l.amounts) }));
  for (const l of fitted) {
    const target = bySection[l.section];
    if (!target) continue;
    for (let i = 0; i < n; i++) target[i] += l.amounts[i];
  }

  const results: GroupMonthResult[] = [];
  let cash = Number(group.openingCash) || 0;
  const opening = cash;
  for (let i = 0; i < n; i++) {
    const cfo = cfoC2[i] + bySection.cfo[i];
    const cfi = cfiC2[i] + bySection.cfi[i];
    const cff = cffC2[i] + bySection.cff[i];
    const net = cfo + cfi + cff;
    const ob = cash;
    cash = ob + net;
    results.push({
      cfoC2: cfoC2[i], cfiC2: cfiC2[i], cffC2: cffC2[i],
      cfoRest: bySection.cfo[i], cfiRest: bySection.cfi[i], cffRest: bySection.cff[i],
      cfo, cfi, cff, netCashFlow: net, openingCash: ob, closingCash: cash,
    });
  }
  const closing = cash;

  const minCash = Math.min(...results.map((r) => r.closingCash));
  if (minCash < 0) {
    warnings.push(
      `Group cash goes negative (low point ${Math.round(minCash).toLocaleString("en-US")} EUR).`
    );
  }

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const lineItems = (section: GroupLine["section"]): BridgeItem[] =>
    fitted
      .filter((l) => l.section === section)
      .map((l) => ({ key: l.id, label: l.label, amount: sum(l.amounts) }))
      .filter((it) => Math.abs(it.amount) > 0.5);

  const blocks: BridgeBlock[] = [
    { key: "cfoC2", label: "CFO C2", amount: sum(cfoC2), items: [{ key: "cfoC2", label: "C2 operating cash flow", amount: sum(cfoC2) }] },
    { key: "cfoRest", label: "CFO rest", amount: sum(bySection.cfo), items: lineItems("cfo") },
    {
      key: "cffC2",
      label: "CFF C2",
      amount: sum(cffC2),
      items: [
        { key: "draw", label: "Debt drawdown", amount: sum(debtDraw) },
        { key: "repay", label: "Debt repayment", amount: -sum(debtRepay) },
        { key: "grant", label: "Grant collected", amount: sum(grant) },
        ...(keepEquity ? [{ key: "equity", label: "Equity subscribed", amount: sum(equityExcluded) }] : []),
      ].filter((it) => Math.abs(it.amount) > 0.5),
    },
    { key: "cffRest", label: "CFF rest", amount: sum(bySection.cff), items: lineItems("cff") },
    {
      key: "cfiC2",
      label: "CFI C2",
      amount: sum(cfiC2),
      items: inputs.capex
        .map((l) => ({ key: l.id, label: l.label.split("—")[0].trim(), amount: sum(capexByConcept[l.id]) }))
        .filter((it) => Math.abs(it.amount) > 0.5),
    },
    { key: "cfiRest", label: "CFI rest", amount: sum(bySection.cfi), items: lineItems("cfi") },
  ];

  // The bridge is only meaningful if the blocks reconcile the two balances.
  const bridgeCheck = closing - opening - blocks.reduce((a, b) => a + b.amount, 0);
  if (Math.abs(bridgeCheck) > 0.5) {
    warnings.push(`Bridge does not reconcile: off by ${Math.round(bridgeCheck).toLocaleString("en-US")} EUR.`);
  }

  return { months, results, openingCash: opening, closingCash: closing, blocks, bridgeCheck, warnings };
}
