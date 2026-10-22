"use client";

import { C } from "./palette";
import type { ModelOutputs } from "@/lib/model/types";

/**
 * Unit economics by plan year.
 *
 * One stacked bar per year: base revenue and the sustainable premium stacked to
 * total revenue, COGS drawn below the axis, and gross margin marked on top. The
 * point of the chart is that the premium's contribution is visible year by
 * year, which is what a per-year premium makes possible.
 *
 * Driven from model.annual so it agrees with the statements by construction,
 * rather than re-summing periods on its own.
 */
export default function YearlyUnitEconomics({ model }: { model: ModelOutputs }) {
  const rows = model.annual.filter((a) => a.revenue !== 0 || a.cogs !== 0);
  if (rows.length === 0) {
    return <div className="note">No revenue or COGS in the plan yet.</div>;
  }

  const W = 1180;
  const H = 420;
  const PAD_L = 76;
  const PAD_R = 16;
  const TOP = 34;
  const BOT = 58;

  // The engine stores COGS as a positive cost, so it is negated here to draw
  // below the axis. Taking it as-is produced bars of negative height, which
  // clamp to nothing and silently removed COGS from the chart.
  const maxUp = Math.max(...rows.map((r) => r.revenue), 0);
  const maxDn = Math.max(...rows.map((r) => Math.abs(r.cogs)), 0);
  const span = maxUp + maxDn || 1;
  const plotH = H - TOP - BOT;
  const zeroY = TOP + (maxUp / span) * plotH;
  const y = (v: number) => zeroY - (v / span) * plotH;

  const slot = (W - PAD_L - PAD_R) / rows.length;
  const bw = Math.min(46, slot * 0.62);
  const cx = (i: number) => PAD_L + slot * i + slot / 2;

  const eurM = (v: number) =>
    Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks * 2 + 1 }, (_, k) => {
    const frac = (k - ticks) / ticks;
    return frac >= 0 ? frac * maxUp : frac * maxDn;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }} role="img">
      <title>Unit economics by plan year</title>

      {gridVals.map((v, k) => (
        <g key={k}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth={0.6} />
          <text x={PAD_L - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>
            {eurM(v)}
          </text>
        </g>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke={C.ink} strokeWidth={1} />

      {rows.map((r, i) => {
        const x = cx(i) - bw / 2;
        const baseTop = y(r.revenueBase);
        const premTop = y(r.revenue);
        const cogsBot = y(-Math.abs(r.cogs));
        return (
          <g key={r.year}>
            <rect x={x} y={baseTop} width={bw} height={Math.max(0, zeroY - baseTop)} fill={C.brandLight} />
            <rect x={x} y={premTop} width={bw} height={Math.max(0, baseTop - premTop)} fill={C.brand} />
            <rect x={x} y={zeroY} width={bw} height={Math.max(0, cogsBot - zeroY)} fill={"#8aa0b8"} />
            <line
              x1={x - 4} x2={x + bw + 4} y1={y(r.grossMargin)} y2={y(r.grossMargin)}
              stroke={C.ink} strokeWidth={1.4} strokeDasharray="4 3"
            />
            <text x={cx(i)} y={premTop - 6} textAnchor="middle" fontSize={10.5} fill={C.ink} fontWeight={600}>
              {eurM(r.revenue)}
            </text>
            <text x={cx(i)} y={H - BOT + 16} textAnchor="middle" fontSize={11} fill={C.muted}>
              {r.label}
            </text>
            <text x={cx(i)} y={H - BOT + 31} textAnchor="middle" fontSize={10} fill={C.muted}>
              {r.revenue > 0 ? `${Math.round((r.grossMargin / r.revenue) * 100)}%` : "–"}
            </text>
          </g>
        );
      })}

      <g transform={`translate(${PAD_L}, 16)`} fontSize={11}>
        <rect x={0} y={-8} width={10} height={10} fill={C.brandLight} />
        <text x={16} y={1} fill={C.ink}>Revenue, base</text>
        <rect x={120} y={-8} width={10} height={10} fill={C.brand} />
        <text x={136} y={1} fill={C.ink}>Sustainable premium</text>
        <rect x={290} y={-8} width={10} height={10} fill={"#8aa0b8"} />
        <text x={306} y={1} fill={C.ink}>COGS</text>
        <line x1={360} x2={382} y1={-3} y2={-3} stroke={C.ink} strokeWidth={1.4} strokeDasharray="4 3" />
        <text x={390} y={1} fill={C.ink}>Gross margin</text>
        <text x={500} y={1} fill={C.muted}>Percentage below each bar is gross margin on revenue</text>
      </g>
    </svg>
  );
}
