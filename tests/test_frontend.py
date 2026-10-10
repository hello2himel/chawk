"""Static checks for the frontend bundle (no browser needed).

    .venv/bin/python -m unittest tests.test_frontend -v
"""

from __future__ import annotations

import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT = os.path.join(ROOT, "frontend")


class TestFrontend(unittest.TestCase):
    def test_files_exist(self):
        for name in ("index.html", "app.js", "styles.css"):
            self.assertTrue(os.path.isfile(os.path.join(FRONT, name)), name)
        for name in ("sine_wave.png", "geometric.png", "parabola_line.png"):
            self.assertTrue(os.path.isfile(os.path.join(FRONT, "samples", name)), name)

    def test_samples_decode(self):
        from chawk.preprocess import load_image
        for name in ("sine_wave.png", "geometric.png", "parabola_line.png"):
            img = load_image(os.path.join(FRONT, "samples", name))
            self.assertEqual(img.ndim, 3)

    def test_html_hooks(self):
        html = open(os.path.join(FRONT, "index.html"), encoding="utf-8").read()
        for hook in ("dropzone", "presets", "data-view", "data-sample", "equations",
                     "role=\"alert\"", "aria-live"):
            self.assertIn(hook, html, hook)
        js = open(os.path.join(FRONT, "app.js"), encoding="utf-8").read()
        for hook in ("/api/process", "/api/presets", "/health", "AbortController",
                     "localStorage", "clipboardData"):
            self.assertIn(hook, js, hook)

    def test_js_syntax(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not available")
        p = subprocess.run([node, "--check", os.path.join(FRONT, "app.js")],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, msg=p.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
