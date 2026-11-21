# Chawk — UI/UX redesign brief

> **Status:** superseded. The redesign in `Chawk — UI UX design.html` has been
> implemented in `frontend/` (start → check → result). This file is kept as the
> product/API context and the pre-redesign critique, not as future work.

**Purpose of this document:** hand this file to a designer or an AI agent and ask it to
produce a new UI/UX skeleton (HTML/CSS/JS) for Chawk. It contains the product, the data
contract, every behaviour that must survive, an honest critique of the current UI, and
the technical constraints. No access to the current codebase is assumed beyond the
file paths named here.

Repo root: `/home/himel/Documents/chawk`
Live dev server: `http://127.0.0.1:8010` (run `.venv/bin/python app.py --port 8010` from
the repo root)

---

## 1. The product in one page

**Chawk turns a line drawing into the mathematical equations of its strokes.**

Upload a hand-drawn or generated line drawing (a sine wave, a circle, a parabola, a
sketch), and Chawk:

1. thresholds the image and reduces it to 1-pixel skeletons,
2. traces ordered strokes through junctions and self-intersections,
3. segments each stroke where the curvature changes and fits a model per segment
   (line, polynomial, circle, ellipse, elliptical arc, sinusoid, freeform spline),
4. renders the fitted equations back over the drawing, or alone on blank paper,
5. reports every equation with its fit quality (R², RMSE, max error) as JSON/text/LaTeX.

It is a **single-shot analysis tool**, not an editor. One image in → one report out.
There are no accounts, no saved projects, no collaboration, no server-side history.
Everything in the UI is derived from one API response.

The killer moment the UI must sell: **the drawing is reproduced by its equations.**
Right now that moment is buried. A user sees a rainbow overlay and a narrow list of
formulas; the "redraw from equations only" output — the actual wow — is one of three
tabs and is not compared against the source side by side.

**Current visual identity:** dark "lab" canvas (`#101014`), electric blue accent
(`#6e9bff`), Remix icons, KaTeX for math, white paper art floating on the dark surface.
It reads like a generic developer tool. It can be replaced, but keep the name **Chawk**.

**Audience:** students, teachers, physics/maths hobbyists, people digitising sketches,
and developers testing what the engine can fit. Mostly desktop, often phone for quick
checks. Technical comfort varies; assume no knowledge of "RMSE" or "skeleton".

---

## 2. Jobs to be done

| User | Job | Success feels like |
|---|---|---|
| Curious visitor | "What does this thing do?" | Understands in 10 seconds from the empty state |
| Student | Turn a sketched graph into its equation | Copies one equation without reading the rest |
| Teacher | Show that a curve *is* a function | A clean before/after they can put on a slide |
| Hobbyist | Digitise a doodle | Downloads a picture that looks like their drawing |
| Developer | Probe the fitter | Changes presets, reads R²/RMSE, compares runs |

Primary task: **upload → see equations → copy/download them**.
Secondary: **inspect whether the equations actually match the drawing.**

---

## 3. What the engine can and cannot do (do not promise more)

**Can**
- Trace and fit 1–400 strokes (up to ~1200 in the "dense art" preset).
- Fit several segments per stroke, each with its own model and equation.
- Handle dark-on-light and light-on-dark art (auto-detected polarity).
- Reproduce each stroke in **its sampled pen colour** and the drawing's **own paper
  colour**, at the measured pen width, when rendering the "redraw".
- Return three ready-made PNGs per run (labeled overlay, unlabeled overlay, redraw).
- Copy an equation as LaTeX; export all equations as `.txt` or a LaTeX `align` block.
- Fit quality per segment: `r_squared`, `rmse`, `max_error`, `bic`, `notes`.
- Re-run with different presets/tuning; results replace the previous run.

**Cannot (today)**
- Edit an equation and have the drawing update. Equations are output only.
- Export SVG/vector paths, or 3D, or animation.
- Batch upload several images in one run (the folder-batch script is CLI-only).
- Persist results, share links, or keep run history.
- Draw labels outside the baked PNG, move them, or show a label-free per-segment image.
- Render custom overlays client-side: the curves are baked by matplotlib server-side.
  The report contains equations and bounding boxes, **not** sampled curve points.
