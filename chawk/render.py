"""Stage 5: render the annotated overlay with Matplotlib."""

from __future__ import annotations

import io
import math

import cv2
import matplotlib
import numpy as np

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import PathPatch  # noqa: E402
from matplotlib.path import Path as MplPath  # noqa: E402
from matplotlib.patheffects import withStroke  # noqa: E402

from . import geom, ink
from .config import Config

_PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080",
    "#f032e6", "#bcf60c", "#fabebe", "#9a6324", "#800000", "#808000",
    "#000075", "#e6beff", "#aaffc3", "#ffd8b1",
]


def _color(index: int) -> str:
    return _PALETTE[index % len(_PALETTE)]


def _label_points(segments, max_labels: int) -> list[int]:
    """Pick which segments get an on-image label (longest ones win)."""
    order = sorted(range(len(segments)), key=lambda i: -segments[i][2])
    return sorted(order[:max_labels])


def _shorten(text: str, limit: int = 46) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "\u2026"


def _place_labels(entries, width, height, fontsize):
    """Greedy non-overlap placement; returns (x, y, anchor_x, anchor_y) tuples."""
    # Approximate label box size in pixels.
    placed: list[tuple[float, float, float, float]] = []
    out = []
    char_w = fontsize * 0.62
    line_h = fontsize * 1.7
    for anchor, text, normal in entries:
        w = char_w * len(text)
        h = line_h
        best = None
        for radius in (14, 26, 42, 64, 92, 130):
            for ang in np.linspace(0, 2 * math.pi, 12, endpoint=False):
                nx = anchor[0] + math.cos(ang) * radius
                ny = anchor[1] + math.sin(ang) * radius
                if normal is not None and radius <= 26:
                    nx = anchor[0] + normal[0] * radius
                    ny = anchor[1] + normal[1] * radius
                x0, y0 = nx - w / 2, ny - h / 2
                if x0 < 2 or y0 < 2 or x0 + w > width - 2 or y0 + h > height - 2:
                    continue
                overlap = any(not (x0 + w < px0 or px0 + pw < x0 or y0 + h < py0 or py0 + ph < y0)
                              for px0, py0, pw, ph in placed)
                score = radius + (1e6 if overlap else 0)
                if best is None or score < best[0]:
                    best = (score, nx, ny, x0, y0, w, h)
            if best is not None and best[0] < 1e6:
                break
        if best is None:
            continue
        _score, nx, ny, x0, y0, w, h = best
        placed.append((x0, y0, w, h))
        out.append((nx, ny, anchor[0], anchor[1], text))
    return out


def _check_render_size(image) -> tuple[int, int]:
    h, w = image.shape[:2]
    if h < 1 or w < 1:
        raise ValueError(f"cannot render empty image ({w}x{h}).")
    # Guard against gigapixel outputs: matplotlib would OOM long before finishing.
    if int(h) * int(w) > 25_000_000:
        raise ValueError(
            f"image too large to render ({w}x{h} = {w*h/1e6:.1f}MP; limit 25MP). "
            "Downscale the input or lower --max-dimension."
        )
    return h, w


