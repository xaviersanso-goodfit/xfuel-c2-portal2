"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";
import { Auth } from "./Auth";
import { createClient, isConfigured } from "@/lib/supabase/client";
import { listScenarios, saveScenario, deleteScenario } from "@/lib/supabase/scenarios";
import type { ScenarioRow, Role } from "@/lib/supabase/types";
import { runModel } from "@/lib/model/engine";
import { defaultScenario } from "@/lib/model/defaults";
import { normaliseScenario } from "@/lib/model/normalise";
import { BUILD, BUILD_NOTES } from "@/lib/version";
import type { ScenarioInputs } from "@/lib/model/types";

import ParametersTab from "./tabs/ParametersTab";
import CapexTab from "./tabs/CapexTab";
import UnitEconTab from "./tabs/UnitEconTab";
import OpexTab from "./tabs/OpexTab";
import FinancingTab from "./tabs/FinancingTab";
import StatementTab from "./tabs/StatementTab";
import ScenariosTab from "./tabs/ScenariosTab";
import GroupTab from "./tabs/GroupTab";

export type TabId =
  | "parameters" | "capex" | "unitecon" | "opex" | "financing"
  | "pnl" | "cashflow" | "group" | "scenarios";

const TABS: { id: TabId; label: string }[] = [
  { id: "parameters", label: "Global parameters" },
  { id: "capex", label: "CAPEX" },
  { id: "unitecon", label: "Unit economics" },
  { id: "opex", label: "OPEX & personnel" },
  { id: "financing", label: "Financing" },
  { id: "pnl", label: "P&L" },
  { id: "cashflow", label: "Cash flow" },
  { id: "group", label: "XFuel total" },
  { id: "scenarios", label: "Scenarios" },
];

