import type { Period } from "./types";

export const MONTHLY_YEARS = 3; // Y1, Y2 and Y3 are monthly
export const TOTAL_YEARS = 20;
export const MONTHLY_PERIODS = MONTHLY_YEARS * 12; // 36
export const ANNUAL_PERIODS = TOTAL_YEARS - MONTHLY_YEARS; // 17
export const PERIOD_COUNT = MONTHLY_PERIODS + ANNUAL_PERIODS; // 53

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse "YYYY-MM" into [year, monthIndex0]. Falls back to Jan of current year. */
export function parseStartMonth(startMonth: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(startMonth.trim());
  if (!m) return [new Date().getFullYear(), 0];
  const year = Number(m[1]);
  const month = Math.min(11, Math.max(0, Number(m[2]) - 1));
  return [year, month];
}

/**
 * Build the period grid: MONTHLY_PERIODS monthly periods (Y1..Y3) followed by the
 * remaining annual periods (Y4..Y20).
 * Plan years are offset from the start month, so "Y1" runs 12 months from the start month.
 */
export function buildPeriods(startMonth: string): Period[] {
  const [startYear, startMonthIdx] = parseStartMonth(startMonth);
  const periods: Period[] = [];

  for (let i = 0; i < MONTHLY_PERIODS; i++) {
    const abs = startMonthIdx + i;
    const year = startYear + Math.floor(abs / 12);
    const monthIdx = ((abs % 12) + 12) % 12;
    periods.push({
      index: i,
      label: `${MONTH_LABELS[monthIdx]}-${String(year).slice(2)}`,
      months: 1,
      year: Math.floor(i / 12) + 1,
      monthly: true,
      yearsAtEnd: (i + 1) / 12,
    });
  }

  for (let k = 0; k < ANNUAL_PERIODS; k++) {
    const planYear = MONTHLY_YEARS + k + 1; // Y4..Y20
    const index = MONTHLY_PERIODS + k;
    periods.push({
      index,
      label: `Y${planYear}`,
      months: 12,
      year: planYear,
      monthly: false,
      yearsAtEnd: planYear,
    });
  }

  return periods;
}

/** Zero-filled array sized to the period grid. */
export function zeroes(n: number = PERIOD_COUNT): number[] {
  return new Array(n).fill(0);
}

/** Coerce a possibly-short/long array to exactly the period count. */
export function fit(values: number[] | undefined, n: number = PERIOD_COUNT): number[] {
  const out = zeroes(n);
  if (!values) return out;
  for (let i = 0; i < Math.min(values.length, n); i++) {
    const v = Number(values[i]);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** Days in a period, used for DSO/DPO working capital. */
export function daysInPeriod(p: Period): number {
  return p.months * (365 / 12);
}
