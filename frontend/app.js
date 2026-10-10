/* Chawk lab UI: canvas-first, floating dock + equation sheet. Vanilla JS. */
"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  health: $("health"), tune: $("tune"), tuneDot: $("tune-dot"), tunePop: $("tune-pop"),
  reset: $("reset"), rmse: $("rmse"), rmseVal: $("rmse-val"),
  maxerr: $("maxerr"), maxerrVal: $("maxerr-val"), poly: $("poly"), polyVal: $("poly-val"),
  mCircle: $("m-circle"), mEllipse: $("m-ellipse"), mSinusoid: $("m-sinusoid"),
  mSpline: $("m-spline"), labels: $("labels"), debug: $("debug"),
  dz: $("dropzone"), file: $("file"), empty: $("empty"), paper: $("paper"), scan: $("scan"),
  go: $("go"), viewbar: $("viewbar"),
  serverVer: $("server-ver"), dlPng: $("dl-png"), dlJson: $("dl-json"),
  eqtoggle: $("eqtoggle"), fresh: $("fresh"),
  eqsheet: $("eqsheet"), eqclose: $("eqclose"), equations: $("equations"),
  statStrokes: $("stat-strokes"), statEqs: $("stat-eqs"), statFit: $("stat-fit"),
  status: $("status"), error: $("error"), errorText: $("error-text"), errorAction: $("error-action"),
};
const viewBtns = [...document.querySelectorAll("[data-view]")];
const presetBtns = [...document.querySelectorAll("[data-preset]")];
const STORE_KEY = "chawk-settings-v1";
const MAX_BYTES = 15 * 1024 * 1024;
// Same cycling as the backend overlay (chawk/render.py), so dots match curves.
const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080",
  "#f032e6", "#bcf60c", "#fabebe", "#9a6324", "#800000", "#808000",
  "#000075", "#e6beff", "#aaffc3", "#ffd8b1"];

const state = {
  file: null, previewURL: null,
  status: "idle", // idle | working | done | error
  result: null,   // { report, annotatedURL, debugURL }
  view: "fitted", sheetOpen: false,
  controller: null, timerId: null, t0: 0,
  urls: [],
};

