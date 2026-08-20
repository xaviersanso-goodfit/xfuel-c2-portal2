"use client";

import { createClient, isConfigured } from "./client";
import { diffScenarios } from "../model/diff";
import type { FieldChange } from "../model/diff";
import type { ScenarioInputs } from "../model/types";

const LOCAL_KEY = "xfuel_c2_changelog_local";
/** Never write more than this many rows for one save. */
const MAX_ENTRIES_PER_SAVE = 200;

export interface ChangeLogEntry {
  id: string;
  scenario_id: string | null;
  scenario_name: string;
  user_email: string;
  field_key: string;
  field_label: string;
  old_value: string;
  new_value: string;
  changed_at: string;
}

/**
 * Changelog persistence.
 *
 * Mirrors the scenario store: Supabase when configured, browser storage
 * otherwise, so the portal still works before the backend is wired up. The
 * local fallback is clearly not an audit trail and is labelled as such in the
 * interface.
 */

function localRead(): ChangeLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as ChangeLogEntry[]) : [];
  } catch {
    return [];
  }
}

function localWrite(rows: ChangeLogEntry[]) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rows.slice(0, 2000)));
  } catch {
    /* quota exceeded, nothing useful to do */
  }
}

/**
 * Record the difference between two versions of a scenario.
 *
 * Called on save, with the version that was loaded and the version being
 * written. Returns the entries recorded so the interface can confirm what was
 * logged. A save that changes nothing writes nothing.
 */
export async function recordChanges(args: {
  before: ScenarioInputs | null;
  after: ScenarioInputs;
  scenarioId: string | null;
  scenarioName: string;
  userEmail: string;
}): Promise<FieldChange[]> {
  const { before, after, scenarioId, scenarioName, userEmail } = args;
  if (!before) return [];

  const changes = diffScenarios(before, after).slice(0, MAX_ENTRIES_PER_SAVE);
  if (changes.length === 0) return [];

  const now = new Date().toISOString();
  const rows = changes.map((c) => ({
    scenario_id: scenarioId,
    scenario_name: scenarioName,
    user_email: userEmail,
    field_key: c.key,
    field_label: c.label,
    old_value: c.from,
    new_value: c.to,
    changed_at: now,
  }));

  if (!isConfigured()) {
    const existing = localRead();
    localWrite([
      ...rows.map((r, i) => ({ ...r, id: `local-${Date.now()}-${i}`, scenario_id: r.scenario_id ?? null })),
      ...existing,
    ]);
    return changes;
  }

  const supabase = createClient();
  if (!supabase) return [];
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("change_log")
    .insert(rows.map((r) => ({ ...r, user_id: userData?.user?.id ?? null })));

  // A failed log must not fail the save. The scenario is the thing that
  // matters; a missing audit row is reported to the caller, not thrown.
  if (error) {
    console.warn("Change log write failed:", error.message);
    return [];
  }
  return changes;
}

/** Most recent entries first. Optionally filtered to one scenario. */
export async function listChanges(scenarioId?: string | null, limit = 500): Promise<ChangeLogEntry[]> {
  if (!isConfigured()) {
    const rows = localRead();
    return scenarioId ? rows.filter((r) => r.scenario_id === scenarioId) : rows;
  }
  const supabase = createClient();
  if (!supabase) return [];
  let q = supabase.from("change_log").select("*").order("changed_at", { ascending: false }).limit(limit);
  if (scenarioId) q = q.eq("scenario_id", scenarioId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeLogEntry[];
}
