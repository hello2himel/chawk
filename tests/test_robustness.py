"""Robustness / reliability regression suite for Chawk.

Runs with the stdlib only (no pytest dependency):

    .venv/bin/python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest

import cv2
import numpy as np

from chawk import NoStrokesDetected, build_config, process_image
from chawk import models
from chawk.preprocess import load_image, preprocess
from chawk.trace import trace_strokes

IMAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")


def _cfg(**kw):
    return build_config(**kw)


class TestGoldenImages(unittest.TestCase):
    """Every bundled test image must process within tolerance."""

    def _check(self, name, min_strokes=1):
        r = process_image(os.path.join(IMAGES, name), cfg=_cfg(),
                          output_image=None, output_json=None)
        s = r.report["summary"]
        self.assertGreaterEqual(s["stroke_count"], min_strokes, name)
        self.assertGreaterEqual(s["segment_count"], 1, name)
        self.assertIsNotNone(s["mean_rmse_px"], name)
        self.assertLessEqual(s["mean_rmse_px"], 2.0, name)
        self.assertLessEqual(s["max_rmse_px"], 6.0, name)
        self.assertEqual(s["segments_within_tolerance"], s["segment_count"], name)
        # strict-JSON safety: no inf/nan may survive into the report
        txt = json.dumps(r.report, allow_nan=False)
        self.assertNotIn("Infinity", txt)
        self.assertNotIn("NaN", txt)
        return s

    def test_sine_wave(self):
        s = self._check("sine_wave.png")
        self.assertIn("sinusoid", s["models_used"])

    def test_geometric(self):
        s = self._check("geometric.png", min_strokes=4)
        self.assertIn("circle", s["models_used"])

    def test_parabola_line(self):
        self._check("parabola_line.png", min_strokes=2)

    def test_dashed(self):
        self._check("dashed.png", min_strokes=2)

    def test_self_intersecting(self):
        self._check("self_intersecting.png")

    def test_thick(self):
        self._check("thick.png", min_strokes=2)

    def test_multi_curve(self):
        self._check("multi_curve.png", min_strokes=5)

    def test_complex_scene(self):
        s = self._check("complex_scene.png", min_strokes=10)
        self.assertGreaterEqual(s["segment_count"], 10)


class TestModelSelection(unittest.TestCase):
    def test_straight_line_picks_line(self):
        cfg = _cfg()
        x = np.linspace(0, 200, 120)
        pts = np.column_stack([x, 0.5 * x + 10.0])
        fit = models.fit_segment(pts, cfg)
        self.assertEqual(fit.model, "line")
        models.score_fit(fit, pts, cfg)
        self.assertLess(fit.rmse, 0.5)

    def test_axis_aligned_ellipse(self):
        cfg = _cfg()
        t = np.linspace(0, 2 * np.pi, 300)
        cx, cy, a, b = 200.0, 150.0, 120.0, 70.0
        pts = np.column_stack([cx + a * np.cos(t), cy + b * np.sin(t)])
        ell = models.fit_ellipse(pts, cfg)
        self.assertIsNotNone(ell)
        models.score_fit(ell, pts, cfg)
        self.assertLess(ell.rmse, 1.0)
        best = models.fit_segment(pts, cfg, closed=True)
        self.assertIn(best.model, ("ellipse", "elliptical_arc", "circle", "circular_arc"))

    def test_rotated_ellipse(self):
        """Regression: phi was offset +90deg so rotated ellipses never won."""
        cfg = _cfg()
        rng = np.random.default_rng(7)
        t = np.linspace(0, 2 * np.pi, 400)
        a, b, phi = 120.0, 70.0, np.deg2rad(25.0)
        x = 180 + a * np.cos(t) * np.cos(phi) - b * np.sin(t) * np.sin(phi)
        y = 340 + a * np.cos(t) * np.sin(phi) + b * np.sin(t) * np.cos(phi)
        pts = np.column_stack([x, y]) + rng.normal(0, 0.3, (400, 2))
        ell = models.fit_ellipse(pts, cfg)
        self.assertIsNotNone(ell)
        models.score_fit(ell, pts, cfg)
        self.assertLess(ell.rmse, 1.5)


class TestEdgeCases(unittest.TestCase):
    def test_blank_white_raises(self):
        img = np.full((200, 200, 3), 255, np.uint8)
        with self.assertRaises(NoStrokesDetected):
            process_image(img, cfg=_cfg())

    def test_blank_black_raises(self):
        img = np.zeros((200, 200, 3), np.uint8)
        with self.assertRaises(NoStrokesDetected):
            process_image(img, cfg=_cfg())

    def test_single_pixel_raises(self):
        img = np.full((100, 100, 3), 255, np.uint8)
        img[50, 50] = (0, 0, 0)
        with self.assertRaises(NoStrokesDetected):
            process_image(img, cfg=_cfg())

    def test_tiny_image_raises_softly(self):
        img = np.full((5, 5, 3), 255, np.uint8)
        with self.assertRaises((NoStrokesDetected, ValueError)):
            process_image(img, cfg=_cfg())

    def test_grayscale_2d_array(self):
        gray = np.full((200, 200), 255, np.uint8)
        cv2.line(gray, (10, 10), (190, 190), 0, 2)
        r = process_image(gray, cfg=_cfg())
        self.assertGreaterEqual(r.report["summary"]["stroke_count"], 1)

    def test_bgra_array(self):
        img = np.full((200, 200, 4), 255, np.uint8)
        cv2.line(img, (10, 10), (190, 190), (0, 0, 0, 255), 2)
        r = process_image(img, cfg=_cfg())
        self.assertGreaterEqual(r.report["summary"]["stroke_count"], 1)

    def test_empty_array_raises(self):
        with self.assertRaises(ValueError):
            process_image(np.zeros((0, 0, 3), np.uint8), cfg=_cfg())

    def test_corrupt_bytes_raise(self):
        with self.assertRaises(ValueError):
            process_image(b"not an image", cfg=_cfg())

    def test_missing_file_raises(self):
        with self.assertRaises(ValueError):
            process_image("/nonexistent/nope.png", cfg=_cfg())

    def test_noise_fails_fast(self):
        """Photos/noise must be rejected by the density guard, not hang."""
        rng = np.random.default_rng(0)
        img = rng.integers(0, 255, (300, 300, 3), dtype=np.uint8)
        t0 = time.time()
        with self.assertRaises(NoStrokesDetected):
            process_image(img, cfg=_cfg())
        self.assertLess(time.time() - t0, 15.0)

    def test_transparent_dark_art(self):
        """Logos/icons are often black-on-transparent; alpha must not kill them."""
        import io as _io
        img = np.zeros((300, 300, 4), np.uint8)
        cv2.circle(img, (150, 120), 70, (0, 0, 0, 255), 2)
        cv2.line(img, (30, 250), (270, 250), (0, 0, 0, 255), 2)
        ok, buf = cv2.imencode(".png", img)
        self.assertTrue(ok)
        for data in (img, bytes(buf.tobytes())):
            r = process_image(data, cfg=_cfg())
            s = r.report["summary"]
            self.assertGreaterEqual(s["stroke_count"], 2)
            self.assertEqual(s["segments_within_tolerance"], s["segment_count"])

    def test_transparent_light_art(self):
        """White dark-mode logos on transparency must work too."""
        img = np.zeros((200, 200, 4), np.uint8)
        cv2.line(img, (10, 10), (190, 190), (255, 255, 255, 255), 3)
        r = process_image(img, cfg=_cfg())
        s = r.report["summary"]
        self.assertGreaterEqual(s["stroke_count"], 1)
        self.assertEqual(s["segments_within_tolerance"], s["segment_count"])

    def test_light_on_dark_symmetry(self):
        """Same geometry in either polarity must trace to the same length."""
        cfg = _cfg()
        got = []
        for bg, fg in ((255, 0), (0, 255)):
            img = np.full((200, 200, 3), bg, np.uint8)
            cv2.line(img, (10, 10), (190, 190), (fg, fg, fg), 3)
            r = process_image(img, cfg=cfg)
            st = r.report["strokes"][0]
            got.append(round(st["arc_length"], 1))
            self.assertEqual(r.report["summary"]["segments_within_tolerance"],
                             r.report["summary"]["segment_count"])
        self.assertAlmostEqual(got[0], got[1], delta=5.0)

    def test_fully_transparent_raises_softly(self):
        img = np.zeros((100, 100, 4), np.uint8)
        with self.assertRaises(NoStrokesDetected):
            process_image(img, cfg=_cfg())

    def test_thin_one_px_line(self):
        """Median blur must not erase 1px CAD-style strokes (blur fallback)."""
        img = np.full((420, 640, 3), 255, np.uint8)
        cv2.line(img, (70, 240), (570, 240), (0, 0, 0), 1)
        r = process_image(img, cfg=_cfg())
        s = r.report["summary"]
        self.assertEqual(s["stroke_count"], 1)
        self.assertEqual(s["segments_within_tolerance"], s["segment_count"])

    def test_semi_transparent_art(self):
        """Art visible only at low opacity must survive alpha flattening."""
        img = np.zeros((60, 60, 4), np.uint8)
        img[20:40, :, 0:3] = 0
        img[20:40, :, 3] = 100
        from chawk.preprocess import preprocess as _pre
        pre = _pre(img, _cfg())
        self.assertGreater(float(pre.ink_ratio), 0.01)

    def test_load_empty_bytes(self):
        from chawk.preprocess import load_image as _load
        with self.assertRaises(ValueError):
            _load(b"")

    def test_output_dir_guards(self):
        import tempfile as _tf
        with _tf.TemporaryDirectory() as d:
            for kw in ({"output_image": d}, {"output_json": d}):
                with self.assertRaises(OSError, msg=str(kw)):
                    process_image(
                        __import__("os").path.join(IMAGES, "sine_wave.png"),
                        cfg=_cfg(), **kw)

    def test_wrong_type_configs_raise_value_error(self):
        for kw in ({"rmse_tolerance": "abc"}, {"max_poly_degree": [1]},
                   {"dpi": "high"}, {"max_dimension": "big"}):
            with self.assertRaises(ValueError, msg=str(kw)):
                build_config(**kw)

    def test_nan_inf_points_no_crash(self):
        import json as _json
        from chawk import models as _m
        from chawk.segment import Segment as _S
        cfg = _cfg()
        for bad in (float("nan"), float("inf")):
            pts = np.array([[0., 0.], [1., bad], [2., 2.], [3., 3.],
                            [4., 4.], [5., 5.]])
            best = _m.fit_segment(pts, cfg)
            self.assertIsNone(_m.fit_spline(pts, cfg))
            d = _S(1, 0, 5, pts, best, length=1.0).to_dict()
            _json.dumps(d, allow_nan=False)  # must not raise

    def test_bad_configs_raise(self):
        for kw in ({"rmse_tolerance": -1}, {"resample_spacing": 0},
                   {"max_dimension": 10}, {"max_poly_degree": 99},
                   {"dpi": 10}, {"max_labels": 500}, {"corner_angle": 500}):
            with self.assertRaises(ValueError, msg=str(kw)):
                build_config(**kw)


class TestArtifacts(unittest.TestCase):
    def test_json_and_image_outputs(self):
        from chawk import process_image as pi
        with tempfile.TemporaryDirectory() as d:
            out_img = os.path.join(d, "o.png")
            out_json = os.path.join(d, "o.json")
            r = pi(os.path.join(IMAGES, "sine_wave.png"), cfg=_cfg(),
                   output_image=out_img, output_json=out_json)
            self.assertTrue(os.path.isfile(out_img))
            self.assertTrue(os.path.isfile(out_json))
            with open(out_json, encoding="utf-8") as fh:
                data = json.load(fh)  # strict parse must succeed
            self.assertEqual(data["summary"]["stroke_count"], 1)
            self.assertEqual(r.image_path, out_img)
            self.assertEqual(r.json_path, out_json)

    def test_cli_smoke(self):
        import subprocess, sys
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "cli.png")
            js = os.path.join(d, "cli.json")
            cmd = [sys.executable, "lineart2eq.py", "-i",
                   os.path.join(IMAGES, "geometric.png"),
                   "-o", out, "--json", js, "--quiet"]
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            self.assertEqual(p.returncode, 0, msg=p.stderr[-2000:])
            self.assertTrue(os.path.isfile(out))
            self.assertTrue(os.path.isfile(js))

    def test_trace_determinism(self):
        cfg = _cfg()
        pre = preprocess(load_image(os.path.join(IMAGES, "geometric.png")), cfg)
        a = [(s.stroke_id, round(s.length, 3)) for s in trace_strokes(pre, cfg)]
        b = [(s.stroke_id, round(s.length, 3)) for s in trace_strokes(pre, cfg)]
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
