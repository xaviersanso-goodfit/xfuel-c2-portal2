"use client";

import { buildMilestones } from "@/lib/model/milestones";
import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";
import { C } from "./palette";
import { T } from "./text";

const W = 1180;
const H = 172;
// Labels are centred on their node, so the outer nodes need half a label's
// width of clearance or the first and last captions run off the canvas.
const PAD = 118;
const AXIS_Y = 88;

/**
 * Milestone ribbon: CAPEX starts -> CAPEX ends -> production starts ->
 * capacity ramp-up -> maximum production.
 *
 * Nodes are evenly spaced rather than placed on a time axis. The point is the
 * sequence and the dates; a true time axis would crush the construction
 * milestones together and leave the ramp stranded.
 */
export default function ProjectSummary({ inputs, model }: { inputs: ScenarioInputs; model: ModelOutputs }) {
  const ms = buildMilestones(inputs, model);
  const n = ms.length;
  const step = (W - PAD * 2) / (n - 1);
  const x = (i: number) => PAD + step * i;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Project milestone summary">
      <defs>
        <marker id="ps-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill={C.brandLight} />
        </marker>
      </defs>

      <line
        x1={PAD - 18} x2={W - PAD + 20} y1={AXIS_Y} y2={AXIS_Y}
        stroke={C.brandLight} strokeWidth={3} markerEnd="url(#ps-arrow)"
      />

      {ms.map((m, i) => {
        const px = x(i);
        // The final node is an output, not a date: fill it to set it apart.
        const terminal = i === n - 1;
        return (
          <g key={m.key}>
            <circle cx={px} cy={AXIS_Y} r={9} fill={terminal ? C.brandDeep : "#ffffff"} stroke={C.brandDeep} strokeWidth={3} />
            <text {...T.msLabel} x={px} y={AXIS_Y - 42} textAnchor="middle">
              {m.label}
            </text>
            <text {...T.msValue} x={px} y={AXIS_Y - 21} textAnchor="middle">
              {m.periodLabel}
            </text>
            <text {...T.msDetail} x={px} y={AXIS_Y + 30} textAnchor="middle">
              {m.detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
