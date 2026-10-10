/* Chawk frontend: vanilla JS, same-origin API. State + render, no framework. */
"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  health: $("health"), file: $("file"), dz: $("dropzone"), dzLabel: $("dz-label"),
  preview: $("preview"), facts: $("facts"),
  presets: $("presets"), customNote: $("custom-note"), reset: $("reset"),
  rmse: $("rmse"), rmseVal: $("rmse-val"), maxerr: $("maxerr"), maxerrVal: $("maxerr-val"),
  poly: $("poly"), polyVal: $("poly-val"),
  mCircle: $("m-circle"), mEllipse: $("m-ellipse"), mSinusoid: $("m-sinusoid"),
  mSpline: $("m-spline"), labels: $("labels"), debug: $("debug"),
  go: $("go"), cancel: $("cancel"), status: $("status"),
  error: $("error"), errorText: $("error-text"), errorAction: $("error-action"),
  placeholder: $("placeholder"), progress: $("progress"), progressText: $("progress-text"),
  result: $("result"), resultHeading: $("result-heading"), output: $("output"),
  summary: $("summary"), dlPng: $("dl-png"), dlJson: $("dl-json"), equations: $("equations"),
};
const viewBtns = [...document.querySelectorAll("[data-view]")];
const presetBtns = [...document.querySelectorAll("[data-preset]")];
const STORE_KEY = "chawk-settings-v1";
const MAX_BYTES = 15 * 1024 * 1024;

const state = {
  file: null, previewURL: null,
  status: "idle", // idle | working | done | error
  result: null,   // { report, annotatedURL, debugURL }
  view: "fitted",
  error: null,    // { message, action: null | { label, run } }
  controller: null, timerId: null, t0: 0,
  urls: [],
};

/* ---------- settings ---------- */
function readSettings() {
  const presetEl = document.querySelector('[data-preset][aria-pressed="true"]');
  return {
    preset: presetEl ? presetEl.dataset.preset : "balanced",
    rmse_tolerance: Number(els.rmse.value),
    max_error_tolerance: Number(els.maxerr.value),
    max_poly_degree: Number(els.poly.value),
    enable_circle: els.mCircle.checked,
    enable_ellipse: els.mEllipse.checked,
    enable_sinusoid: els.mSinusoid.checked,
    enable_spline: els.mSpline.checked,
    label_equations: els.labels.checked,
    debug: els.debug.checked,
  };
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(readSettings())); } catch { /* private mode */ }
}
function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* ignore */ }
  if (!s) return false;
  if (s.preset) setPreset(s.preset, true);
  if (s.rmse_tolerance) els.rmse.value = s.rmse_tolerance;
  if (s.max_error_tolerance) els.maxerr.value = s.max_error_tolerance;
  if (s.max_poly_degree) els.poly.value = s.max_poly_degree;
  for (const [key, el] of [["enable_circle", els.mCircle], ["enable_ellipse", els.mEllipse],
      ["enable_sinusoid", els.mSinusoid], ["enable_spline", els.mSpline],
      ["label_equations", els.labels], ["debug", els.debug]]) {
    if (typeof s[key] === "boolean") el.checked = s[key];
  }
  return true;
}
function setPreset(name, silent) {
  let known = false;
  for (const b of presetBtns) {
    const on = b.dataset.preset === name;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) known = true;
  }
  els.customNote.hidden = known;
  if (!silent) saveSettings();
}
function markCustom() {
  for (const b of presetBtns) b.setAttribute("aria-pressed", "false");
  els.customNote.hidden = false;
  saveSettings();
}
function paintSliderLabels() {
  els.rmseVal.textContent = Number(els.rmse.value).toFixed(1) + "px";
  els.maxerrVal.textContent = Number(els.maxerr.value).toFixed(1) + "px";
  els.polyVal.textContent = els.poly.value;
}

