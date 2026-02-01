from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
import mimetypes
import json
import hashlib
import os
import stat
from datetime import datetime, timezone
from typing import Any, Iterator, Dict

from PIL import Image, ExifTags, ImageOps
import piexif

from hachoir.metadata import extractMetadata
from hachoir.parser import createParser

import av  # pip install av


PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif"}
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".3gp"}


# -------------------- helpers --------------------

def iso_utc_from_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def classify_type(path: Path) -> str | None:
    ext = path.suffix.lower()
    if ext in PHOTO_EXTS:
        return "photo"
    if ext in VIDEO_EXTS:
        return "video"

    mime, _ = mimetypes.guess_type(str(path))
    if mime:
        if mime.startswith("image/"):
            return "photo"
        if mime.startswith("video/"):
            return "video"
    return None


def should_ignore(path: Path) -> bool:
    name = path.name.lower()
    if name in {".ds_store", "thumbs.db"}:
        return True
    if name.endswith((".tmp", ".part", ".crdownload")):
        return True
    return False


def is_hidden(path: Path) -> bool:
    if path.name.startswith("."):
        return True
    if os.name == "nt":
        try:
            import ctypes
            attrs = ctypes.windll.kernel32.GetFileAttributesW(str(path))
            if attrs == -1:
                return False
            return bool(attrs & 2)
        except Exception:
            return False
    return False


def safe_decode(x: Any) -> Any:
    if isinstance(x, bytes):
        try:
            return x.decode("utf-8", errors="ignore")
        except Exception:
            return None
    return x


def try_parse_exif_datetime(s: str) -> str | None:
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%Y:%m:%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return None


def dms_to_deg(dms, ref: str) -> float | None:
    try:
        deg = dms[0][0] / dms[0][1]
        minutes = dms[1][0] / dms[1][1]
        seconds = dms[2][0] / dms[2][1]
        val = deg + (minutes / 60.0) + (seconds / 3600.0)
        if ref in ("S", "W"):
            val = -val
        return float(val)
    except Exception:
        return None


# -------------------- photo metadata --------------------

def extract_photo_metadata(path: Path) -> dict:
    out = {
        "captured_at": None,
        "width": None,
        "height": None,
        "gps_lat": None,
        "gps_lon": None,
        "camera_make": None,
        "camera_model": None,
        "orientation": None,

        "duration_sec": None,
        "container": None,
        "codec": None,
        "video_codec": None,
        "audio_codec": None,
        "bitrate": None,
        "fps": None,
    }

    with Image.open(path) as img:
        out["width"], out["height"] = img.size
        exif = img.getexif()
        if exif:
            for tag_id, value in exif.items():
                tag_name = ExifTags.TAGS.get(tag_id, tag_id)
                if tag_name == "Make":
                    out["camera_make"] = safe_decode(value)
                elif tag_name == "Model":
                    out["camera_model"] = safe_decode(value)
                elif tag_name == "Orientation":
                    try:
                        out["orientation"] = int(value)
                    except Exception:
                        pass
                elif tag_name in ("DateTimeOriginal", "DateTime"):
                    if out["captured_at"] is None and isinstance(value, str):
                        out["captured_at"] = try_parse_exif_datetime(value)

    try:
        exif_dict = piexif.load(str(path))
        gps = exif_dict.get("GPS", {})
        if gps:
            lat = gps.get(piexif.GPSIFD.GPSLatitude)
            lat_ref = gps.get(piexif.GPSIFD.GPSLatitudeRef)
            lon = gps.get(piexif.GPSIFD.GPSLongitude)
            lon_ref = gps.get(piexif.GPSIFD.GPSLongitudeRef)

            if lat and lat_ref and lon and lon_ref:
                lat_ref = safe_decode(lat_ref)
                lon_ref = safe_decode(lon_ref)
                out["gps_lat"] = dms_to_deg(lat, lat_ref)
                out["gps_lon"] = dms_to_deg(lon, lon_ref)
    except Exception:
        pass

    return out


# -------------------- video metadata --------------------

