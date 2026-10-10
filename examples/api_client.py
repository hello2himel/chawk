#!/usr/bin/env python3
"""Upload an image to a running Chawk server and save the results.

Stdlib only (no extra dependencies)::

    .venv/bin/python app.py &            # start the server first
    .venv/bin/python examples/api_client.py tests/images/sine_wave.png out_api/
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.request
import uuid

SERVER = os.environ.get("CHAWK_SERVER", "http://127.0.0.1:8000")


def _post_image(path: str, preset: str = "balanced", overrides: dict | None = None) -> dict:
    boundary = uuid.uuid4().hex
    with open(path, "rb") as fh:
        raw = fh.read()
    if not raw:
        raise ValueError(f"empty file: {path}")
    name = os.path.basename(path)

    def part(headers: str, body: bytes) -> bytes:
        return (f"--{boundary}\r\n{headers}\r\n\r\n").encode() + body + b"\r\n"

    body = b""
    body += part(
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
        "Content-Type: application/octet-stream",
        raw,
    )
    body += part('Content-Disposition: form-data; name="preset"', preset.encode())
    body += part('Content-Disposition: form-data; name="config"',
                 json.dumps(overrides or {}).encode())
    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{SERVER}/api/process", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.load(exc).get("detail", exc.reason)
        except Exception:
            detail = exc.reason
        raise SystemExit(f"server error {exc.code}: {detail}")


def main(argv: list[str] | None = None) -> int:
    args = (argv if argv is not None else sys.argv[1:])
    if not args:
        print("usage: api_client.py IMAGE [OUT_DIR] [--preset NAME]", file=sys.stderr)
        return 2
    image, out_dir = args[0], args[1] if len(args) > 1 else "out_api"
    preset = "balanced"
    if "--preset" in args:
        preset = args[args.index("--preset") + 1]
    os.makedirs(out_dir, exist_ok=True)

    out = _post_image(image, preset)
    report = out["report"]
    stem = os.path.splitext(os.path.basename(image))[0]
    png_path = os.path.join(out_dir, f"{stem}_chawk.png")
    json_path = os.path.join(out_dir, f"{stem}_chawk.json")
    with open(png_path, "wb") as fh:
        fh.write(base64.b64decode(out["image_png_b64"]))
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    s = report["summary"]
    print(f"{s['stroke_count']} strokes -> {s['segment_count']} equations "
          f"(mean RMSE {s['mean_rmse_px']}px)")
    print(f"wrote {png_path}\nwrote {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
