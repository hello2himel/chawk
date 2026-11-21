"""Filled-region support: solid blobs become filled vector shapes, not strokes.

    .venv/bin/python -m unittest tests.test_fill -v
"""

from __future__ import annotations

import unittest

import cv2
import numpy as np

from chawk import build_config, process_image
from chawk import render as render_mod


def _decode(png: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None, "render did not produce a decodable PNG"
    return img


def _disc(size: int = 300, radius: int = 80) -> np.ndarray:
    img = np.full((size, size, 3), 255, np.uint8)
    cv2.circle(img, (size // 2, size // 2), radius, (0, 0, 0), -1, cv2.LINE_AA)
    return img


class TestFills(unittest.TestCase):
    def test_disc_is_filled_not_stroked(self):
        r = process_image(_disc(), cfg=build_config("balanced"))
        fills = [s for s in r.report["strokes"] if s["filled"]]
        self.assertEqual(len(fills), 1)
        self.assertEqual(r.report["summary"]["fill_count"], 1)
        self.assertEqual(fills[0]["fill_role"], "outer")
        self.assertEqual(fills[0]["segments"][0]["model"], "circle")

        png = render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, r.config, labels=False, paper=True)
        px = _decode(png)
        self.assertLess(int(px[150, 150].max()), 40, "disc centre should be filled")
        self.assertGreater(int(px[5, 5].min()), 240, "paper stays paper")

    def test_ring_keeps_its_hole(self):
        img = np.full((320, 320, 3), 255, np.uint8)
        cv2.circle(img, (160, 160), 110, (0, 0, 0), -1, cv2.LINE_AA)
        cv2.circle(img, (160, 160), 55, (255, 255, 255), -1, cv2.LINE_AA)
        r = process_image(img, cfg=build_config("balanced"))
        roles = sorted(s["fill_role"] for s in r.report["strokes"] if s["filled"])
        self.assertEqual(roles, ["hole", "outer"])

        png = render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, r.config, labels=False, paper=True)
        px = _decode(png)
        self.assertGreater(int(px[160, 160].min()), 240, "hole must stay paper")
        self.assertLess(int(px[60, 160].max()), 40, "ring must be ink")

    def test_mixed_stroke_and_fill(self):
        img = np.full((320, 420, 3), 255, np.uint8)
        cv2.circle(img, (110, 160), 70, (30, 30, 30), -1, cv2.LINE_AA)
        cv2.line(img, (230, 100), (390, 260), (0, 0, 0), 4, cv2.LINE_AA)
        r = process_image(img, cfg=build_config("balanced"))
        filled = [s for s in r.report["strokes"] if s["filled"]]
        stroked = [s for s in r.report["strokes"] if not s["filled"]]
        self.assertEqual(len(filled), 1)
        self.assertGreaterEqual(len(stroked), 1)

    def test_outline_art_has_no_fills(self):
        img = np.full((300, 300, 3), 255, np.uint8)
        cv2.circle(img, (150, 150), 80, (0, 0, 0), 4, cv2.LINE_AA)
        r = process_image(img, cfg=build_config("balanced"))
        self.assertEqual(r.report["summary"]["fill_count"], 0)
        self.assertEqual(len(r.report["strokes"]), 1)

    def test_connected_line_network_is_not_one_giant_fill(self):
        """Regression: a dense line drawing must not be filled as a ring.

        The whole line network is one connected component with holes; without
        the ring-blobbiness cap it was accepted as a single huge fill and
        painted over the face.
        """
        import os
        path = os.path.join(os.path.dirname(__file__), "inputs", "portrait_line.png")
        r = process_image(path, cfg=build_config("balanced"))
        self.assertLessEqual(r.report["summary"]["fill_count"], 6)
        self.assertGreater(r.report["summary"]["stroke_count"], 40)
        png = render_mod.render_png_bytes(
            r.preprocessed, r.strokes, r.stroke_segments, r.config, labels=False, paper=True)
        px = _decode(png)
        # Face centre must stay paper, not a filled blob.
        self.assertGreater(int(px[640, 640].min()), 200, "face was filled over")

    def test_fill_can_be_disabled(self):
        r = process_image(_disc(), cfg=build_config("balanced", enable_fill=False))
        self.assertEqual(r.report["summary"]["fill_count"], 0)
        self.assertFalse(any(s["filled"] for s in r.report["strokes"]))


if __name__ == "__main__":
    unittest.main()
