"""Top-level pipeline: image in, annotated PNG + JSON report out."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import cv2
import numpy as np

from . import color as color_mod, geom, ink, models, render as render_mod
from .config import Config, build_config
from .preprocess import Preprocessed, load_image, preprocess
from .segment import Segment, segment_stroke
from .trace import Stroke, resample_path, smooth_path, trace_strokes

ProgressFn = Callable[[str, float, str], None]
"""``(stage_key, fraction_0_to_1, human_message)``"""


class NoStrokesDetected(ValueError):
    """Raised when preprocessing/tracing finds nothing usable."""


@dataclass
class Result:
    report: dict[str, Any]
    strokes: list[Stroke]
    stroke_segments: list[list[Segment]]
    preprocessed: Preprocessed
    config: Config
    image_path: str | None = None
    json_path: str | None = None
    timings: dict[str, float] = field(default_factory=dict)


def _noop(stage: str, fraction: float, message: str) -> None:
    return None


def _summarize(strokes, stroke_segments, cfg: Config, pre: Preprocessed,
               source: str | None, timings: dict[str, float]) -> dict[str, Any]:
    stroke_entries = []
    model_counts: dict[str, int] = {}
    r2_values: list[float] = []
    rmse_values: list[float] = []
    weighted_r2_num = 0.0
    weighted_len = 0.0

    for stroke, segments in zip(strokes, stroke_segments):
        seg_dicts = [s.to_dict(cfg.float_precision) for s in segments]
        for s, sd in zip(segments, seg_dicts):
            model_counts[s.fit.model] = model_counts.get(s.fit.model, 0) + 1
            r2_values.append(float(s.fit.r_squared))
            if np.isfinite(s.fit.rmse):
                rmse_values.append(float(s.fit.rmse))
            weighted_r2_num += float(s.fit.r_squared) * s.length
            weighted_len += s.length
        x0, y0, x1, y1 = (
            float(stroke.points[:, 0].min()), float(stroke.points[:, 1].min()),
            float(stroke.points[:, 0].max()), float(stroke.points[:, 1].max()),
        )
        stroke_entries.append({
            "stroke_id": stroke.stroke_id,
            "closed": bool(stroke.closed),
            "arc_length": round(stroke.length, cfg.float_precision),
            "point_count": int(len(stroke.points)),
            "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
            "merged_from_pieces": int(stroke.merged_from),
            "color": stroke.color,
            "filled": bool(stroke.filled),
            "fill_group": stroke.fill_group,
            "fill_role": stroke.fill_role,
            "segment_count": len(seg_dicts),
            "segments": seg_dicts,
        })

    h, w = pre.original.shape[:2]
    total_segments = sum(len(s) for s in stroke_segments)
    return {
        "source": os.path.basename(source) if source else None,
        "image_size": {"width": int(w), "height": int(h)},
        "working_scale": round(float(pre.scale), 5),
        "stroke_thickness_px": round(float(pre.stroke_thickness), 2),
        "ink_ratio": round(float(pre.ink_ratio), 5),
        "summary": {
            "stroke_count": len(stroke_entries),
            "fill_count": len({s.fill_group for s in strokes if s.filled}),
            "segment_count": total_segments,
            "mean_r_squared": round(float(np.mean(r2_values)), 6) if r2_values else None,
            "length_weighted_r_squared": (
                round(weighted_r2_num / weighted_len, 6) if weighted_len > 0 else None
            ),
            "mean_rmse_px": round(float(np.mean(rmse_values)), 4) if rmse_values else None,
            "max_rmse_px": round(float(np.max(rmse_values)), 4) if rmse_values else None,
            "segments_within_tolerance": int(sum(
                1 for segs in stroke_segments for s in segs
                if np.isfinite(s.fit.rmse) and s.fit.rmse <= cfg.rmse_tolerance
            )),
            "models_used": dict(sorted(model_counts.items(), key=lambda kv: -kv[1])),
        },
        "config": cfg.to_dict(),
        "timings_sec": {k: round(v, 3) for k, v in timings.items()},
        "strokes": stroke_entries,
    }


def _sanitize_json(obj):
    """Replace inf/nan floats with None so the report is strict-JSON safe."""
    if isinstance(obj, float):
        return obj if np.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_json(v) for v in obj]
    if isinstance(obj, np.floating):
        f = float(obj)
        return f if np.isfinite(f) else None
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def _fill_strokes(pre: Preprocessed, cfg: Config) -> list[Stroke]:
    """Turn each solid region's contours into closed, fittable paths."""
    inv = 1.0 / pre.scale if pre.scale else 1.0
    smoothing = 3 if pre.color_mode else max(int(cfg.smoothing_window), 7)
    out: list[Stroke] = []
    for region in pre.fills:
        for contour in region.contours:
            pts = contour.points.astype(np.float64) * inv
            if len(pts) < 4:
                continue
            pts = resample_path(pts, cfg.resample_spacing, True)
            pts = smooth_path(pts, smoothing, True)
            if len(pts) < 3:
                continue
            length = float(np.hypot(*np.diff(pts, axis=0).T).sum())
            if length < cfg.min_stroke_length:
                continue
            out.append(Stroke(
                stroke_id=0, points=pts, closed=True, length=length,
                raw_point_count=int(len(pts)), filled=True,
                fill_group=region.fill_id, fill_role=contour.role,
                color=region.color,
            ))
    return out


