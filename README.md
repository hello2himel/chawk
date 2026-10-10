# Chawk — line art → equations

Trace a line drawing and fit a mathematical equation to every stroke.

## Quick start

```bash
.venv/bin/python lineart2eq.py -i tests/images/sine_wave.png -o out/sine.png
.venv/bin/python app.py            # web UI at http://127.0.0.1:8000
```

## Parts

| Path | What |
|---|---|
| `chawk/` | The one pipeline (`process_image`): preprocess → trace → segment/fit → render |
| `lineart2eq.py` | CLI (annotated PNG + JSON report + `--print-equations`) |
| `app.py` | FastAPI backend; serves `frontend/` and `POST /api/process` |
| `frontend/` | Dependency-free web UI (upload, tune, inspect equations) |
| `examples/` | `api_client.py` (server client), `batch_process.py` (folder batch) |
| `tests/` | `make_test_images.py` + `test_robustness.py` (25 tests, stdlib unittest) |

## CLI

```bash
.venv/bin/python lineart2eq.py -i drawing.png -o out.png --json out.json --preset precise
.venv/bin/python lineart2eq.py -i art.png -o out.png --rmse-tolerance 1.0 --print-equations
```

Exit codes: `0` ok, `2` bad input/config, `3` no strokes detected.

## Web

```bash
.venv/bin/python app.py --port 8000
```

- `GET /health`, `GET /api/presets`
- `POST /api/process` (multipart `file`, plus `preset`, `config` JSON, `debug`);
  returns `{report, image_png_b64, image_clean_b64, debug_png_b64}` —
  labeled overlay, label-free twin, and optional mask/skeleton view.
- Limits: 15MB uploads, 2 concurrent jobs, 180s timeout.
  Dense photo/noise input is rejected (422), not hung.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
```

## Limits (by design)

- **Dotted art**: dots below `min_component_area` (default 12px) are specks;
  gaps wider than `merge_endpoint_distance` (default 14px) won't join.
  Tune both knobs for dotted lines.
- **Touching strokes**: lines ~1px apart skeletonize into one centerline
  and trace as a single stroke. Separate your strokes by more than the
  stroke width.
- **Tiny text**: glyphs under ~12px tall are partially removed as specks.
  Use a larger image or lower `min_component_area` / `min_stroke_length`.
- **Filled blobs**: a solid disc has no centerline; only its outline traces.
- **Photos/noise**: rejected fast (exit 3 / HTTP 422), never hung.
