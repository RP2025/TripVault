import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import Auth from "../Auth";
import ProfilePage from "../views/ProfilePage.tsx";
import AlbumPage from "../views/AlbumPage.tsx";

export default function AppShell() {
  const [session, setSession] = useState<Session | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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
            <Link className="btn" to="/profile">Profile</Link>
            <button className="btn" onClick={logout}>Logout</button>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/profile" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/album/:id" element={<AlbumPage />} />
        <Route path="*" element={<Navigate to="/profile" replace />} />
      </Routes>
    </div>
  );
}
