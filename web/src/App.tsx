import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import Auth from "./Auth";
import { supabase } from "./supabaseClient";
import type { Session } from "@supabase/supabase-js";

import ProfilePage from "./views/ProfilePage.tsx";
import AlbumPage from "./views/AlbumPage.tsx";

export default function App() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    nav("/");
  }

  if (!session) return <Auth />;

  return (
    <div className="page">
      <header className="topbar">
        <div className="titleRow">
          <div>
            <div className="title">TripVault</div>
            <div className="subtitle">{session.user.email}</div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link className="btn" to="/">Profile</Link>
            <button className="btn" onClick={logout}>Logout</button>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<ProfilePage />} />
        <Route path="/album/:id" element={<AlbumPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
