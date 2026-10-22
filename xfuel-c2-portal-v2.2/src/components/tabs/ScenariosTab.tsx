"use client";

import { useRef, useState } from "react";
import { fmt, pct } from "@/lib/format";
import { runModel } from "@/lib/model/engine";
import type { ScenarioInputs } from "@/lib/model/types";
import type { ScenarioRow } from "@/lib/supabase/types";

export default function ScenariosTab({
  inputs, scenarios, activeId, editable, onSaveAsNew, onDelete, onSelect, onImport,
}: {
  inputs: ScenarioInputs;
  scenarios: ScenarioRow[];
  activeId: string | null;
  editable: boolean;
  onSaveAsNew: (name: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onImport: (next: ScenarioInputs) => void;
}) {
  const [newName, setNewName] = useState("");
  const [compareId, setCompareId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy("export");
    setErr(null);
    try {
      const { workbookToBuffer } = await import("@/lib/excel/export");
      const buf = await workbookToBuffer(inputs);
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `XFuel_C2_${inputs.name.replace(/[^\w]+/g, "_")}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy("import");
    setErr(null);
    try {
      const { parseWorkbook } = await import("@/lib/excel/import");
      const { normaliseScenario } = await import("@/lib/model/normalise");
      const { inputs: parsed, notes } = await parseWorkbook(await file.arrayBuffer());
      // A workbook exported under a shorter horizon has short series; extend
      // them rather than letting the missing columns read as zero.
      onImport(normaliseScenario(parsed));
      if (notes.length) setErr(notes.join(" "));
    } catch (e) {
      setErr(`Could not read the workbook: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const current = runModel(inputs);
  const other = compareId ? scenarios.find((s) => s.id === compareId) : null;
  const otherModel = other ? runModel(other.inputs as ScenarioInputs) : null;

  const metrics: [string, (m: ReturnType<typeof runModel>) => number | null, "num" | "pct"][] = [
    ["Total CAPEX", (m) => m.results.reduce((a, r) => a + r.capexSpend, 0), "num"],
    ["Final-year revenue", (m) => m.annual[m.annual.length - 1].revenue, "num"],
    ["Final-year EBITDA", (m) => m.annual[m.annual.length - 1].ebitda, "num"],
    ["Peak funding need", (m) => Math.min(...m.results.map((r) => r.closingCash)), "num"],
    ["Terminal value (EV)", (m) => m.valuation.terminalValueEnterprise, "num"],
    ["Project IRR", (m) => m.valuation.projectIrr, "pct"],
    ["Project NPV", (m) => m.valuation.projectNpv, "num"],
    ["Equity IRR", (m) => m.valuation.equityIrr, "pct"],
    ["Equity NPV", (m) => m.valuation.equityNpv, "num"],
  ];

  return (
    <>
      <div className="page-title">Scenarios</div>
      <div className="page-sub">
        Save the working inputs as a named scenario, compare two side by side, and move the model in and out of Excel.
      </div>

      {err && <div className="note">{err}</div>}

      <div className="grid2">
        <div className="card">
          <h3>Excel</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
            The exported workbook is live: the P&amp;L, cash flow and summary cells are real Excel formulas pointing at
            the input tabs, so the model recalculates when you edit an input in Excel. Debt amortisation schedules are
            exported as values.
          </p>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className="btn" onClick={download} disabled={busy === "export"}>
              {busy === "export" ? "Building…" : "Download model (.xlsx)"}
            </button>
            {editable && (
              <>
                <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy === "import"}>
                  {busy === "import" ? "Reading…" : "Upload model (.xlsx)"}
                </button>
                <input
                  ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
              </>
            )}
          </div>
        </div>

        <div className="card">
          <h3>Save as a new scenario</h3>
          <div className="field">
            <label>Scenario name</label>
            <input
              type="text" value={newName} disabled={!editable} placeholder="e.g. Low price case"
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <button
            className="btn" disabled={!editable || !newName.trim()}
            onClick={() => { onSaveAsNew(newName.trim()); setNewName(""); }}
          >
            Create scenario
          </button>
          {!editable && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Read-only users cannot create scenarios.</div>}
        </div>
      </div>

      <div className="card">
        <h3>Saved scenarios</h3>
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Updated</th>
              <th style={{ textAlign: "right" }}>Project IRR</th>
              <th style={{ textAlign: "right" }}>Equity IRR</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const m = runModel(s.inputs as ScenarioInputs);
              return (
                <tr key={s.id}>
                  <td>
                    {s.id === activeId && <span className="pill">active</span>} {s.name}
                    {s.is_base ? <span className="muted"> · base</span> : null}
                  </td>
                  <td className="muted">{new Date(s.updated_at).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{pct(m.valuation.projectIrr)}</td>
                  <td style={{ textAlign: "right" }}>{pct(m.valuation.equityIrr)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn ghost sm" onClick={() => onSelect(s.id)}>Open</button>{" "}
                    {editable && !s.is_base && (
                      <button className="btn danger sm" onClick={() => onDelete(s.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {scenarios.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ padding: 18 }}>No scenarios saved yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Compare</h3>
        <div className="field">
          <label>Compare the working scenario against</label>
          <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
            <option value="">Select a saved scenario…</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        {otherModel && (
          <div className="tbl-wrap">
            <table className="fin">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>{inputs.name} (working)</th>
                  <th>{other?.name}</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(([label, get, type]) => {
                  const a = get(current);
                  const b = get(otherModel);
                  const diff = a != null && b != null ? a - b : null;
                  return (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num">{type === "pct" ? pct(a) : fmt(a ?? 0)}</td>
                      <td className="num">{type === "pct" ? pct(b) : fmt(b ?? 0)}</td>
                      <td className={`num ${diff != null && diff < 0 ? "neg" : ""}`}>
                        {diff == null ? "–" : type === "pct" ? pct(diff) : fmt(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
