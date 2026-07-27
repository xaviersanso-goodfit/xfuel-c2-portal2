import type { Instrument, Period } from "./types";

/** Net present value of cashflows at given year offsets, discounted annually. */
export function npv(rate: number, flows: number[], yearsAtEnd: number[]): number {
  let total = 0;
  for (let i = 0; i < flows.length; i++) {
    total += flows[i] / Math.pow(1 + rate, yearsAtEnd[i]);
  }
  return total;
}

/**
 * IRR via bisection on the NPV function. Robust for the sign patterns typical of a
 * project plan (early negative construction flows, later positive operating flows).
 * Returns null when no sign change exists or no root is bracketed.
 */
export function irr(flows: number[], yearsAtEnd: number[]): number | null {
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;

  const f = (r: number) => npv(r, flows, yearsAtEnd);

  let lo = -0.9499;
  let hi = 10;
  let flo = f(lo);
  let fhi = f(hi);

  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;

  // Expand upper bound if not bracketed.
  let guard = 0;
  while (flo * fhi > 0 && guard < 60) {
    hi *= 1.5;
    fhi = f(hi);
    if (!Number.isFinite(fhi)) return null;
    guard++;
    if (hi > 1e6) break;
  }
  if (flo * fhi > 0) return null;

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (!Number.isFinite(fmid)) return null;
    if (Math.abs(fmid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (flo * fmid <= 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

export interface DebtFlows {
  draw: number[];
  principalRepayment: number[];
  interest: number[];
  balance: number[];
  fees: number[];
}

/**
 * Build monthly-resolution debt flows for one instrument, then aggregate onto the
 * period grid. Working at monthly resolution keeps annual periods correct.
 */
export function buildDebtFlows(inst: Instrument, periods: Period[]): DebtFlows {
  const n = periods.length;
  const draw = new Array(n).fill(0);
  const principalRepayment = new Array(n).fill(0);
  const interest = new Array(n).fill(0);
  const balance = new Array(n).fill(0);
  const fees = new Array(n).fill(0);

  if (inst.kind !== "debt" || !(inst.amount > 0)) return { draw, principalRepayment, interest, balance, fees };

  // Map each period to its first month offset and length.
  const monthStart: number[] = [];
  let cursor = 0;
  for (const p of periods) {
    monthStart.push(cursor);
    cursor += p.months;
  }
  const totalMonths = cursor;

  const drawPeriod = clampIndex(inst.drawPeriod, n);
  const drawMonth = monthStart[drawPeriod];
  const rate = inst.rate ?? 0;
  const monthlyRate = rate / 12;
  const grace = Math.max(0, Math.round(inst.graceMonths ?? 0));
  const tenor = Math.max(1, Math.round(inst.tenorMonths ?? 12));
  const amortMonths = Math.max(1, tenor - grace);
  const profile = inst.repayment ?? "linear";

  // Monthly arrays.
  const mDraw = new Array(totalMonths).fill(0);
  const mPrincipal = new Array(totalMonths).fill(0);
  const mInterest = new Array(totalMonths).fill(0);
  const mBalance = new Array(totalMonths).fill(0);

  if (drawMonth < totalMonths) mDraw[drawMonth] = inst.amount;

  // Annuity payment (principal + interest) over the amortisation window.
  const annuityPayment =
    monthlyRate > 0
      ? (inst.amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -amortMonths))
      : inst.amount / amortMonths;

  let bal = 0;
  for (let m = 0; m < totalMonths; m++) {
    const opening = bal + mDraw[m];
    const interestThisMonth = opening * monthlyRate;
    let principalThisMonth = 0;

    const monthsSinceDraw = m - drawMonth;
    const amortising = monthsSinceDraw >= grace && monthsSinceDraw < tenor && opening > 0;

    if (amortising) {
      if (profile === "linear") {
        principalThisMonth = inst.amount / amortMonths;
      } else if (profile === "annuity") {
        principalThisMonth = annuityPayment - interestThisMonth;
      } else {
        // bullet: full principal in the final month of the tenor
        principalThisMonth = monthsSinceDraw === tenor - 1 ? opening : 0;
      }
    }
    principalThisMonth = Math.min(Math.max(principalThisMonth, 0), opening);

    mInterest[m] = interestThisMonth;
    mPrincipal[m] = principalThisMonth;
    bal = opening - principalThisMonth;
    mBalance[m] = bal;
  }

  // Aggregate to periods.
  for (let i = 0; i < n; i++) {
    const from = monthStart[i];
    const to = from + periods[i].months;
    for (let m = from; m < to && m < totalMonths; m++) {
      draw[i] += mDraw[m];
      principalRepayment[i] += mPrincipal[m];
      interest[i] += mInterest[m];
    }
    const lastMonth = Math.min(to, totalMonths) - 1;
    balance[i] = lastMonth >= 0 ? mBalance[lastMonth] : 0;
  }

  if (inst.upfrontFeePct && inst.upfrontFeePct > 0) {
    fees[drawPeriod] = inst.amount * inst.upfrontFeePct;
  }

  return { draw, principalRepayment, interest, balance, fees };
}

function clampIndex(i: number, n: number): number {
  if (!Number.isFinite(i)) return 0;
  return Math.min(Math.max(Math.round(i), 0), n - 1);
}