export default function Portal() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("editor");
  const [tab, setTab] = useState<TabId>("parameters");

  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<ScenarioInputs>(defaultScenario());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const backend = isConfigured();

  // ---------- session ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Whatever happens below, the app must finish loading. A thrown error or an
      // unreachable Supabase project must not leave the user on a blank screen.
      try {
        if (!backend) {
          setEmail("local@xfuel.com");
          setRole("editor");
          return;
        }
        const sb = createClient();
        if (!sb) {
          setBootError("Supabase client could not be created. Check the environment variables.");
          return;
        }
        // Don't hang forever if the project URL is wrong or unreachable.
        const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
          Promise.race([
            Promise.resolve(p),
            new Promise<T>((_, reject) =>
              setTimeout(() => reject(new Error("Supabase did not respond within 10 seconds")), ms)
            ),
          ]);

        const { data, error } = await withTimeout(sb.auth.getUser());
        if (cancelled) return;
        if (error && error.name !== "AuthSessionMissingError" && !/session/i.test(error.message)) {
          // A missing session is normal for a signed-out visitor; anything else is a real fault.
          setBootError(`Could not reach Supabase: ${error.message}`);
          return;
        }
        if (data?.user) {
          setEmail(data.user.email ?? null);
          const { data: profile } = await withTimeout(
            sb.from("profiles").select("role").eq("id", data.user.id).single()
          );
          if (cancelled) return;
          setRole(((profile as any)?.role as Role) ?? "viewer");
        }
      } catch (e) {
        if (!cancelled) setBootError((e as Error).message);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  // ---------- scenarios ----------
  const refresh = useCallback(async () => {
    try {
      const rows = await listScenarios();
      setScenarios(rows);
      const first = rows.find((r) => r.is_base) ?? rows[0];
      if (first) {
        setActiveId((prev) => prev ?? first.id);
        // Scenarios saved under an older, shorter horizon carry short series.
        // Normalise on the way in so the grids and the engine agree.
        if (!activeId) setInputs(normaliseScenario(first.inputs as ScenarioInputs));
      }
    } catch (e) {
      setToast(`Could not load scenarios: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && email) void refresh();
  }, [ready, email, refresh]);

  const model = useMemo(() => {
    try {
      return runModel(inputs);
    } catch (e) {
      setToast(`Model error: ${(e as Error).message}`);
      return runModel(defaultScenario());
    }
  }, [inputs]);

  const isEditor = role === "editor";

  const update = useCallback(
    (next: ScenarioInputs) => {
      if (!isEditor) return;
      setInputs(next);
      setDirty(true);
    },
    [isEditor]
  );

  const selectScenario = (id: string) => {
    const row = scenarios.find((r) => r.id === id);
    if (!row) return;
    if (dirty && !window.confirm("You have unsaved changes. Switch scenario and lose them?")) return;
    setActiveId(id);
    setInputs(normaliseScenario(row.inputs as ScenarioInputs));
    setDirty(false);
  };

  const save = async () => {
    if (!isEditor) return;
    setBusy(true);
    try {
      const row = await saveScenario({ id: activeId ?? undefined, name: inputs.name, inputs });
      if (row) {
        setActiveId(row.id);
        setDirty(false);
        await refresh();
        setToast("Scenario saved");
      }
    } catch (e) {
      setToast(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveAsNew = async (name: string) => {
    setBusy(true);
    try {
      const row = await saveScenario({ name, inputs: { ...inputs, name } });
      if (row) {
        setActiveId(row.id);
        setInputs({ ...inputs, name });
        setDirty(false);
        await refresh();
        setToast(`Scenario "${name}" created`);
      }
    } catch (e) {
      setToast(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this scenario?")) return;
    await deleteScenario(id);
    if (id === activeId) setActiveId(null);
    await refresh();
    setToast("Scenario deleted");
  };

  const signOut = async () => {
    const sb = createClient();
    if (sb) await sb.auth.signOut();
    window.location.reload();
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!ready) return <div className="center-msg">Loading…</div>;

  if (bootError) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 style={{ marginTop: 0 }}>Cannot reach the database</h1>
          <div className="sub">The portal loaded, but the connection to Supabase failed.</div>
          <div className="note bad" style={{ marginBottom: 16 }}>{bootError}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>Most likely causes, in order:</p>
            <ol style={{ paddingLeft: 18, margin: "0 0 14px" }}>
              <li>The Supabase project URL is wrong, or has a stray space or line break.</li>
              <li>The anon key belongs to a different project.</li>
              <li>The Supabase project is paused (free projects pause after inactivity).</li>
              <li>The database tables have not been created yet.</li>
            </ol>
          </div>
          <button className="btn" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!email) return <Auth onSignedIn={() => window.location.reload()} />;

  const visibleTabs = TABS.filter((t) => isEditor || !["scenarios"].includes(t.id) || true);

  return (
    <>
      <header className="header">
        <Logo height={24} />
        <span style={{ color: "#9db3aa", fontWeight: 600, fontSize: 13 }}>C2 Tarragona · project plan</span>
        {/* Build marker: lets you confirm which version is actually live without
            opening the Vercel dashboard. */}
        <span className="build" title={BUILD_NOTES}>build {BUILD}</span>
        <div className="spacer" />
        <div className="ctl">
          <label>Scenario</label>
          <select value={activeId ?? ""} onChange={(e) => selectScenario(e.target.value)}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_base ? " (base)" : ""}
              </option>
            ))}
          </select>
        </div>
        {dirty && <span className="pill" style={{ background: "#6fcf97", color: "#0d2b21" }}>unsaved</span>}
        {isEditor && (
          <button className="btn sm" onClick={save} disabled={busy || !dirty}>
            {busy ? <span className="spin" /> : "Save"}
          </button>
        )}
        <span className={`badge ${isEditor ? "badge-editor" : "badge-viewer"}`}>
          {email} · {isEditor ? "editor" : "read only"}
        </span>
        {backend && (
          <button className="btn-ghost-dark" onClick={signOut}>
            Sign out
          </button>
        )}
      </header>

      <nav className="nav">
        {visibleTabs.map((t) => (
          <button key={t.id} className={t.id === tab ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="page">
        {!backend && (
          <div className="note">
            Running without a backend: scenarios are stored in this browser only. Add your Supabase URL and anon key to
            enable shared storage, real accounts and read-only roles.
          </div>
        )}
        {model.warnings.map((w, i) => (
          <div key={i} className="note bad">
            {w}
          </div>
        ))}

        {tab === "parameters" && <ParametersTab inputs={inputs} model={model} onChange={update} editable={isEditor} />}
        {tab === "capex" && <CapexTab inputs={inputs} model={model} onChange={update} editable={isEditor} />}
        {tab === "unitecon" && <UnitEconTab inputs={inputs} model={model} onChange={update} editable={isEditor} />}
        {tab === "opex" && <OpexTab inputs={inputs} model={model} onChange={update} editable={isEditor} />}
        {tab === "financing" && <FinancingTab inputs={inputs} model={model} onChange={update} editable={isEditor} />}
        {tab === "pnl" && <StatementTab kind="pnl" inputs={inputs} model={model} />}
        {tab === "cashflow" && <StatementTab kind="cashflow" inputs={inputs} model={model} />}
        {tab === "group" && <GroupTab inputs={inputs} model={model} onChange={update} editable={isEditor} />}
        {tab === "scenarios" && (
          <ScenariosTab
            inputs={inputs}
            scenarios={scenarios}
            activeId={activeId}
            editable={isEditor}
            onSaveAsNew={saveAsNew}
            onDelete={remove}
            onSelect={selectScenario}
            onImport={(next) => {
              update(next);
              setToast("Workbook imported into the working scenario");
            }}
          />
        )}
      </main>

      {toast && (
        <div
          style={{
            position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)",
            background: "#12352b", color: "#fff", padding: "11px 20px", borderRadius: 9,
            fontWeight: 600, fontSize: 13, boxShadow: "0 8px 24px rgba(0,0,0,.25)", zIndex: 90,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
