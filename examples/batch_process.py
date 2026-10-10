#!/usr/bin/env python3
"""Batch-process a folder of line-art images with the Chawk library.

Uses ``chawk.process_image`` directly (no server, no subprocess)::

    .venv/bin/python examples/batch_process.py tests/images out_batch --preset precise
"""

from __future__ import annotations

import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chawk import NoStrokesDetected, build_config, process_image


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("usage: batch_process.py INPUT_DIR OUT_DIR [--preset NAME]", file=sys.stderr)
        return 2
    src, dst = args[0], args[1] if len(args) > 1 else "out_batch"
    preset = "balanced"
    if "--preset" in args:
        preset = args[args.index("--preset") + 1]
    cfg = build_config(preset)
    os.makedirs(dst, exist_ok=True)

    paths = sorted(p for ext in ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.webp", "*.tif*")
                   for p in glob.glob(os.path.join(src, ext)))
    if not paths:
        print(f"no images found in {src}", file=sys.stderr)
        return 2
    ok = failed = 0
    for path in paths:
        stem = os.path.splitext(os.path.basename(path))[0]
        try:
            r = process_image(path, cfg=cfg,
                              output_image=os.path.join(dst, f"{stem}_chawk.png"),
                              output_json=os.path.join(dst, f"{stem}_chawk.json"))
        except NoStrokesDetected as exc:
            print(f"SKIP {stem}: {exc}", file=sys.stderr)
            failed += 1
            continue
        except ValueError as exc:
            print(f"FAIL {stem}: {exc}", file=sys.stderr)
            failed += 1
            continue
        s = r.report["summary"]
        print(f"OK {stem}: {s['stroke_count']} strokes, {s['segment_count']} equations, "
              f"RMSE {s['mean_rmse_px']}px")
        ok += 1
    print(f"\n{ok} ok, {failed} skipped/failed")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
