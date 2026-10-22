"use client";

import { MONTHLY_PERIODS } from "@/lib/model/periods";
import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";
import { axisLabel, buildScale } from "./axis";
import { C, capexColour } from "./palette";
import { T } from "./text";

const W = 1180;
const H = 540;
const L = 84; // left gutter
const R = 30; // right gutter
const PLOT_W = W - L - R;

// Two stacked panels sharing the month axis. A single axis cannot carry both a
// ~25M cash balance and ~2M monthly flows without one of them collapsing into
// the baseline, and overlaying them on twin axes puts the cash line straight
// through the bars. Separate panels keep both readable and keep every series on
// a true zero baseline.
const CASH_TOP = 44;
const CASH_H = 132;
const FLOW_TOP = CASH_TOP + CASH_H + 46;
const FLOW_H = 190;
const AXIS_Y = FLOW_TOP + FLOW_H;
// Legend sits below the rotated month labels and may flow onto a second row.
const LEGEND_Y = AXIS_Y + 82;

/**
 * Cover chart: the first three years, month by month.
 *
 *   top    — closing cash balance
 *   bottom — CAPEX spent per month, stacked by concept, plus operating cash flow
 */
export default function CoverChart({ inputs, model }: { inputs: ScenarioInputs; model: ModelOutputs }) {
  const n = Math.min(MONTHLY_PERIODS, model.periods.length);
  const idx = Array.from({ length: n }, (_, i) => i);

  const concepts = inputs.capex.map((line, i) => ({
    id: line.id,
    label: line.label.split("—")[0].trim(),
    colour: capexColour(line.id, i),
    series: (model.capexByConcept?.[line.id] ?? []).slice(0, n),
  }));
  const active = concepts.filter((c) => c.series.some((v) => Math.abs(v) > 0.5));

  const capexTotal = idx.map((i) => active.reduce((a, c) => a + (c.series[i] ?? 0), 0));
  const cfo = idx.map((i) => model.results[i]?.cfo ?? 0);
  const cash = idx.map((i) => model.results[i]?.closingCash ?? 0);

  const flow = buildScale([...capexTotal, ...cfo], FLOW_TOP, FLOW_H, 5);
  const cashScale = buildScale(cash, CASH_TOP, CASH_H, 4);

  const slot = PLOT_W / n;
  const barW = Math.min(11, slot * 0.34);
  const gap = Math.max(2, slot * 0.08);
  const groupW = barW * 2 + gap;
  const cx = (i: number) => L + slot * i + slot / 2;
  const capexX = (i: number) => cx(i) - groupW / 2;
  const cfoX = (i: number) => cx(i) - groupW / 2 + barW + gap;

  const zeroY = flow.y(0);
  const cashPath = idx.map((i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${cashScale.y(cash[i]).toFixed(1)}`).join(" ");
  const cashArea = `${cashPath} L${cx(n - 1).toFixed(1)},${cashScale.y(0).toFixed(1)} L${cx(0).toFixed(1)},${cashScale.y(0).toFixed(1)} Z`;

  const minCash = Math.min(...cash);
  const troughAt = cash.indexOf(minCash);
  const opsStart = inputs.parameters.opsStartPeriod;

  // Operating cash flow is drawn in two colours, so both need a legend entry.
  // The negative one only appears while the plant is pre-revenue, so it is
  // omitted when the plan never has an operating outflow.
  const hasNegativeCfo = cfo.some((v) => v < -0.5);
  const legend = [
    ...active.map((c) => ({ colour: c.colour, label: c.label, kind: "box" as const })),
    { colour: C.cfo, label: "Operating cash flow", kind: "box" as const },
    ...(hasNegativeCfo
      ? [{ colour: C.cfoNeg, label: "Operating cash flow (outflow)", kind: "box" as const }]
      : []),
    { colour: C.cash, label: "Closing cash balance", kind: "line" as const },
  ];

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly cash profile, years 1 to 3">
      {/* ---------------- year bands and dividers ---------------- */}
      {[0, 1, 2].map((y) => {
        const from = y * 12;
        if (from >= n) return null;
        const to = Math.min(from + 12, n);
        const x0 = L + slot * from;
        return (
          <g key={`y${y}`}>
            {y > 0 ? <line x1={x0} x2={x0} y1={CASH_TOP - 10} y2={AXIS_Y} stroke="#d6dde5" strokeDasharray="3 3" /> : null}
            <text {...T.year} x={(x0 + L + slot * to) / 2} y={18} textAnchor="middle">
              Year {y + 1}
            </text>
          </g>
        );
      })}

      {/* operations-start marker, spanning both panels */}
      {opsStart > 0 && opsStart < n ? (
        <g>
          <line
            x1={L + slot * opsStart} x2={L + slot * opsStart} y1={CASH_TOP - 10} y2={AXIS_Y}
            stroke={C.brand} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.75}
          />
          <text {...T.note} x={L + slot * opsStart + 5} y={CASH_TOP - 1}>
            production starts
          </text>
        </g>
      ) : null}

      {/* ---------------- panel 1: cash balance ---------------- */}
      <text {...T.panel} x={L} y={CASH_TOP - 12}>
        CLOSING CASH BALANCE (EUR)
      </text>
      {cashScale.ticks.map((t) => (
        <g key={`ct${t}`}>
          <line
            x1={L} x2={L + PLOT_W} y1={cashScale.y(t)} y2={cashScale.y(t)}
            stroke={t === 0 ? "#c3ccd6" : C.line} strokeWidth={t === 0 ? 1.2 : 1}
          />
          <text {...T.tick} x={L - 8} y={cashScale.y(t) + 3.5} textAnchor="end">
            {axisLabel(t)}
          </text>
        </g>
      ))}
      {/* A flat tint rather than an opacity: alpha compositing is the first thing
          to differ between SVG rasterisers, and this fill has to survive export. */}
      <path d={cashArea} fill="#E4F0FF" />
      <path d={cashPath} fill="none" stroke={C.cash} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      {idx.map((i) =>
        i % 3 === 0 || i === n - 1 ? <circle key={`cp${i}`} cx={cx(i)} cy={cashScale.y(cash[i])} r={2.4} fill={C.cash} /> : null
      )}
      {/* call out the funding trough, the number the chart exists to show */}
      {troughAt >= 0 ? (
        <g>
          <circle cx={cx(troughAt)} cy={cashScale.y(minCash)} r={4} fill={C.bad} />
          <text
            {...T.note}
            fill={C.bad}
            x={Math.min(cx(troughAt) + 7, L + PLOT_W - 120)}
            y={cashScale.y(minCash) + (minCash < (cashScale.max + cashScale.min) / 2 ? -8 : 14)}
          >
            trough {axisLabel(minCash)} · {model.periods[troughAt]?.label}
          </text>
        </g>
      ) : null}

      {/* ---------------- panel 2: monthly flows ---------------- */}
      <text {...T.panel} x={L} y={FLOW_TOP - 12}>
        MONTHLY FLOWS (EUR)
      </text>
      {flow.ticks.map((t) => (
        <g key={`ft${t}`}>
          <line
            x1={L} x2={L + PLOT_W} y1={flow.y(t)} y2={flow.y(t)}
            stroke={t === 0 ? "#c3ccd6" : C.line} strokeWidth={t === 0 ? 1.2 : 1}
          />
          <text {...T.tick} x={L - 8} y={flow.y(t) + 3.5} textAnchor="end">
            {axisLabel(t)}
          </text>
        </g>
      ))}

      {/* stacked CAPEX, growing up from zero */}
      {idx.map((i) => {
        let base = zeroY;
        return (
          <g key={`cap${i}`}>
            {active.map((c) => {
              const v = c.series[i] ?? 0;
              if (v <= 0) return null;
              const h = Math.max(0.8, zeroY - flow.y(v));
              base -= h;
              return <rect key={c.id} x={capexX(i)} y={base} width={barW} height={h} fill={c.colour} />;
            })}
          </g>
        );
      })}

      {/* operating cash flow, signed */}
      {idx.map((i) => {
        const v = cfo[i];
        if (Math.abs(v) < 0.5) return null;
        const y = v >= 0 ? flow.y(v) : zeroY;
        const h = Math.max(0.8, Math.abs(flow.y(v) - zeroY));
        return <rect key={`cfo${i}`} x={cfoX(i)} y={y} width={barW} height={h} fill={v >= 0 ? C.cfo : C.cfoNeg} />;
      })}

      {/* ---------------- month axis ---------------- */}
      <line x1={L} x2={L + PLOT_W} y1={AXIS_Y} y2={AXIS_Y} stroke="#c3ccd6" />
      {/* Rotation lives on a wrapping <g>, not on the <text> itself: a transform
          plus text-anchor on the same element is handled inconsistently by SVG
          rasterisers, and these labels have to survive the PNG export. */}
      {idx.map((i) => (
        <g key={`m${i}`} transform={`translate(${cx(i).toFixed(2)} ${AXIS_Y + 12}) rotate(-60)`}>
          <text {...T.month} x={0} y={0} textAnchor="end">
            {model.periods[i]?.label ?? ""}
          </text>
        </g>
      ))}

      {/* ---------------- legend ---------------- */}
      {/* Flowed rather than fixed-pitch: the number of entries depends on how
          many CAPEX concepts are in play and whether there is an operating
          outflow, so a fixed column width either overflows or leaves gaps.
          Width is estimated from the label length, which is close enough at
          this font size and avoids measuring text in the DOM (these charts are
          also rendered server-side and serialised straight to PNG). */}
      <g transform={`translate(${L}, ${LEGEND_Y})`}>
        {(() => {
          let x = 0;
          let row = 0;
          return legend.map((l) => {
            const w = l.label.length * 5.9 + 34;
            if (x > 0 && x + w > PLOT_W) {
              x = 0;
              row += 1;
            }
            const at = x;
            x += w;
            return (
              <g key={l.label} transform={`translate(${at} ${row * 18})`}>
                {l.kind === "box" ? (
                  <rect x={0} y={-8} width={11} height={11} rx={2} fill={l.colour} />
                ) : (
                  <line x1={0} x2={12} y1={-2.5} y2={-2.5} stroke={l.colour} strokeWidth={2.4} />
                )}
                <text {...T.legend} x={18} y={1}>
                  {l.label}
                </text>
              </g>
            );
          });
        })()}
      </g>
    </svg>
  );
}
