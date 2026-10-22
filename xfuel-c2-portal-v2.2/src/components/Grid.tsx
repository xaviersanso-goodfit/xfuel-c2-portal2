"use client";

import type { Period } from "@/lib/model/types";
import { fmt } from "@/lib/format";

/** Header row of period labels, with a divider at each year boundary. */
export function PeriodHead({ periods, first = "Line" }: { periods: Period[]; first?: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        {periods.map((p, i) => (
          <th key={p.index} className={isYearStart(periods, i) ? "yearsplit" : ""}>
            {p.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function isYearStart(periods: Period[], i: number): boolean {
  if (i === 0) return false;
  return periods[i].year !== periods[i - 1].year;
}

/** Read-only row of computed numbers. */
export function ValueRow({
  label,
  values,
  periods,
  bold,
  section,
  format = fmt,
}: {
  label: string;
  values: number[];
  periods: Period[];
  bold?: boolean;
  section?: boolean;
  format?: (n: number) => string;
}) {
  if (section) {
    return (
      <tr className="section">
        <td colSpan={periods.length + 1}>{label}</td>
      </tr>
    );
  }
  return (
    <tr className={bold ? "subtotal" : ""}>
      <td>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`num ${isYearStart(periods, i) ? "yearsplit" : ""} ${v < 0 ? "neg" : ""}`}>
          {format(v)}
        </td>
      ))}
    </tr>
  );
}

/** Editable row of inputs across the period grid. */
export function InputRow({
  label,
  values,
  periods,
  editable,
  onChange,
  step = "any",
  scale = 1,
  suffix,
}: {
  label: string;
  values: number[];
  periods: Period[];
  editable: boolean;
  onChange: (next: number[]) => void;
  step?: string;
  /** Display scale: e.g. 100 to show a fraction as a percentage. */
  scale?: number;
  suffix?: string;
}) {
  // Always render one cell per period and always emit a dense array of that
  // length. Mapping over `values` instead would stop the row short whenever the
  // stored series is shorter than the plan, leaving later periods with no input
  // at all, and writing past the end of a short array would produce a sparse
  // array whose holes serialise to null and calculate as zero.
  const n = periods.length;
  const dense = (): number[] => {
    const out = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const v = Number(values[i]);
      out[i] = Number.isFinite(v) ? v : 0;
    }
    return out;
  };
  const set = (i: number, raw: string) => {
    const next = dense();
    const parsed = raw === "" ? 0 : parseFloat(raw);
    next[i] = Number.isFinite(parsed) ? parsed / scale : 0;
    onChange(next);
  };
  return (
    <tr>
      <td>
        {label}
        {suffix ? <span className="muted"> {suffix}</span> : null}
      </td>
      {periods.map((_, i) => {
        const v = Number(values[i]);
        return (
          <td key={i} className={isYearStart(periods, i) ? "yearsplit" : ""}>
            <input
              className="cell"
              type="number"
              step={step}
              disabled={!editable}
              value={round((Number.isFinite(v) ? v : 0) * scale)}
              onChange={(e) => set(i, e.target.value)}
            />
          </td>
        );
      })}
    </tr>
  );
}

function round(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}

/** Small labelled scalar input. */
export function Field({
  label,
  value,
  editable,
  onChange,
  type = "number",
  step = "any",
  scale = 1,
  hint,
}: {
  label: string;
  value: number | string;
  editable: boolean;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  scale?: number;
  hint?: string;
}) {
  const shown = typeof value === "number" ? round(value * scale) : value;
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        step={step}
        disabled={!editable}
        value={shown}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

/** Header for a yearly (Y1..Yn) input table. */
export function YearHead({ years, first = "Driver" }: { years: number; first?: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        {Array.from({ length: years }, (_, i) => (
          <th key={i}>Y{i + 1}</th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * One editable row of a yearly driver table.
 *
 * Same contract as InputRow: always renders one cell per year and always emits
 * a dense array of that length, so a scenario stored with fewer years (or with
 * a bare scalar, before these drivers became yearly) cannot leave cells
 * unrendered or produce holes that calculate as zero.
 */
export function YearRow({
  label,
  values,
  years,
  editable,
  onChange,
  step = "any",
  scale = 1,
  suffix,
}: {
  label: string;
  values: number[] | number | undefined;
  years: number;
  editable: boolean;
  onChange: (next: number[]) => void;
  step?: string;
  scale?: number;
  suffix?: string;
}) {
  const read = (i: number): number => {
    const v = Array.isArray(values) ? Number(values[i]) : Number(values);
    return Number.isFinite(v) ? v : 0;
  };
  const set = (i: number, raw: string) => {
    const next = Array.from({ length: years }, (_, k) => read(k));
    const parsed = raw === "" ? 0 : parseFloat(raw);
    next[i] = Number.isFinite(parsed) ? parsed / scale : 0;
    onChange(next);
  };
  return (
    <tr>
      <td>
        {label}
        {suffix ? <span className="muted"> {suffix}</span> : null}
      </td>
      {Array.from({ length: years }, (_, i) => (
        <td key={i}>
          <input
            className="cell"
            type="number"
            step={step}
            disabled={!editable}
            value={round(read(i) * scale)}
            onChange={(e) => set(i, e.target.value)}
          />
        </td>
      ))}
    </tr>
  );
}

/** A non-editable label row used to group a yearly table into sections. */
export function SectionRow({ label, span }: { label: string; span: number }) {
  return (
    <tr className="section">
      <td colSpan={span + 1}>{label}</td>
    </tr>
  );
}
