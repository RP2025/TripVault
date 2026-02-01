import { useEffect, useMemo, useState } from "react";
import type { PhotoItem } from "./types";
import "./App.css";
import Auth from "./Auth";
import { supabase } from "./supabaseClient";
import type { Session } from "@supabase/supabase-js";

type DupFilter = "all" | "dup" | "nodup";
type SortMode = "date_desc" | "date_asc" | "name_asc" | "name_desc";
type Tab = "gallery" | "upload" | "profile";

type LocalAlbum = {
  id: string;
  title: string;
  createdAt: string;

  originalBytes: number;
  previewBytes: number;
  itemsScanned: number;

  // Local preview URLs (in-memory)
  previewUrls: Array<{ name: string; url: string; size: number }>;
};

const DEFAULT_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB (MVP)

function fmtBytes(n?: number) {
  if (n == null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(s?: string) {
  if (!s) return "";
  return s.replace("T", " ").slice(0, 19);
}

function safeStr(x: unknown) {
  return x == null ? "" : String(x);
}

// ---------- Folder scan helpers (Chrome/Edge) ----------
async function readDirHandle(dirHandle: any): Promise<Array<{ file: File; rel: string }>> {
  const out: Array<{ file: File; rel: string }> = [];

  async function walk(handle: any, prefix = "") {
    for await (const entry of handle.values()) {
      if (entry.kind === "file") {
        const file = await entry.getFile();
        out.push({ file, rel: prefix + entry.name });
      } else if (entry.kind === "directory") {
        await walk(entry, prefix + entry.name + "/");
      }
    }
  }

  await walk(dirHandle);
  return out;
}

async function makePhotoPreviewBlob(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const maxSide = 1280;

  let width = img.width;
  let height = img.height;

  if (width > height && width > maxSide) {
    height = Math.round((height * maxSide) / width);
    width = maxSide;
  } else if (height >= width && height > maxSide) {
    width = Math.round((width * maxSide) / height);
    height = maxSide;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.7
    );
  });

  return blob;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  // Tabs
  const [tab, setTab] = useState<Tab>("gallery");

  // ---------- Existing gallery state ----------
  const [all, setAll] = useState<PhotoItem[]>([]);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("(all)");
  const [dup, setDup] = useState<DupFilter>("all");
  const [sort, setSort] = useState<SortMode>("date_desc");
  const [active, setActive] = useState<PhotoItem | null>(null);

  // ---------- Upload (local MVP) state ----------
  const [albumTitle, setAlbumTitle] = useState("");
  const [albums, setAlbums] = useState<LocalAlbum[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>("");

  const [scanProgress, setScanProgress] = useState(0);
  const [scanRunning, setScanRunning] = useState(false);
  const [quotaBytes, setQuotaBytes] = useState(DEFAULT_QUOTA_BYTES);

  const [scanStats, setScanStats] = useState({
    totalFiles: 0,
    doneFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
    originalBytes: 0,
    previewBytes: 0,
  });

  // ---------- Auth bootstrap ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));

    // const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
});


    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- Load exported gallery only when logged in ----------
  useEffect(() => {
    if (!session) return;

    (async () => {
      const res = await fetch("/data.json");
      const data = (await res.json()) as PhotoItem[];
      setAll(data);
    })().catch((e) => {
      console.error(e);
      alert("Failed to load /data.json. Did you run: python -m agent export --web-public web/public ?");
    });
  }, [session]);

  const folders = useMemo(() => {
    const s = new Set<string>();
    for (const it of all) s.add(it.parent_folder || "");
    return ["(all)", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [all]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    let items = all.filter((x) => {
      if (folder !== "(all)" && (x.parent_folder || "") !== folder) return false;

      if (dup === "dup" && !x.is_duplicate) return false;
      if (dup === "nodup" && x.is_duplicate) return false;

      if (!qq) return true;

      const hay = [
        x.file_name,
        x.relative_path,
        x.parent_folder,
        x.camera_make,
        x.camera_model,
      ]
        .map(safeStr)
        .join(" ")
        .toLowerCase();

      return hay.includes(qq);
    });

    const byCaptured = (a: PhotoItem, b: PhotoItem) => {
      const da = a.captured_at || "";
      const db = b.captured_at || "";
      return da.localeCompare(db);
    };

    const byName = (a: PhotoItem, b: PhotoItem) =>
      safeStr(a.file_name).localeCompare(safeStr(b.file_name));

    switch (sort) {
      case "date_desc":
        items = items.sort((a, b) => byCaptured(b, a) || byName(a, b));
        break;
      case "date_asc":
        items = items.sort((a, b) => byCaptured(a, b) || byName(a, b));
        break;
      case "name_asc":
        items = items.sort((a, b) => byName(a, b));
        break;
      case "name_desc":
        items = items.sort((a, b) => byName(b, a));
        break;
    }

    return items;
  }, [all, q, folder, dup, sort]);

  async function logout() {
    await supabase.auth.signOut();
  }

  const selectedAlbum = albums.find((a) => a.id === selectedAlbumId) || null;

  function createLocalAlbum(title: string) {
    const t = title.trim();
    if (!t) return null;

    const id = crypto.randomUUID();
    const alb: LocalAlbum = {
      id,
      title: t,
      createdAt: new Date().toISOString(),
      originalBytes: 0,
      previewBytes: 0,
      itemsScanned: 0,
      previewUrls: [],
    };

    setAlbums((prev) => [alb, ...prev]);
    setSelectedAlbumId(id);
    return id;
  }

  async function createAlbumThenPickFolder() {
    const name = albumTitle.trim();
    if (!name) {
      alert("Enter album name first.");
      return;
    }

    const id = createLocalAlbum(name);
    if (!id) return;

    setAlbumTitle("");
    await scanLocalFolderPhotosOnly(id);
  }

  async function scanLocalFolderPhotosOnly(albumId: string) {
    setScanRunning(true);
    setScanProgress(0);
    setScanStats({
      totalFiles: 0,
      doneFiles: 0,
      totalBytes: 0,
      doneBytes: 0,
      originalBytes: 0,
      previewBytes: 0,
    });

    // revoke old URLs for that album to avoid memory leaks
    setAlbums((prev) =>
      prev.map((a) => {
        if (a.id !== albumId) return a;
        for (const p of a.previewUrls) URL.revokeObjectURL(p.url);
        return { ...a, previewUrls: [] };
      })
    );

    try {
      if (!(window as any).showDirectoryPicker) {
        alert("Folder picking needs Chrome/Edge (File System Access API).");
        return;
      }

      const dirHandle = await (window as any).showDirectoryPicker();
      const items = await readDirHandle(dirHandle);

      // photos only
      const photos = items.filter(({ file }) => {
        const isPhoto =
          file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(file.name);
        return isPhoto;
      });

      const totalBytes = photos.reduce((s, x) => s + x.file.size, 0);

      if (totalBytes > quotaBytes) {
        alert(
          `Quota exceeded.\nSelected photos total: ${fmtBytes(totalBytes)}\nQuota: ${fmtBytes(
            quotaBytes
          )}\n\nPick a smaller folder or increase quota (for testing).`
        );
        return;
      }

      setScanStats((s) => ({
        ...s,
        totalFiles: photos.length,
        totalBytes,
      }));

      let doneBytes = 0;
      let doneFiles = 0;
      let originalBytes = 0;
      let previewBytes = 0;

      const previewUrls: Array<{ name: string; url: string; size: number }> = [];

      for (const { file } of photos) {
        originalBytes += file.size;

        const previewBlob = await makePhotoPreviewBlob(file);
        previewBytes += previewBlob.size;

        const url = URL.createObjectURL(previewBlob);
        previewUrls.push({ name: file.name, url, size: previewBlob.size });

        doneBytes += file.size;
        doneFiles += 1;

        const pct = totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0;
        setScanProgress(pct);

        setScanStats({
          totalFiles: photos.length,
          doneFiles,
          totalBytes,
          doneBytes,
          originalBytes,
          previewBytes,
        });
      }

      setAlbums((prev) =>
        prev.map((a) =>
          a.id === albumId
            ? { ...a, originalBytes, previewBytes, itemsScanned: photos.length, previewUrls }
            : a
        )
      );
    } catch (e: any) {
      console.error(e);
      if (String(e?.name) !== "AbortError") alert(e?.message || "Scan failed");
    } finally {
      setScanRunning(false);
    }
  }

  if (!session) return <Auth />;

  // ---------- UI blocks ----------
  const Tabs = (
    <div className="tvTabs">
      <button className={`tvTab ${tab === "gallery" ? "active" : ""}`} onClick={() => setTab("gallery")}>
        Gallery
      </button>
      <button className={`tvTab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>
        Upload (Local)
      </button>
      <button className={`tvTab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
        Profile
      </button>
    </div>
  );

  const Topbar = (
    <header className="topbar">
      <div className="titleRow">
        <div>
          <div className="title">TripVault</div>
          <div className="subtitle">{session.user.email}</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {Tabs}
          <button className="btn" onClick={logout}>Logout</button>
        </div>
      </div>
    </header>
  );

  const GalleryView = (
    <>
      <div className="tvSection">
        <div className="tvSectionTitle">Gallery (Exported)</div>
        <div className="controls">
          <input
            className="input"
            placeholder="Search file / folder / camera…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)}>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f === "" ? "(root)" : f}
              </option>
            ))}
          </select>

          <select className="select" value={dup} onChange={(e) => setDup(e.target.value as DupFilter)}>
            <option value="all">All</option>
            <option value="nodup">No duplicates</option>
            <option value="dup">Duplicates only</option>
          </select>

          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="date_desc">Date ↓</option>
            <option value="date_asc">Date ↑</option>
            <option value="name_asc">Name A→Z</option>
            <option value="name_desc">Name Z→A</option>
          </select>

          <div className="subtitle" style={{ marginLeft: "auto" }}>
            {filtered.length} / {all.length}
          </div>
        </div>
      </div>

      <main className="main">
        <div className="grid">
          {filtered.map((item) => (
            <button
              key={item.sha256}
              className="card"
              onClick={() => setActive(item)}
              title={item.relative_path || item.file_name || item.sha256}
            >
              <img
                className="thumb"
                src={`/previews/${item.preview_file}`}
                loading="lazy"
                alt={item.file_name || item.sha256}
              />
              <div className="meta">
                <div className="name">
                  {item.file_name || item.sha256}
                  {item.is_duplicate ? <span className="badge">dup</span> : null}
                </div>
                <div className="muted">
                  {(item.parent_folder || "")} • {fmtDate(item.captured_at)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>

      {active ? (
        <div
          className="modal"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains("modal")) setActive(null);
          }}
        >
          <div className="modalContent">
            <div className="modalTop">
              <div className="modalTitle">{active.relative_path || active.file_name}</div>
              <button className="btn" onClick={() => setActive(null)}>Close</button>
            </div>

            <div className="modalBody">
              <div className="modalImgWrap">
                <img className="modalImg" src={`/previews/${active.preview_file}`} alt={active.file_name || active.sha256} />
              </div>

              <div className="side">
                <div className="kv"><b>Date</b> {fmtDate(active.captured_at)}</div>
                <div className="kv"><b>Folder</b> {active.parent_folder}</div>
                <div className="kv"><b>Size</b> {fmtBytes(active.size_bytes)}</div>
                <div className="kv"><b>Dims</b> {active.width}×{active.height}</div>
                <div className="kv"><b>Camera</b> {[active.camera_make, active.camera_model].filter(Boolean).join(" ")}</div>
                <div className="kv"><b>GPS</b> {(active.gps_lat && active.gps_lon) ? `${active.gps_lat}, ${active.gps_lon}` : ""}</div>
                <div className="kv"><b>Duplicate</b> {active.is_duplicate ? `Yes → ${active.duplicate_of}` : "No"}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  const UploadView = (
    <main className="tvPage">
      <div className="tvCard">
        <div className="tvCardTitle">Create an album</div>
        <div className="tvRow">
          <input
            className="input"
            placeholder="Album name…"
            value={albumTitle}
            onChange={(e) => setAlbumTitle(e.target.value)}
          />
          <button className="btn primary" onClick={createAlbumThenPickFolder} disabled={scanRunning}>
            {scanRunning ? "Scanning..." : "Create & Pick Folder"}
          </button>
        </div>

        <div className="tvRow" style={{ marginTop: 12 }}>
          <select
            className="select"
            value={selectedAlbumId}
            onChange={(e) => setSelectedAlbumId(e.target.value)}
            style={{ minWidth: 260 }}
          >
            <option value="">Select existing album…</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} • {fmtBytes(a.originalBytes)} orig
              </option>
            ))}
          </select>

          <button
            className="btn"
            onClick={() => selectedAlbumId && scanLocalFolderPhotosOnly(selectedAlbumId)}
            disabled={scanRunning || !selectedAlbumId}
          >
            {scanRunning ? "Scanning..." : "Pick Folder & Scan"}
          </button>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            <span className="subtitle">Quota</span>
            <select className="select" value={quotaBytes} onChange={(e) => setQuotaBytes(Number(e.target.value))}>
              <option value={100 * 1024 * 1024}>100 MB</option>
              <option value={200 * 1024 * 1024}>200 MB</option>
              <option value={500 * 1024 * 1024}>500 MB</option>
              <option value={1024 * 1024 * 1024}>1 GB</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="tvProgressBar">
            <div className="tvProgressFill" style={{ width: `${scanProgress}%` }} />
          </div>

          <div className="tvProgressMeta">
            <div>{scanProgress}%</div>
            <div>
              {scanStats.doneFiles}/{scanStats.totalFiles} files • Original {fmtBytes(scanStats.originalBytes)} • Preview{" "}
              {fmtBytes(scanStats.previewBytes)}
            </div>
          </div>
        </div>

        {selectedAlbum ? (
          <div className="tvAlbumSummary">
            <div><b>Selected:</b> {selectedAlbum.title}</div>
            <div className="muted">
              Items: {selectedAlbum.itemsScanned} • Original: {fmtBytes(selectedAlbum.originalBytes)} • Preview:{" "}
              {fmtBytes(selectedAlbum.previewBytes)}
            </div>
          </div>
        ) : null}
      </div>

      {selectedAlbum && selectedAlbum.previewUrls.length ? (
        <div className="tvCard">
          <div className="tvCardTitle">Local previews</div>
          <div className="grid">
            {selectedAlbum.previewUrls.map((p) => (
              <div key={p.url} className="card" title={p.name}>
                <img className="thumb" src={p.url} loading="lazy" alt={p.name} />
                <div className="meta">
                  <div className="name">{p.name}</div>
                  <div className="muted">{fmtBytes(p.size)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );

  const ProfileView = (
    <main className="tvPage">
      <div className="tvCard">
        <div className="tvCardTitle">Profile</div>
        <div className="subtitle" style={{ marginTop: 6 }}>
          For now this is simple. Next we’ll add:
          <ul style={{ marginTop: 8 }}>
            <li>Saved albums in Supabase (not just local state)</li>
            <li>Sharing (max 3 emails per album)</li>
            <li>Read / Write permissions</li>
            <li>Quota enforcement per user</li>
          </ul>
        </div>

        <div className="tvRow" style={{ marginTop: 10 }}>
          <div className="subtitle">User ID (UID):</div>
          <code style={{ fontSize: 12, padding: "6px 8px", background: "#f3f3f3", borderRadius: 8 }}>
            {session.user.id}
          </code>
        </div>
      </div>
    </main>
  );

  return (
    <div className="page">
      {Topbar}

      {tab === "gallery" ? GalleryView : null}
      {tab === "upload" ? UploadView : null}
      {tab === "profile" ? ProfileView : null}
    </div>
  );
}
