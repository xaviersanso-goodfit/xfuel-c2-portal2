"use client";

import { useCallback, useEffect, useState } from "react";
import { listChanges } from "@/lib/supabase/changelog";
import type { ChangeLogEntry } from "@/lib/supabase/changelog";
import { formatCet } from "@/lib/model/diff";

/**
 * The audit trail.
 *
 * Read only by construction: the database grants insert to editors and grants
 * nobody update or delete, so nothing here can be altered from the application.
 * When the backend is not configured the log falls back to browser storage,
 * which is not an audit trail, and says so.
 */
export default function ChangelogTab({
  scenarioId,
  backend,
}: {
  scenarioId: string | null;
  backend: boolean;
}) {
  const [rows, setRows] = useState<ChangeLogEntry[]>([]);
  const [scope, setScope] = useState<"all" | "current">("current");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setRows(await listChanges(scope === "current" ? scenarioId : null));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [scope, scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="page-title">Changelog</div>
      <div className="page-sub">
        Every field changed on save, with who changed it and when. Times are shown in Madrid local time. The log is
        append only: it cannot be edited or deleted from the portal.
      </div>

      {!backend && (
        <div className="note">
          Running without a backend, so this log is stored in this browser only. It is a convenience, not an audit
          trail. Connect Supabase for a real one.
        </div>
      )}
      {err && <div className="note bad">Could not load the log: {err}</div>}

      <div className="toolbar">
        <div className="ctl">
          <label>Show</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "current")}>
            <option value="current">This scenario</option>
            <option value="all">All scenarios</option>
          </select>
        </div>
        <button className="btn ghost sm" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading…" : "Refresh"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="fin">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                {scope === "all" && <th>Scenario</th>}
                <th>Field</th>
                <th>From</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatCet(r.changed_at)}</td>
                  <td>{r.user_email || "unknown"}</td>
                  {scope === "all" && <td>{r.scenario_name}</td>}
                  <td>{r.field_label}</td>
                  <td className="num neg">{r.old_value}</td>
                  <td className="num">{r.new_value}</td>
                </tr>
              ))}
              {rows.length === 0 && !busy && (
                <tr>
                  <td colSpan={scope === "all" ? 6 : 5} className="muted">
                    Nothing recorded yet. The log fills as edits are saved.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
