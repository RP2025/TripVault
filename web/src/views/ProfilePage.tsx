// import { useEffect, useMemo, useState } from "react";
// import { supabase } from "../supabaseClient";
// import type { Album } from "../domain";
// import { useNavigate } from "react-router-dom";

// function fmtBytes(n: number) {
//   const units = ["B", "KB", "MB", "GB"];
//   let i = 0, x = n;
//   while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
//   return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
// }

// export default function ProfilePage() {
//   const nav = useNavigate();

//   const [owned, setOwned] = useState<Album[]>([]);
//   const [title, setTitle] = useState("");
//   const [msg, setMsg] = useState<string | null>(null);
//   const [loading, setLoading] = useState(false);

//   // MVP quota just as UI text for now (real enforcement later)
//   const quota = useMemo(() => 100 * 1024 * 1024, []);

//   useEffect(() => {
//     (async () => {
//       const { data } = await supabase.auth.getUser();
//       const uid = data.user?.id;
//       if (!uid) return;

//       const o = await supabase
//         .from("albums")
//         .select("*")
//         .eq("owner_id", uid)
//         .order("created_at", { ascending: false });

//       if (o.error) {
//         console.error(o.error);
//         setMsg(o.error.message);
//         return;
//       }

//       setOwned((o.data ?? []) as Album[]);
//     })().catch(console.error);
//   }, []);

//   async function createAlbum(pickFolderAfterCreate: boolean) {
//     setMsg(null);

//     const uid = (await supabase.auth.getUser()).data.user?.id;
//     if (!uid) {
//       setMsg("Not logged in.");
//       return;
//     }

//     const t = title.trim();
//     if (!t) {
//       setMsg("Please enter album name.");
//       return;
//     }

//     setLoading(true);
//     try {
//       const res = await supabase
//         .from("albums")
//         .insert({ title: t })
//         .select("*")
//         .single();

//       if (res.error) {
//         setMsg(res.error.message);
//         return;
//       }

//       const created = res.data as Album;

//       setOwned((prev) => [created, ...prev]);
//       setTitle("");

//       if (pickFolderAfterCreate) {
//         // ✅ go directly to album and auto-open folder picker
//         nav(`/album/${created.id}?pick=1`);
//       } else {
//         nav(`/album/${created.id}`);
//       }
//     } finally {
//       setLoading(false);
//     }
//   }

//   return (
//     <main className="main">
//       <div className="cardBlock">
//         <div className="blockTitle">Profile</div>
//         <div className="muted">
//           Quota (MVP): {fmtBytes(quota)} • (Storage stats will come after upload is wired)
//         </div>
//       </div>

//       <div className="cardBlock">
//         <div className="blockTitle">Create album</div>

//         <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
//           <input
//             className="input"
//             placeholder="Album name (e.g., Goa)"
//             value={title}
//             onChange={(e) => setTitle(e.target.value)}
//           />

//           <button className="btn" onClick={() => createAlbum(false)} disabled={loading}>
//             {loading ? "Creating..." : "Create"}
//           </button>

//           <button className="btn primary" onClick={() => createAlbum(true)} disabled={loading}>
//             {loading ? "Creating..." : "Create & Pick Folder"}
//           </button>
//         </div>

//         {msg ? <div className="authMsg">{msg}</div> : null}
//       </div>

//       <div className="cardBlock">
//         <div className="blockTitle">My albums</div>
//         <div className="list">
//           {owned.map((a) => (
//             <button key={a.id} className="rowBtn" onClick={() => nav(`/album/${a.id}`)}>
//               <div className="name">{a.title}</div>
//               <div className="muted">{a.created_at?.slice(0, 10)}</div>
//             </button>
//           ))}
//           {owned.length === 0 ? <div className="muted">No albums yet.</div> : null}
//         </div>
//       </div>

//       <div className="cardBlock">
//         <div className="blockTitle">Shared with me</div>
//         <div className="muted">
//           Coming next (after MVP): album sharing + permissions (max 3 users).
//         </div>
//       </div>
//     </main>
//   );
// }


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

export default function ProfilePage() {
  const nav = useNavigate();

  const [owned, setOwned] = useState<Album[]>([]);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const quota = useMemo(() => 100 * 1024 * 1024, []);

  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        setMsg("Not logged in.");
        return;
      }

      const o = await supabase
        .from("albums")
        .select("*")
        .order("created_at", { ascending: false });

      if (o.error) {
        console.error(o.error);
        setMsg(o.error.message);
        return;
      }

      // because RLS only returns your albums anyway, this is fine
      setOwned((o.data ?? []) as Album[]);
    })().catch(console.error);
  }, []);

  async function createAlbum(openPickerAfter: boolean) {
    setMsg(null);
    setLoading(true);
    try {
      const t = title.trim();
      if (!t) return;

      // ✅ DO NOT send owner_id anymore (DB sets it)
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

      // go to album
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
        <div className="muted">
          Coming next (after MVP): album sharing + permissions (max 3 users).
        </div>
      </div>
    </main>
  );
}