/* ---------- status / error ---------- */
function setStatus(msg) { els.status.textContent = msg || ""; }
function showError(message, action) {
  state.error = message ? { message, action: action || null } : null;
  els.error.hidden = !message;
  els.errorText.textContent = message || "";
  const a = state.error && state.error.action;
  els.errorAction.hidden = !a;
  if (a) {
    els.errorAction.textContent = a.label;
    els.errorAction.onclick = () => { showError(""); a.run(); };
  }
  if (message) (a ? els.errorAction : els.error).focus();
}
function forgetURLs() {
  for (const u of state.urls) URL.revokeObjectURL(u);
  state.urls = [];
}

/* ---------- file intake ---------- */
function fmtMB(n) { return (n / 1048576).toFixed(1) + "MB"; }
async function chooseFile(f) {
  if (!f) return false;
  const okType = /^image\//.test(f.type) || /\.(png|jpe?g|bmp|webp|tiff?)$/i.test(f.name);
  if (!okType) { showError("That doesn't look like an image — use PNG, JPG, BMP, WEBP or TIFF."); return false; }
  if (f.size > MAX_BYTES) { showError(`Too large (${fmtMB(f.size)}). The limit is 15MB — try a smaller export.`); return false; }
  if (f.size === 0) { showError("That file is empty (0 bytes)."); return false; }
  try {
    const bmp = await createImageBitmap(f);
    const w = bmp.width, h = bmp.height;
    bmp.close();
    if (w < 2 || h < 2) { showError(`Too tiny (${w}×${h}px) — need at least a few pixels of drawing.`); return false; }
    if (Math.max(w, h) > 6000) { showError(`Huge (${w}×${h}px). It may time out — try scaling below ~4000px.`); return false; }
    state.fileFacts = `${w}×${h}px`;
  } catch { state.fileFacts = ""; }
  if (state.previewURL) URL.revokeObjectURL(state.previewURL);
  state.file = f;
  state.previewURL = URL.createObjectURL(f);
  els.preview.src = state.previewURL;
  els.preview.hidden = false;
  els.dzLabel.style.display = "none";
  els.facts.hidden = false;
  els.facts.textContent = `${f.name} · ${fmtMB(f.size)}${state.fileFacts ? " · " + state.fileFacts : ""}`;
  showError("");
  els.go.disabled = false;
  return true;
}
async function loadSample(name, auto) {
  setStatus("Loading sample…");
  try {
    const r = await fetch("samples/" + name);
    if (!r.ok) throw new Error("not found");
    const blob = await r.blob();
    if (await chooseFile(new File([blob], name, { type: "image/png" }))) {
      setStatus("");
      if (auto) go();
    }
  } catch { showError("Couldn't load the sample. Check the server is running."); setStatus(""); }
}

