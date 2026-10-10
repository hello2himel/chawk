"""Stage 3: split a stroke into the fewest segments that still fit accurately.

Approach:

1. Find *forced* break points at genuine corners (RDP vertices whose turn angle
   exceeds ``corner_angle``).  A corner can never be represented by a smooth
   model, so splitting there is free.
2. Inside each corner-to-corner piece, grow segments greedily: from the current
   start, take the **longest** span whose best fit still meets the error budget
   (exponential probe + binary search).  Greedy-longest is what keeps the
   segment count minimal rather than maximal.
3. Absorb runt segments into a neighbour, refitting the union.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import geom
from .config import Config
from .models import FitResult, fit_segment


@dataclass
class Segment:
    segment_id: int
    start_index: int
    end_index: int
    points: np.ndarray
    fit: FitResult
    length: float
    closed: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self, precision: int = 4) -> dict[str, Any]:
        pts = self.points
        x0, y0, x1, y1 = geom.bbox(pts)

        def r(v: float) -> float | None:
            # JSON-safe rounding: inf/nan become None instead of `Infinity`.
            try:
                f = float(v)
            except (TypeError, ValueError):
                return None
            if not np.isfinite(f):
                return None
            return round(f, precision)

        params = {}
        for key, value in self.fit.params.items():
            if isinstance(value, float):
                params[key] = r(value)
            elif isinstance(value, list):
                clean = []
                for v in value:
                    if isinstance(v, bool):
                        clean.append(v)
                    elif isinstance(v, (int, float)):
                        f = float(v)
                        clean.append(round(f, precision) if np.isfinite(f) else None)
                    else:
                        clean.append(v)
                params[key] = clean
            else:
                params[key] = value

        domain = dict(self.fit.domain)
        for key in ("start", "end"):
            if key in domain and isinstance(domain[key], float):
                domain[key] = r(domain[key])

        return {
            "segment_id": self.segment_id,
            "model": self.fit.model,
            "equation": self.fit.equation,
            "params": params,
            "domain": domain,
            "x_range": [r(x0), r(x1)],
            "y_range": [r(y0), r(y1)],
            "pixel_start": [r(pts[0][0]), r(pts[0][1])],
            "pixel_end": [r(pts[-1][0]), r(pts[-1][1])],
            "point_count": int(len(pts)),
            "arc_length": r(self.length),
            "r_squared": round(float(self.fit.r_squared), 6),
            "rmse": r(self.fit.rmse),
            "max_error": r(self.fit.max_error),
            "bic": round(float(self.fit.bic), 3) if np.isfinite(self.fit.bic) else None,
            "closed": bool(self.closed),
            "notes": list(self.notes),
        }


def _acceptable(fit: FitResult, cfg: Config) -> bool:
    return (np.isfinite(fit.rmse) and fit.rmse <= cfg.rmse_tolerance
            and fit.max_error <= cfg.max_error_tolerance)


def _tangent_angle_change(pts: np.ndarray, index: int, k: int) -> float:
    """Angle (radians) between the incoming and outgoing tangent at ``index``,
    measured over a window of ``k`` points on each side."""
    n = len(pts)
    i0 = max(0, index - k)
    i1 = min(n - 1, index + k)
    if i0 == index or i1 == index:
        return 0.0
    v1 = pts[index] - pts[i0]
    v2 = pts[i1] - pts[index]
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return 0.0
    cos = float(np.dot(v1, v2) / (n1 * n2))
    return float(np.arccos(np.clip(cos, -1.0, 1.0)))


def find_corners(points: np.ndarray, cfg: Config, closed: bool) -> list[int]:
    """Indices of hard corners where a smooth model must be broken.

    A large turn angle alone is not enough: a tight circular arc also turns
    sharply, and splitting it would waste segments.  The discriminator is how
    the turn scales with the measurement window.  At a true corner the tangent
    change is a discontinuity, so it is already fully present in a small
    window; along a smooth arc the change grows in proportion to the window.
    We therefore require both a large small-window angle *and* that widening
    the window does not reveal much more turning.
    """
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if n < 7:
        return []
    keep = geom.rdp_indices(pts, max(cfg.rdp_epsilon, 0.5))
    if len(keep) < 3:
        return []

    spacing = max(cfg.resample_spacing, 0.5)
    k_small = max(2, int(round(cfg.corner_window / spacing)))
    k_large = k_small * 3
    threshold = np.deg2rad(cfg.corner_angle)
    min_gap = max(cfg.min_segment_points // 2, 3)

    corners: list[int] = []
    for idx in keep[1:-1]:
        idx = int(idx)
        if idx < min_gap or idx > n - 1 - min_gap:
            continue
        small = _tangent_angle_change(pts, idx, k_small)
        if small < threshold:
            continue
        large = _tangent_angle_change(pts, idx, k_large)
        # Smooth arc: `large` is much bigger than `small`. Corner: they match.
        if large > 1e-6 and small < cfg.corner_concentration * large:
            continue
        if corners and idx - corners[-1] < min_gap:
            # Keep the sharper of two nearby candidates.
            if small > _tangent_angle_change(pts, corners[-1], k_small):
                corners[-1] = idx
            continue
        corners.append(idx)
    return corners


def _grow_segments(points: np.ndarray, cfg: Config, offset: int,
                   closed: bool) -> list[tuple[int, int, FitResult]]:
    """Greedy longest-acceptable-span segmentation over one open piece.

    Two details matter for keeping the segment count minimal:

    * Growth probes with ``allow_spline=False``.  A smoothing spline can fit
      almost anything, so leaving it enabled would make every probe "succeed"
      and the reported boundary would be meaningless.
    * Before probing incrementally we test the **whole** remaining span.
      Acceptability is not monotonic in span length: half a sine hump needs a
      cubic and fails, while the full wave is a clean 4-parameter sinusoid.
      Without this check a greedy left-to-right probe would never discover the
      global model.
    """
    n = len(points)
    out: list[tuple[int, int, FitResult]] = []
    start = 0
    min_pts = max(4, int(cfg.min_segment_points))
    budget = max(1, int(cfg.max_segments_per_stroke))

    while start < n - 1:
        remaining = n - start
        if remaining <= min_pts + 1 or len(out) >= budget - 1:
            fit = fit_segment(points[start:], cfg, closed=closed)
            out.append((offset + start, offset + n - 1, fit))
            break

        # 1) Can one closed-form equation cover everything that is left?
        whole = fit_segment(points[start:], cfg, closed=closed, allow_spline=False)
        if _acceptable(whole, cfg):
            out.append((offset + start, offset + n - 1, whole))
            break

        # 2) Exponential probe for the last known-good end index.
        good_end = -1
        good_fit: FitResult | None = None
        end = min(n - 1, start + min_pts)
        while True:
            candidate = fit_segment(points[start:end + 1], cfg, closed=False, allow_spline=False)
            if _acceptable(candidate, cfg):
                good_end, good_fit = end, candidate
                if end >= n - 1:
                    break
                step = max(min_pts, (end - start))
                end = min(n - 1, end + step)
            else:
                break

        if good_end < 0:
            # Even the minimum span misses the budget: emit it anyway, this
            # time letting the spline fallback in so the report stays honest.
            end = min(n - 1, start + min_pts)
            fit = fit_segment(points[start:end + 1], cfg, closed=False)
            out.append((offset + start, offset + end, fit))
            start = end
            continue

        if good_end < n - 1:
            # Binary search the true boundary between good_end and the failure.
            lo, hi = good_end, min(n - 1, end)
            while hi - lo > 1:
                mid = (lo + hi) // 2
                candidate = fit_segment(points[start:mid + 1], cfg, closed=False,
                                        allow_spline=False)
                if _acceptable(candidate, cfg):
                    lo, good_fit = mid, candidate
                else:
                    hi = mid
            good_end = lo

        assert good_fit is not None
        out.append((offset + start, offset + good_end, good_fit))
        if good_end >= n - 1:
            break
        start = good_end  # segments share a boundary point so curves connect

    return out


def _merge_runts(points: np.ndarray, spans: list[tuple[int, int, FitResult]],
                 cfg: Config) -> list[tuple[int, int, FitResult]]:
    """Absorb too-short segments into whichever neighbour tolerates them."""
    if len(spans) < 2:
        return spans
    spans = list(spans)
    changed = True
    while changed and len(spans) > 1:
        changed = False
        for i, (a, b, _fit) in enumerate(spans):
            seg_pts = points[a:b + 1]
            too_few = len(seg_pts) < cfg.min_segment_points
            too_short = geom.polyline_length(seg_pts) < cfg.min_segment_length
            if not (too_few or too_short):
                continue
            options = []
            if i > 0:
                options.append(i - 1)
            if i < len(spans) - 1:
                options.append(i + 1)
            best = None
            for j in options:
                lo = min(a, spans[j][0])
                hi = max(b, spans[j][1])
                fit = fit_segment(points[lo:hi + 1], cfg, closed=False, allow_spline=False)
                penalty = 0.0 if _acceptable(fit, cfg) else 1e6
                score = penalty + fit.rmse
                if best is None or score < best[0]:
                    best = (score, j, lo, hi, fit)
            if best is None:
                continue
            _score, j, lo, hi, fit = best
            keep = min(i, j)
            spans[keep] = (lo, hi, fit)
            del spans[max(i, j)]
            changed = True
            break
    return spans


def segment_stroke(stroke, cfg: Config) -> list[Segment]:
    """Segment + fit one traced stroke."""
    pts = np.asarray(stroke.points, dtype=np.float64)
    n = len(pts)
    if n < 3:
        return []

    # A closed shape may be a single circle/ellipse: try that first.
    if stroke.closed:
        whole = fit_segment(pts, cfg, closed=True, allow_spline=False)
        if _acceptable(whole, cfg):
            return [Segment(1, 0, n - 1, pts, whole, geom.polyline_length(pts),
                            closed=True, notes=["closed shape fitted as a single curve"])]

    corners = find_corners(pts, cfg, stroke.closed)
    boundaries = [0] + corners + [n - 1]
    boundaries = sorted(set(boundaries))

    spans: list[tuple[int, int, FitResult]] = []
    for a, b in zip(boundaries[:-1], boundaries[1:]):
        piece = pts[a:b + 1]
        if len(piece) < 2:
            continue
        spans.extend(_grow_segments(piece, cfg, a, closed=False))

    spans = _merge_runts(pts, spans, cfg)

    segments: list[Segment] = []
    for i, (a, b, fit) in enumerate(spans, start=1):
        seg_pts = pts[a:b + 1]
        if len(seg_pts) < 2:
            continue
        notes: list[str] = []
        if fit.model == "spline":
            notes.append("no simple closed form matched; reported as piecewise cubic")
        if not _acceptable(fit, cfg):
            notes.append(f"fit exceeds tolerance (rmse {fit.rmse:.2f}px)")
        if a in corners or b in corners:
            notes.append("bounded by a detected corner")
        segments.append(Segment(i, a, b, seg_pts, fit, geom.polyline_length(seg_pts),
                                closed=False, notes=notes))

    if stroke.closed and segments:
        segments[0].notes.append("stroke is a closed loop")
    return segments
