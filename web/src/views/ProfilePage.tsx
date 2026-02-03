import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Album } from "../domain";
import { useNavigate } from "react-router-dom";

function fmtBytes(n: number) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

type SharedAlbum = Album & { my_role?: string };

export default function ProfilePage() {
  const nav = useNavigate();

  const [owned, setOwned] = useState<Album[]>([]);
  const [shared, setShared] = useState<SharedAlbum[]>([]);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const quota = useMemo(() => 100 * 1024 * 1024, []);

  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data: userRes, error: uerr } = await supabase.auth.getUser();
      if (uerr) {
        setMsg(uerr.message);
        return;
      }

      const uid = userRes.user?.id;
      if (!uid) {
        setMsg("Not logged in.");
        return;
      }

      // ✅ Owned albums (RLS filters)
      const o = await supabase
        .from("albums")
        .select("*")
        .order("created_at", { ascending: false });

      if (o.error) {
        console.error(o.error);
        setMsg(o.error.message);
        return;
      }
      setOwned((o.data ?? []) as Album[]);

      // ✅ Shared with me (album_members join)
      const m = await supabase
        .from("album_members")
        .select("album_id, role, albums:albums(id,title,created_at,owner_id)")
        .eq("user_id", uid);

      if (m.error) {
        console.error(m.error);
        setMsg(m.error.message);
        return;
      }

      const sharedAlbums = (m.data ?? [])
        .filter((row: any) => row.albums)
        .map((row: any) => ({ ...(row.albums as Album), my_role: row.role })) as SharedAlbum[];

      // remove duplicates
      const uniq = new Map<string, SharedAlbum>();
      for (const a of sharedAlbums) uniq.set(a.id, a);

      setShared(Array.from(uniq.values()));
    })().catch((e) => {
      console.error(e);
      setMsg("Failed to load profile data.");
    });
  }, []);

  async function createAlbum(openPickerAfter: boolean) {
    setMsg(null);
    setLoading(true);

    try {
      const t = title.trim();
      if (!t) return;

      // ✅ ONLY title (DB trigger sets owner_id)
      const res = await supabase
        .from("albums")
        .insert({ title: t })
        .select("*")
        .single();

      if (res.error) {
        setMsg(res.error.message);
        return;
      }

      const created = res.data as Album;
      setOwned((prev) => [created, ...prev]);
      setTitle("");
      nav(`/album/${created.id}${openPickerAfter ? "?pick=1" : ""}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="main">
      <div className="cardBlock">
        <div className="blockTitle">Profile</div>
        <div className="muted">
          Quota (MVP): {fmtBytes(quota)} • (Storage stats will come after upload is wired)
        </div>
      </div>

      <div className="cardBlock">
        <div className="blockTitle">Create album</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <input
            className="input"
            placeholder="Album name (e.g., Goa)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button className="btn" onClick={() => createAlbum(false)} disabled={loading}>
            {loading ? "Creating..." : "Create"}
          </button>

          <button className="btn primary" onClick={() => createAlbum(true)} disabled={loading}>
            {loading ? "Creating..." : "Create & Pick Folder"}
          </button>
        </div>

        {msg ? <div className="authMsg">{msg}</div> : null}
      </div>

      <div className="cardBlock">
        <div className="blockTitle">My albums</div>
        <div className="list">
          {owned.map((a) => (
            <button key={a.id} className="rowBtn" onClick={() => nav(`/album/${a.id}`)}>
              <div className="name">{a.title}</div>
              <div className="muted">{a.created_at?.slice(0, 10)}</div>
            </button>
          ))}
          {owned.length === 0 ? <div className="muted">No albums yet.</div> : null}
        </div>
      </div>

      <div className="cardBlock">
        <div className="blockTitle">Shared with me</div>
        <div className="list">
          {shared.map((a) => (
            <button key={a.id} className="rowBtn" onClick={() => nav(`/album/${a.id}`)}>
              <div className="name">{a.title}</div>
              <div className="muted">shared{a.my_role ? ` • role: ${a.my_role}` : ""}</div>
            </button>
          ))}
          {shared.length === 0 ? <div className="muted">No shared albums yet.</div> : null}
        </div>
      </div>
    </main>
  );
}
