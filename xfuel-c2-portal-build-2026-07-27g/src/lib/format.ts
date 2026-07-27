export const fmt = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "–";
  return Math.round(n).toLocaleString("en-US");
};
export const fmt1 = (n: number): string =>
  !Number.isFinite(n) ? "–" : n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const pct = (n: number | null | undefined, dp = 1): string =>
  n == null || !Number.isFinite(n) ? "n/a" : `${(n * 100).toFixed(dp)}%`;
export const eur = (n: number): string => `${fmt(n)}`;