def process_image(
    image_or_path,
    cfg: Config | None = None,
    output_image: str | None = None,
    output_json: str | None = None,
    progress: ProgressFn | None = None,
    debug_image: str | None = None,
) -> Result:
    """Run the full pipeline.

    ``image_or_path`` may be a path, raw bytes, or an already-loaded BGR array.
    """
    cfg = cfg or build_config()
    cfg.validate()
    progress = progress or _noop
    timings: dict[str, float] = {}
    source = image_or_path if isinstance(image_or_path, (str, os.PathLike)) else None

    t0 = time.perf_counter()
    progress("loading", 0.02, "Loading image\u2026")
    try:
        image = image_or_path if isinstance(image_or_path, np.ndarray) else load_image(image_or_path)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Could not decode image: {exc}") from exc
    if isinstance(image, np.ndarray) and image.size == 0:
        raise ValueError("Empty image array (zero pixels).")

    progress("preprocessing", 0.10, "Preprocessing (threshold + skeletonize)\u2026")
    color_mode = bool(cfg.enable_fill and cfg.color_count > 0
                      and color_mod.is_colorful(image, cfg))
    if color_mode:
        regions, bg = color_mod.vectorize(image, cfg)
        pre = Preprocessed(
            original=image,
            gray=cv2.cvtColor(image, cv2.COLOR_BGR2GRAY),
            binary=np.zeros(image.shape[:2], np.uint8),
            skeleton=np.zeros(image.shape[:2], np.uint8),
            scale=1.0, stroke_thickness=1.0, ink_ratio=0.0,
            fills=regions, paper_rgb=bg, color_mode=True,
        )
    else:
        pre = preprocess(image, cfg)
    timings["preprocess"] = time.perf_counter() - t0
    fill_points = sum(len(c.points) for f in pre.fills for c in f.contours)
    if not pre.color_mode and (fill_points > 120_000 or len(pre.fills) > 300):
        raise NoStrokesDetected(
            "This looks like a photo or a very noisy scan rather than line art "
            f"({len(pre.fills)} solid regions, {fill_points} contour points)."
        )
    if np.count_nonzero(pre.skeleton) < 10 and not pre.fills:
        raise NoStrokesDetected(
            "No strokes detected. The image looks blank or extremely low contrast \u2014 "
            "try a higher-contrast line drawing, or a darker pen."
        )

    # Dense-ink guard: line art covers a few percent of the canvas. Photos,
    # gradients and uniform noise come out at 25%+ ink with a dense skeleton
    # and would otherwise hang tracing/fitting for minutes.
    skel_density = float(np.count_nonzero(pre.skeleton)) / pre.skeleton.size
    # Dense skeletons are noise/photos; high ink is fine only when a few solid
    # fills explain it (a logo) rather than a dense line network.
    too_dense = (not pre.color_mode) and (
        skel_density > 0.08
        or (pre.ink_ratio > 0.25 and not (pre.fills and skel_density < 0.02))
    )
    if too_dense:
        raise NoStrokesDetected(
            f"No clean strokes found (ink {pre.ink_ratio:.1%} of pixels, "
            f"skeleton {skel_density:.1%}). This looks like a photo, gradient or "
            "noise rather than line art \u2014 try a higher-contrast line drawing."
        )

    if debug_image:
        if os.path.isdir(debug_image):
            raise OSError(f"debug image path is a directory: {debug_image!r}")
        render_mod.render_debug(pre, debug_image)

    t1 = time.perf_counter()
    progress("tracing", 0.28, "Detecting strokes\u2026")
    strokes = trace_strokes(pre, cfg)
    strokes.extend(_fill_strokes(pre, cfg))
    timings["trace"] = time.perf_counter() - t1
    if not strokes:
        raise NoStrokesDetected(
            "No strokes or filled regions detected \u2014 every traced path was "
            f"shorter than min_stroke_length ({cfg.min_stroke_length}px). Try a "
            "higher-contrast or larger image."
        )
    progress("tracing", 0.35, f"Detected {len(strokes)} stroke(s)")
    ink.assign_stroke_colors(pre.original, strokes)

    t2 = time.perf_counter()
    stroke_segments: list[list[Segment]] = []
    total = len(strokes)
    for i, stroke in enumerate(strokes):
        if pre.color_mode and stroke.filled:
            try:
                fit = models.fit_closed_spline(
                    stroke.points, cfg, smoothing=cfg.color_spline_smoothing)
                segments = [Segment(
                    segment_id=1, start_index=0, end_index=len(stroke.points) - 1,
                    points=stroke.points, fit=fit, length=stroke.length, closed=True,
                )]
            except Exception:
                segments = segment_stroke(stroke, cfg)
        else:
            segments = segment_stroke(stroke, cfg)
        stroke_segments.append(segments)
        frac = 0.35 + 0.5 * (i + 1) / total
        progress("fitting", frac, f"Fitting curves\u2026 stroke {i + 1}/{total}")
    timings["fit"] = time.perf_counter() - t2

    # Drop strokes that produced no usable segments, then renumber.
    kept = [(s, segs) for s, segs in zip(strokes, stroke_segments) if segs]
    if not kept:
        raise NoStrokesDetected("Strokes were found but none could be fitted. Try the 'simple' preset.")
    strokes = []
    stroke_segments = []
    for new_id, (stroke, segs) in enumerate(kept, start=1):
        stroke.stroke_id = new_id
        strokes.append(stroke)
        stroke_segments.append(segs)

    t3 = time.perf_counter()
    progress("rendering", 0.88, "Rendering result\u2026")
    total_segments = sum(len(s) for s in stroke_segments)
    title = f"Chawk \u2014 {len(strokes)} strokes, {total_segments} equations"
    image_path = None
    if output_image:
        if os.path.isdir(output_image):
            raise OSError(f"output image path is a directory: {output_image!r} "
                          f"(did you mean {output_image.rstrip(os.sep) + '.png'}?)")
        os.makedirs(os.path.dirname(os.path.abspath(output_image)) or ".", exist_ok=True)
        image_path = render_mod.render(pre, strokes, stroke_segments, cfg, output_image, title=title)
    timings["render"] = time.perf_counter() - t3
    timings["total"] = time.perf_counter() - t0

    report = _sanitize_json(_summarize(strokes, stroke_segments, cfg, pre, source, timings))

    json_path = None
    if output_json:
        if os.path.isdir(output_json):
            raise OSError(f"output JSON path is a directory: {output_json!r}")
        os.makedirs(os.path.dirname(os.path.abspath(output_json)) or ".", exist_ok=True)
        with open(output_json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False, allow_nan=False)
        json_path = output_json

    progress("done", 1.0, "Done")
    return Result(
        report=report, strokes=strokes, stroke_segments=stroke_segments,
        preprocessed=pre, config=cfg, image_path=image_path, json_path=json_path,
        timings=timings,
    )
