"use client";

import { createClient, isConfigured } from "./client";
import { defaultScenario } from "../model/defaults";
import type { ScenarioInputs } from "../model/types";
import type { ScenarioRow } from "./types";

const LOCAL_KEY = "xfuel_c2_scenarios_local";

/**
 * Scenario persistence. Uses Supabase when configured; otherwise falls back to
 * browser storage so the portal is usable before the backend is wired up.
 */

function localRead(): ScenarioRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as ScenarioRow[];
  } catch {
    /* ignore */
  }
  const seed: ScenarioRow = {
    id: "local-base",
    name: "Base case",
    description: "Seeded from C2 Tarragona CAPEX and the FAIIP business model.",
    inputs: defaultScenario(),
    is_base: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  localWrite([seed]);
  return [seed];
}

function localWrite(rows: ScenarioRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
}

export async function listScenarios(): Promise<ScenarioRow[]> {
  const sb = createClient();
  if (!sb) return localRead();
  const { data, error } = await sb.from("scenarios").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    // Seed the base case on first run.
    const seeded = await saveScenario({
      name: "Base case",
      description: "Seeded from C2 Tarragona CAPEX and the FAIIP business model.",
      inputs: defaultScenario(),
      is_base: true,
    });
    return seeded ? [seeded] : [];
  }
  return data as ScenarioRow[];
}

export async function saveScenario(payload: {
  id?: string;
  name: string;
  description?: string | null;
  inputs: ScenarioInputs;
  is_base?: boolean;
}): Promise<ScenarioRow | null> {
  const sb = createClient();
  if (!sb) {
    const rows = localRead();
    const now = new Date().toISOString();
    if (payload.id) {
      const idx = rows.findIndex((r) => r.id === payload.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...payload, inputs: payload.inputs, updated_at: now } as ScenarioRow;
        localWrite(rows);
        return rows[idx];
      }
    }
    const row: ScenarioRow = {
      id: `local-${Date.now()}`,
      name: payload.name,
      description: payload.description ?? null,
      inputs: payload.inputs,
      is_base: payload.is_base ?? false,
      created_at: now,
      updated_at: now,
    };
    rows.unshift(row);
    localWrite(rows);
    return row;
  }

  const record = {
    name: payload.name,
    description: payload.description ?? null,
    inputs: payload.inputs as unknown as Record<string, unknown>,
    is_base: payload.is_base ?? false,
  };
  if (payload.id) {
    const { data, error } = await sb.from("scenarios").update(record).eq("id", payload.id).select().single();
    if (error) throw new Error(error.message);
    return data as ScenarioRow;
  }
  const { data, error } = await sb.from("scenarios").insert(record).select().single();
  if (error) throw new Error(error.message);
  return data as ScenarioRow;
}

export async function deleteScenario(id: string): Promise<void> {
  const sb = createClient();
  if (!sb) {
    localWrite(localRead().filter((r) => r.id !== id));
    return;
  }
  const { error } = await sb.from("scenarios").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function loadCommentary(scenarioId: string): Promise<Record<string, string>> {
  const sb = createClient();
  if (!sb) {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(`xfuel_cmt_${scenarioId}`) || "{}");
    } catch {
      return {};
    }
  }
  const { data, error } = await sb.from("commentary").select("section, body").eq("scenario_id", scenarioId);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[(row as any).section] = (row as any).body;
  return out;
}

export async function saveCommentary(scenarioId: string, section: string, body: string): Promise<void> {
  const sb = createClient();
  if (!sb) {
    if (typeof window === "undefined") return;
    const key = `xfuel_cmt_${scenarioId}`;
    const cur = JSON.parse(window.localStorage.getItem(key) || "{}");
    cur[section] = body;
    window.localStorage.setItem(key, JSON.stringify(cur));
    return;
  }
  await sb.from("commentary").upsert({ scenario_id: scenarioId, section, body }, { onConflict: "scenario_id,section" });
}

export { isConfigured };
