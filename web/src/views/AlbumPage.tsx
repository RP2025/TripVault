import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import type { Album, AlbumMember, MediaItem, Role } from "../domain";
import * as exifr from "exifr";

async function sha256Hex(buf: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function imageDims(file: File): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const out = { width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

async function makePreviewBlob(file: File, maxSide = 640, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const { width, height } = bmp;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Preview encode failed"))),
      "image/jpeg",
      quality
    );
  });
}

function isImageFile(f: File) {
  const t = (f.type || "").toLowerCase();
  return t.startsWith("image/") || /\.(jpg|jpeg|png|webp|tif|tiff|heic|heif)$/i.test(f.name);
}

function fmtBytes(n: number) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function AlbumPage() {
  const { id } = useParams();
  const albumId = id!;
  const [sp] = useSearchParams();

  const shouldAutoPick = sp.get("pick") === "1";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [album, setAlbum] = useState<Album | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [active, setActive] = useState<MediaItem | null>(null);

  const [myRole, setMyRole] = useState<Role>("read");
  const [isOwner, setIsOwner] = useState(false);

  const [members, setMembers] = useState<AlbumMember[]>([]);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<Role>("read");
  const [msg, setMsg] = useState<string | null>(null);

  const [urlCache, setUrlCache] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);


  // ✅ progress
  const [prog, setProg] = useState({
    totalFiles: 0,
    doneFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
  });

  const pct = useMemo(() => {
    if (!prog.totalBytes) return 0;
    return Math.min(100, Math.round((prog.doneBytes / prog.totalBytes) * 100));
  }, [prog]);

  useEffect(() => {
    (async () => {
      
      setMsg(null);
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;

      const a = await supabase.from("albums").select("*").eq("id", albumId).single();
      if (a.error) { setMsg(a.error.message); return; }

      const alb = a.data as Album;
      setAlbum(alb);
      setIsOwner(alb.owner_id === uid);

      // Determine role
      if (alb.owner_id === uid) {
        setMyRole("write");
      } else {
        const m = await supabase
          .from("album_members")
          .select("*")
          .eq("album_id", albumId)
          .eq("user_id", uid)
          .single();
        if (m.data) setMyRole((m.data as any).role as Role);
      }

      // Load items
      const it = await supabase
        .from("media_items")
        .select("*")
        .eq("album_id", albumId)
        .order("created_at", { ascending: false });

      setItems((it.data ?? []) as MediaItem[]);

      // Load members (owner only UI)
      const mem = await supabase
        .from("album_members")
        .select("album_id,user_id,role,created_at,profiles:profiles(email)")
        .eq("album_id", albumId);

      setMembers((mem.data ?? []) as any);
    })().catch(console.error);
  }, [albumId]);

  // ✅ Auto-open folder picker if we came via "?pick=1"
 useEffect(() => {
  if (!shouldAutoPick) return;
  if (!album) return;              // ✅ wait album loaded
  if (myRole !== "write") return;  // ✅ wait role resolved

  const t = setTimeout(() => {
    fileInputRef.current?.click();
  }, 400);

  return () => clearTimeout(t);
}, [shouldAutoPick, myRole, album]);


  // Signed URL loader
  async function getSigned(preview_path: string) {
    if (urlCache[preview_path]) return urlCache[preview_path];
    const { data, error } = await supabase.storage
      .from("previews")
      .createSignedUrl(preview_path, 60 * 60 * 24 * 7);
    if (error) throw error;
    setUrlCache((prev) => ({ ...prev, [preview_path]: data.signedUrl }));
    return data.signedUrl;
  }

  async function onPickFolder(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg(null);
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";

    if (!files.length) return;
    if (myRole !== "write") { setMsg("You only have read access."); return; }

    const images = files.filter(isImageFile);
    if (!images.length) { setMsg("No images found in selected folder."); return; }

    // init progress
    const totalBytes = images.reduce((s, f) => s + f.size, 0);
    setProg({ totalFiles: images.length, doneFiles: 0, totalBytes, doneBytes: 0 });

    setBusy(true);
    try {
      let doneBytes = 0;
      let doneFiles = 0;

      for (const file of images) {
        // Read file bytes (for hash)
        const buf = await file.arrayBuffer();
        const sha = await sha256Hex(buf);

        // avoid duplicates within same album
        const exists = await supabase
          .from("media_items")
          .select("id")
          .eq("album_id", albumId)
          .eq("sha256", sha)
          .maybeSingle();

        if (exists.data?.id) {
          // still count progress
          doneBytes += file.size;
          doneFiles += 1;
          setProg((p) => ({ ...p, doneFiles, doneBytes }));
          continue;
        }

        const dims = await imageDims(file);

        // EXIF (best effort)
        let captured_at: string | null = null;
        try {
          const ex = await exifr.parse(file, { tiff: true, ifd0: {}, exif: true });
          const dt =
            (ex as any)?.DateTimeOriginal ||
            (ex as any)?.CreateDate ||
            (ex as any)?.ModifyDate;
          if (dt instanceof Date) captured_at = dt.toISOString();
        } catch {}

        const previewBlob = await makePreviewBlob(file, 640, 0.8);

        // ✅ quota reserve (based on preview size)
        const { error: qerr } = await supabase.rpc("reserve_quota", { delta_bytes: previewBlob.size });
        if (qerr) throw qerr;

        const previewPath = `${albumId}/${sha}.jpg`;
        const up = await supabase.storage
          .from("previews")
          .upload(previewPath, previewBlob, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (up.error) throw up.error;

        const uid = (await supabase.auth.getUser()).data.user?.id;
        if (!uid) throw new Error("No user");

        const ins = await supabase
          .from("media_items")
          .insert({
            album_id: albumId,
            owner_id: uid,
            sha256: sha,
            file_name: file.name,
            size_bytes: file.size,
            last_modified_ms: file.lastModified,
            captured_at,
            width: dims.width,
            height: dims.height,
            preview_path: previewPath,
          })
          .select("*")
          .single();

        if (ins.error) throw ins.error;
        setItems((prev) => [ins.data as MediaItem, ...prev]);

        // progress
        doneBytes += file.size;
        doneFiles += 1;
        setProg((p) => ({ ...p, doneFiles, doneBytes }));
      }
    } catch (err: any) {
      setMsg(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function shareAdd() {
    setMsg(null);
    const email = shareEmail.trim().toLowerCase();
    if (!email) return;

    if (!isOwner) { setMsg("Only the owner can share."); return; }

    // max 3 users rule (UI-side check; DB trigger also enforces)
    if (members.length >= 3) {
      setMsg("Max 3 shared users allowed for this album.");
      return;
    }

    // look up profile by email (requires user to have signed up once)
    const p = await supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
    if (!p.data?.id) {
      setMsg("That email hasn’t signed up yet (profile not found). Ask them to sign up once, then retry.");
      return;
    }

    const res = await supabase.from("album_members").insert({
      album_id: albumId,
      user_id: p.data.id,
      role: shareRole,
    });

    if (res.error) { setMsg(res.error.message); return; }

    // refresh members list
    const mem = await supabase
      .from("album_members")
      .select("album_id,user_id,role,created_at,profiles:profiles(email)")
      .eq("album_id", albumId);

    setMembers((mem.data ?? []) as any);
    setShareEmail("");
  }

  async function revoke(user_id: string) {
    setMsg(null);
    if (!isOwner) return;

    const res = await supabase.from("album_members").delete().eq("album_id", albumId).eq("user_id", user_id);
    if (res.error) { setMsg(res.error.message); return; }

    setMembers((prev) => prev.filter((m) => (m as any).user_id !== user_id));
  }

  const canUpload = myRole === "write";

  return (
    <main className="main">
      <div className="cardBlock">
        <div className="blockTitle">{album?.title ?? "Album"}</div>

        <div className="muted">
          {items.length} items • access: <b>{myRole}</b>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <label className={`btn ${(!canUpload || busy) ? "disabledBtn" : ""}`}>
            Select folder (scan & upload)
            <input
              ref={fileInputRef}
              type="file"
              multiple
              // @ts-ignore
              webkitdirectory="true"
              style={{ display: "none" }}
              onChange={onPickFolder}
              disabled={!canUpload || busy}
            />
          </label>

          {busy ? <div className="muted">Working…</div> : null}
        </div>

        {/* ✅ Progress bar */}
        {busy || prog.totalFiles > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="tvProgressBar">
              <div className="tvProgressFill" style={{ width: `${pct}%` }} />
            </div>
            <div className="tvProgressMeta">
              <div>{pct}%</div>
              <div>
                {prog.doneFiles}/{prog.totalFiles} files • {fmtBytes(prog.doneBytes)} / {fmtBytes(prog.totalBytes)}
              </div>
            </div>
          </div>
        ) : null}

        {msg ? <div className="authMsg">{msg}</div> : null}
      </div>

      {/* ✅ Sharing block (kept, NOT removed) */}
      {isOwner ? (
        <div className="cardBlock">
          <div className="blockTitle">Share (max 3 users)</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <input
              className="input"
              placeholder="Add user email"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
            />
            <select className="select" value={shareRole} onChange={(e) => setShareRole(e.target.value as Role)}>
              <option value="read">read</option>
              <option value="write">write</option>
            </select>
            <button className="btn" onClick={shareAdd}>Add</button>
          </div>

          <div className="list" style={{ marginTop: 12 }}>
            {members.map((m: any) => (
              <div key={m.user_id} className="rowLine">
                <div>
                  <div className="name">{m.profiles?.email ?? m.user_id}</div>
                  <div className="muted">role: {m.role}</div>
                </div>
                <button className="btn" onClick={() => revoke(m.user_id)}>Revoke</button>
              </div>
            ))}
            {members.length === 0 ? <div className="muted">No shared users.</div> : null}
          </div>
        </div>
      ) : null}

      <div className="grid">
        {items.map((it) => (
          <button key={it.id} className="card" onClick={() => setActive(it)}>
            <AsyncImg getUrl={() => getSigned(it.preview_path)} />
            <div className="meta">
              <div className="name">{it.file_name}</div>
              <div className="muted">{fmtBytes(it.size_bytes)}</div>
            </div>
          </button>
        ))}
      </div>

      {active ? (
        <div
          className="modal"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains("modal")) setActive(null);
          }}
        >
          <div className="modalContent">
            <div className="modalTop">
              <div className="modalTitle">{active.file_name}</div>
              <button className="btn" onClick={() => setActive(null)}>Close</button>
            </div>

            <div className="modalBody">
              <div className="modalImgWrap">
                <AsyncImg getUrl={() => getSigned(active.preview_path)} className="modalImg" />
              </div>

              <div className="side">
                <div className="kv"><b>Size</b> {fmtBytes(active.size_bytes)}</div>
                <div className="kv"><b>Dims</b> {active.width}×{active.height}</div>
                <div className="kv"><b>Date</b> {active.captured_at ? active.captured_at.slice(0, 19).replace("T", " ") : ""}</div>
                <div className="kv"><b>SHA</b> {active.sha256.slice(0, 18)}…</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AsyncImg({ getUrl, className }: { getUrl: () => Promise<string>; className?: string }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let alive = true;
    getUrl().then((u) => { if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
  }, [getUrl]);

  return <img className={className ?? "thumb"} src={src} alt="" loading="lazy" />;
}