def extract_video_metadata(path: Path) -> dict:
    out = {
        "captured_at": None,
        "width": None,
        "height": None,
        "duration_sec": None,
        "gps_lat": None,
        "gps_lon": None,
        "camera_make": None,
        "camera_model": None,
        "orientation": None,
        "codec": None,
        "video_codec": None,
        "audio_codec": None,
        "container": None,
        "bitrate": None,
        "fps": None,
    }

    parser = createParser(str(path))
    if not parser:
        return out

    try:
        metadata = extractMetadata(parser)
    except Exception:
        return out
    finally:
        try:
            parser.close()
        except Exception:
            pass

    if not metadata:
        return out

    def get(key: str):
        try:
            return metadata.get(key)
        except Exception:
            return None

    duration = get("duration")
    if duration:
        try:
            out["duration_sec"] = float(duration.total_seconds())
        except Exception:
            pass

    w = get("width")
    h = get("height")
    try:
        out["width"] = int(w) if w else None
        out["height"] = int(h) if h else None
    except Exception:
        pass

    out["container"] = get("container")
    out["video_codec"] = get("video_codec") or get("codec")
    out["audio_codec"] = get("audio_codec")
    out["codec"] = out["video_codec"]

    br = get("bit_rate") or get("overall_bit_rate")
    if br:
        try:
            out["bitrate"] = int(br)
        except Exception:
            pass

    fps = get("frame_rate")
    if fps:
        try:
            out["fps"] = float(fps)
        except Exception:
            pass

    creation = get("creation_date")
    if creation:
        try:
            if getattr(creation, "tzinfo", None) is None:
                creation = creation.replace(tzinfo=timezone.utc)
            out["captured_at"] = creation.astimezone(timezone.utc).isoformat()
        except Exception:
            out["captured_at"] = str(creation)

    return out


# -------------------- record schema --------------------

@dataclass
class MediaRecord:
    type: str
    sha256: str

    relative_path: str
    file_name: str
    stem: str
    extension: str
    parent_folder: str

    mime_type: str
    size_bytes: int
    is_hidden: bool

    created_at_fs: str
    modified_at_fs: str
    accessed_at_fs: str

    mode_octal: str
    uid: int | None
    gid: int | None

    captured_at: str | None
    width: int | None
    height: int | None
    duration_sec: float | None
    gps_lat: float | None
    gps_lon: float | None
    camera_make: str | None
    camera_model: str | None
    orientation: int | None

    codec: str | None
    video_codec: str | None
    audio_codec: str | None
    container: str | None
    bitrate: int | None
    fps: float | None

    is_duplicate: bool
    duplicate_of: str | None


# -------------------- cache --------------------

def load_cache(cache_path: Path) -> dict:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache_path: Path, cache: dict) -> None:
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


# -------------------- scan --------------------

def build_record(path: Path, root: Path, media_type: str, sha256: str) -> MediaRecord:
    st = path.stat()
    mime, _ = mimetypes.guess_type(str(path))
    uid = getattr(st, "st_uid", None)
    gid = getattr(st, "st_gid", None)

    if media_type == "photo":
        md = extract_photo_metadata(path)
        if md["captured_at"] is None:
            md["captured_at"] = iso_utc_from_ts(st.st_mtime)
    else:
        md = extract_video_metadata(path)
        if md["captured_at"] is None:
            md["captured_at"] = iso_utc_from_ts(st.st_mtime)

    rel = str(path.resolve().relative_to(root)).replace("\\", "/")

    return MediaRecord(
        type=media_type,
        sha256=sha256,

        relative_path=rel,
        file_name=path.name,
        stem=path.stem,
        extension=path.suffix.lower(),
        parent_folder=path.parent.name,

        mime_type=mime or "application/octet-stream",
        size_bytes=st.st_size,
        is_hidden=is_hidden(path),

        created_at_fs=iso_utc_from_ts(st.st_ctime),
        modified_at_fs=iso_utc_from_ts(st.st_mtime),
        accessed_at_fs=iso_utc_from_ts(st.st_atime),

        mode_octal=oct(stat.S_IMODE(st.st_mode)),
        uid=uid,
        gid=gid,

        captured_at=md["captured_at"],
        width=md["width"],
        height=md["height"],
        duration_sec=md["duration_sec"],
        gps_lat=md["gps_lat"],
        gps_lon=md["gps_lon"],
        camera_make=md["camera_make"],
        camera_model=md["camera_model"],
        orientation=md["orientation"],

        codec=md["codec"],
        video_codec=md["video_codec"],
        audio_codec=md["audio_codec"],
        container=md["container"],
        bitrate=md["bitrate"],
        fps=md["fps"],

        is_duplicate=False,
        duplicate_of=None,
    )


