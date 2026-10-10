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
        for name in ("app.js", "math.js"):
            p = subprocess.run([node, "--check", os.path.join(FRONT, name)],
                               capture_output=True, text=True, timeout=60)
            self.assertEqual(p.returncode, 0, msg=name + p.stderr[-2000:])

    def test_js_dom_ids_crosscheck(self):
        """Every $("id") in app.js must exist as id="..." in index.html.

        Catches dead wiring (null.addEventListener) without a browser.
        """
        import re
        html = open(os.path.join(FRONT, "index.html"), encoding="utf-8").read()
        js = open(os.path.join(FRONT, "app.js"), encoding="utf-8").read()
        have = set(re.findall(r'id="([^"]+)"', html))
        for ref in sorted(set(re.findall(r'\$\("([^"]+)"\)', js))):
            self.assertIn(ref, have, f'app.js references #${ref} but index.html lacks it')

    def test_math_converter(self):
        """math.js must convert every backend equation format to KaTeX-safe TeX."""
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not available")
        harness = r"""
const fs = require("fs");
const ROOT = %r;
eval(fs.readFileSync(ROOT + "/frontend/math.js", "utf-8")
  + ";globalThis.__m = { chawkToLatex, renderEquationHTML };");
const { chawkToLatex, renderEquationHTML } = globalThis.__m;
const assert = require("assert");
const cases = [
  ["y = 0.375x + 89.8058", "line", ["0.375x"]],
  ["y = -0.0035x² + 2.251x + 19.3701", "polynomial2", ["x^{2}", "2.251x"]],
  ["x = 0.5y + 3", "line", ["0.5y"]],
  ["y = x² - 2x + 1", "polynomial2", ["x^{2}"]],
  ["y = 1.20e-05x² + 1", "polynomial2", ["\\times 10^{-05}"]],
  ["(x - 149.8533)² + (y - 149.8829)² = 49.88²", "circle", ["^{2}"]],
  ["((x-179.9)cosφ + (y-339.8)sinφ)²/120² = 1, φ = 25°", "elliptical_arc",
   ["\\cos", "\\varphi", "^{\\circ}"]],
  ["y = 89.8525·sin(0.022x - 1.1953) + 209.4678", "sinusoid", ["\\cdot", "\\sin"]],
  ["(10, 20)", "point", ["(10, 20)"]],
];
for (const [eq, model, wants] of cases) {
  const tex = chawkToLatex(eq, model);
  assert(tex, "null tex for " + eq);
  for (const w of wants) assert(tex.includes(w), `${eq} -> ${tex} missing ${w}`);
  for (const bad of ["²", "·", "φ", "°", "^2"]) assert(!tex.includes(bad), `${eq} leaked ${bad}`);
}
assert.strictEqual(chawkToLatex("piecewise cubic: (x(u), y(u))", "spline"), null);
// every conversion must survive real KaTeX
const katex = require(ROOT + "/frontend/vendor/katex/katex.min.js");
for (const [eq, model] of cases) {
  const html = katex.renderToString(chawkToLatex(eq, model), { throwOnError: false });
  assert(!html.includes("katex-error"), "KaTeX rejected: " + eq);
}
// fallback path: no KaTeX -> escaped text, and scary input is escaped
delete globalThis.katex;
assert.strictEqual(renderEquationHTML("spline words", "spline"), "spline words");
assert(renderEquationHTML("<img src=x>", "line").includes("&lt;img"));
console.log("math converter OK");
""" % (ROOT,)
        p = subprocess.run([node, "-e", harness], capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, msg=(p.stderr + p.stdout)[-3000:])
        self.assertIn("math converter OK", p.stdout)


if __name__ == "__main__":
    unittest.main()
