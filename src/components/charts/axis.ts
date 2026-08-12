/** Shared axis maths for the SVG charts. */

/** Round a span up to a 1/2/2.5/5/10 x 10^n step. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  /** Map a value to a pixel y within [top, top+height]. */
  y: (v: number) => number;
}

/**
 * Build a scale that always includes zero, so bars sit on a true baseline and a
 * signed series is not visually rebased.
 */
export function buildScale(values: number[], top: number, height: number, target = 5): Scale {
  const finite = values.filter((v) => Number.isFinite(v));
  let lo = Math.min(0, ...finite);
  let hi = Math.max(0, ...finite);
  if (lo === hi) hi = lo + 1;

  const step = niceStep((hi - lo) / target);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Accumulate in integer multiples to avoid float drift producing a stray tick.
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) ticks.push(lo + i * step);

  const span = hi - lo || 1;
  return {
    min: lo,
    max: hi,
    step,
    ticks,
    y: (v: number) => top + height - ((v - lo) / span) * height,
  };
}

/** Compact EUR label: 1.2M, 450k, 0. */
export function axisLabel(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e9) return `${(v / 1e9).toFixed(a % 1e9 === 0 ? 0 : 1)}bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a % 1e6 === 0 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a % 1e3 === 0 ? 0 : 0)}k`;
  return String(Math.round(v));
}