- Process photos: dense/noisy input is rejected by design (HTTP 422).
- Accept images over 15 MB, or jobs longer than 180 s.

**Known engine limits** worth surfacing gently in UI copy: dots under 12 px are removed
as specks; strokes closer than ~1 px merge; filled blobs only produce outlines; very
small text is partially removed.

---

## 4. Current surface area

```
frontend/index.html      single page
frontend/styles.css      all styling (~11 KB), dark theme, CSS variables
frontend/app.js          all behaviour (~22 KB), vanilla classic script, DOM ids via $()
frontend/math.js         chawkToLatex(), renderEquationHTML(), TXT/TeX exporters
frontend/samples/        sine_wave.png, geometric.png, parabola_line.png
frontend/vendor/         katex/ (CSS+JS), remixicon.css + fonts
app.py                   FastAPI: /health, /api/presets, /api/process, static mount "/"
chawk/                   the engine (do not modify for a UI-only redesign)
tests/test_frontend.py   static checks: files exist, HTML hooks, node --check, DOM ids
```

There is **no build step, no npm, no framework, no bundler**. `index.html` is served
directly by FastAPI's `StaticFiles`. Any redesign must remain plain static files loaded
by `<link>`/`<script>` (or, if you propose a build step, say so explicitly and treat it
as a backend/tooling change — the default expectation is zero build).

---

## 5. API contract (the UI's only data source)

### `GET /health`
```json
{ "status": "ok", "version": "1.1.0" }
```
Used for the connection dot and version label.

### `GET /api/presets`
```json
{
  "presets": ["balanced", "complex", "precise", "simple"],
  "defaults": { "...full Config..." : "..." },
  "limits": { "max_upload_bytes": 15728640 }
}
```
`defaults` is the full engine config. The UI only needs the four knobs listed in §6.

### `POST /api/process` (multipart/form-data)

| field | type | notes |
|---|---|---|
| `file` | file | PNG/JPEG/BMP/WEBP/TIFF, ≤ 15 MB |
| `preset` | string | one of the four names |
| `config` | JSON string | optional overrides, e.g. `{"rmse_tolerance":1.4}` |
| `debug` | "true"/"false" | optional; adds a mask/skeleton PNG |

Unknown config keys are rejected with HTTP 400. Unknown preset → 400.

Response:
```json
{
  "report": { ...see §6... },
  "image_png_b64":   "…",   // source + fitted curves + baked equation labels
  "image_clean_b64": "…",   // source + fitted curves, no labels
  "image_redraw_b64":"…",   // equations only, on the drawing's paper colour
  "debug_png_b64":   null,  // mask/skeleton side-by-side when debug=true
  "timings_sec": { "server_total": 0.44 }
}
```
All three PNGs are pre-rendered server-side on every request, so switching views in the
UI is instant (no refetch, no re-fit). Typical time: 0.4 s for a simple drawing, ~4 s for
a 20-stroke scene. Hard timeout 180 s, 2 concurrent jobs.

### Error catalogue (HTTP status → user-facing meaning)

| status | meaning | suggested recovery |
|---|---|---|
| 400 | bad/unknown config, corrupt image | inline validation; "reset tuning" |
| 413 | upload over 15 MB | "shrink or re-export the image" |
| 422 | no strokes: blank, faint, or photo-like input | "try a sample", "use a darker pen / higher contrast" |
| 504 | job exceeded 180 s (very dense art) | "retry as Simple" |
| 5xx | server failure | retry |

Client-side pre-checks before upload: is an image, ≤ 15 MB, ≥ 2 px, ≤ 6000 px per side.
Currently these produce toast messages; a redesign should make them inline and specific.

---

## 6. Report schema (everything the result UI may show)

