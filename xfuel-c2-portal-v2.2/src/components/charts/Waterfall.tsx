"use client";

import { LOGO_DARK } from "../Logo";
import type { BridgeBlock } from "@/lib/model/group";
import { C } from "./palette";
import { text } from "./text";
import { axisLabel, buildScale } from "./axis";

const W = 1180;
const L = 92;
const R = 30;
const PLOT_W = W - L - R;

// Sized for the chart to be read at a distance, since this is the one that gets
// copied into board packs. Everything below is derived from these.
const TOP = 84;
const PLOT_H = 262;
const AXIS_Y = TOP + PLOT_H;
const LABEL_BAND = 40; // room for the flat block labels
const ITEMS_Y = AXIS_Y + LABEL_BAND + 26;
const ITEM_ROW_H = 68;
const H = ITEMS_Y + 2 * ITEM_ROW_H + 40;

// Logo is 296x88 in the source asset; keep the aspect ratio.
const LOGO_H = 30;
const LOGO_W = (LOGO_H * 296) / 88;

interface Step {
  label: string;
  amount: number;
  /** Anchors are absolute balances drawn from zero; deltas float. */
  anchor: boolean;
  from: number;
  to: number;
}

/** "Cash 30/06/2026" -> "Cash Jun-26". */
function shortLabel(s: string): string {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (!m) return s;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Cash ${names[Number(m[2]) - 1] ?? m[2]}-${m[3].slice(2)}`;
}

/**
 * Cash bridge as a waterfall: opening balance, one floating bar per block, and
 * the closing balance.
 *
 * Anchors are drawn from zero so they read as balances; the blocks in between
 * float between the running totals, so the eye follows the cash rather than
 * comparing bar heights.
 *
 * The XFuel wordmark is embedded as a data URI rather than a file reference.
 * This chart is serialised and painted onto a canvas to produce the PNG, and an
 * external image URL would either fail to load in the detached SVG or taint the
 * canvas and block the export; a data URI does neither.
 */
export default function Waterfall({
  blocks,
  opening,
  closing,
  openingLabel,
  closingLabel,
}: {
  blocks: BridgeBlock[];
  opening: number;
  closing: number;
  openingLabel: string;
  closingLabel: string;
}) {
  const steps: Step[] = [];
  // Anchors get a short label: the full date is in the subtitle, and a long
  // rotated label on the first bar runs off the left edge of the canvas.
  steps.push({ label: shortLabel(openingLabel), amount: opening, anchor: true, from: 0, to: opening });
  let running = opening;
  for (const b of blocks) {
    const from = running;
    running += b.amount;
    steps.push({ label: b.label, amount: b.amount, anchor: false, from, to: running });
  }
  steps.push({ label: shortLabel(closingLabel), amount: closing, anchor: true, from: 0, to: closing });

  const scale = buildScale(steps.flatMap((s) => [s.from, s.to]), TOP, PLOT_H, 5);

  const slot = PLOT_W / steps.length;
  const barW = Math.min(78, slot * 0.62);
  const cx = (i: number) => L + slot * i + slot / 2;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cash bridge waterfall">
      <image
        href={LOGO_DARK}
        xlinkHref={LOGO_DARK}
        x={W - R - LOGO_W}
        y={16}
        width={LOGO_W}
        height={LOGO_H}
      />

      <text {...text(15, 700, C.ink, 0.4)} x={L} y={30}>
        CASH BRIDGE
      </text>
      <text {...text(12.5, 400, C.muted)} x={L} y={50}>
        {openingLabel} to {closingLabel}, EUR. Blocks are cumulative over the whole period, not annual averages.
      </text>

      {scale.ticks.map((t) => (
        <g key={t}>
          <line
            x1={L} x2={L + PLOT_W} y1={scale.y(t)} y2={scale.y(t)}
            stroke={t === 0 ? "#c3ccd6" : C.line} strokeWidth={t === 0 ? 1.4 : 1}
          />
          <text {...text(12, 400, C.muted)} x={L - 10} y={scale.y(t) + 4.5} textAnchor="end">
            {axisLabel(t)}
          </text>
        </g>
      ))}

      {steps.map((s, i) => {
        const yTop = Math.min(scale.y(s.from), scale.y(s.to));
        const h = Math.max(2, Math.abs(scale.y(s.to) - scale.y(s.from)));
        const x = cx(i) - barW / 2;
        const fill = s.anchor ? C.brandDeep : s.amount >= 0 ? C.cfo : C.bad;
        // Connector from the previous bar's landing point, so the eye follows
        // the running balance rather than reading each bar independently.
        const prev = steps[i - 1];
        return (
          <g key={s.label}>
            {prev && !s.anchor ? (
              <line
                x1={cx(i - 1) + barW / 2} x2={x} y1={scale.y(s.from)} y2={scale.y(s.from)}
                stroke="#b8c2cd" strokeDasharray="3 3"
              />
            ) : null}
            <rect x={x} y={yTop} width={barW} height={h} rx={2} fill={fill} />
            <text
              {...text(14, 700, s.anchor ? C.brandDeep : s.amount >= 0 ? C.good : C.bad)}
              x={cx(i)}
              y={s.amount >= 0 || s.anchor ? yTop - 8 : yTop + h + 17}
              textAnchor="middle"
            >
              {axisLabel(s.anchor ? s.to : s.amount)}
            </text>
          </g>
        );
      })}

      <line x1={L} x2={L + PLOT_W} y1={AXIS_Y} y2={AXIS_Y} stroke="#c3ccd6" strokeWidth={1.4} />
      {/* All labels sit flat and centred. With eight bars each slot is wide
          enough for the longest label, so nothing needs rotating: rotated text
          is the first thing SVG rasterisers disagree about, and this chart is
          exported as a PNG. */}
      {steps.map((s, i) => (
        <text
          key={`l${s.label}`}
          {...text(13, 700, s.anchor ? C.brandDeep : C.ink)}
          x={cx(i)}
          y={AXIS_Y + 24}
          textAnchor="middle"
        >
          {s.label}
        </text>
      ))}

      {/* Itemisation, so the grouped bars stay legible but the detail is present. */}
      <line x1={L} x2={L + PLOT_W} y1={ITEMS_Y - 26} y2={ITEMS_Y - 26} stroke={C.line} />
      <text {...text(12, 700, C.muted, 0.5)} x={L} y={ITEMS_Y - 8}>
        ITEMS WITHIN EACH BLOCK
      </text>
      {blocks.map((b, bi) => {
        const col = bi % 3;
        const row = Math.floor(bi / 3);
        const bx = L + col * (PLOT_W / 3);
        const by = ITEMS_Y + 18 + row * ITEM_ROW_H;
        return (
          <g key={`it${b.key}`}>
            <text {...text(12.5, 700, C.ink)} x={bx} y={by}>
              {b.label}
            </text>
            <text {...text(12.5, 700, b.amount >= 0 ? C.good : C.bad)} x={bx + 78} y={by}>
              {axisLabel(b.amount)}
            </text>
            {b.items.slice(0, 3).map((it, k) => (
              <text key={it.key} {...text(11, 400, C.muted)} x={bx} y={by + 16 + k * 13}>
                {it.label} {axisLabel(it.amount)}
              </text>
            ))}
            {b.items.length > 3 ? (
              <text {...text(11, 400, C.muted)} x={bx} y={by + 16 + 3 * 13}>
                +{b.items.length - 3} more
              </text>
            ) : null}
            {b.items.length === 0 ? (
              <text {...text(11, 400, C.muted)} x={bx} y={by + 16}>
                nothing booked
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