def scan_folder_cached(root: Path, cache_path: Path):
    root = root.resolve()
    if not root.exists():
        raise FileNotFoundError(f"Folder not found: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a folder: {root}")

    cache = load_cache(cache_path)
    first_seen_by_hash: dict[str, str] = {}  # sha256 -> relative_path

    stats = {
        "scanned": 0,
        "from_cache": 0,
        "rehash": 0,
        "duplicates": 0,
        "photos": 0,
        "videos": 0,
    }

    records_out = []

    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if should_ignore(p):
            continue

        media_type = classify_type(p)
        if not media_type:
            continue

        rel = str(p.resolve().relative_to(root)).replace("\\", "/")
        ck = rel

        st = p.stat()
        mtime = iso_utc_from_ts(st.st_mtime)
        size = st.st_size

        stats["scanned"] += 1

        cached = cache.get(ck)
        if cached and cached.get("size_bytes") == size and cached.get("modified_at_fs") == mtime:
            rec_dict = cached["record"]
            stats["from_cache"] += 1
        else:
            stats["rehash"] += 1
            file_hash = sha256_file(p)
            rec = build_record(p, root, media_type, file_hash)
            rec_dict = asdict(rec)

            cache[ck] = {
                "size_bytes": size,
                "modified_at_fs": mtime,
                "record": rec_dict,
            }

        sha = rec_dict["sha256"]
        if sha in first_seen_by_hash:
            stats["duplicates"] += 1
            rec_dict["is_duplicate"] = True
            rec_dict["duplicate_of"] = first_seen_by_hash[sha]
        else:
            first_seen_by_hash[sha] = rec_dict["relative_path"]

        if rec_dict["type"] == "photo":
            stats["photos"] += 1
        elif rec_dict["type"] == "video":
            stats["videos"] += 1

        records_out.append(rec_dict)

    save_cache(cache_path, cache)
    return records_out, stats


def write_jsonl_dicts(records: list[dict], output_path: Path) -> None:
    output_path = output_path.resolve()
    with output_path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def run_scan(root: Path, output_path: Path, cache_path: Path) -> dict:
    records, stats = scan_folder_cached(root, cache_path)
    write_jsonl_dicts(records, output_path)
    return stats


# -------------------- previews --------------------

def iter_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def make_webp_preview(
    src_path: Path,
    dst_path: Path,
    max_side: int = 1440,
    quality: int = 80,
) -> None:
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)

        w, h = img.size
        scale = min(max_side / max(w, h), 1.0)
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        img.save(dst_path, format="WEBP", quality=quality, method=6)


def pick_target_height(orig_h: int | None) -> int:
    if not orig_h:
        return 360
    if orig_h > 480:
        return 480
    if orig_h > 360:
        return 360
    return 240


def make_video_preview_pyav(
    src_path: Path,
    dst_path: Path,
    target_h: int,
    crf: int = 30,
    fps_cap: int = 24,
) -> None:
    """
    Video preview using PyAV only (no OS tools).
    Output: MP4 H.264. Audio dropped for MVP stability.
    """
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    in_container = av.open(str(src_path))
    vstream = next((s for s in in_container.streams if s.type == "video"), None)
    if vstream is None:
        in_container.close()
        raise RuntimeError("No video stream found")

    # detect dimensions
    orig_w = int(vstream.codec_context.width or 0)
    orig_h = int(vstream.codec_context.height or 0)
    if orig_w <= 0 or orig_h <= 0:
        for frame in in_container.decode(video=0):
            orig_w, orig_h = frame.width, frame.height
            break
        in_container.seek(0)

    if orig_h <= 0:
        orig_h = target_h
    if orig_w <= 0:
        orig_w = int(target_h * 16 / 9)

    target_w = int(round(orig_w * (target_h / orig_h)))
    if target_w % 2 == 1:
        target_w += 1

    # choose output fps
    try:
        in_fps = float(vstream.average_rate) if vstream.average_rate else float(fps_cap)
    except Exception:
        in_fps = float(fps_cap)
    out_fps = min(float(fps_cap), in_fps) if in_fps > 0 else float(fps_cap)

    out_container = av.open(str(dst_path), mode="w")
    out_stream = out_container.add_stream("libx264", rate=out_fps)
    out_stream.width = target_w
    out_stream.height = target_h
    out_stream.pix_fmt = "yuv420p"
    out_stream.options = {"crf": str(crf), "preset": "veryfast"}

    # simple fps cap by skipping frames (approx)
    skip = 1
    if in_fps > out_fps and out_fps > 0:
        skip = max(1, int(round(in_fps / out_fps)))

    i = 0
    for frame in in_container.decode(video=0):
        i += 1
        if skip > 1 and (i % skip) != 0:
            continue

        new_frame = frame.reformat(width=target_w, height=target_h, format="yuv420p")
        for packet in out_stream.encode(new_frame):
            out_container.mux(packet)

    for packet in out_stream.encode():
        out_container.mux(packet)

    in_container.close()
    out_container.close()


