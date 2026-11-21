"""Sample the pen colour of every traced stroke from the original image.

The fitted curves are redrawn over (or instead of) the source, so they should
use the colour the drawing was actually made in. Sampling is deliberately
robust to anti-aliasing, JPEG noise and half-pixel skeleton offsets: for each
skeleton point we take the most-inked pixel in its 3x3 neighbourhood, then the
per-channel median over the stroke. The canvas colour is the border median,
which also lets a "redraw" start from the same paper the art was drawn on.
"""

from __future__ import annotations

import cv2
import numpy as np

# A sample count per stroke is plenty for a stable median and keeps dense
# drawings fast (80000-point strokes still cost only a few milliseconds).
_MAX_SAMPLES = 400
# Below this RGB distance from the canvas the pixel is background, not ink.
_MIN_INK = 12.0


def to_rgb(image: np.ndarray) -> np.ndarray:
    """Return an HxWx3 RGB uint8 view of a BGR / BGRA / gray image."""
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2RGB)
    if image.shape[2] == 1:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def to_hex(rgb) -> str:
    r, g, b = (int(round(float(v))) for v in np.asarray(rgb).reshape(3))
    r, g, b = (min(255, max(0, c)) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def background_color(rgb: np.ndarray) -> np.ndarray:
    """Median colour of the whole image: the paper the drawing sits on.

    Line art is mostly paper, so the median is the canvas even when the
    drawing has a frame or fills a large part of the frame. Sampling a
    downscaled copy keeps this cheap on large inputs.
    """
    h, w = rgb.shape[:2]
    step = max(1, int(round(max(h, w) / 256.0)))
    return np.median(rgb[::step, ::step].reshape(-1, 3), axis=0)


def ink_color(rgb: np.ndarray, points: np.ndarray, background: np.ndarray) -> str:
    """Median pen colour under one stroke's points, as ``#rrggbb``."""
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2 or len(pts) == 0:
        return to_hex(background)
    if len(pts) > _MAX_SAMPLES:
        pts = pts[np.linspace(0, len(pts) - 1, _MAX_SAMPLES).astype(int)]
    h, w = rgb.shape[:2]
    radius = 1 if min(h, w) > 2 else 0
    xs = np.clip(np.rint(pts[:, 0]).astype(int), radius, w - 1 - radius)
    ys = np.clip(np.rint(pts[:, 1]).astype(int), radius, h - 1 - radius)
    if radius == 0:
        pixels = rgb[ys, xs][:, None, :]
    else:
        offsets = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
        pixels = np.stack([
            rgb[np.clip(ys + dy, 0, h - 1), np.clip(xs + dx, 0, w - 1)]
            for dy, dx in offsets
        ], axis=1)
    ink = np.linalg.norm(pixels.astype(np.float32) - np.asarray(background, np.float32), axis=2)
    rows = np.arange(len(pixels))
    pick = np.argmax(ink, axis=1)
    best = pixels[rows, pick]
    strongest = ink[rows, pick]
    # Ignore points that landed on paper (merged strokes can have short bridges).
    inked = best[strongest >= _MIN_INK]
    return to_hex(np.median(inked if len(inked) else best, axis=0))


def assign_stroke_colors(image: np.ndarray, strokes) -> None:
    """Set ``stroke.color`` for every stroke from the source image."""
    rgb = to_rgb(image)
    background = background_color(rgb)
    for stroke in strokes:
        if stroke.color:
            continue  # explicit colour (colour mode)
        stroke.color = ink_color(rgb, stroke.points, background)
