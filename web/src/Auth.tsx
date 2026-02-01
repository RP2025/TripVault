import { useState } from "react";
import { supabase } from "./supabaseClient";
import "./app.css";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Signup done. If email confirmation is ON in Supabase, check your inbox.");
      }
    } catch (err: any) {
      setMsg(err?.message ?? "Auth failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authCard">
        <div className="authTitle">TripVault</div>
        <div className="authSub">Sign in to view your gallery</div>

        <form onSubmit={onSubmit} className="authForm">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
          />

          <button className="btn primaryBtn" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Login" : "Create account"}
          </button>
        </form>

        {msg ? <div className="authMsg">{msg}</div> : null}

        <div className="authSwitch">
          {mode === "login" ? (
            <>
              New here?{" "}
              <button className="linkBtn" onClick={() => setMode("signup")} type="button">
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button className="linkBtn" onClick={() => setMode("login")} type="button">
                Login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