```jsonc
{
  "source": "sine_wave.png",
  "image_size": { "width": 640, "height": 420 },
  "working_scale": 1.0,          // processing scale, 0–1
  "stroke_thickness_px": 4.56,
  "ink_ratio": 0.01234,          // fraction of pixels that are ink
  "summary": {
    "stroke_count": 1,
    "segment_count": 1,
    "mean_r_squared": 0.999999,
    "length_weighted_r_squared": 0.999999,
    "mean_rmse_px": 0.1343,
    "max_rmse_px": 0.1343,
    "segments_within_tolerance": 1,
    "models_used": { "sinusoid": 1 }
  },
  "config": { "...full config used for this run..." },
  "timings_sec": { "preprocess": 0.05, "trace": 0.1, "fit": 0.2, "render": 0.1, "total": 0.44 },
  "strokes": [
    {
      "stroke_id": 1,
      "closed": false,
      "arc_length": 653.6,
      "point_count": 327,
      "bbox": [80.0, 177.0, 559.0, 379.0],   // original-image pixels
      "merged_from_pieces": 1,
      "color": "#000000",                    // sampled pen colour
      "segment_count": 1,
      "segments": [
        {
          "segment_id": 1,
          "model": "sinusoid",               // line | polynomialN | circle | ellipse |
          "equation": "y = 89.8525·sin(0.022x - 1.1953) + 209.4678",
          "params": { "...model specific..." },
          "domain": { "...model specific..." },
          "x_range": [80.0, 559.0],
          "y_range": [177.0, 379.0],
          "pixel_start": [80.0, 379.0],
          "pixel_end": [559.0, 177.0],
          "point_count": 327,
          "arc_length": 653.6,
          "r_squared": 1.0,
          "rmse": 0.12,
          "max_error": 0.31,
          "bic": -1234.5,
          "closed": false,
          "notes": ["closed shape fitted as a single curve"]
        }
      ]
    }
  ]
}
```
Model names that can appear: `line`, `polynomial2`…`polynomial6`, `circle`, `ellipse`,
`elliptical_arc`, `sinusoid`, `spline`, `point`. `spline` equations are prose, not math.
Values are rounded; `null` is possible for non-finite numbers.

**How the current UI uses the report**
- `stroke.bbox` + `x_range/y_range` → hover highlight boxes positioned over the displayed
  image (convert image pixels to displayed pixels via object-fit math).
- `color` → available for per-stroke accents (current UI still uses a fixed palette for
  sheet dots; you may use the real ink colour where contrast allows).
- `r_squared` / `rmse` → badges and the "Excellent/Good/Fair/Rough" verdict.
- `segments` → KaTeX-rendered equations, copy-to-clipboard, notes.
- `timings_sec` → "Traced in 0.44s" status.

---

## 7. Feature checklist the redesign must keep

Every item below exists today and is expected in the skeleton. None is optional unless
marked *(nice to have)*.

**Input**
- [ ] Drag & drop anywhere on the page, click-to-choose, and Ctrl/⌘+V paste.
- [ ] Three one-click samples (sine, shapes, curve) that run immediately.
- [ ] Client-side validation with specific messages (type, size, dimensions).
- [ ] Empty state that explains the product, not just the gestures.

