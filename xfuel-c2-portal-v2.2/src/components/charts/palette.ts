/**
 * Chart palette.
 *
 * These are literal hex values, not CSS variables, on purpose: charts are
 * serialised to PNG via XMLSerializer + canvas, and a detached SVG string has
 * no access to the document's custom properties. Anything referencing
 * var(--brand) would render black in the exported image.
 */
export const C = {
  brand: "#0B7BFF",
  brandDeep: "#0059C7",
  brandLight: "#7FBBFF",
  ink: "#101418",
  muted: "#6b7480",
  line: "#e3e7ec",
  panel: "#ffffff",
  good: "#1a8c5a",
  bad: "#d92d20",
  // CAPEX concepts, darkest to lightest.
  isbl: "#0059C7",
  osbl: "#0B7BFF",
  other: "#7FBBFF",
  land: "#C7DFFF",
  cfo: "#1a8c5a",
  cfoNeg: "#e8a33d",
  cash: "#0D0D0D",
} as const;

export const CAPEX_COLOURS: Record<string, string> = {
  isbl: C.isbl,
  osbl: C.osbl,
  other: C.other,
  land: C.land,
};

/** Stable colour for a concept id, falling back through the brand ramp. */
const FALLBACK = [C.isbl, C.osbl, C.other, C.land, "#8aa0b8", "#b9c6d4"];
export function capexColour(id: string, index: number): string {
  return CAPEX_COLOURS[id] ?? FALLBACK[index % FALLBACK.length];
}
