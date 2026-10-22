"use client";

import { TOTAL_YEARS } from "@/lib/model/periods";
import type { GlobalParameters, PremiumMode } from "@/lib/model/types";

/**
 * Editor for the sustainable premium.
 *
 * The premium used to be a single multiplier for the whole plan. It is now a
 * yearly series, because the uplift is expected to differ year by year, and it
 * can be expressed either as a ratio on the base price or as a flat EUR amount
 * per ton. Both series are kept so switching mode does not lose the other's
 * figures.
 *
 * Why not a revenue line instead: the premium is modelled as margin with no
 * incremental cost, and the unit economics and statements split base from
 * premium explicitly. A separate revenue line would carry a COGS basis and
 * would not appear in that split.
 */
export default function PremiumEditor({
  parameters,
  editable,
  onChange,
}: {
  parameters: GlobalParameters;
  editable: boolean;
  onChange: (patch: Partial<GlobalParameters>) => void;
}) {
  const emit = editable ? onChange : () => {};
  const years = TOTAL_YEARS;
  const mode: PremiumMode = parameters.premiumMode === "perTon" ? "perTon" : "multiplier";

  const dense = (src: number[] | undefined, fallback: number) => {
    const out = Array.from({ length: years }, (_, i) => {
      const v = Number(src?.[i]);
      return Number.isFinite(v) ? v : fallback;
    });
    return out;
  };
  const mult = dense(parameters.premiumMultiplierByYear, 1);
  const perTon = dense(parameters.premiumPerTonByYear, 0);

  const setYear = (which: PremiumMode, y: number, raw: string) => {
    const base = which === "perTon" ? [...perTon] : [...mult];
    const parsed = raw === "" ? (which === "perTon" ? 0 : 1) : parseFloat(raw);
    base[y] = Number.isFinite(parsed) ? parsed : 0;
    // Year 1 is mirrored back onto the legacy scalar so the workbook and any
    // older reader still see a sensible single figure.
    if (which === "perTon") emit({ premiumPerTonByYear: base });
    else emit({ premiumMultiplierByYear: base, sustainablePremium: base[0] });
  };

  /** Apply year 1 across every year. The common case is a flat premium. */
  const fill = () => {
    if (mode === "perTon") emit({ premiumPerTonByYear: new Array(years).fill(perTon[0]) });
    else emit({ premiumMultiplierByYear: new Array(years).fill(mult[0]), sustainablePremium: mult[0] });
  };

  const row = mode === "perTon" ? perTon : mult;
  const step = mode === "perTon" ? "1" : "0.01";

  return (
    <div className="card">
      <h3>Sustainable premium</h3>
      <div className="note">
        {mode === "perTon"
          ? "A fixed EUR uplift per ton of premium-eligible product. Entered figures are final: revenue inflation does not escalate them, because a year-by-year forecast already carries your own view of how the premium moves."
          : "A ratio on the base price. 1.00 means no premium, 1.70 means the realised price is 1.70x the base, so 0.70x is the green premium. Being a ratio, it applies to the inflated base price."}{" "}
        Applies only to revenue lines flagged premium eligible.
      </div>

      <div className="toolbar">
        <label className="comp-flag">
          <input
            type="radio"
            name="premiumMode"
            checked={mode === "multiplier"}
            disabled={!editable}
            onChange={() => emit({ premiumMode: "multiplier" })}
          />
          Multiplier on price
        </label>
        <label className="comp-flag">
          <input
            type="radio"
            name="premiumMode"
            checked={mode === "perTon"}
            disabled={!editable}
            onChange={() => emit({ premiumMode: "perTon" })}
          />
          EUR per ton
        </label>
        {editable && (
          <button className="btn ghost sm" onClick={fill} title="Copy the Y1 figure across every year">
            Apply Y1 to all years
          </button>
        )}
      </div>

      <div className="tbl-wrap">
        <table className="fin">
          <thead>
            <tr>
              <th>By plan year</th>
              {Array.from({ length: years }, (_, y) => (
                <th key={y}>Y{y + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{mode === "perTon" ? "Premium (EUR/ton)" : "Premium (multiplier)"}</td>
              {row.map((v, y) => (
                <td key={y}>
                  <input
                    type="number"
                    step={step}
                    value={v}
                    disabled={!editable}
                    onChange={(e) => setYear(mode, y, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
