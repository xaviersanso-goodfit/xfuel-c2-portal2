"use client";

import { buildUnitEconomics } from "@/lib/model/milestones";
import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";
import { C } from "./palette";
import { T } from "./text";

const W = 1180;
const H = 320;
const PAD = 34;
const BAR_TOP = 52;
const BAR_H = 66;

const COST_COLOURS = ["#0059C7", "#0B7BFF", "#4C9CFF", "#7FBBFF", "#B3D6FF"];

const eur0 = (v: number) => `€${Math.round(v).toLocaleString("en-US")}`;
const eur2 = (v: number) =>
  `€${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Unit economics per ton of finished product: the selling price as the full
 * bar, the variable cost stack consuming it from the left, and the contribution
 * that survives on the right. Steady-state annual figures sit underneath.
 *
 * The model works in hourly throughput; everything here is divided by the
 * hourly product yield so the segments are directly comparable.
 */
export default function UnitEconomics({ inputs, model }: { inputs: ScenarioInputs; model: ModelOutputs }) {
  const u = buildUnitEconomics(inputs, model);

  const trackW = W - PAD * 2;
  const scale = Math.max(u.pricePerTon, u.variableCostPerTon, 1);
  const px = (v: number) => (v / scale) * trackW;

  let cursor = PAD;
  const stack = u.components.map((c, i) => {
    const seg = { ...c, x: cursor, w: px(c.perTon), colour: COST_COLOURS[i % COST_COLOURS.length] };
    cursor += seg.w;
    return seg;
  });
  const contribX = cursor;
  const contribW = Math.max(0, PAD + px(u.pricePerTon) - cursor);

  const stats = [
    { label: "Price per ton", value: eur2(u.pricePerTon) },
    { label: "Variable cost per ton", value: eur2(u.variableCostPerTon) },
    { label: "Contribution per ton", value: eur2(u.contributionPerTon), accent: true },
    { label: "Contribution margin", value: `${(u.contributionPct * 100).toFixed(1)}%`, accent: true },
    { label: "Nameplate capacity", value: `${Math.round(u.nameplateTonsPerYear).toLocaleString("en-US")} t/y` },
    {
      label: "Steady-state output",
      value: `${Math.round(u.steadyTonsPerYear).toLocaleString("en-US")} t/y`,
      sub: `${(u.steadyUtilisation * 100).toFixed(0)}% utilisation`,
    },
    { label: "Steady-state revenue", value: eur0(u.steadyRevenue) },
    {
      label: "Steady-state EBITDA",
      value: eur0(u.steadyEbitda),
      sub: `${(u.steadyEbitdaMargin * 100).toFixed(1)}% margin`,
      accent: true,
    },
  ];

  // Two rows of four. Leaders below the bar need clearance, so the grid starts
  // below the deepest possible callout.
  const STAT_TOP = BAR_TOP + BAR_H + 78;
  const colW = trackW / 4;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Unit economics per ton">
      <text {...T.panel} x={PAD} y={BAR_TOP - 26}>
        PER TON OF PRODUCT
      </text>
      <text {...T.msDetail} x={PAD} y={BAR_TOP - 10}>
        Full bar = selling price {eur2(u.pricePerTon)} per ton. Segments are variable cost at full utilisation.
      </text>

      <rect x={PAD} y={BAR_TOP} width={px(u.pricePerTon)} height={BAR_H} rx={4} fill="#F2F6FB" />

      {stack.map((s) => (
        <g key={s.key}>
          <rect x={s.x} y={BAR_TOP} width={Math.max(0, s.w - 1)} height={BAR_H} fill={s.colour} />
          {s.w > 96 ? (
            <>
              <text {...T.segIn} x={s.x + 9} y={BAR_TOP + 26}>
                {s.label}
              </text>
              <text {...T.segIn} x={s.x + 9} y={BAR_TOP + 43} fillOpacity={0.92}>
                {eur2(s.perTon)}
              </text>
            </>
          ) : null}
        </g>
      ))}

      {/* segments too narrow for inline text get a leader below the bar */}
      {stack.map((s, i) =>
        s.w <= 96 ? (
          <g key={`o${s.key}`}>
            <line
              x1={s.x + s.w / 2} x2={s.x + s.w / 2}
              y1={BAR_TOP + BAR_H} y2={BAR_TOP + BAR_H + 10 + (i % 2) * 16}
              stroke="#c3ccd6"
            />
            <text {...T.segOut} x={s.x + s.w / 2} y={BAR_TOP + BAR_H + 22 + (i % 2) * 16} textAnchor="middle">
              {s.label} {eur2(s.perTon)}
            </text>
          </g>
        ) : null
      )}

      <rect x={contribX} y={BAR_TOP} width={Math.max(0, contribW - 1)} height={BAR_H} fill={C.good} />
      {contribW > 130 ? (
        <>
          <text {...T.segIn} x={contribX + 10} y={BAR_TOP + 26}>
            Contribution
          </text>
          <text {...T.segIn} x={contribX + 10} y={BAR_TOP + 43} fillOpacity={0.92}>
            {eur2(u.contributionPerTon)} · {(u.contributionPct * 100).toFixed(1)}%
          </text>
        </>
      ) : null}

      {stats.map((s, i) => {
        const sx = PAD + (i % 4) * colW;
        const sy = STAT_TOP + Math.floor(i / 4) * 60;
        return (
          <g key={s.label}>
            <text {...T.statLabel} x={sx} y={sy}>
              {s.label}
            </text>
            <text {...(s.accent ? T.statValueAccent : T.statValue)} x={sx} y={sy + 23}>
              {s.value}
            </text>
            {s.sub ? (
              <text {...T.statSub} x={sx} y={sy + 38}>
                {s.sub}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
