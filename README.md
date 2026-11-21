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

- Four-step flow, desktop and phone layouts: **start** (drop/click/paste or a
  sample) → **check** (preview of the ink that will be traced, ink sensitivity,
  drawing type, minimalist-vs-pedantic fit, allowed curve types) → **working**
  (scan animation, rotating status lines, timer, cancel) → **result**.
- Result stage: the drawing as a faint ghost under the equations-only redraw on
  graph paper, with a blend slider, labels, "show the wobble" ticks, hold Space
  to flip to the original, Pixels / Math y-up coordinates, and hover
  highlighting. Equations are numbered, each carries a fit verdict
  ("spot on" / "a bit wobbly"), and up to four session runs stay available
  as chips.
- Downloads: current-style PNGs (drawing + equations, equations only, with
  labels) and the math as Desmos, LaTeX, text or JSON.
- `GET /health`, `GET /api/presets`
- `POST /api/process` (multipart `file`, plus `preset`, `config` JSON, `debug`);
  returns `{report, image_png_b64, image_clean_b64, image_redraw_b64,
  image_redraw_labels_b64, debug_png_b64}` — labeled overlay, label-free twin,
  equations-only redraw, labeled redraw, and optional mask/skeleton view.
- Colour: each fitted curve uses the pen colour sampled from the drawing
  (`color_by: "original"`, set `stroke`/`segment` for the palette), and the
  redraw reuses the paper colour and measured pen width, so it reads as a
  faithful reproduction rather than a rainbow.
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
- **Filled regions**: solid blobs, letters and frames are vectorised as filled
  contours (outer boundary plus holes) and their boundaries are fitted as
  equations too. Turn it off with `enable_fill: false`.
- **Photos/noise**: rejected fast (exit 3 / HTTP 422), never hung.
