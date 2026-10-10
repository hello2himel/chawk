#!/usr/bin/env python3
"""Chawk CLI - trace line art and fit equations to every stroke.

This module is the single engine used by both the CLI and the web backend
(``app.py`` imports the same ``chawk.process_image``), so pipeline logic lives
in exactly one place.

Examples
--------
    python lineart2eq.py --input tests/images/sine.png --output out/sine.png
    python lineart2eq.py -i drawing.png -o out.png --json out.json --preset complex
    python lineart2eq.py -i art.png -o out.png --rmse-tolerance 1.0 --print-equations
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from chawk import NoStrokesDetected, PRESETS, build_config, process_image


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="lineart2eq",
        description="Convert line-art images into fitted mathematical equations.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("-i", "--input", required=True, help="Input image (PNG/JPG/...)")
    p.add_argument("-o", "--output", help="Annotated output PNG (default: <input>_chawk.png)")
    p.add_argument("--json", dest="json_path",
                   help="JSON report path (default: alongside the output PNG)")
    p.add_argument("--preset", choices=sorted(PRESETS), default="balanced",
                   help="Starting parameter set")
    p.add_argument("--debug-image", help="Also write a mask/skeleton debug figure here")
    p.add_argument("--print-equations", action="store_true",
                   help="Print every fitted equation to stdout")
    p.add_argument("--quiet", action="store_true", help="Suppress progress output")

    g = p.add_argument_group("preprocessing")
    g.add_argument("--max-dimension", type=int, help="Downscale so the longest side is at most this")
    g.add_argument("--threshold-mode", choices=["auto", "otsu", "adaptive"])
    g.add_argument("--invert", choices=["auto", "dark_strokes", "light_strokes"])
    g.add_argument("--min-component-area", type=int, help="Speck removal threshold (px)")
    g.add_argument("--close-gaps", type=int, help="Morphological closing radius (px)")

    g = p.add_argument_group("tracing")
    g.add_argument("--min-stroke-length", type=float)
    g.add_argument("--merge-endpoint-distance", type=float)
    g.add_argument("--resample-spacing", type=float)
    g.add_argument("--smoothing-window", type=int)
    g.add_argument("--max-strokes", type=int)

    g = p.add_argument_group("segmentation / fitting")
    g.add_argument("--rmse-tolerance", type=float, help="Target fit RMSE in pixels")
    g.add_argument("--max-error-tolerance", type=float)
    g.add_argument("--rdp-epsilon", type=float)
    g.add_argument("--corner-angle", type=float)
    g.add_argument("--max-segments-per-stroke", type=int)
    g.add_argument("--max-poly-degree", type=int)
    g.add_argument("--no-circle", dest="enable_circle", action="store_false", default=None)
    g.add_argument("--no-ellipse", dest="enable_ellipse", action="store_false", default=None)
    g.add_argument("--no-sinusoid", dest="enable_sinusoid", action="store_false", default=None)
    g.add_argument("--no-spline", dest="enable_spline", action="store_false", default=None)

    g = p.add_argument_group("rendering")
    g.add_argument("--no-labels", dest="label_equations", action="store_false", default=None)
    g.add_argument("--max-labels", type=int)
    g.add_argument("--label-fontsize", type=float)
    g.add_argument("--overlay-linewidth", type=float)
    g.add_argument("--dpi", type=int)
    g.add_argument("--color-by", choices=["stroke", "segment"])
    return p


_CONFIG_KEYS = (
    "max_dimension", "threshold_mode", "invert", "min_component_area", "close_gaps",
    "min_stroke_length", "merge_endpoint_distance", "resample_spacing", "smoothing_window",
    "max_strokes", "rmse_tolerance", "max_error_tolerance", "rdp_epsilon", "corner_angle",
    "max_segments_per_stroke", "max_poly_degree", "enable_circle", "enable_ellipse",
    "enable_sinusoid", "enable_spline", "label_equations", "max_labels", "label_fontsize",
    "overlay_linewidth", "dpi", "color_by",
)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if not os.path.isfile(args.input):
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 2

    stem = os.path.splitext(args.input)[0]
    out_image = args.output or f"{stem}_chawk.png"
    out_json = args.json_path or f"{os.path.splitext(out_image)[0]}.json"

    overrides = {k: getattr(args, k) for k in _CONFIG_KEYS if getattr(args, k, None) is not None}
    try:
        cfg = build_config(args.preset, **overrides)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    last = {"msg": ""}

    def progress(stage: str, fraction: float, message: str) -> None:
        if args.quiet or message == last["msg"]:
            return
        last["msg"] = message
        print(f"[{fraction * 100:5.1f}%] {message}", file=sys.stderr)

    try:
        result = process_image(
            args.input, cfg=cfg, output_image=out_image, output_json=out_json,
            progress=progress, debug_image=args.debug_image,
        )
    except NoStrokesDetected as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    s = result.report["summary"]
    if not args.quiet:
        print(
            f"\n{s['stroke_count']} strokes -> {s['segment_count']} equations | "
            f"mean R^2 {s['mean_r_squared']} | mean RMSE {s['mean_rmse_px']}px | "
            f"{result.timings['total']:.2f}s",
            file=sys.stderr,
        )
        print(f"annotated image: {result.image_path}", file=sys.stderr)
        print(f"json report:     {result.json_path}", file=sys.stderr)
        models = ", ".join(f"{k}={v}" for k, v in s["models_used"].items())
        print(f"models: {models}", file=sys.stderr)

    if args.print_equations:
        for stroke in result.report["strokes"]:
            print(f"\nstroke {stroke['stroke_id']} "
                  f"({'closed' if stroke['closed'] else 'open'}, "
                  f"{stroke['segment_count']} segment(s), "
                  f"len {stroke['arc_length']:.1f}px)")
            for seg in stroke["segments"]:
                rmse = seg.get("rmse")
                rmse_s = f"{rmse:.2f}px" if isinstance(rmse, (int, float)) else "n/a"
                r2 = seg.get("r_squared")
                r2_s = f"{r2:.4f}" if isinstance(r2, (int, float)) else "n/a"
                print(f"  [{seg['segment_id']}] {seg['model']:<14} {seg['equation']}")
                print(f"      x\u2208[{seg['x_range'][0]:.1f}, {seg['x_range'][1]:.1f}] "
                      f"y\u2208[{seg['y_range'][0]:.1f}, {seg['y_range'][1]:.1f}] "
                      f"R\u00b2={r2_s} rmse={rmse_s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
