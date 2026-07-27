"use client";

import { useState } from "react";
import { Logo } from "./Logo";
import { createClient } from "@/lib/supabase/client";

/** Email + password sign in / sign up against Supabase Auth. */
export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = createClient();
    if (!sb) {
      setMsg({ text: "Supabase is not configured.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn();
      } else {
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        setMsg({ text: "Account created. Check your email to confirm, then sign in.", ok: true });
        setMode("in");
      }
    } catch (err) {
      setMsg({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Logo height={30} light={false} />
        <h1>C2 project portal</h1>
        <div className="sub">
          {mode === "in" ? "Sign in to view the C2 Tarragona plan." : "Create an account. New users start read only."}
        </div>
        <input
          type="email" placeholder="Email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} required
        />
        <input
          type="password" placeholder="Password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} required minLength={6}
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? <span className="spin" /> : mode === "in" ? "Sign in" : "Create account"}
        </button>
        {msg && <div className={`auth-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
        <div style={{ marginTop: 14, fontSize: 12.5 }}>
          <button
            type="button"
            style={{ background: "none", border: 0, color: "#0B7BFF", fontWeight: 600, padding: 0 }}
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}
          >
            {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
