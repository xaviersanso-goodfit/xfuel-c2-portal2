"use client";

import { TOTAL_YEARS } from "@/lib/model/periods";
import {
  BASIS_FIELD_LABELS,
  BASIS_LABELS,
  BASIS_USES,
  DESCRIPTION_MAX,
  clampDescription,
  newComponent,
} from "@/lib/model/components";
import type { ComponentBasis, ModelComponent } from "@/lib/model/components";

/**
 * Editor for a list of revenue, COGS or OPEX components.
 *
 * One table per component rather than one row: each line carries a name, a
 * description, a basis and up to three yearly series, which is too much to fit
 * on a single row across twenty year columns. Grouping by component also keeps
 * the field labels correct, since what "quantity" means depends on the basis.
 */
export default function ComponentEditor({
  kind,
  title,
  intro,
  components,
  bases,
  editable,
  onChange,
  showPremium = false,
  showYield = false,
}: {
  kind: "revenue" | "cogs" | "opex";
  title: string;
  intro: string;
  components: ModelComponent[];
  bases: ComponentBasis[];
  editable: boolean;
  onChange: (next: ModelComponent[]) => void;
  showPremium?: boolean;
  showYield?: boolean;
}) {
  const emit = editable ? onChange : () => {};
  const years = TOTAL_YEARS;

  const setOne = (id: string, patch: Partial<ModelComponent>) =>
    emit(components.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const setYear = (id: string, field: "quantity" | "unitCost" | "yieldKgPerHour", y: number, raw: string) => {
    const c = components.find((x) => x.id === id);
    if (!c) return;
    // Always emit a dense, full-length array. A sparse or short series reads as
    // zero downstream, which looks like a modelling result rather than a bug.
    const next = Array.from({ length: years }, (_, k) => {
      const v = Number((c[field] as number[] | undefined)?.[k]);
      return Number.isFinite(v) ? v : 0;
    });
    const parsed = raw === "" ? 0 : parseFloat(raw);
    next[y] = Number.isFinite(parsed) ? parsed : 0;
    setOne(id, { [field]: next } as Partial<ModelComponent>);
  };

  const add = () => emit([...components, newComponent(kind, years, components.length)]);
  const remove = (id: string) => emit(components.filter((c) => c.id !== id));

  const yearRow = (
    c: ModelComponent,
    field: "quantity" | "unitCost" | "yieldKgPerHour",
    label: string,
    step = "any"
  ) => (
    <tr key={`${c.id}-${field}`}>
      <td>{label}</td>
      {Array.from({ length: years }, (_, y) => {
        const v = Number((c[field] as number[] | undefined)?.[y]);
        return (
          <td key={y}>
            <input
              className="cell"
              type="number"
              step={step}
              disabled={!editable}
              value={Number.isFinite(v) ? v : 0}
              onChange={(e) => setYear(c.id, field, y, e.target.value)}
            />
          </td>
        );
      })}
    </tr>
  );

  return (
    <>
      <div className="page-title">{title}</div>
      <div className="page-sub">{intro}</div>

      {components.map((c) => {
        const uses = BASIS_USES[c.basis] ?? { quantity: true, unitCost: true };
        const fieldLabels = BASIS_FIELD_LABELS[c.basis] ?? { quantity: "Quantity", unitCost: "Unit cost" };
        return (
          <div className="card" key={c.id}>
            <div className="comp-head">
              <input
                className="comp-name"
                type="text"
                value={c.name}
                disabled={!editable}
                placeholder="Line name"
                onChange={(e) => setOne(c.id, { name: e.target.value })}
              />
              <select
                value={c.basis}
                disabled={!editable}
                onChange={(e) => setOne(c.id, { basis: e.target.value as ComponentBasis })}
              >
                {bases.map((b) => (
                  <option key={b} value={b}>
                    {BASIS_LABELS[b]}
                  </option>
                ))}
              </select>
              {showPremium && (
                <label className="comp-flag">
                  <input
                    type="checkbox"
                    checked={c.premiumEligible !== false}
                    disabled={!editable}
                    onChange={(e) => setOne(c.id, { premiumEligible: e.target.checked })}
                  />
                  Premium eligible
                </label>
              )}
              {editable && (
                <button className="btn danger sm" onClick={() => remove(c.id)} title="Remove this line">
                  Remove
                </button>
              )}
            </div>

            <div className="comp-desc">
              <input
                type="text"
                value={c.description ?? ""}
                disabled={!editable}
                maxLength={DESCRIPTION_MAX}
                placeholder="Description, up to 150 characters"
                onChange={(e) => setOne(c.id, { description: clampDescription(e.target.value) })}
              />
              <span className="comp-count">
                {(c.description ?? "").length}/{DESCRIPTION_MAX}
              </span>
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
                  {showYield && c.yieldKgPerHour ? yearRow(c, "yieldKgPerHour", "Yield (kg/h)") : null}
                  {uses.quantity ? yearRow(c, "quantity", fieldLabels.quantity, c.basis === "pctOfCapex" ? "0.001" : "any") : null}
                  {uses.unitCost ? yearRow(c, "unitCost", fieldLabels.unitCost) : null}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {editable && (
        <div className="toolbar">
          <button className="btn ghost" onClick={add}>
            + Add {kind === "cogs" ? "COGS" : kind} line
          </button>
        </div>
      )}
      {components.length === 0 && (
        <div className="note">
          No lines. Add one to start, or reload the base scenario to restore the seeded set.
        </div>
      )}
    </>
  );
}
