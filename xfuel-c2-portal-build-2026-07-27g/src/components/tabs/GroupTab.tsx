"use client";

import { Field } from "../Grid";
import ChartFrame from "../charts/ChartFrame";
import Waterfall from "../charts/Waterfall";
import { fmt } from "@/lib/format";
import { GROUP_MONTHS, groupZeroes, runGroup } from "@/lib/model/group";
import type { GroupInputs, GroupLine } from "@/lib/model/group";
import { normaliseGroup } from "@/lib/model/normalise";
import type { ModelOutputs, ScenarioInputs } from "@/lib/model/types";

const SECTIONS: { key: GroupLine["section"]; label: string; c2: string }[] = [
  { key: "cfo", label: "Operating cash flow", c2: "CFO — C2 project" },
  { key: "cfi", label: "Investing cash flow", c2: "CFI — C2 project" },
  { key: "cff", label: "Financing cash flow", c2: "CFF — C2 project" },
];

export default function GroupTab({
  inputs, model, onChange, editable,
}: {
  inputs: ScenarioInputs;
  model: ModelOutputs;
  onChange: (next: ScenarioInputs) => void;
  editable: boolean;
}) {
  // Defence in depth: never emit a change when the session is read only.
  const emit = editable ? onChange : () => {};
  const group: GroupInputs = normaliseGroup(inputs.group);
  const g = runGroup(inputs, model, group);
  const months = g.months;
  const R = g.results;

  const setGroup = (patch: Partial<GroupInputs>) =>
    emit({ ...inputs, group: { ...group, ...patch } });

  const setLine = (id: string, patch: Partial<GroupLine>) =>
    setGroup({ lines: group.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const setAmount = (id: string, i: number, raw: string) => {
    const line = group.lines.find((l) => l.id === id);
    if (!line) return;
    const next = groupZeroes();
    for (let k = 0; k < GROUP_MONTHS; k++) {
      const v = Number(line.amounts[k]);
      next[k] = Number.isFinite(v) ? v : 0;
    }
    const parsed = raw === "" ? 0 : parseFloat(raw);
    next[i] = Number.isFinite(parsed) ? parsed : 0;
    setLine(id, { amounts: next });
  };

  const addLine = (section: GroupLine["section"]) =>
    setGroup({
      lines: [
        ...group.lines,
        { id: `${section}_${Date.now()}`, label: "New line", section, amounts: groupZeroes() },
      ],
    });
  const removeLine = (id: string) => setGroup({ lines: group.lines.filter((l) => l.id !== id) });

  const yearStart = (i: number) => i > 0 && months[i].year !== months[i - 1].year;
  const c2Of = (i: number, s: GroupLine["section"]) =>
    s === "cfo" ? R[i].cfoC2 : s === "cfi" ? R[i].cfiC2 : R[i].cffC2;
  const totalOf = (i: number, s: GroupLine["section"]) =>
    s === "cfo" ? R[i].cfo : s === "cfi" ? R[i].cfi : R[i].cff;

  const minCash = Math.min(...R.map((r) => r.closingCash));
  const troughAt = R.findIndex((r) => r.closingCash === minCash);
  const first = months[0];
  const last = months[months.length - 1];
  const openingLabel = `Cash 30/06/${first.year}`;
  const closingLabel = `Cash 31/12/${last.year}`;

  return (
    <>
      <div className="page-title">XFuel total</div>
      <div className="page-sub">
        Group cash position from {openingLabel.replace("Cash ", "")} to {closingLabel.replace("Cash ", "")}. C2 flows
        come from the project model and are mapped by calendar month, so they move if the plan start month changes.
        Everything outside C2 is entered on the lines below.
      </div>

      {g.warnings.map((w) => (
        <div key={w} className="note" style={{ borderColor: "#f2c4c0", background: "#fdeceb" }}>
          {w}
        </div>
      ))}

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">{openingLabel}</div>
          <div className="k-val">{fmt(g.openingCash)}</div>
          <div className="k-meta">group opening cash</div>
        </div>
        <div className="kpi">
          <div className="k-label">{closingLabel}</div>
          <div className="k-val" style={{ color: g.closingCash < 0 ? "var(--bad)" : undefined }}>
            {fmt(g.closingCash)}
          </div>
          <div className="k-meta">after {months.length} months</div>
        </div>
        <div className="kpi">
          <div className="k-label">Lowest cash</div>
          <div className="k-val" style={{ color: minCash < 0 ? "var(--bad)" : undefined }}>
            {fmt(minCash)}
          </div>
          <div className="k-meta">{months[troughAt]?.label ?? "–"}</div>
        </div>
        <div className="kpi">
          <div className="k-label">Movement</div>
          <div className="k-val">{fmt(g.closingCash - g.openingCash)}</div>
          <div className="k-meta">total change over the window</div>
        </div>
      </div>

      <div className="grid3">
        <div className="card">
          <h3>Opening position</h3>
          <Field
            label={`${openingLabel} (EUR)`} value={group.openingCash} editable={editable}
            onChange={(x) => setGroup({ openingCash: Number(x) || 0 })}
            hint="Group cash at the start of the window. Everything below rolls forward from here."
          />
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={group.eliminateIntercompanyEquity}
                disabled={!editable}
                onChange={(e) => setGroup({ eliminateIntercompanyEquity: e.target.checked })}
                style={{ marginRight: 8 }}
              />
              Treat C2 equity as intercompany
            </label>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              On, the C2 equity subscription is removed from group CFF: the cash leaves as CAPEX and returns as equity,
              so counting both would overstate group cash. Turn off only if that equity is subscribed from outside the
              group.
            </div>
          </div>
        </div>
      </div>

      {/* ---------- monthly cash flow ---------- */}
      <div className="card">
        <h3>Monthly cash flow</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <thead>
              <tr>
                <th>Line</th>
                {months.map((m, i) => (
                  <th key={m.index} className={yearStart(i) ? "yearsplit" : ""}>
                    {m.label}
                  </th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="subtotal">
                <td>Opening cash</td>
                {R.map((r, i) => (
                  <td key={i} className={`num ${yearStart(i) ? "yearsplit" : ""} ${r.openingCash < 0 ? "neg" : ""}`}>
                    {fmt(r.openingCash)}
                  </td>
                ))}
                <td className="num">{fmt(g.openingCash)}</td>
              </tr>

              {SECTIONS.map((sec) => {
                const lines = group.lines.filter((l) => l.section === sec.key);
                return (
                  <>
                    <tr key={`${sec.key}-h`} className="section">
                      <td colSpan={months.length + 2}>{sec.label}</td>
                    </tr>
                    <tr key={`${sec.key}-c2`}>
                      <td>{sec.c2}</td>
                      {R.map((_, i) => (
                        <td key={i} className={`num ${yearStart(i) ? "yearsplit" : ""} ${c2Of(i, sec.key) < 0 ? "neg" : ""}`}>
                          {fmt(c2Of(i, sec.key))}
                        </td>
                      ))}
                      <td className="num">{fmt(R.reduce((a, _, i) => a + c2Of(i, sec.key), 0))}</td>
                    </tr>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="text"
                              value={l.label}
                              disabled={!editable}
                              onChange={(e) => setLine(l.id, { label: e.target.value })}
                              style={{ width: "100%", minWidth: 150 }}
                            />
                            {editable && (
                              <button className="btn danger sm" onClick={() => removeLine(l.id)} title="Remove line">
                                ×
                              </button>
                            )}
                          </div>
                        </td>
                        {months.map((_, i) => (
                          <td key={i} className={yearStart(i) ? "yearsplit" : ""}>
                            <input
                              className="cell"
                              type="number"
                              disabled={!editable}
                              value={Number.isFinite(Number(l.amounts[i])) ? Number(l.amounts[i]) : 0}
                              onChange={(e) => setAmount(l.id, i, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="num">{fmt(l.amounts.reduce((a, b) => a + (Number(b) || 0), 0))}</td>
                      </tr>
                    ))}
                    {editable && (
                      <tr key={`${sec.key}-add`}>
                        <td colSpan={months.length + 2}>
                          <button className="btn ghost sm" onClick={() => addLine(sec.key)}>
                            + Add line to {sec.label.toLowerCase()}
                          </button>
                        </td>
                      </tr>
                    )}
                    <tr key={`${sec.key}-t`} className="subtotal">
                      <td>Total {sec.label.toLowerCase()}</td>
                      {R.map((_, i) => (
                        <td key={i} className={`num ${yearStart(i) ? "yearsplit" : ""} ${totalOf(i, sec.key) < 0 ? "neg" : ""}`}>
                          {fmt(totalOf(i, sec.key))}
                        </td>
                      ))}
                      <td className="num">{fmt(R.reduce((a, _, i) => a + totalOf(i, sec.key), 0))}</td>
                    </tr>
                  </>
                );
              })}

              <tr className="subtotal">
                <td>Net cash flow</td>
                {R.map((r, i) => (
                  <td key={i} className={`num ${yearStart(i) ? "yearsplit" : ""} ${r.netCashFlow < 0 ? "neg" : ""}`}>
                    {fmt(r.netCashFlow)}
                  </td>
                ))}
                <td className="num">{fmt(g.closingCash - g.openingCash)}</td>
              </tr>
              <tr className="subtotal">
                <td>Closing cash</td>
                {R.map((r, i) => (
                  <td key={i} className={`num ${yearStart(i) ? "yearsplit" : ""} ${r.closingCash < 0 ? "neg" : ""}`}>
                    {fmt(r.closingCash)}
                  </td>
                ))}
                <td className="num">{fmt(g.closingCash)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- bridge ---------- */}
      <ChartFrame
        wide
        title="Cash bridge"
        subtitle={`${openingLabel} to ${closingLabel}, in blocks. The table below itemises each block.`}
        filename="xfuel-cash-bridge"
      >
        <Waterfall
          blocks={g.blocks}
          opening={g.openingCash}
          closing={g.closingCash}
          openingLabel={openingLabel}
          closingLabel={closingLabel}
        />
      </ChartFrame>

      <div className="card">
        <h3>Bridge detail</h3>
        <div className="tbl-wrap">
          <table className="fin">
            <thead>
              <tr>
                <th>Block</th>
                <th>Item</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="subtotal">
                <td>{openingLabel}</td>
                <td />
                <td className="num">{fmt(g.openingCash)}</td>
              </tr>
              {g.blocks.map((b) => (
                <>
                  <tr key={b.key} className="subtotal">
                    <td>{b.label}</td>
                    <td />
                    <td className={`num ${b.amount < 0 ? "neg" : ""}`}>{fmt(b.amount)}</td>
                  </tr>
                  {b.items.map((it) => (
                    <tr key={`${b.key}-${it.key}`}>
                      <td />
                      <td>{it.label}</td>
                      <td className={`num ${it.amount < 0 ? "neg" : ""}`}>{fmt(it.amount)}</td>
                    </tr>
                  ))}
                  {b.items.length === 0 && (
                    <tr key={`${b.key}-none`}>
                      <td />
                      <td className="muted">nothing booked</td>
                      <td className="num">{fmt(0)}</td>
                    </tr>
                  )}
                </>
              ))}
              <tr className="subtotal">
                <td>{closingLabel}</td>
                <td />
                <td className={`num ${g.closingCash < 0 ? "neg" : ""}`}>{fmt(g.closingCash)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Reconciliation check: blocks less movement = {fmt(g.bridgeCheck)}. Anything other than zero means a flow is
          being counted twice or missed.
        </div>
      </div>
    </>
  );
}
