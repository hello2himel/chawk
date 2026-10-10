#!/usr/bin/env python3
"""Generate deterministic line-art test images for validating the pipeline."""

from __future__ import annotations

import os

import cv2
import numpy as np

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")


def _canvas(w=640, h=420):
    return np.full((h, w, 3), 255, np.uint8)


def _polyline(img, pts, thickness=2, color=(0, 0, 0), closed=False):
    p = np.asarray(pts, dtype=np.int32).reshape(-1, 1, 2)
    cv2.polylines(img, [p], closed, color, thickness, lineType=cv2.LINE_AA)


def sine_wave():
    img = _canvas()
    x = np.arange(60, 580)
    y = 210 + 90 * np.sin(0.022 * x - 1.2)
    _polyline(img, np.column_stack([x, y]), 2)
    return "sine_wave.png", img


def geometric():
    """Circle + straight lines + a triangle: the classic sanity check."""
    img = _canvas()
    cv2.circle(img, (150, 150), 90, (0, 0, 0), 2, cv2.LINE_AA)
    _polyline(img, [(300, 60), (600, 60)], 2)
    _polyline(img, [(300, 100), (600, 220)], 2)
    _polyline(img, [(340, 380), (460, 260), (580, 380), (340, 380)], 2, closed=True)
    return "geometric.png", img


def parabola_and_line():
    img = _canvas()
    x = np.arange(80, 560)
    y = 380 - 0.0022 * (x - 320) ** 2 * 1.6
    _polyline(img, np.column_stack([x, y]), 2)
    _polyline(img, [(80, 120), (560, 300)], 2)
    return "parabola_line.png", img


def dashed_line():
    """Dashed + gapped strokes to exercise endpoint merging."""
    img = _canvas()
    x = np.arange(60, 580)
    y = 120 + 0.35 * x
    pts = np.column_stack([x, y])
    for start in range(0, len(pts), 40):
        chunk = pts[start:start + 28]
        if len(chunk) > 1:
            _polyline(img, chunk, 2)
    x2 = np.arange(60, 580)
    y2 = 360 - 0.0009 * (x2 - 300) ** 2 * 40 / 40
    _polyline(img, np.column_stack([x2, y2]), 2)
    return "dashed.png", img


def self_intersecting():
    """A lemniscate: crosses itself, so junction handling matters."""
    img = _canvas()
    t = np.linspace(0, 2 * np.pi, 1400)
    x = 320 + 220 * np.cos(t)
    y = 210 + 120 * np.sin(2 * t)
    _polyline(img, np.column_stack([x, y]), 2, closed=True)
    return "self_intersecting.png", img


def thick_strokes():
    """Thick, anti-aliased strokes to exercise skeletonization."""
    img = _canvas()
    t = np.linspace(0, np.pi, 800)
    x = 90 + 460 * t / np.pi
    y = 240 - 130 * np.sin(t)
    _polyline(img, np.column_stack([x, y]), 9)
    cv2.circle(img, (480, 330), 55, (0, 0, 0), 7, cv2.LINE_AA)
    return "thick.png", img


def multi_curve():
    """Several disconnected curves of different families in one image."""
    img = _canvas(760, 520)
    x = np.arange(40, 360)
    _polyline(img, np.column_stack([x, 100 + 60 * np.sin(0.05 * x)]), 2)
    x = np.arange(400, 720)
    _polyline(img, np.column_stack([x, 60 + 0.0016 * (x - 560) ** 2 * 1.2]), 2)
    cv2.ellipse(img, (180, 340), (120, 70), 25, 0, 360, (0, 0, 0), 2, cv2.LINE_AA)
    _polyline(img, [(420, 300), (700, 300)], 2)
    _polyline(img, [(420, 340), (560, 470), (700, 340)], 2)
    x = np.arange(60, 340)
    _polyline(img, np.column_stack([x, 480 - 0.00004 * (x - 60) ** 3]), 2)
    return "multi_curve.png", img


def complex_scene():
    """A denser drawing: house + sun + hills, closer to real artwork."""
    img = _canvas(800, 560)
    # hills
    x = np.arange(0, 800)
    _polyline(img, np.column_stack([x, 430 + 40 * np.sin(0.008 * x)]), 2)
    _polyline(img, np.column_stack([x, 480 + 25 * np.sin(0.013 * x + 2.0)]), 2)
    # sun
    cv2.circle(img, (660, 110), 55, (0, 0, 0), 2, cv2.LINE_AA)
    for ang in range(0, 360, 45):
        a = np.deg2rad(ang)
        _polyline(img, [(660 + 70 * np.cos(a), 110 + 70 * np.sin(a)),
                        (660 + 100 * np.cos(a), 110 + 100 * np.sin(a))], 2)
    # house
    _polyline(img, [(160, 400), (160, 250), (330, 250), (330, 400), (160, 400)], 2, closed=True)
    _polyline(img, [(140, 250), (245, 170), (350, 250)], 2)
    _polyline(img, [(200, 400), (200, 320), (250, 320), (250, 400)], 2)
    _polyline(img, [(280, 300), (280, 340), (315, 340), (315, 300), (280, 300)], 2, closed=True)
    # tree
    _polyline(img, [(470, 400), (470, 300)], 3)
    cv2.circle(img, (470, 260), 55, (0, 0, 0), 2, cv2.LINE_AA)
    # bird
    t = np.linspace(-1, 1, 60)
    _polyline(img, np.column_stack([420 + 60 * t, 110 + 30 * np.abs(t)]), 2)
    _polyline(img, np.column_stack([520 + 45 * t, 150 + 22 * np.abs(t)]), 2)
    return "complex_scene.png", img


GENERATORS = [
    sine_wave, geometric, parabola_and_line, dashed_line,
    self_intersecting, thick_strokes, multi_curve, complex_scene,
]


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for gen in GENERATORS:
        name, img = gen()
        path = os.path.join(OUT_DIR, name)
        cv2.imwrite(path, img)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
