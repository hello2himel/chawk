"""Small geometry helpers shared by the segmentation and fitting stages."""

from __future__ import annotations

import numpy as np


def polyline_length(points: np.ndarray) -> float:
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def arc_length_param(points: np.ndarray) -> np.ndarray:
    """Cumulative arc length of a polyline, starting at 0."""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 2:
        return np.zeros(len(pts))
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


def point_to_polyline_distance(points: np.ndarray, polyline: np.ndarray) -> np.ndarray:
    """Shortest Euclidean distance from each point to a dense polyline.

    Used as the single, model-agnostic error metric so that ``y = f(x)``
    fits, arcs, and splines are all judged on the same geometric scale.
    """
    p = np.asarray(points, dtype=np.float64)
    q = np.asarray(polyline, dtype=np.float64)
    if len(q) == 0:
        return np.full(len(p), np.inf)
    if len(q) == 1:
        return np.linalg.norm(p - q[0], axis=1)

    a = q[:-1]                    # (M, 2) segment starts
    ab = q[1:] - a                # (M, 2) segment vectors
    denom = np.einsum("ij,ij->i", ab, ab)
    denom = np.where(denom < 1e-12, 1e-12, denom)

    out = np.empty(len(p), dtype=np.float64)
    chunk = max(1, int(4_000_000 // max(len(a), 1)))
    for start in range(0, len(p), chunk):
        block = p[start:start + chunk]
        ap = block[:, None, :] - a[None, :, :]           # (B, M, 2)
        t = np.einsum("bmj,mj->bm", ap, ab) / denom      # (B, M)
        np.clip(t, 0.0, 1.0, out=t)
        proj = a[None, :, :] + t[:, :, None] * ab[None, :, :]
        d = np.linalg.norm(block[:, None, :] - proj, axis=2)
        out[start:start + chunk] = d.min(axis=1)
    return out


def rdp_indices(points: np.ndarray, epsilon: float) -> list[int]:
    """Ramer-Douglas-Peucker, returning the indices of retained vertices."""
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if n <= 2:
        return list(range(n))

    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        seg = pts[i:j + 1]
        a, b = pts[i], pts[j]
        ab = b - a
        norm = np.linalg.norm(ab)
        if norm < 1e-12:
            d = np.linalg.norm(seg - a, axis=1)
        else:
            # 2D cross magnitude (np.cross on 2-vectors is deprecated in NumPy 2.0).
            rel = seg - a
            d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / norm
        k = int(np.argmax(d))
        if d[k] > epsilon:
            idx = i + k
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return list(np.flatnonzero(keep))


def turn_angles(points: np.ndarray) -> np.ndarray:
    """Absolute turn angle (radians) at each interior vertex of a polyline."""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 3:
        return np.zeros(max(0, len(pts) - 2))
    v1 = pts[1:-1] - pts[:-2]
    v2 = pts[2:] - pts[1:-1]
    n1 = np.linalg.norm(v1, axis=1)
    n2 = np.linalg.norm(v2, axis=1)
    ok = (n1 > 1e-9) & (n2 > 1e-9)
    cos = np.ones(len(v1))
    cos[ok] = np.einsum("ij,ij->i", v1[ok], v2[ok]) / (n1[ok] * n2[ok])
    return np.arccos(np.clip(cos, -1.0, 1.0))


def local_curvature(points: np.ndarray, window: int = 5) -> np.ndarray:
    """Signed curvature estimated from finite differences of a smooth path."""
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if n < 3:
        return np.zeros(n)
    s = arc_length_param(pts)
    # Guard against zero-length steps when differentiating.
    ds = np.gradient(s)
    ds[np.abs(ds) < 1e-9] = 1e-9
    dx = np.gradient(pts[:, 0]) / ds
    dy = np.gradient(pts[:, 1]) / ds
    ddx = np.gradient(dx) / ds
    ddy = np.gradient(dy) / ds
    denom = np.power(dx * dx + dy * dy, 1.5)
    denom[denom < 1e-12] = 1e-12
    k = (dx * ddy - dy * ddx) / denom
    if window and window >= 3 and n > window:
        w = int(window) | 1
        kernel = np.ones(w) / w
        pad = w // 2
        k = np.convolve(np.pad(k, pad, mode="edge"), kernel, mode="valid")
    return k


def is_steep(points: np.ndarray) -> bool:
    """True when the segment spans more vertically than horizontally."""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 2:
        return False
    span = pts.max(axis=0) - pts.min(axis=0)
    return bool(span[1] > span[0])


def bbox(points: np.ndarray) -> tuple[float, float, float, float]:
    pts = np.asarray(points, dtype=np.float64)
    return (float(pts[:, 0].min()), float(pts[:, 1].min()),
            float(pts[:, 0].max()), float(pts[:, 1].max()))
