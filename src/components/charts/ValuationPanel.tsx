"use client";

import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";
import { C } from "./palette";
import { T, text } from "./text";

const W = 1180;
const COLS = 4;
const PAD = 28;
const CARD_H = 150;
const GAP = 12;
const HEAD = 46;

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(1)}%`);
const eur = (v: number) => {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}€${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}€${(a / 1e3).toFixed(0)}k`;
  return `${s}€${Math.round(a)}`;
};

/** Wrap a definition to a fixed character width. Cheap, but the strings are short. */
function wrap(s: string, width: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The valuation metrics, grouped, with the definition of each one printed
 * underneath it.
 *
 * The definitions are on the face of the panel rather than in a tooltip because
 * this is exported as a PNG and dropped into board packs, where IRR and NPV get
 * read by people who will not agree on what "equity IRR" means unless told.
 */
export default function ValuationPanel({ inputs, model }: { inputs: ScenarioInputs; model: ModelOutputs }) {
  const v = model.valuation;
  const p = inputs.parameters;
  const minCash = Math.min(...model.results.map((r) => r.closingCash));
  const troughIdx = model.results.findIndex((r) => r.closingCash === minCash);

  const metrics = [
    {
      label: "Project IRR",
      value: pct(v.projectIrr),
      meta: "unlevered",
      good: (v.projectIrr ?? -1) >= p.wacc,
      def: "Annual return on the project's own cash flows, before any financing. Ignores how the plant is funded, so it measures the asset, not the deal. Compare it against the WACC.",
    },
    {
      label: "Project NPV",
      value: eur(v.projectNpv),
      meta: `discounted at WACC ${(p.wacc * 100).toFixed(1)}%`,
      good: v.projectNpv >= 0,
      def: "Present value of those same unlevered cash flows less the CAPEX, discounted at the WACC. Positive means the project earns more than the capital costs.",
    },
    {
      label: "Equity IRR",
      value: pct(v.equityIrr),
      meta: "levered, after debt service",
      good: (v.equityIrr ?? -1) >= p.costOfEquity,
      def: "Annual return to the shareholders after interest, debt repayment and tax. Sits above the project IRR when debt is cheaper than the asset return.",
    },
    {
      label: "Equity NPV",
      value: eur(v.equityNpv),
      meta: `discounted at Ke ${(p.costOfEquity * 100).toFixed(1)}%`,
      good: v.equityNpv >= 0,
      def: "Present value of the cash the shareholders put in and take out, discounted at the cost of equity. This is the value created for the sponsors.",
    },
    {
      label: "Terminal value",
      value: eur(v.terminalValueEnterprise),
      meta: `${p.exitMultiple}x final-year EBITDA`,
      def: "Assumed enterprise value at the end of the plan, from applying the exit multiple to final-year EBITDA. Usually the largest single driver of both NPVs.",
    },
    {
      label: "Net debt at exit",
      value: eur(v.netDebtAtExit),
      meta: "debt outstanding less cash",
      def: "Debt still outstanding at the end of the plan, net of the cash balance. Deducted from terminal enterprise value to get what the equity is worth.",
    },
    {
      label: "Peak funding need",
      value: eur(minCash),
      meta: model.periods[troughIdx]?.label
        ? `lowest cash, ${model.periods[troughIdx].label}`
        : "lowest cash in the plan",
      good: minCash >= 0,
      def: "The lowest the cash balance ever gets. If it is negative, the plan is short by that amount and needs more funding before that date.",
    },
    {
      label: "Payback",
      value: paybackLabel(model),
      meta: "cumulative project cash turns positive",
      def: "When cumulative unlevered cash flow first turns positive, so the project has returned the cash it consumed. Excludes terminal value.",
    },
  ];

  const rows = Math.ceil(metrics.length / COLS);
  const H = HEAD + rows * (CARD_H + GAP) + 10;
  const cardW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const defStyle = text(9.5, 400, C.muted);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Valuation metrics">
      <text {...T.panel} x={PAD} y={20}>
        RETURNS AND VALUATION
      </text>
      <text {...T.msDetail} x={PAD} y={35}>
        All figures in EUR, over a {model.periods[model.periods.length - 1]?.year ?? 10}-year plan with an exit at the
        end. Definitions are stated under each metric.
      </text>

      {metrics.map((m, i) => {
        const cxx = PAD + (i % COLS) * (cardW + GAP);
        const cyy = HEAD + Math.floor(i / COLS) * (CARD_H + GAP);
        const valueColour = m.good === undefined ? C.ink : m.good ? C.good : C.bad;
        return (
          <g key={m.label}>
            <rect x={cxx} y={cyy} width={cardW} height={CARD_H} rx={6} fill="#F7F9FC" stroke={C.line} />
            <rect x={cxx} y={cyy} width={3} height={CARD_H} fill={m.good === undefined ? C.brand : valueColour} />
            <text {...T.statLabel} x={cxx + 14} y={cyy + 22}>
              {m.label}
            </text>
            {/* Long values are words rather than numbers ("beyond plan"), so
                step the size down instead of letting them run off the card. */}
            <text {...text(m.value.length > 8 ? 17 : 24, 700, valueColour)} x={cxx + 14} y={cyy + 51}>
              {m.value}
            </text>
            <text {...T.statSub} x={cxx + 14} y={cyy + 68}>
              {m.meta}
            </text>
            <line x1={cxx + 14} x2={cxx + cardW - 14} y1={cyy + 78} y2={cyy + 78} stroke={C.line} />
            {wrap(m.def, Math.floor((cardW - 28) / 4.55)).slice(0, 5).map((line, k) => (
              <text key={k} {...defStyle} x={cxx + 14} y={cyy + 92 + k * 12}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** First period where cumulative unlevered cash flow turns positive. */
function paybackLabel(model: ModelOutputs): string {
  let cum = 0;
  for (let i = 0; i < model.results.length; i++) {
    cum += model.results[i].projectFcf;
    if (cum > 0) return model.periods[i]?.label ?? "–";
  }
  return "beyond plan";
}
