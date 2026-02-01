from __future__ import annotations

import sys
from pathlib import Path

from agent.core import run_scan, build_previews, export_for_web



USAGE = """
Usage:
  python -m agent scan "<folder_path>" [--out <output_file.jsonl>] [--cache <cache_file.json>]

  python -m agent preview "<folder_path>"
      [--index <index_file.jsonl>]
      [--out <preview_output_folder>]
      [--max-side <pixels>]
      [--quality <1-100>]
      [--video-crf <int>]
      [--fps-cap <int>]

Defaults:
  index_file = tripvault_index.jsonl
  cache_file = tripvault_cache.json
  preview_out = previews
  max_side   = 1440
  quality    = 80
  video_crf  = 30
  fps_cap    = 24
""".strip()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(USAGE)
        return 1

    cmd = argv[1].lower()

    if cmd == "export":
        if len(argv) < 3:
            print('Usage: python -m agent export --web-public "web/public" [--index tripvault_index.jsonl] [--previews previews]')
            return 1

        # defaults
        index_file = Path("tripvault_index.jsonl")
        previews_dir = Path("previews")
        web_public = None

        if "--index" in argv:
            i = argv.index("--index")
            index_file = Path(argv[i + 1].strip().strip('"'))

        if "--previews" in argv:
            i = argv.index("--previews")
            previews_dir = Path(argv[i + 1].strip().strip('"'))

        if "--web-public" in argv:
            i = argv.index("--web-public")
            web_public = Path(argv[i + 1].strip().strip('"'))

        if web_public is None:
            print('Missing --web-public "web/public"')
            return 1

        stats = export_for_web(index_file, previews_dir, web_public)
        print("\n✔ Export complete")
        print(f"✔ Photos exported: {stats['photos_exported']}")
        print(f"✔ Previews copied: {stats['previews_copied']}")
        print(f"✔ Previews missing: {stats['previews_missing']}")
        print(f"✔ data.json: {stats['data_path']}")
        print(f"✔ previews/: {stats['previews_path']}")
        return 0

    
    if cmd == "scan":
        if len(argv) < 3:
            print("Missing folder_path.\n\n" + USAGE)
            return 1

        folder = Path(argv[2].strip().strip('"'))
        out_file = Path("tripvault_index.jsonl")
        cache_file = Path("tripvault_cache.json")

        if "--out" in argv:
            i = argv.index("--out")
            out_file = Path(argv[i + 1].strip().strip('"'))

        if "--cache" in argv:
            i = argv.index("--cache")
            cache_file = Path(argv[i + 1].strip().strip('"'))

        stats = run_scan(folder, out_file, cache_file)

        print("\n✔ Scan complete")
        print(f"✔ Files scanned: {stats['scanned']}")
        print(f"✔ Reused from cache: {stats['from_cache']}")
        print(f"✔ Rehashed/extracted: {stats['rehash']}")
        print(f"✔ Duplicates found: {stats['duplicates']}")
        print(f"  - Photos: {stats['photos']}")
        print(f"  - Videos: {stats['videos']}")
        print(f"✔ Index:  {out_file.resolve()}")
        print(f"✔ Cache:  {cache_file.resolve()}")
        return 0

    if cmd == "preview":
        if len(argv) < 3:
            print("Missing folder_path.\n\n" + USAGE)
            return 1

        folder = Path(argv[2].strip().strip('"'))
        index_file = Path("tripvault_index.jsonl")
        out_dir = Path("previews")
        max_side = 1440
        quality = 80
        video_crf = 30
        fps_cap = 24

        if "--index" in argv:
            i = argv.index("--index")
            index_file = Path(argv[i + 1].strip().strip('"'))

        if "--out" in argv:
            i = argv.index("--out")
            out_dir = Path(argv[i + 1].strip().strip('"'))

        if "--max-side" in argv:
            i = argv.index("--max-side")
            max_side = int(argv[i + 1])

        if "--quality" in argv:
            i = argv.index("--quality")
            quality = int(argv[i + 1])

        if "--video-crf" in argv:
            i = argv.index("--video-crf")
            video_crf = int(argv[i + 1])

        if "--fps-cap" in argv:
            i = argv.index("--fps-cap")
            fps_cap = int(argv[i + 1])

        stats = build_previews(
            root_folder=folder,
            index_jsonl=index_file,
            out_dir=out_dir,
            max_side=max_side,
            quality=quality,
            video_crf=video_crf,
            fps_cap=fps_cap,
        )

        print("\n✔ Preview generation complete")
        print(f"✔ Photos seen: {stats['photos_seen']}")
        print(f"✔ Photo previews created: {stats['photo_previews_created']}")
        print(f"✔ Photo previews skipped: {stats['photo_previews_skipped']}")
        print(f"✔ Videos seen: {stats['videos_seen']}")
        print(f"✔ Video previews created: {stats['video_previews_created']}")
        print(f"✔ Video previews skipped: {stats['video_previews_skipped']}")
        print(f"✔ Errors: {stats['errors']}")
        if stats.get("last_error"):
            print(f"Last error: {stats['last_error']}")
        print(f"✔ Output folder: {out_dir.resolve()}")
        return 0

    print(f"Unknown command: {cmd}\n\n{USAGE}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