def _to_rgb(image) -> "np.ndarray":
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2RGB)
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def _signed_area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _draw_fills(ax, strokes, stroke_segments, cfg: Config) -> None:
    """Fill solid ink regions from their fitted boundary equations.

    Outer contours and holes are wound in opposite directions so the non-zero
    fill rule punches the holes out (a donut, the counter of a letter).
    """
    groups: dict[int, dict] = {}
    for si, segs in enumerate(stroke_segments):
        stroke = strokes[si] if si < len(strokes) else None
        if stroke is None or not getattr(stroke, "filled", False):
            continue
        group = groups.setdefault(stroke.fill_group, {
            "color": stroke.color or "#15161A", "polys": [],
        })
        parts = []
        for seg in segs:
            curve = seg.fit.sample(240)
            if curve is not None and len(curve) >= 2:
                parts.append(curve)
        if not parts:
            continue
        poly = np.vstack(parts)
        if len(poly) < 3:
            continue
        if np.linalg.norm(poly[0] - poly[-1]) > 1e-6:
            poly = np.vstack([poly, poly[0]])
        area = _signed_area(poly)
        want_positive = stroke.fill_role != "hole"
        if (area > 0) != want_positive:
            poly = poly[::-1]
        group["polys"].append(poly)

    for group in groups.values():
        verts: list[np.ndarray] = []
        codes: list[int] = []
        for poly in group["polys"]:
            verts.extend(poly)
            codes.extend([MplPath.MOVETO] + [MplPath.LINETO] * (len(poly) - 2) + [MplPath.CLOSEPOLY])
        if not verts:
            continue
        patch = PathPatch(
            MplPath(np.asarray(verts), codes),
            facecolor=group["color"], edgecolor=group["color"],
            linewidth=0.9, antialiased=True, zorder=2,
        )
        ax.add_patch(patch)


