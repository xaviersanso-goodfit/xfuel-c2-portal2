import { C } from "./palette";

/**
 * Text styling helpers.
 *
 * Charts are rasterised to PNG by serialising the SVG and painting it onto a
 * canvas. A detached SVG has no stylesheet context, and SVG renderers vary in
 * how much of the CSS `font:` shorthand they support, so every text node
 * carries explicit presentation attributes instead of a class.
 */
export const FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  letterSpacing?: number;
}

export function text(size: number, weight = 400, fill: string = C.ink, letterSpacing?: number): TextStyle {
  const s: TextStyle = { fontFamily: FONT, fontSize: size, fontWeight: weight, fill };
  if (letterSpacing !== undefined) s.letterSpacing = letterSpacing;
  return s;
}

export const T = {
  tick: text(10, 400, C.muted),
  month: text(9, 400, C.muted),
  year: text(11, 600, C.ink),
  axis: text(10, 600, C.muted, 0.5),
  legend: text(11, 400, C.ink),
  note: text(9, 600, C.brandDeep),
  panel: text(10, 600, C.muted, 0.6),
  msLabel: text(12, 600, C.ink),
  msValue: text(17, 700, C.brandDeep),
  msDetail: text(10.5, 400, C.muted),
  segIn: text(10, 600, "#ffffff"),
  segOut: text(10, 400, C.muted),
  statLabel: text(11, 400, C.muted),
  statValue: text(18, 700, C.ink),
  statValueAccent: text(18, 700, C.brandDeep),
  statSub: text(10, 400, C.muted),
} as const;