def build_previews(
    root_folder: Path,
    index_jsonl: Path,
    out_dir: Path,
    max_side: int = 1440,
    quality: int = 80,
    video_crf: int = 30,
    fps_cap: int = 24,
) -> dict:
    root_folder = root_folder.resolve()
    index_jsonl = index_jsonl.resolve()
    out_dir = out_dir.resolve()

    stats = {
        "photos_seen": 0,
        "videos_seen": 0,
        "photo_previews_created": 0,
        "photo_previews_skipped": 0,
        "video_previews_created": 0,
        "video_previews_skipped": 0,
        "errors": 0,
        "last_error": None,
    }

    for rec in iter_jsonl(index_jsonl):
        rtype = rec.get("type")
        rel = rec.get("relative_path")
        sha = rec.get("sha256")
        if not rtype or not rel or not sha:
            continue

        src = root_folder / rel

        try:
            if rtype == "photo":
                stats["photos_seen"] += 1
                dst = out_dir / f"{sha}.webp"

                if dst.exists():
                    stats["photo_previews_skipped"] += 1
                    continue

                make_webp_preview(src, dst, max_side=max_side, quality=quality)
                stats["photo_previews_created"] += 1
            elif rtype == "video":
                # Skipping videos for photo-only MVP
                stats["videos_seen"] += 1
                stats["video_previews_skipped"] += 1
                continue


            # elif rtype == "video":
            #     stats["videos_seen"] += 1
            #     dst = out_dir / f"{sha}.mp4"

            #     if dst.exists():
            #         stats["video_previews_skipped"] += 1
            #         continue

            #     orig_h = rec.get("height")
            #     try:
            #         orig_h = int(orig_h) if orig_h is not None else None
            #     except Exception:
            #         orig_h = None

            #     target_h = pick_target_height(orig_h)

            #     make_video_preview_pyav(
            #         src_path=src,
            #         dst_path=dst,
            #         target_h=target_h,
            #         crf=video_crf,
            #         fps_cap=fps_cap,
            #     )
            #     stats["video_previews_created"] += 1

        except Exception as e:
            stats["errors"] += 1
            stats["last_error"] = f"{rel}: {e}"

    return stats


from pathlib import Path
import json
import shutil

def export_for_web(
    index_jsonl: Path,
    previews_dir: Path,
    web_public_dir: Path,
    data_filename: str = "data.json",
) -> dict:
    """
    Creates:
      web_public_dir/data.json
      web_public_dir/previews/<sha>.webp  (copied)
    Photo-only export for React gallery.
    """
    index_jsonl = index_jsonl.resolve()
    previews_dir = previews_dir.resolve()
    web_public_dir = web_public_dir.resolve()

    web_public_dir.mkdir(parents=True, exist_ok=True)
    out_previews = web_public_dir / "previews"
    out_previews.mkdir(parents=True, exist_ok=True)

    items = []
    copied = 0
    missing = 0

    # JSONL -> list of photo items
    with index_jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)

            if rec.get("type") != "photo":
                continue

            sha = rec.get("sha256")
            if not sha:
                continue

            preview_name = f"{sha}.webp"
            src_preview = previews_dir / preview_name

            if src_preview.exists():
                dst_preview = out_previews / preview_name
                # copy if not exists or file size differs
                if (not dst_preview.exists()) or (dst_preview.stat().st_size != src_preview.stat().st_size):
                    shutil.copy2(src_preview, dst_preview)
                    copied += 1
            else:
                missing += 1

            items.append({
                "sha256": sha,
                "file_name": rec.get("file_name"),
                "relative_path": rec.get("relative_path"),
                "parent_folder": rec.get("parent_folder"),
                "captured_at": rec.get("captured_at"),
                "width": rec.get("width"),
                "height": rec.get("height"),
                "size_bytes": rec.get("size_bytes"),
                "camera_make": rec.get("camera_make"),
                "camera_model": rec.get("camera_model"),
                "gps_lat": rec.get("gps_lat"),
                "gps_lon": rec.get("gps_lon"),
                "is_duplicate": rec.get("is_duplicate", False),
                "duplicate_of": rec.get("duplicate_of"),
                "preview_file": preview_name,
            })

    # sort by captured_at desc (fallback: file_name)
    def key_fn(x):
        ca = x.get("captured_at") or ""
        return (ca, x.get("file_name") or "")
    items.sort(key=key_fn, reverse=True)

    out_data = web_public_dir / data_filename
    out_data.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "photos_exported": len(items),
        "previews_copied": copied,
        "previews_missing": missing,
        "data_path": str(out_data),
        "previews_path": str(out_previews),
    }