def _build_figure(pre, strokes, stroke_segments, cfg: Config,
                  title: str | None = None, labels: bool | None = None,
                  paper: bool = False):
    """Build the annotated overlay figure (shared by file and bytes output).

    ``labels`` overrides ``cfg.label_equations``: True forces equation labels,
    False suppresses them. This lets callers pre-render both variants so a UI
    can toggle labels instantly without refitting.

    ``paper`` drops the source image and paints the fitted equations alone on
    the drawing's own canvas colour, at the measured pen thickness - a pure
    redraw rather than an overlay.
    """
    image = pre.original
    h, w = _check_render_size(image)
    rgb = _to_rgb(image)
    if paper:
        paper_rgb = getattr(pre, "paper_rgb", None)
        canvas = ink.to_hex(paper_rgb) if paper_rgb else ink.to_hex(ink.background_color(rgb))
    else:
        canvas = "#ffffff"

    dpi = float(cfg.dpi)
    fig = plt.figure(figsize=(w / dpi, h / dpi), dpi=dpi)
    fig.patch.set_facecolor(canvas)
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set_facecolor(canvas)
    if not paper:
        ax.imshow(rgb, extent=(0, w, h, 0), interpolation="antialiased")
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.axis("off")

    line_width = cfg.overlay_linewidth
    if paper:
        # Reproduce the ink width: points -> pixels is dpi/72, so px -> pt is 72/dpi.
        thickness_px = float(pre.stroke_thickness) / (float(pre.scale) or 1.0)
        line_width = max(0.5, thickness_px * 72.0 / dpi)

    _draw_fills(ax, strokes, stroke_segments, cfg)

    flat: list[tuple[int, int, float]] = []  # (stroke_idx, seg_idx, length)
    for si, segs in enumerate(stroke_segments):
        for gi, seg in enumerate(segs):
            flat.append((si, gi, seg.length))

    show_labels = cfg.label_equations if labels is None else bool(labels)
    label_ids = set(_label_points(flat, cfg.max_labels)) if show_labels else set()

    label_entries = []
    for flat_index, (si, gi, _length) in enumerate(flat):
        seg = stroke_segments[si][gi]
        sampled = strokes[si].color if si < len(strokes) else None
        if cfg.color_by == "original" and sampled:
            color = sampled
        else:
            color = _color(si if cfg.color_by != "segment" else flat_index)
        curve = seg.fit.sample(max(60, min(600, 4 * len(seg.points))))
        if curve is None or len(curve) < 2:
            continue
        if not getattr(strokes[si], "filled", False):
            ax.plot(curve[:, 0], curve[:, 1], color=color, linewidth=line_width,
                    alpha=1.0 if paper else 0.95, solid_capstyle="round", zorder=3)

        if flat_index in label_ids:
            mid = curve[len(curve) // 2]
            tangent = curve[min(len(curve) - 1, len(curve) // 2 + 1)] - curve[max(0, len(curve) // 2 - 1)]
            norm = np.linalg.norm(tangent)
            normal = np.array([-tangent[1], tangent[0]]) / norm if norm > 1e-9 else None
            text = _shorten(f"[{seg.fit.model}] {seg.fit.equation}")
            label_entries.append(((float(mid[0]), float(mid[1])), text, normal))

    if label_entries:
        placed = _place_labels(label_entries, w, h, cfg.label_fontsize * dpi / 72.0)
        for (nx, ny, ax_, ay, text), entry in zip(placed, label_entries):
            ax.annotate(
                text, xy=(ax_, ay), xytext=(nx, ny),
                fontsize=cfg.label_fontsize, color="#FFFFFF", ha="center", va="center",
                zorder=6,
                bbox=dict(boxstyle="round,pad=0.26", facecolor="#15161A", edgecolor="#15161A",
                          alpha=0.92, linewidth=0.5),
                arrowprops=dict(arrowstyle="-", color="#15161A", linewidth=0.7,
                                shrinkA=0.0, shrinkB=1.0, alpha=0.9),
                path_effects=[withStroke(linewidth=0.0, foreground="white")],
            )

    if title:
        ax.text(8, 8, title, fontsize=cfg.label_fontsize + 1.5, va="top", ha="left",
                color="#111111", zorder=7,
                bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.85,
                          edgecolor="#888888", linewidth=0.5))

    return fig, dpi


def render(pre, strokes, stroke_segments, cfg: Config, out_path: str,
           title: str | None = None, labels: bool | None = None,
           paper: bool = False) -> str:
    """Draw the original image with fitted curves + equation labels on top."""
    fig, dpi = _build_figure(pre, strokes, stroke_segments, cfg, title=title,
                             labels=labels, paper=paper)
    try:
        fig.savefig(out_path, dpi=dpi, facecolor=fig.get_facecolor())
    except Exception as exc:
        plt.close(fig)
        raise OSError(f"could not write rendered image to {out_path!r}: {exc}") from exc
    plt.close(fig)
    return out_path


def render_png_bytes(pre, strokes, stroke_segments, cfg: Config,
                     title: str | None = None, labels: bool | None = None,
                     paper: bool = False) -> bytes:
    """Same overlay as :func:`render` but returned as in-memory PNG bytes."""
    fig, dpi = _build_figure(pre, strokes, stroke_segments, cfg, title=title,
                             labels=labels, paper=paper)
    try:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, facecolor=fig.get_facecolor())
        return buf.getvalue()
    finally:
        plt.close(fig)


def render_debug(pre, out_path: str) -> str:
    """Side-by-side of the binary mask and the skeleton (useful for tuning)."""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), dpi=110)
    axes[0].imshow(cv2.cvtColor(pre.original, cv2.COLOR_BGR2RGB))
    axes[0].set_title("input")
    axes[1].imshow(pre.binary, cmap="gray")
    axes[1].set_title("binary mask")
    axes[2].imshow(pre.skeleton, cmap="gray")
    axes[2].set_title("skeleton")
    for a in axes:
        a.axis("off")
    fig.tight_layout()
    try:
        fig.savefig(out_path, facecolor="white")
    except Exception as exc:
        plt.close(fig)
        raise OSError(f"could not write debug image to {out_path!r}: {exc}") from exc
    plt.close(fig)
    return out_path


def render_debug_bytes(pre) -> bytes:
    """Same side-by-side debug figure as :func:`render_debug`, in memory."""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), dpi=110)
    axes[0].imshow(_to_rgb(pre.original))
    axes[0].set_title("input")
    axes[1].imshow(pre.binary, cmap="gray")
    axes[1].set_title("binary mask")
    axes[2].imshow(pre.skeleton, cmap="gray")
    axes[2].set_title("skeleton")
    for a in axes:
        a.axis("off")
    fig.tight_layout()
    try:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", facecolor="white")
        return buf.getvalue()
    finally:
        plt.close(fig)