/* ---------- settings ---------- */
function readSettings() {
  const p = document.querySelector('[data-preset][aria-pressed="true"]');
  return {
    preset: p ? p.dataset.preset : "balanced",
    rmse_tolerance: Number(els.rmse.value),
    max_error_tolerance: Number(els.maxerr.value),
    max_poly_degree: Number(els.poly.value),
    enable_circle: els.mCircle.checked,
    enable_ellipse: els.mEllipse.checked,
    enable_sinusoid: els.mSinusoid.checked,
    enable_spline: els.mSpline.checked,
    label_equations: els.labels.checked,
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
  for (const [k, el] of [["enable_circle", els.mCircle], ["enable_ellipse", els.mEllipse],
      ["enable_sinusoid", els.mSinusoid], ["enable_spline", els.mSpline],
      ["label_equations", els.labels]]) {
    if (typeof s[k] === "boolean") el.checked = s[k];
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
  els.tuneDot.hidden = known;
  els.tune.setAttribute("aria-label", known ? "Tune fit" : "Tune fit (customized)");
  if (!silent) saveSettings();
}
function markCustom() {
  for (const b of presetBtns) b.setAttribute("aria-pressed", "false");
  els.tuneDot.hidden = false;
  saveSettings();
}
function paintSliderLabels() {
  els.rmseVal.textContent = Number(els.rmse.value).toFixed(1) + "px";
  els.maxerrVal.textContent = Number(els.maxerr.value).toFixed(1) + "px";
  els.polyVal.textContent = els.poly.value;
}

/* ---------- status / toast ---------- */
function setStatus(msg) { els.status.textContent = msg || ""; }
function toast(message, action) {
  els.error.hidden = !message;
  els.errorText.textContent = message || "";
  els.errorAction.hidden = !(action && message);
  if (action && message) {
    els.errorAction.textContent = action.label;
    els.errorAction.onclick = () => { hideToast(); action.run(); };
  }
  if (message) (action ? els.errorAction : els.error).focus();
}
function hideToast() { els.error.hidden = true; }
function forgetURLs() {
  for (const u of state.urls) URL.revokeObjectURL(u);
  state.urls = [];
}

/* ---------- intake ---------- */
function fmtMB(n) { return (n / 1048576).toFixed(1) + "MB"; }
async function chooseFile(f) {
  if (!f) return false;
  const okType = /^image\//.test(f.type) || /\.(png|jpe?g|bmp|webp|tiff?)$/i.test(f.name);
  if (!okType) { toast("Not an image — PNG, JPG, BMP, WEBP or TIFF."); return false; }
  if (f.size > MAX_BYTES) { toast(`Too large (${fmtMB(f.size)}). Limit is 15MB.`); return false; }
  if (f.size === 0) { toast("Empty file (0 bytes)."); return false; }
  try {
    const bmp = await createImageBitmap(f);
    const ok = bmp.width >= 2 && bmp.height >= 2 && Math.max(bmp.width, bmp.height) <= 6000;
    bmp.close();
    if (!ok) { toast(`Unusable size — need a real drawing, scaled under ~4000px.`); return false; }
  } catch { /* dimensions optional */ }
  if (state.previewURL) URL.revokeObjectURL(state.previewURL);
  state.file = f;
  state.previewURL = URL.createObjectURL(f);
  state.result = null;
  state.view = "fitted";
  els.paper.src = state.previewURL;
  els.paper.hidden = false;
  els.empty.hidden = true;
  els.eqtoggle.hidden = true;
  els.fresh.hidden = true;
  els.viewbar.hidden = true;
  setViewButtons();
  closeSheet();
  hideToast();
  els.go.disabled = false;
  setStatus(`${f.name} · ${fmtMB(f.size)} — hit Trace.`);
  return true;
}
async function loadSample(name) {
  setStatus("Loading sample…");
  try {
    const r = await fetch("samples/" + name);
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    if (await chooseFile(new File([blob], name, { type: "image/png" }))) go();
  } catch { toast("Couldn't load the sample — is the server running?"); setStatus(""); }
}
function fresh() {
  if (state.previewURL) URL.revokeObjectURL(state.previewURL);
  state.file = null; state.previewURL = null; state.result = null;
  els.paper.hidden = true;
  els.empty.hidden = false;
  els.eqtoggle.hidden = true;
  els.fresh.hidden = true;
  els.viewbar.hidden = true;
  closeSheet();
  els.go.disabled = true;
  setStatus("");
}

/* ---------- job ---------- */
const STAGES = [[0, "Uploading"], [1000, "Tracing strokes"], [2500, "Fitting equations"]];
function tick() {
  const el = Date.now() - state.t0;
  let label = STAGES[0][1];
  for (const [t, s] of STAGES) if (el >= t) label = s;
  els.go.textContent = `${label}… ${(el / 1000).toFixed(1)}s`;
}
function setWorking(on) {
  // One button, two jobs: Trace morphs into Cancel so the slot never shifts.
  els.go.disabled = on ? false : !state.file;
  els.go.classList.toggle("abort", on);
  els.scan.hidden = !on;
  els.dz.classList.toggle("busy", on);
  if (on) {
    state.t0 = Date.now();
    els.go.textContent = "Uploading…";
    state.timerId = setInterval(tick, 200);
  } else { clearInterval(state.timerId); els.go.textContent = "Trace"; els.go.classList.remove("abort"); }
}
async function go() {
  if (!state.file || state.status === "working") return;
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  state.status = "working";
  state.view = "fitted";
  hideToast();
  forgetURLs();
  els.eqtoggle.hidden = true;
  els.fresh.hidden = true;
  closeSheet();
  setWorking(true);
  setStatus("");
  const s = readSettings();
  const form = new FormData();
  form.append("file", state.file);
  form.append("preset", s.preset);
  form.append("config", JSON.stringify({
    rmse_tolerance: s.rmse_tolerance, max_error_tolerance: s.max_error_tolerance,
    max_poly_degree: s.max_poly_degree, enable_circle: s.enable_circle,
    enable_ellipse: s.enable_ellipse, enable_sinusoid: s.enable_sinusoid,
    enable_spline: s.enable_spline, label_equations: s.label_equations,
  }));
  form.append("debug", "true"); // Debug is a result view; always fetch it
  let res;
  try {
    res = await fetch("/api/process", { method: "POST", body: form, signal: state.controller.signal });
  } catch (e) {
    setWorking(false);
    if (e.name === "AbortError") { state.status = "idle"; setStatus("Cancelled."); }
    else { state.status = "error"; toast("Server unreachable.", { label: "Retry", run: go }); }
    return;
  }
  setWorking(false);
  if (!res.ok) {
    state.status = "error";
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* keep */ }
    if (res.status === 422) toast(detail + " Dark lines on white work best.", { label: "Try a sample", run: () => loadSample("sine_wave.png") });
    else if (res.status === 504) toast(detail, { label: "Re-run as Simple", run: () => { setPreset("simple"); go(); } });
    else if (res.status === 400) toast(detail, { label: "Reset to Balanced", run: () => setPreset("balanced") });
    else if (res.status === 413) toast(detail + " Export it smaller and retry.");
    else toast(`Error ${res.status}: ${detail}`, { label: "Retry", run: go });
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
  paintResult();
  const t = out.timings_sec && out.timings_sec.server_total;
  setStatus(t ? `Traced in ${t}s.` : "Done.");
  openSheet();
}

/* ---------- result ---------- */
function countUp(el, target) {
  const t0 = performance.now(), dur = 700;
  (function f(t) {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(f);
  })(t0);
}
function fitWord(rmse) {
  if (rmse == null) return "—";
  if (rmse <= 0.5) return "Excellent";
  if (rmse <= 1) return "Good";
  if (rmse <= 2) return "Fair";
  return "Rough";
}
function paintResult() {
  const { report } = state.result;
  const s = report.summary;
  setViewButtons();
  els.viewbar.hidden = false;
  paintView();
  els.eqtoggle.hidden = false;
  els.fresh.hidden = false;
  countUp(els.statStrokes, s.stroke_count);
  countUp(els.statEqs, s.segment_count);
  els.statFit.textContent = `${fitWord(s.mean_rmse_px)} · ~${s.mean_rmse_px}px off`;
  els.statFit.title = `Mean R² ${s.mean_r_squared}, max RMSE ${s.max_rmse_px}px`;
  els.dlPng.href = state.result.annotatedURL;
  const jsonURL = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  state.urls.push(jsonURL);
  els.dlJson.href = jsonURL;
  els.equations.innerHTML = "";
  report.strokes.forEach((st, si) => {
    const div = document.createElement("div");
    div.className = "stroke";
    const models = [...new Set(st.segments.map((g) => g.model))].join(" + ");
    const h = document.createElement("h3");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = PALETTE[si % PALETTE.length];
    h.append(dot, ` ${st.stroke_id} · ${models}`);
    const sub = document.createElement("span");
    sub.className = "meta";
    sub.textContent = `${st.closed ? "closed" : "open"} · ${st.arc_length.toFixed(0)}px`;
    h.append(sub);
    div.append(h);
    for (const sg of st.segments) {
      const p = document.createElement("p");
      p.className = "seg";
      const top = document.createElement("span");
      top.className = "topline";
      const b = document.createElement("span");
      b.className = "badge " + (sg.r_squared == null ? "" : sg.r_squared >= 0.98 ? "ok" : sg.r_squared >= 0.9 ? "warn" : "bad");
      b.textContent = sg.model;
      const m = document.createElement("span");
      m.className = "meta";
      m.textContent = `R²=${typeof sg.r_squared === "number" ? sg.r_squared.toFixed(3) : "n/a"}`;
      top.append(b, m);
      const eq = document.createElement("span");
      eq.className = "eqline";
      eq.textContent = sg.equation;
      const metaline = document.createElement("span");
      metaline.className = "metalime";
      const rm = document.createElement("span");
      rm.className = "meta";
      rm.textContent = typeof sg.rmse === "number" ? sg.rmse.toFixed(2) + "px off" : "n/a";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "copy";
      copy.textContent = "⧉";
      copy.setAttribute("aria-label", `Copy ${sg.equation}`);
      copy.onclick = async () => {
        const text = `${sg.equation}, x in [${sg.x_range}], y in [${sg.y_range}]`;
        try { await navigator.clipboard.writeText(text); copy.textContent = "✓"; }
        catch {
          const ta = document.createElement("textarea");
          ta.value = text; document.body.append(ta); ta.select();
          try { document.execCommand("copy"); copy.textContent = "✓"; } catch { copy.textContent = "!"; }
          ta.remove();
        }
        setTimeout(() => { copy.textContent = "⧉"; }, 1200);
      };
      metaline.append(rm, copy);
      p.append(top, eq, metaline);
      if (sg.notes && sg.notes.length) {
        const nt = document.createElement("span");
        nt.className = "notes";
        nt.textContent = sg.notes.join("; ");
        p.append(nt);
      }
      div.append(p);
    }
    els.equations.append(div);
  });
}
function setViewButtons() {
  const dbg = viewBtns.find((b) => b.dataset.view === "debug");
  dbg.hidden = !(state.result && state.result.debugURL);
}
function paintView() {
  for (const b of viewBtns) b.setAttribute("aria-pressed", b.dataset.view === state.view ? "true" : "false");
  if (!state.result) return;
  els.paper.src = state.view === "original" ? state.previewURL
    : state.view === "debug" && state.result.debugURL ? state.result.debugURL
    : state.result.annotatedURL;
}
function openSheet() {
  state.sheetOpen = true;
  els.eqsheet.hidden = false;
  els.eqtoggle.setAttribute("aria-expanded", "true");
}
function closeSheet() {
  state.sheetOpen = false;
  els.eqsheet.hidden = true;
  els.eqtoggle.setAttribute("aria-expanded", "false");
}

/* ---------- wiring ---------- */
els.dz.addEventListener("click", (e) => {
  if (e.target.closest("button") || e.target.closest("a")) return;
  els.file.click();
});
els.dz.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.file.click(); }
});
els.file.addEventListener("change", () => chooseFile(els.file.files[0]));
for (const ev of ["dragover", "dragenter"]) {
  document.addEventListener(ev, (e) => { e.preventDefault(); els.dz.classList.add("drag"); });
}
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) els.dz.classList.remove("drag");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dz.classList.remove("drag");
  if (e.dataTransfer.files.length) chooseFile(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  const items = (e.clipboardData && e.clipboardData.files) || [];
  if (items.length) chooseFile(items[0]);
});
for (const b of presetBtns) b.addEventListener("click", () => setPreset(b.dataset.preset));
els.reset.addEventListener("click", () => { setPreset("balanced"); toggleTune(false); });
function toggleTune(force) {
  const open = force !== undefined ? force : els.tunePop.hidden;
  if (open) {
    const r = els.tune.getBoundingClientRect();
    els.tunePop.style.top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 20)) + "px";
    els.tunePop.hidden = false;
  } else els.tunePop.hidden = true;
  els.tune.setAttribute("aria-expanded", String(!els.tunePop.hidden));
}
els.tune.addEventListener("click", (e) => { e.stopPropagation(); toggleTune(); });
document.addEventListener("pointerdown", (e) => {
  if (!els.tunePop.hidden && !e.target.closest("#tune-pop") && !e.target.closest("#tune")) toggleTune(false);
});
for (const el of [els.rmse, els.maxerr, els.poly, els.mCircle, els.mEllipse,
    els.mSinusoid, els.mSpline, els.labels]) {
  el.addEventListener("input", () => { paintSliderLabels(); markCustom(); });
}
for (const b of viewBtns) b.addEventListener("click", () => { state.view = b.dataset.view; paintView(); });
document.querySelectorAll("[data-sample]").forEach((b) =>
  b.addEventListener("click", (e) => { e.stopPropagation(); loadSample(b.dataset.sample); }));
els.go.addEventListener("click", () => {
  if (state.status === "working" && state.controller) state.controller.abort();
  else go();
});
els.eqtoggle.addEventListener("click", () => (state.sheetOpen ? closeSheet() : openSheet()));
els.eqclose.addEventListener("click", closeSheet);
els.fresh.addEventListener("click", fresh);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.tunePop.hidden) toggleTune(false); });

async function checkHealth() {
  try {
    const r = await fetch("/health");
    if (!r.ok) throw new Error();
    const ver = (await r.json()).version;
    els.health.textContent = "●";
    els.health.title = "server v" + ver + " — reachable";
    els.health.className = "health ok";
    els.serverVer.textContent = "server v" + ver;
  } catch {
    els.health.textContent = "●";
    els.health.title = "server unreachable — start it with .venv/bin/python app.py";
    els.health.className = "health down";
    els.serverVer.textContent = "server unreachable";
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