**Run**
- [ ] One primary action ("Trace"), disabled with no image.
- [ ] The same button becomes Cancel while a job runs (don't shift layout).
- [ ] Progress feedback with elapsed time and stage (uploading / tracing / fitting).
- [ ] Re-trace with a new preset or tuning; result replaces the old one.
- [ ] "New" / reset to start over.

**Result views**
- [ ] **Equations** — source drawing + fitted curves + baked labels.
- [ ] **Fitted** — source + curves, no labels (instant toggle, no refit).
- [ ] **Redraw** — equations only on the drawing's own paper colour (the hero view).
- [ ] Instant switching between the three (all images are already in memory).
- [ ] *(nice to have)* side-by-side or slider comparison of source vs redraw.
- [ ] *(nice to have)* zoom/pan to inspect fit quality.

**Equations panel**
- [ ] Summary: stroke count, equation count, overall fit verdict.
- [ ] Grouped by stroke; each segment shows model name, equation (KaTeX), R²/RMSE.
- [ ] Per-equation copy as LaTeX (with success feedback; clipboard fallback).
- [ ] Hover/focus a stroke or segment → highlight its region on the image.
- [ ] Notes (e.g. "bounded by a detected corner") shown where relevant.

**Downloads**
- [ ] Current view as PNG (file named after the source, e.g. `sine_wave-redraw.png`).
- [ ] Equations only as `.txt` (one per line, `#` comment header).
- [ ] LaTeX `align` block as `.tex`.
- [ ] Full JSON report as `.json`.
- [ ] The image itself has a quick download affordance.

**Presets & tuning**
- [ ] Four presets: Balanced, Precise, Simple, Dense art; "Custom" when tuned.
- [ ] Tune panel: Detail (RMSE tolerance 0.5–6 px), Max wiggle (2–15 px),
      Max degree (1–6), and enable/disable circles, ellipses, waves, freeform.
- [ ] Reset to Balanced.
- [ ] Settings persisted in `localStorage` (`chawk-settings-v1` today).

**System**
- [ ] Backend reachability indicator (+ version).
- [ ] Error toast with a recovery action (retry, try a sample, re-run simple, reset).
- [ ] Keyboard: Escape closes menus; Enter/Space on the canvas opens the file picker.
- [ ] Responsive down to 360 px; usable one-handed on a phone.

---

## 8. Honest critique of the current UI

The redesign should visibly fix these:

1. **The dock overflows on phones.** Six pills in a fixed floating bar; on 390 px the
   left and right ends are clipped.
2. **The view switcher floats over the artwork** (top-right of the image card) and can
   cover the baked-in title or a label.
3. **Three different things are called "Equations"** — the view tab, the dock button that
   opens the equation sheet, and the download format. Users cannot tell them apart.
4. **The "Labels" toggle is a lie.** It swaps between the Equations and Fitted views
   rather than toggling labels; it disappears in Redraw. Semantics are opaque.
5. **The equation sheet is a fixed 340 px column**, cramming a two-line header and
   scrolling through every segment. Dense art becomes a wall of formulas with no way to
   search, collapse, or jump from an equation to its place in the drawing.
6. **The hero output is hidden.** "Redraw" reproduces the drawing from equations alone,
   yet it is a third tab with no comparison to the original. This is the product's
   proof and should be the centrepiece.
7. **No zoom.** You cannot inspect whether a fit follows the ink at pixel level.
8. **The empty state explains gestures** ("Drop a drawing anywhere · click · Ctrl+V")
   but not the promise ("get the equation of every stroke").
9. **Labels are baked into the PNG** and may overlap. The UI cannot reposition them.
10. **Colour languages clash**: ink colours in the output vs a fixed 16-colour palette for
    sheet dots and highlight boxes.
11. **Drop-up menus from a floating dock** (preset, tune, download) are fragile on small
    screens and easy to lose.
12. **Errors are toasts only**; there is no inline explanation next to the control that
    caused them.
13. **No run history / comparison.** Trying a preset replaces the result, so you cannot
    compare Balanced vs Precise.
14. **Progress is cosmetic** ("Tracing strokes… 2.3 s" while the server does everything in
    one request); long runs feel stuck.
15. **Dark-only.** For a tool whose content is white paper art, the workspace is a dark
    void that makes the art feel like a photo in a viewer.

Keep what genuinely works: one-screen focus, the instant three-way view toggle, the
samples-as-onboarding, keyboard paste, and the copy-LaTeX affordance.

---

## 9. Design brief

### Positioning
"Point at a drawing; get its equations." Precise, a little nerdy, but friendly — a
lab instrument, not a SaaS dashboard. Confident, uncluttered, evidence-first.

### Principles
1. **The proof is the picture.** The comparison between the original and the
   equation-only redraw is the product. Make it the focal point of the result screen.
2. **One primary action at a time.** Upload/trace dominates the empty state; after a run
   the result dominates and controls recede.
3. **Show, don't lecture.** Fit quality appears next to the equation it describes, with a
   plain-language word (Excellent/Good/Fair/Rough) plus the number on demand.
4. **Progressive disclosure.** Presets and tuning live behind one clearly labelled
   "Settings/Tune" surface, not six chips fighting for the bottom edge.
5. **The drawing is the hero, not the chrome.** Neutral surfaces, generous whitespace
   around the artwork, minimal overlays, no element on top of the canvas that is not
   essential.
6. **Mobile is a first-class result viewer.** Upload and read equations on a phone;
   tuning can be secondary.
7. **Honest about limits.** Tell the user when a photo or faint scan is rejected and what
   to do, in place.

### Tone of voice
Short, concrete, second person. "Trace", "Redraw", "Copy LaTeX", "Excellent fit".
Avoid "RMSE", "BIC", "skeleton" in primary copy; expose them as secondary detail,
tooltips, or an "Advanced" area. "Dense art" rather than "complex preset".

### Visual direction (suggestion, not a straitjacket)
- Light workspace with a paper-like stage; the art sits on white with a soft shadow.
  Optional dark theme via `prefers-color-scheme`.
- One accent colour for actions; fit quality uses a restrained semantic scale
  (green/amber/red) only on badges, never on the artwork.
- Type: a geometric or humanist sans for UI; a monospace only for raw equations/JSON.
- Motion: ≤ 200 ms, purposeful; respect `prefers-reduced-motion`.

---

## 10. Information architecture

**Screens / states (single page is fine):**

| State | Content |
|---|---|
| `empty` | Brand, one-sentence promise, large drop target, 3 samples, limits note |
| `selected` (file chosen, not run) | Preview of the drawing, "Trace" primary, change/remove |
| `working` | Same layout as selected + progress, elapsed, cancel |
| `result` | Comparison stage (source ↔ redraw), view switcher, equations panel, downloads |
| `error` | Inline error card with cause + recovery actions (keep the last result if any) |

**Suggested result layout**
- Desktop: artwork stage 60–70% width with the three views; equations panel 30–40%,
  collapsible, independently scrollable. Downloads and settings in a toolbar above or
  beside the stage — never on top of the image.
- Mobile: artwork edge-to-edge, a segmented view control underneath it (not overlapping),
  and a draggable bottom sheet for equations with the summary always visible.
- Compare mode (*recommended*): side-by-side source vs redraw with a draggable divider or
  an A/B toggle, defaulting to Redraw after a run.


## 11. Component inventory

- **App shell** — brand, project/context area, global actions, connectivity dot.
- **Dropzone** — idle, drag-over, focused, disabled while running.
- **Sample cards** — three thumbnails with captions.
- **Art stage** — image with `object-fit: contain`, subtle paper shadow; permits overlay
  highlight boxes; view switcher docked *outside* the image bounds.
- **View switcher** — 3 segments, `aria-pressed`, keyboard arrow support; disabled
  while no result.
- **Progress** — determinate-looking stage text + elapsed; cancel action in place.
- **Summary block** — stroke/equation counts, verdict, mean RMSE, models used.
- **Equation group** — stroke header (colour dot, status, length), segment rows
  (model badge, equation, R²/RMSE, copy button, notes).
- **Downloads menu** — current-view PNG, equations TXT, LaTeX TEX, JSON report.
- **Preset control** — four options + "Custom" state; descriptions in one line each.
- **Tune panel** — three sliders with live value labels + four model toggles + reset.
- **Toast / inline error** — message + one recovery action; `role="alert"`.
- **Empty-state hero** — promise, drop target, samples, one-line limits.

Every interactive element needs: default / hover / focus-visible / active / disabled /
aria-pressed (where toggle) states.

---

## 12. Interaction details worth specifying

- **Drop/paste anywhere**, not just on the canvas; ignore non-image files with a clear
  message; the dropzone shows a drag-over state.
- **Trace button** is the only primary; while running it turns into Cancel without
  changing width (no layout shift).
- **View switches** are instant because all images are already loaded; keep the previous
  scroll position in the equations panel.
- **Label toggle** applies to the source views only (Equations/Fitted). In Redraw there
  are no labels: hide or disable it with an explanation rather than a dead control.
- **Hover a stroke header or segment** highlights its bounding box on the displayed
  image; focus on mobile/tablet should do the same when tapped.
- **Copy LaTeX** writes `\(<tex>\)`, shows a check for ~1 s, and falls back to a hidden
  textarea + `execCommand` when the Clipboard API is unavailable.
- **Download** names files from the source: `<name>.png`, `<name>-equations.txt`,
  `<name>-equations.tex`, `<name>.json`.
- **Escape** closes any menu/panel; **Enter/Space** on the empty canvas opens the picker.
- **Re-run** keeps the same image; the "New" action clears it.
- **Errors** persist until dismissed and offer exactly one next step; 422 suggests a
  sample, 504 suggests the Simple preset, 400 suggests resetting tuning.

---

## 13. Accessibility, responsiveness, performance

**Accessibility (WCAG 2.1 AA)**
- Full keyboard operation; visible `:focus-visible` rings; logical tab order.
- The stage image has meaningful `alt` per view ("drawing with fitted equations
  labeled", "drawing redrawn purely from the fitted equations").
- Live regions: `role="status"` for progress, `role="alert"` for errors.
- Equation rows expose readable text even if KaTeX fails to render.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries; don't encode fit quality by colour
  alone (pair badges with words).
- `prefers-reduced-motion`: disable scanning/animated transitions.

**Responsive**
- Breakpoints at ~640, 1024, 1280 px.
- No horizontal page scroll at 360 px; controls wrap or collapse into a menu.
- The equations panel becomes a bottom sheet under ~900 px (drag handle, snap points).

**Performance**
- First meaningful paint < 1 s on a warm server; no layout shift when results arrive.
- All three PNGs are already returned by one request — reuse them; never re-fetch to
  toggle a view or label.
- Keep the page dependency-free; KaTeX and icons are vendored locally (`frontend/vendor/`).
- Don't block on fonts; if using a webfont, self-host and subset it.

---

## 14. Deliverables & technical constraints

**Produce**
1. `frontend/index.html` — semantic markup for all states (can be one page).
2. `frontend/styles.css` — complete styling, CSS custom properties, responsive rules.
3. `frontend/app.js` — behaviour, fetching `/api/process`, state machine, a11y wiring.
4. You may reuse or extend `frontend/math.js` (LaTeX conversion, TXT/TEX exporters).
5. Optionally a short rationale in `docs/UI_NOTES.md` (no screenshots needed).

**Do not**
- Modify `app.py` or anything under `chawk/` for a UI-only redesign. If you need a
  backend change (e.g. SVG export, per-segment label-free images, curve point data),
  list it as a **proposal**, don't assume it exists.
- Add npm/build tooling, remote CDNs, analytics, accounts, or persistence.
- Rename the product or remove the three samples.
- Promise editing equations, vector export, batch upload, or history.

**Compatibility target**
- Current Chrome, Firefox, Safari, Edge (last 2 versions); iOS Safari 16+, Android Chrome.
- ES2020 syntax, no TypeScript, no JSX, no module bundler required.

**Existing static checks to keep green** (`tests/test_frontend.py`)
- `frontend/index.html`, `app.js`, `styles.css` exist; the three sample PNGs exist.
- `index.html` contains the hooks `dropzone`, `presets`, `data-view`, `data-sample`,
  `data-view="redraw"`, `role="alert"`, `aria-live` (adapt the test if the new IA
  legitimately changes these names, but keep the intent).
- Every `$("id")` referenced in `app.js` exists as `id="…"` in `index.html`.
- `node --check` passes for `app.js` and `math.js`.
- Equation exports (`chawkEquationsText`, `chawkEquationsLatex`) keep their output shape,
  because other code and tests consume them.

---

## 15. Acceptance criteria for the skeleton

A reviewer should be able to tick all of these without reading the code:

- [ ] Purpose is understandable from the empty state without hovering anything.
- [ ] Upload works by drag, click, and paste; the three samples run in one click.
- [ ] A run shows progress, can be cancelled, and never shifts the layout.
- [ ] After a run the user can switch Source/Fitted/Redraw instantly with no network.
- [ ] The result screen makes the "equations reproduce the drawing" idea obvious,
      ideally by direct comparison with the original.
- [ ] Equations are grouped by stroke, readable, copyable as LaTeX, and each shows its
      fit quality in plain language.
- [ ] Hovering a stroke/segment highlights it on the artwork.
- [ ] Downloads offer the current view PNG, equations TXT, LaTeX TEX, and JSON.
- [ ] Presets and tuning are discoverable but not competing with the primary action.
- [ ] Errors explain the cause and offer one concrete next step, inline.
- [ ] Fully keyboard operable; focus states visible; live regions announced.
- [ ] No horizontal scroll at 360 px; the equations panel is usable on a phone.
- [ ] No element permanently covers the artwork or its labels.
- [ ] `node --check` passes and `python -m unittest discover -s tests` stays green
      (update DOM-hook tests if the contract genuinely changes).

---

## 16. Stretch ideas (optional, do not fake)

- Before/after comparison slider pinned to the same pixel coordinates.
- Zoom/pan with a magnifier over a selected segment.
- Preset A/B comparison of two runs (needs client-side state, not server history).
- Group equations by model; filter to "circles only".
- Export SVG — requires backend work; propose it.
- Shareable permalink — requires backend storage; propose it.
- Equation search/copy-all in one click.
- "Explain this fit" disclosure with R², RMSE, max error and a one-line plain-language
  explanation of each.

---

## 17. Running and testing locally

```bash
cd /home/himel/Documents/chawk
.venv/bin/python app.py --port 8010      # http://127.0.0.1:8010
.venv/bin/python -m unittest discover -s tests -v
```

Sample inputs already in the repo: `frontend/samples/sine_wave.png`,
`geometric.png`, `parabola_line.png`; harder ones in `tests/images/`.

API smoke test:
```bash
curl -s http://127.0.0.1:8010/health
curl -s -X POST http://127.0.0.1:8010/api/process \
  -F "file=@frontend/samples/sine_wave.png" -F "preset=balanced" \
  -o /tmp/chawk.json -w "%{http_code} %{time_total}s\n"
```

---

## 18. Appendix — copy inventory (rewrite freely, keep the meaning)

| Context | Current copy |
|---|---|
| Empty | "Drop a drawing anywhere · click · Ctrl+V" |
| Empty note | "dark lines on white · PNG/JPG ≤15MB" |
| Primary action | "Trace" → "Uploading…" → "Tracing strokes… 1.2s" → "Fitting equations… 2.0s" |
| Cancel | button label switches to the close icon |
| Status | "Traced in 0.44s." |
| Views | "Equations", "Fitted", "Redraw" |
| Labels | "Labels" (aria-pressed) |
| Sheet header | "2 strokes · 5 equations" |
| Fit verdict | "Excellent / Good / Fair / Rough · ~0.13px off" |
| Downloads | "Image · current view PNG", "Equations · text only", "LaTeX · align block", "Report · full JSON" |
| Presets | Balanced "good for most drawings"; Precise "tighter fit, more equations"; Simple "fewer, simpler equations"; Dense art "many strokes, busy drawings" |
| Tune | "Detail", "Max wiggle", "Max degree", "Curve types", "Reset to Balanced" |
| Errors | "Couldn't reach the server. Is it still running?", "No strokes detected…", "Image too large (limit 15MB)." |
| Health | "server v1.1.0 — reachable" |

---

## 19. One-paragraph prompt you can reuse

> Build a new UI/UX skeleton for **Chawk**, a line-art → equations tool, using only plain
> HTML, CSS, and vanilla JavaScript served as static files (no build step, no
> framework). Read the brief in `UI_BRIEF.md`. The backend contract is fixed:
> `POST /api/process` returns one JSON report plus three pre-rendered PNGs (labeled
> overlay, unlabeled overlay, equations-only redraw). Preserve every behaviour in §7 — upload by drop/click/paste, samples, one
> primary Trace action that becomes Cancel, instant three-view switching, equations
> grouped by stroke with KaTeX, copy-as-LaTeX, hover highlight, four downloads, four
> presets plus tuning, settings persistence, and inline error recovery. Fix the problems
> in §8: no controls overlapping the artwork, no dock overflow on phones, no three
> different things named "Equations", and make the source-vs-redraw comparison the
> centrepiece. Deliver `frontend/index.html`, `frontend/styles.css`, `frontend/app.js`
> (reuse `frontend/math.js`), meet the acceptance criteria in §15, and keep
> `node --check` plus the Python test suite green.