/* ---------- job ---------- */
const STAGES = [[0, "Uploading…"], [1000, "Tracing strokes…"], [2500, "Fitting equations…"]];
function tick() {
  const el = Date.now() - state.t0;
  let label = STAGES[0][1];
  for (const [t, s] of STAGES) if (el >= t) label = s;
  els.progressText.textContent = `${label} ${(el / 1000).toFixed(1)}s`;
}
function setWorking(on) {
  els.go.disabled = on || !state.file;
  els.cancel.hidden = !on;
  els.progress.hidden = !on;
  els.dz.style.pointerEvents = on ? "none" : "";
  if (on) {
    state.t0 = Date.now();
    els.progressText.textContent = "Uploading…";
    state.timerId = setInterval(tick, 200);
  } else clearInterval(state.timerId);
}
function buildConfig() {
  const s = readSettings();
  return {
    rmse_tolerance: s.rmse_tolerance,
    max_error_tolerance: s.max_error_tolerance,
    max_poly_degree: s.max_poly_degree,
    enable_circle: s.enable_circle,
    enable_ellipse: s.enable_ellipse,
    enable_sinusoid: s.enable_sinusoid,
    enable_spline: s.enable_spline,
    label_equations: s.label_equations,
  };
}
async function go() {
  if (!state.file || state.status === "working") return;
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  state.status = "working";
  state.view = "fitted";
  showError("");
  forgetURLs();
  els.result.hidden = true;
  els.placeholder.hidden = true;
  setWorking(true);
  setStatus("");
  const s = readSettings();
  const form = new FormData();
  form.append("file", state.file);
  form.append("preset", s.preset);
  form.append("config", JSON.stringify(buildConfig()));
  form.append("debug", s.debug ? "true" : "false");
  let res;
  try {
    res = await fetch("/api/process", { method: "POST", body: form, signal: state.controller.signal });
  } catch (e) {
    setWorking(false);
    if (e.name === "AbortError") { state.status = "idle"; setStatus("Cancelled."); }
    else {
      state.status = "error";
      showError("Couldn't reach the server. Is it still running?", { label: "Retry", run: go });
    }
    return;
  }
  setWorking(false);
  if (!res.ok) {
    state.status = "error";
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* keep */ }
    if (res.status === 422) showError(detail + " Dark lines on white work best; photos and transparent logos often fail.", { label: "Try a sample instead", run: () => loadSample("sine_wave.png", true) });
    else if (res.status === 504) showError(detail, { label: "Re-run as Simple", run: () => { setPreset("simple"); go(); } });
    else if (res.status === 400 && /config|preset/i.test(detail)) showError(detail, { label: "Reset to Balanced", run: () => { setPreset("balanced"); } });
    else if (res.status === 413) showError(detail + " Export a smaller image and try again.");
    else showError(`Error ${res.status}: ${detail}`, { label: "Retry", run: go });
    els.placeholder.hidden = false;
    return;
  }
  const out = await res.json();
  const pngURL = URL.createObjectURL(new Blob(
    [Uint8Array.from(atob(out.image_png_b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
  state.urls.push(pngURL);
  let debugURL = null;
  if (out.debug_png_b64) {
    debugURL = URL.createObjectURL(new Blob(
      [Uint8Array.from(atob(out.debug_png_b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
    state.urls.push(debugURL);
  }
  state.result = { report: out.report, annotatedURL: pngURL, debugURL };
  state.status = "done";
  renderResult();
  const t = out.timings_sec && out.timings_sec.server_total;
  setStatus(t ? `Done in ${t}s.` : "Done.");
  els.resultHeading.focus();
}

/* ---------- results ---------- */
function chip(text, title) {
  const s = document.createElement("span");
  s.className = "chip";
  s.textContent = text;
  if (title) s.title = title;
  return s;
}
function fitWord(rmse) {
  if (rmse == null) return "Unknown";
  if (rmse <= 0.5) return "Excellent";
  if (rmse <= 1) return "Good";
  if (rmse <= 2) return "Fair";
  return "Rough";
}
function renderResult() {
  const { report } = state.result;
  const s = report.summary;
  els.result.hidden = false;
  els.placeholder.hidden = true;
  // view switch
  const dbgBtn = viewBtns.find((b) => b.dataset.view === "debug");
  dbgBtn.hidden = !state.result.debugURL;
  paintView();
  // summary
  els.summary.innerHTML = "";
  els.summary.append(
    chip(`${s.segment_count} equations from ${s.stroke_count} strokes`),
    chip(`off by ~${s.mean_rmse_px}px`, `Mean RMSE ${s.mean_rmse_px}px, max ${s.max_rmse_px}px`),
    chip(fitWord(s.mean_rmse_px), `Mean R² ${s.mean_r_squared}`),
  );
  // downloads
  els.dlPng.href = state.result.annotatedURL;
  const jsonURL = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  state.urls.push(jsonURL);
  els.dlJson.href = jsonURL;
  // equations
  els.equations.innerHTML = "";
  const palette = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080"];
  report.strokes.forEach((st, si) => {
    const div = document.createElement("div");
    div.className = "stroke";
    const models = [...new Set(st.segments.map((g) => g.model))].join(" + ");
    const h = document.createElement("h3");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = palette[si % palette.length];
    h.append(dot, ` Stroke ${st.stroke_id} — ${models} (${st.segment_count})`);
    div.append(h);
    for (const sg of st.segments) {
      const p = document.createElement("p");
      p.className = "seg";
      const b = document.createElement("span");
      b.className = "badge " + (sg.r_squared == null ? "" : sg.r_squared >= 0.98 ? "ok" : sg.r_squared >= 0.9 ? "warn" : "bad");
      b.textContent = sg.model;
      const eq = document.createElement("span");
      eq.className = "eq";
      eq.textContent = sg.equation;
      const m = document.createElement("span");
      m.className = "meta";
      const r2 = typeof sg.r_squared === "number" ? sg.r_squared.toFixed(4) : "n/a";
      const rm = typeof sg.rmse === "number" ? sg.rmse.toFixed(2) + "px" : "n/a";
      m.textContent = `R²=${r2} · ${rm}`;
      if (sg.notes && sg.notes.length) m.textContent += " · " + sg.notes.join("; ");
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy";
      copy.textContent = "copy";
      copy.setAttribute("aria-label", `Copy equation ${sg.equation}`);
      copy.onclick = async () => {
        const text = `${sg.equation}, x in [${sg.x_range}], y in [${sg.y_range}]`;
        try { await navigator.clipboard.writeText(text); copy.textContent = "copied"; }
        catch {
          const ta = document.createElement("textarea");
          ta.value = text; document.body.append(ta); ta.select();
          try { document.execCommand("copy"); copy.textContent = "copied"; } catch { copy.textContent = "failed"; }
          ta.remove();
        }
        setTimeout(() => { copy.textContent = "copy"; }, 1200);
      };
      p.append(b, eq, m, copy);
      div.append(p);
    }
    els.equations.append(div);
  });
}
function paintView() {
  for (const b of viewBtns) b.setAttribute("aria-pressed", b.dataset.view === state.view ? "true" : "false");
  if (!state.result) return;
  els.output.src = state.view === "original" ? state.previewURL
    : state.view === "debug" && state.result.debugURL ? state.result.debugURL
    : state.result.annotatedURL;
  els.output.alt = state.view === "original" ? "your original drawing"
    : state.view === "debug" ? "binary mask and skeleton debug view"
    : "drawing with fitted equation curves overlaid";
}

/* ---------- wiring ---------- */
els.dz.addEventListener("click", () => els.file.click());
els.dz.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.file.click(); }
});
els.file.addEventListener("change", () => chooseFile(els.file.files[0]));
for (const ev of ["dragover", "dragenter"]) {
  document.addEventListener(ev, (e) => { e.preventDefault(); els.dz.classList.add("drag"); });
}
for (const ev of ["dragleave", "drop"]) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && e.relatedTarget) return;
    els.dz.classList.remove("drag");
  });
}
document.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) chooseFile(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  const items = (e.clipboardData && e.clipboardData.files) || [];
  if (items.length) chooseFile(items[0]);
});
for (const b of presetBtns) b.addEventListener("click", () => { setPreset(b.dataset.preset); });
els.reset.addEventListener("click", () => setPreset("balanced"));
for (const el of [els.rmse, els.maxerr, els.poly, els.mCircle, els.mEllipse,
    els.mSinusoid, els.mSpline, els.labels, els.debug]) {
  el.addEventListener("input", () => { paintSliderLabels(); markCustom(); });
}
for (const b of viewBtns) b.addEventListener("click", () => { state.view = b.dataset.view; paintView(); });
document.querySelectorAll("[data-sample]").forEach((b) =>
  b.addEventListener("click", () => loadSample(b.dataset.sample, true)));
els.go.addEventListener("click", go);
els.cancel.addEventListener("click", () => state.controller && state.controller.abort());

async function checkHealth() {
  try {
    const r = await fetch("/health");
    if (!r.ok) throw new Error();
    els.health.textContent = "server v" + (await r.json()).version;
    els.health.className = "health ok";
  } catch {
    els.health.textContent = "server unreachable — start it with .venv/bin/python app.py";
    els.health.className = "health down";
  }
}
async function syncDefaults() {
  try {
    const r = await fetch("/api/presets");
    if (!r.ok) return;
    const d = (await r.json()).defaults || {};
    if (d.rmse_tolerance) els.rmse.value = d.rmse_tolerance;
    if (d.max_error_tolerance) els.maxerr.value = d.max_error_tolerance;
    if (d.max_poly_degree) els.poly.value = d.max_poly_degree;
    paintSliderLabels();
  } catch { /* static defaults stand */ }
}

paintSliderLabels();
const hadStored = loadSettings();
paintSliderLabels();
if (!hadStored) syncDefaults();
checkHealth();
