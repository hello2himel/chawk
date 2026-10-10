"""API-level tests for app.py. Stdlib unittest only (no httpx needed).

Covers process_image_bytes plus the HTTP error mapping by calling the
endpoint function directly with a synthetic UploadFile.

    .venv/bin/python -m unittest tests.test_api -v
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import unittest

from fastapi import HTTPException
from starlette.datastructures import UploadFile

import app as server
from chawk import NoStrokesDetected

IMAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _bytes(name: str) -> bytes:
    with open(os.path.join(IMAGES, name), "rb") as fh:
        return fh.read()


def _upload(data: bytes, filename: str = "test.png") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), size=len(data), filename=filename)


class TestProcessBytes(unittest.TestCase):
    def test_sine_wave(self):
        out = server.process_image_bytes(_bytes("sine_wave.png"))
        s = out["report"]["summary"]
        self.assertEqual(s["stroke_count"], 1)
        self.assertIn("sinusoid", s["models_used"])
        raw = base64.b64decode(out["image_png_b64"])
        self.assertTrue(raw.startswith(PNG_MAGIC))
        self.assertIsNone(out["debug_png_b64"])

    def test_debug_bundle(self):
        out = server.process_image_bytes(_bytes("geometric.png"), debug=True)
        self.assertIsNotNone(out["debug_png_b64"])
        raw = base64.b64decode(out["debug_png_b64"])
        self.assertTrue(raw.startswith(PNG_MAGIC))

    def test_preset_and_overrides(self):
        out = server.process_image_bytes(
            _bytes("sine_wave.png"), preset="precise",
            overrides={"max_poly_degree": 2},
        )
        self.assertEqual(out["report"]["config"]["max_poly_degree"], 2)

    def test_clean_twin_differs(self):
        """Labeled + label-free renders must both be valid PNGs and differ."""
        out = server.process_image_bytes(_bytes("geometric.png"))
        lab = base64.b64decode(out["image_png_b64"])
        cln = base64.b64decode(out["image_clean_b64"])
        self.assertTrue(lab.startswith(PNG_MAGIC))
        self.assertTrue(cln.startswith(PNG_MAGIC))
        self.assertNotEqual(lab, cln)
        self.assertGreater(len(lab), len(cln))  # labels add ink

    def test_blank_raises_no_strokes(self):
        import cv2
        import numpy as np
        ok, buf = cv2.imencode(".png", np.full((100, 100, 3), 255, np.uint8))
        self.assertTrue(ok)
        with self.assertRaises(NoStrokesDetected):
            server.process_image_bytes(bytes(buf))

    def test_corrupt_raises_value_error(self):
        with self.assertRaises(ValueError):
            server.process_image_bytes(b"this is not an image")

    def test_empty_raises_value_error(self):
        with self.assertRaises(ValueError):
            server.process_image_bytes(b"")

    def test_bad_config_raises_value_error(self):
        with self.assertRaises(ValueError):
            server.process_image_bytes(
                _bytes("sine_wave.png"), overrides={"rmse_tolerance": -1})


class TestEndpoints(unittest.TestCase):
    def test_health(self):
        self.assertEqual(server.health()["status"], "ok")
        self.assertIn("version", server.health())

    def test_presets(self):
        p = server.presets()
        self.assertIn("balanced", p["presets"])
        self.assertEqual(p["presets"], sorted(p["presets"]))
        self.assertIn("rmse_tolerance", p["defaults"])

    def test_unknown_preset_400(self):
        async def go():
            with self.assertRaises(HTTPException) as cm:
                await server.api_process(file=_upload(_bytes("sine_wave.png")),
                                         preset="nope", config=None, debug=False)
            self.assertEqual(cm.exception.status_code, 400)
        asyncio.run(go())

    def test_unknown_config_key_400(self):
        async def go():
            with self.assertRaises(HTTPException) as cm:
                await server.api_process(file=_upload(_bytes("sine_wave.png")),
                                         preset="balanced",
                                         config='{"bogus_knob": 1}', debug=False)
            self.assertEqual(cm.exception.status_code, 400)
        asyncio.run(go())

    def test_malformed_config_400(self):
        async def go():
            with self.assertRaises(HTTPException) as cm:
                await server.api_process(file=_upload(_bytes("sine_wave.png")),
                                         preset="balanced",
                                         config='{not json', debug=False)
            self.assertEqual(cm.exception.status_code, 400)
        asyncio.run(go())

    def test_empty_upload_400(self):
        async def go():
            with self.assertRaises(HTTPException) as cm:
                await server.api_process(file=_upload(b"", filename="e.png"),
                                         preset="balanced", config=None, debug=False)
            self.assertEqual(cm.exception.status_code, 400)
        asyncio.run(go())

    def test_blank_upload_422(self):
        import cv2
        import numpy as np
        ok, buf = cv2.imencode(".png", np.full((100, 100, 3), 255, np.uint8))
        self.assertTrue(ok)

        async def go():
            with self.assertRaises(HTTPException) as cm:
                await server.api_process(file=_upload(bytes(buf)),
                                         preset="balanced", config=None, debug=False)
            self.assertEqual(cm.exception.status_code, 422)
        asyncio.run(go())

    def test_wrong_type_config_400(self):
        async def go():
            with self.assertRaises(HTTPException) as cm:
                await server.api_process(file=_upload(_bytes("sine_wave.png")),
                                         preset="balanced",
                                         config='{"rmse_tolerance": "abc"}',
                                         debug=False)
            self.assertEqual(cm.exception.status_code, 400)
        asyncio.run(go())

    def test_happy_path(self):
        async def go():
            out = await server.api_process(file=_upload(_bytes("geometric.png")),
                                           preset="balanced", config=None, debug=False)
            # JSONResponse wraps the payload in .body
            import json as _json
            payload = _json.loads(out.body.decode())
            self.assertIn("report", payload)
            self.assertIn("image_png_b64", payload)
            self.assertGreaterEqual(payload["report"]["summary"]["stroke_count"], 4)
        asyncio.run(go())


if __name__ == "__main__":
    unittest.main()
