#!/usr/bin/env python3
"""Chawk web backend - same engine as the CLI, exposed over HTTP.

The CLI (``lineart2eq.py``) and this server share one pipeline:
``chawk.process_image``. This module only adds HTTP plumbing
(upload handling, config parsing, PNG-as-base64 responses).

Run with::

    .venv/bin/python app.py                  # http://127.0.0.1:8000
    .venv/bin/python app.py --port 8080
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from chawk import (
    PRESETS,
    Config,
    NoStrokesDetected,
    __version__,
    build_config,
    process_image,
)
from chawk import render as render_mod
from chawk.preprocess import load_image

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_CONCURRENT_JOBS = 2
PROCESS_TIMEOUT_SEC = 180

app = FastAPI(title="Chawk", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

_jobs = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/presets")
def presets() -> dict:
    return {
        "presets": sorted(PRESETS),
        "defaults": Config().to_dict(),
        "limits": {"max_upload_bytes": MAX_UPLOAD_BYTES},
    }


def process_image_bytes(
    data: bytes,
    preset: str = "balanced",
    overrides: dict | None = None,
    debug: bool = False,
) -> dict:
    """Run the full pipeline on raw image bytes (pure function, easy to test).

    Returns ``{"report": ..., "image_png_b64": ..., "debug_png_b64": ...|None}``.
    Raises ``ValueError`` for bad input/config, ``NoStrokesDetected`` for blank art.
    """
    if not data:
        raise ValueError("Empty upload (0 bytes).")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(
            f"Image too large ({len(data) / 1e6:.1f}MB; limit {MAX_UPLOAD_BYTES / 1e6:.0f}MB)."
        )
    cfg = build_config(preset, **(overrides or {}))  # validates; ValueError on bad knobs
    image = load_image(data)  # ValueError on undecodable input
    result = process_image(image, cfg=cfg, output_image=None, output_json=None)
    total = sum(len(s) for s in result.stroke_segments)
    title = f"Chawk - {len(result.strokes)} strokes, {total} equations"
    out = {
        "report": result.report,
        "image_png_b64": base64.b64encode(
            render_mod.render_png_bytes(
                result.preprocessed, result.strokes,
                result.stroke_segments, cfg, title=title, labels=True,
            )
        ).decode("ascii"),
        # Clean twin without labels: the UI toggles labels instantly (views +
        # dock switch) instead of refitting.
        "image_clean_b64": base64.b64encode(
            render_mod.render_png_bytes(
                result.preprocessed, result.strokes,
                result.stroke_segments, cfg, title=title, labels=False,
            )
        ).decode("ascii"),
    }
    if debug:
        out["debug_png_b64"] = base64.b64encode(
            render_mod.render_debug_bytes(result.preprocessed)
        ).decode("ascii")
    else:
        out["debug_png_b64"] = None
    return out


def _parse_overrides(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config JSON: {exc}")
    if not isinstance(obj, dict):
        raise HTTPException(status_code=400, detail="config must be a JSON object.")
    known = {f for f in Config.__dataclass_fields__ if f != "extras"}
    unknown = [k for k in obj if k not in known]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown config keys: {', '.join(sorted(unknown))}.",
        )
    return obj


@app.post("/api/process")
async def api_process(
    file: UploadFile = File(...),
    preset: str = Form("balanced"),
    config: str | None = Form(None),
    debug: bool = Form(False),
):
    if preset not in PRESETS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown preset {preset!r}. Choices: {', '.join(sorted(PRESETS))}.",
        )
    overrides = _parse_overrides(config)
    try:
        data = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read upload: {exc}")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload (0 bytes).")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (limit 15MB).")
    try:
        async with _jobs:
            t0 = time.perf_counter()
            try:
                out = await asyncio.wait_for(
                    asyncio.to_thread(
                        process_image_bytes, data, preset, overrides, debug
                    ),
                    timeout=PROCESS_TIMEOUT_SEC,
                )
            except asyncio.TimeoutError:
                raise HTTPException(status_code=504, detail="Processing timed out.")
            out["timings_sec"] = {"server_total": round(time.perf_counter() - t0, 3)}
            return JSONResponse(out)
    except HTTPException:
        raise
    except NoStrokesDetected as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="chawk-server", description="Run the Chawk web server.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args(argv)
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
