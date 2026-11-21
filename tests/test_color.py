"""Ink-colour inheritance: fitted curves reuse the pen colour, and the
equations-only redraw reproduces the drawing on its own paper.

    .venv/bin/python -m unittest tests.test_color -v
"""

from __future__ import annotations

import unittest

import cv2
import numpy as np

from chawk import build_config, process_image
from chawk import render as render_mod
from chawk.preprocess import preprocess


def _decode(png: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None, "render did not produce a decodable PNG"
    return img


class TestInkColour(unittest.TestCase):
    def _art(self) -> np.ndarray:
        img = np.full((260, 360, 3), 255, np.uint8)
        cv2.circle(img, (90, 130), 55, (0, 0, 255), 4, cv2.LINE_AA)        # red pen
        cv2.line(img, (200, 50), (330, 200), (255, 0, 0), 4, cv2.LINE_AA)  # blue pen
        return img

    def test_each_stroke_keeps_its_pen_colour(self):
        r = process_image(self._art(), cfg=build_config("balanced"))
        colors = [s.color for s in r.strokes]
        self.assertEqual(len(colors), 2)
        self.assertIn("#ff0000", colors)
        self.assertIn("#0000ff", colors)
        self.assertEqual([s["color"] for s in r.report["strokes"]], colors)

    def test_redraw_carries_colours(self):
        cfg = build_config("balanced")
        r = process_image(self._art(), cfg=cfg)
        redraw = _decode(render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, cfg, labels=False, paper=True))
        px = redraw.reshape(-1, 3).astype(int)  # BGR
        self.assertTrue(((px[:, 2] > 200) & (px[:, 1] < 90)).any(), "red ink missing")
        self.assertTrue(((px[:, 0] > 200) & (px[:, 1] < 90)).any(), "blue ink missing")
        self.assertTrue((redraw[0, 0] > 245).all(), redraw[0, 0])  # white paper

    def test_dark_paper_stays_dark(self):
        """White ink on black paper must redraw on black paper, not white."""
        img = np.zeros((220, 300, 3), np.uint8)
        cv2.line(img, (40, 180), (260, 60), (255, 255, 255), 4, cv2.LINE_AA)
        cfg = build_config("balanced")
        r = process_image(img, cfg=cfg)
        self.assertEqual(r.strokes[0].color, "#ffffff")
        redraw = _decode(render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, cfg, labels=False, paper=True))
        self.assertTrue((redraw[0, 0] < 10).all(), redraw[0, 0])
        px = redraw.reshape(-1, 3)
        self.assertTrue((px.min(axis=1) > 240).any(), "white ink missing")

    def test_redraw_omits_the_source_image(self):
        """A speck filtered out of the strokes must vanish from the redraw."""
        img = self._art()
        img[8:11, 340:343] = 0  # 9px component: below min_component_area
        cfg = build_config("balanced")
        r = process_image(img, cfg=cfg)
        over = _decode(render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, cfg, labels=False))
        paper = _decode(render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, cfg, labels=False, paper=True))
        y, x = 9, 341
        self.assertTrue(over[y, x].max() < 60, over[y, x])     # source speck present
        self.assertTrue(paper[y, x].min() > 240, paper[y, x])  # absent from the redraw

    def test_frame_does_not_become_the_paper(self):
        """A drawn border is ink, not the canvas: redraw paper stays white."""
        img = self._art()
        cv2.rectangle(img, (0, 0), (359, 259), (0, 0, 0), 3)
        cfg = build_config("balanced")
        r = process_image(img, cfg=cfg)
        redraw = _decode(render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, cfg, labels=False, paper=True))
        self.assertTrue((redraw[10, 10] > 245).all(), redraw[10, 10])

    def test_canvas_colour_follows_the_paper(self):
        img = np.full((90, 140, 3), (210, 228, 245), np.uint8)  # cream paper (BGR)
        cfg = build_config("balanced")
        pre = preprocess(img, cfg)
        paper = _decode(render_mod.render_png_bytes(
            pre, [], [], cfg, labels=False, paper=True))
        self.assertTrue(np.allclose(paper[0, 0], (210, 228, 245), atol=2), paper[0, 0])


if __name__ == "__main__":
    unittest.main()
