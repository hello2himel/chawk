"""Stage 2: turn a 1px skeleton mask into ordered, resampled stroke paths.

The skeleton is converted into a pixel graph whose nodes are endpoints and
junctions and whose edges are the degree-2 chains between them.  Edges are then
stitched back together *through* junctions by direction continuity, which is
what stops a self-intersecting curve from turning onto the crossing branch.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import Config

_OFFSETS = (
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1), (0, 1),
    (1, -1), (1, 0), (1, 1),
)


@dataclass
class Stroke:
    stroke_id: int
    points: np.ndarray
    """(N, 2) float array of (x, y) in *original image* pixel coordinates."""

    closed: bool
    length: float
    raw_point_count: int
    merged_from: int = 1
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# pixel graph
# --------------------------------------------------------------------------

@dataclass
class _Edge:
    node_a: int
    node_b: int          # -1 for a dangling chain, -2 for a closed loop
    pixels: np.ndarray   # (N, 2) int array of (row, col), ordered a -> b
    length: float
    alive: bool = True


def _degree_map(skel: np.ndarray) -> np.ndarray:
    binary = (skel > 0).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    kernel[1, 1] = 0
    neighbours = cv2.filter2D(binary, cv2.CV_16S, kernel, borderType=cv2.BORDER_CONSTANT)
    return np.where(binary > 0, neighbours, np.int16(-1))


def _polyline_length(pixels: np.ndarray) -> float:
    if len(pixels) < 2:
        return 0.0
    d = np.diff(pixels.astype(np.float64), axis=0)
    return float(np.hypot(d[:, 0], d[:, 1]).sum())


def _build_graph(skel: np.ndarray, cfg: Config) -> tuple[list[_Edge], np.ndarray]:
    """Return (edges, node_label_map). Node label 0 means 'not a node pixel'."""
    binary = skel > 0
    degree = _degree_map(skel)

    # Node pixels: endpoints (deg 1) and junctions (deg >= 3). Adjacent node
    # pixels are grouped into a single node so fat junctions behave sanely.
    node_mask = (binary & ((degree == 1) | (degree >= 3))).astype(np.uint8)
    n_nodes, node_labels = cv2.connectedComponents(node_mask, connectivity=8)

    h, w = skel.shape
    visited = np.zeros((h, w), dtype=bool)
    edges: list[_Edge] = []
    seen_direct: set[tuple[int, int]] = set()

    def neighbours(r: int, c: int):
        for dr, dc in _OFFSETS:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and binary[rr, cc]:
                yield rr, cc

    def walk(start_node: int, r0: int, c0: int, sr: int, sc: int):
        """Walk the degree-2 chain that starts at (r0, c0) leaving node pixel
        (sr, sc). Returns an _Edge or None."""
        chain = [(sr, sc), (r0, c0)]
        prev = (sr, sc)
        cur = (r0, c0)
        while True:
            if node_labels[cur] != 0:
                return _Edge(start_node, int(node_labels[cur]), np.array(chain, dtype=np.int32),
                             _polyline_length(np.array(chain, dtype=np.float64)))
            visited[cur] = True
            nxt = None
            for cand in neighbours(*cur):
                if cand == prev or visited[cand]:
                    continue
                nxt = cand
                break
            if nxt is None:
                # Dead end, or the chain closed back on an already-visited pixel.
                return _Edge(start_node, -1, np.array(chain, dtype=np.int32),
                             _polyline_length(np.array(chain, dtype=np.float64)))
            chain.append(nxt)
            prev, cur = cur, nxt

    node_pixels = np.argwhere(node_mask > 0)
    for r, c in node_pixels:
        r, c = int(r), int(c)
        label = int(node_labels[r, c])
        for rr, cc in neighbours(r, c):
            if node_labels[rr, cc] == label:
                continue  # inside the same node cluster
            if node_labels[rr, cc] != 0:
                # Two node clusters touching directly: a zero-interior edge.
                other = int(node_labels[rr, cc])
                key = (min(label, other), max(label, other))
                if key in seen_direct:
                    continue
                seen_direct.add(key)
                pix = np.array([(r, c), (rr, cc)], dtype=np.int32)
                edges.append(_Edge(label, other, pix, _polyline_length(pix.astype(np.float64))))
                continue
            if visited[rr, cc]:
                continue
            edges.append(walk(label, rr, cc, r, c))

    # Remaining unvisited degree-2 pixels belong to closed loops.
    loop_candidates = np.argwhere(binary & (degree == 2) & (~visited))
    for r, c in loop_candidates:
        r, c = int(r), int(c)
        if visited[r, c]:
            continue
        chain = [(r, c)]
        visited[r, c] = True
        prev = None
        cur = (r, c)
        while True:
            nxt = None
            for cand in neighbours(*cur):
                if cand == prev or visited[cand]:
                    continue
                nxt = cand
                break
            if nxt is None:
                break
            visited[nxt] = True
            chain.append(nxt)
            prev, cur = cur, nxt
        pix = np.array(chain, dtype=np.int32)
        if len(pix) >= 4:
            edges.append(_Edge(-2, -2, pix, _polyline_length(pix.astype(np.float64))))

    return edges, node_labels


def _prune_spurs(edges: list[_Edge], cfg: Config) -> None:
    """Iteratively drop short dead-end twigs hanging off junctions."""
    if cfg.prune_spur_length <= 0:
        return
    for _ in range(6):
        incident: dict[int, list[int]] = {}
        for i, e in enumerate(edges):
            if not e.alive:
                continue
            for node in (e.node_a, e.node_b):
                if node >= 0:
                    incident.setdefault(node, []).append(i)
        removed = 0
        for i, e in enumerate(edges):
            if not e.alive or e.length > cfg.prune_spur_length:
                continue
            ends = [n for n in (e.node_a, e.node_b) if n >= 0]
            dangling = e.node_b == -1 or any(len(incident.get(n, ())) == 1 for n in ends)
            junctioned = any(len(incident.get(n, ())) >= 3 for n in ends)
            if dangling and junctioned:
                e.alive = False
                removed += 1
        if removed == 0:
            return


def _end_direction(pixels: np.ndarray, at_start: bool, span: int = 7) -> np.ndarray:
    """Unit vector pointing *away* from the given end of the chain, in (x, y)."""
    pts = pixels.astype(np.float64)
    k = min(span, len(pts))
    if k < 2:
        return np.array([0.0, 0.0])
    seg = pts[:k] if at_start else pts[-k:][::-1]
    # (row, col) -> (x, y)
    vec = np.array([seg[-1, 1] - seg[0, 1], seg[-1, 0] - seg[0, 0]])
    norm = np.linalg.norm(vec)
    if norm < 1e-9:
        return np.array([0.0, 0.0])
    return -vec / norm if at_start else -vec / norm


def _pair_through_junctions(edges: list[_Edge], cfg: Config) -> dict[tuple[int, int], tuple[int, int]]:
    """Greedily pair up half-edges at each junction by straightness."""
    node_ends: dict[int, list[tuple[int, int]]] = {}
    for i, e in enumerate(edges):
        if not e.alive:
            continue
        if e.node_a >= 0:
            node_ends.setdefault(e.node_a, []).append((i, 0))
        if e.node_b >= 0:
            node_ends.setdefault(e.node_b, []).append((i, 1))

    max_dev = np.deg2rad(cfg.junction_link_angle)
    pairing: dict[tuple[int, int], tuple[int, int]] = {}

    for ends in node_ends.values():
        if len(ends) < 2:
            continue
        dirs = {}
        for eid, side in ends:
            # Direction pointing away from the node along the edge.
            pixels = edges[eid].pixels
            k = min(7, len(pixels))
            pts = pixels.astype(np.float64)
            if side == 0:
                vec = np.array([pts[k - 1, 1] - pts[0, 1], pts[k - 1, 0] - pts[0, 0]])
            else:
                vec = np.array([pts[-k, 1] - pts[-1, 1], pts[-k, 0] - pts[-1, 0]])
            n = np.linalg.norm(vec)
            dirs[(eid, side)] = vec / n if n > 1e-9 else np.array([0.0, 0.0])

        candidates = []
        for a in range(len(ends)):
            for b in range(a + 1, len(ends)):
                ea, eb = ends[a], ends[b]
                if ea[0] == eb[0]:
                    continue  # don't glue an edge to itself
                da, db = dirs[ea], dirs[eb]
                if np.linalg.norm(da) < 1e-9 or np.linalg.norm(db) < 1e-9:
                    continue
                # Straight-through means the two outward directions oppose.
                dev = np.arccos(np.clip(float(np.dot(da, -db)), -1.0, 1.0))
                if dev <= max_dev:
                    candidates.append((dev, ea, eb))
        candidates.sort(key=lambda t: t[0])
        taken: set[tuple[int, int]] = set()
        for _dev, ea, eb in candidates:
            if ea in taken or eb in taken:
                continue
            pairing[ea] = eb
            pairing[eb] = ea
            taken.add(ea)
            taken.add(eb)
    return pairing


def _chain_edges(edges: list[_Edge], pairing: dict) -> list[np.ndarray]:
    """Follow the pairing to concatenate edges into long polylines."""
    used: set[int] = set()
    polylines: list[np.ndarray] = []

    for eid, edge in enumerate(edges):
        if not edge.alive or eid in used:
            continue
        chain: deque[tuple[int, bool]] = deque([(eid, False)])
        seen = {eid}

        cur = (eid, 0)
        while cur in pairing:
            e2, s2 = pairing[cur]
            if e2 in seen:
                break
            chain.appendleft((e2, s2 == 0))
            seen.add(e2)
            cur = (e2, 1 - s2)

        cur = (eid, 1)
        while cur in pairing:
            e2, s2 = pairing[cur]
            if e2 in seen:
                break
            chain.append((e2, s2 == 1))
            seen.add(e2)
            cur = (e2, 1 - s2)

        used |= seen
        parts = []
        for e_id, reverse in chain:
            pix = edges[e_id].pixels
            pix = pix[::-1] if reverse else pix
            if parts and len(parts[-1]) and np.array_equal(parts[-1][-1], pix[0]):
                pix = pix[1:]
            if len(pix):
                parts.append(pix)
        if parts:
            polylines.append(np.vstack(parts))
    return polylines


# --------------------------------------------------------------------------
# gap merging / resampling
# --------------------------------------------------------------------------

def _tangent(points: np.ndarray, at_start: bool, span: int = 9) -> np.ndarray:
    k = min(span, len(points))
    if k < 2:
        return np.array([0.0, 0.0])
    if at_start:
        vec = points[0] - points[k - 1]
    else:
        vec = points[-1] - points[-k]
    n = np.linalg.norm(vec)
    return vec / n if n > 1e-9 else np.array([0.0, 0.0])


def _merge_broken_paths(paths: list[np.ndarray], cfg: Config) -> tuple[list[np.ndarray], list[int]]:
    """Join paths whose endpoints nearly touch and whose tangents agree.

    Handles dashed lines and anti-aliasing breaks.

    Uses a uniform-grid spatial hash over endpoints so the pairwise search is
    roughly linear instead of quadratic. Without it, noise/photo inputs that
    produce thousands of tiny paths hang the pipeline.
    """
    if cfg.merge_endpoint_distance <= 0 or len(paths) < 2:
        return paths, [1] * len(paths)

    items = [p.astype(np.float64) for p in paths]
    counts = [1] * len(items)
    max_dist = cfg.merge_endpoint_distance
    max_ang = np.deg2rad(cfg.merge_endpoint_angle)
    cell = max(max_dist, 1e-6)

    def endpoints(idx: int) -> tuple[np.ndarray, np.ndarray]:
        p = items[idx]
        return p[0], p[-1]

    changed = True
    # Each round merges exactly one pair, so at most len(items)-1 merges happen;
    # the loop always terminates. (The spatial hash above keeps each round cheap.)
    while changed and len(items) > 1:
        changed = False
        # Build grid: cell -> list of (path_idx, side, point).
        grid: dict[tuple[int, int], list[tuple[int, int, np.ndarray]]] = {}
        for i, p in enumerate(items):
            if len(p) < 2:
                continue
            for side, pt in ((0, p[0]), (1, p[-1])):
                key = (int(np.floor(pt[0] / cell)), int(np.floor(pt[1] / cell)))
                grid.setdefault(key, []).append((i, side, pt))
        # Cache outward tangents per (path, side).
        tang: dict[tuple[int, int], np.ndarray] = {}

        def outward(i: int, side: int) -> np.ndarray:
            key = (i, side)
            t = tang.get(key)
            if t is None:
                t = _tangent(items[i], side == 0)
                tang[key] = t
            return t

        best = None  # (score, i, j, flip_i, flip_j)
        for i, pi in enumerate(items):
            if len(pi) < 2:
                continue
            for si, ei in ((0, pi[0]), (1, pi[-1])):
                cx, cy = int(np.floor(ei[0] / cell)), int(np.floor(ei[1] / cell))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for j, sj, ej in grid.get((cx + dx, cy + dy), ()):
                            if j <= i:
                                continue  # each unordered pair once
                            pj = items[j]
                            if len(pj) < 2:
                                continue
                            dist = float(np.linalg.norm(ei - ej))
                            if dist > max_dist:
                                continue
                            ti = outward(i, si)
                            tj = outward(j, sj)
                            if np.linalg.norm(ti) < 1e-9 or np.linalg.norm(tj) < 1e-9:
                                continue
                            # Outward tangents should oppose for a clean join.
                            ang = np.arccos(np.clip(float(np.dot(ti, -tj)), -1.0, 1.0))
                            if ang > max_ang:
                                continue
                            score = dist + np.rad2deg(ang) * 0.15
                            if best is None or score < best[0]:
                                best = (score, i, j, si, sj)
        if best is not None:
            _score, i, j, si, sj = best
            pi = items[i][::-1] if si == 0 else items[i]
            pj = items[j][::-1] if sj == 1 else items[j]
            items[i] = np.vstack([pi, pj])
            counts[i] += counts[j]
            del items[j]
            del counts[j]
            changed = True

    return items, counts


def _dedupe(points: np.ndarray) -> np.ndarray:
    if len(points) < 2:
        return points
    keep = np.ones(len(points), dtype=bool)
    d = np.linalg.norm(np.diff(points, axis=0), axis=1)
    keep[1:] = d > 1e-9
    return points[keep]


def resample_path(points: np.ndarray, spacing: float, closed: bool) -> np.ndarray:
    """Resample a polyline to (roughly) uniform arc-length spacing."""
    pts = _dedupe(np.asarray(points, dtype=np.float64))
    if len(pts) < 2:
        return pts
    if closed and np.linalg.norm(pts[0] - pts[-1]) > 1e-9:
        pts = np.vstack([pts, pts[0]])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(s[-1])
    if total < 1e-9:
        return pts[:1]
    n = max(2, int(round(total / max(spacing, 0.25))) + 1)
    targets = np.linspace(0.0, total, n)
    x = np.interp(targets, s, pts[:, 0])
    y = np.interp(targets, s, pts[:, 1])
    return np.column_stack([x, y])


def smooth_path(points: np.ndarray, window: int, closed: bool) -> np.ndarray:
    """Moving-average smoothing that preserves the endpoints of open paths."""
    n = len(points)
    if window is None or window < 3 or n < window + 2:
        return points
    w = int(window) | 1
    half = w // 2
    kernel = np.ones(w) / w
    if closed:
        padded = np.vstack([points[-half:], points, points[:half]])
    else:
        padded = np.vstack([
            np.repeat(points[:1], half, axis=0), points, np.repeat(points[-1:], half, axis=0)
        ])
    sx = np.convolve(padded[:, 0], kernel, mode="valid")
    sy = np.convolve(padded[:, 1], kernel, mode="valid")
    out = np.column_stack([sx, sy])
    if not closed:
        # Blend back toward the true endpoints so the extremes don't shrink in.
        ramp = np.linspace(0.0, 1.0, min(half + 1, n))
        for idx, t in enumerate(ramp):
            out[idx] = points[idx] * (1 - t) + out[idx] * t
            out[-1 - idx] = points[-1 - idx] * (1 - t) + out[-1 - idx] * t
    return out


def trace_strokes(pre, cfg: Config) -> list[Stroke]:
    """Extract ordered strokes from a preprocessed image.

    Returned point coordinates are in the *original* image pixel space.
    """
    edges, _node_labels = _build_graph(pre.skeleton, cfg)
    if not edges:
        return []

    _prune_spurs(edges, cfg)
    pairing = _pair_through_junctions(edges, cfg)
    polylines_rc = _chain_edges(edges, pairing)

    # (row, col) -> (x, y)
    raw_paths = []
    for pl in polylines_rc:
        pts = np.column_stack([pl[:, 1], pl[:, 0]]).astype(np.float64)
        pts = _dedupe(pts)
        if len(pts) >= 2:
            raw_paths.append(pts)

    # Drop sub-pixel specks before gap merging: they can number in the
    # thousands on noise/photo inputs and make merging quadratic. Real dashes
    # are an order of magnitude longer, so a 2px floor is safe.
    if len(raw_paths) > 400:
        kept_paths = [p for p in raw_paths if _polyline_length(p) >= 2.0]
        # Never drop everything; if all are specks there is nothing to merge.
        if kept_paths:
            raw_paths = kept_paths

    merged, merge_counts = _merge_broken_paths(raw_paths, cfg)

    inv_scale = 1.0 / pre.scale if pre.scale else 1.0
    closed_tol = max(2.5, 1.5 * pre.stroke_thickness)

    strokes: list[Stroke] = []
    scored: list[tuple[float, np.ndarray, int]] = []
    for pts, count in zip(merged, merge_counts):
        length = _polyline_length(pts)
        if length < cfg.min_stroke_length:
            continue
        scored.append((length, pts, count))

    scored.sort(key=lambda t: -t[0])
    if cfg.max_strokes and len(scored) > cfg.max_strokes:
        scored = scored[: cfg.max_strokes]

    for length, pts, count in scored:
        closed = bool(len(pts) > 6 and np.linalg.norm(pts[0] - pts[-1]) <= closed_tol
                      and length > 4 * closed_tol)
        raw_count = len(pts)
        pts = resample_path(pts, cfg.resample_spacing, closed)
        pts = smooth_path(pts, cfg.smoothing_window, closed)
        if len(pts) < 3:
            continue
        pts_orig = pts * inv_scale
        strokes.append(Stroke(
            stroke_id=len(strokes) + 1,
            points=pts_orig,
            closed=closed,
            length=_polyline_length(pts_orig),
            raw_point_count=raw_count,
            merged_from=count,
        ))

    return strokes
