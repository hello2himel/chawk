/* Chawk — front-end. Implements the "Chawk — UI UX design" boards:
   start → check → result, with run history, layered stage, diff overlay,
   equation list, downloads and coordinate toggle. Vanilla JS, no build step. */
"use strict";

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 15 * 1024 * 1024;

const KIND_PRESET = { clean: "precise", sketchy: "balanced", busy: "busy" };
const KIND_VALUES = {
  clean: { sensitivity: 50, fit: 50 },
  sketchy: { sensitivity: 50, fit: 50 },
  busy: { sensitivity: 100, fit: 100 },
};
const MODEL_NAME = {
  line: "Line", polynomial2: "Parabola", polynomial3: "Cubic", polynomial4: "Quartic",
  polynomial5: "Quintic", polynomial6: "Curve", circle: "Circle", ellipse: "Ellipse",
  elliptical_arc: "Arc", sinusoid: "Wave", spline: "Freeform", point: "Point",
  closed_spline: "Closed curve",
};

/* Every Config field the server accepts, grouped for the advanced drawer. */
const ADV_GROUPS = [
  { title: "Preprocessing", fields: [
    { key: "max_dimension", label: "Maximum working size", min: 128, max: 4000, step: 1, hint: "Longest side; larger uploads are downscaled." },
    { key: "blur_kernel", label: "Blur kernel", min: 0, max: 15, step: 1, hint: "Median blur before thresholding. 0 disables." },
    { key: "threshold_mode", label: "Threshold mode", options: ["auto", "otsu", "adaptive"], hint: "auto = Otsu, with an adaptive fallback." },
    { key: "adaptive_block", label: "Adaptive block", min: 3, max: 201, step: 2, hint: "Neighbourhood size for adaptive thresholding." },
    { key: "adaptive_C", label: "Adaptive C", min: 1, max: 50, step: 1, hint: "How much fainter than the paper counts as ink." },
    { key: "invert", label: "Ink polarity", options: ["auto", "dark_strokes", "light_strokes"] },
    { key: "min_component_area", label: "Minimum speck area", min: 0, max: 500, step: 1, hint: "Smaller components are discarded." },
    { key: "close_gaps", label: "Close gaps", min: 0, max: 20, step: 1, hint: "Bridge tiny anti-aliasing gaps." },
  ] },
  { title: "Filled shapes", fields: [
    { key: "enable_fill", label: "Fill solid shapes" },
    { key: "fill_min_area", label: "Minimum fill area", min: 0, max: 5000, step: 1 },
    { key: "fill_min_radius", label: "Minimum fill thickness", min: 0, max: 100, step: 0.5 },
    { key: "fill_max_blobbiness", label: "Maximum fill blobbiness", min: 0.1, max: 10, step: 0.1 },
    { key: "fill_max_ring_blobbiness", label: "Maximum ring blobbiness", min: 1, max: 100, step: 1 },
  ] },
  { title: "Colour", fields: [
    { key: "color_count", label: "Colour count", min: 0, max: 64, step: 1, hint: "0 disables the colour path." },
    { key: "color_min_area", label: "Minimum colour area", min: 0, max: 5000, step: 1 },
    { key: "fill_edge_width", label: "Fill seam width", min: 0.1, max: 10, step: 0.1 },
    { key: "color_spline_smoothing", label: "Boundary smoothing", min: 0, max: 2, step: 0.01 },
  ] },
  { title: "Tracing", fields: [
    { key: "min_stroke_length", label: "Minimum stroke length", min: 0.1, max: 200, step: 0.5 },
    { key: "prune_spur_length", label: "Prune spurs shorter than", min: 0, max: 200, step: 0.5 },
    { key: "junction_link_angle", label: "Junction link angle", min: 1, max: 90, step: 1, hint: "Degrees allowed when crossing a junction." },
    { key: "merge_endpoint_distance", label: "Merge endpoints within", min: 0, max: 100, step: 0.5 },
    { key: "merge_endpoint_angle", label: "Merge angle", min: 0, max: 90, step: 1 },
    { key: "resample_spacing", label: "Resample spacing", min: 0.5, max: 20, step: 0.1 },
    { key: "smoothing_window", label: "Smoothing window", min: 0, max: 51, step: 1, hint: "Odd window; 0 or below 3 disables." },
  ] },
  { title: "Segmentation", fields: [
    { key: "rmse_tolerance", label: "Fit tolerance (RMSE)", min: 0.1, max: 20, step: 0.1, hint: "Split until every fit is at or below this." },
    { key: "max_error_tolerance", label: "Worst-case tolerance", min: 0.1, max: 50, step: 0.1 },
    { key: "min_segment_points", label: "Minimum segment points", min: 3, max: 100, step: 1 },
    { key: "min_segment_length", label: "Minimum segment length", min: 0.1, max: 200, step: 0.5 },
    { key: "max_segments_per_stroke", label: "Max segments per stroke", min: 1, max: 500, step: 1 },
    { key: "rdp_epsilon", label: "Corner detection epsilon", min: 0.1, max: 50, step: 0.1 },
    { key: "corner_angle", label: "Corner angle", min: 1, max: 179, step: 1 },
    { key: "corner_window", label: "Corner window", min: 1, max: 100, step: 0.5 },
    { key: "corner_concentration", label: "Corner concentration", min: 0.01, max: 0.99, step: 0.01 },
  ] },
  { title: "Fitting", fields: [
    { key: "max_poly_degree", label: "Maximum polynomial degree", min: 1, max: 6, step: 1 },
    { key: "enable_circle", label: "Circles" },
    { key: "enable_ellipse", label: "Ellipses" },
    { key: "enable_sinusoid", label: "Waves" },
    { key: "enable_spline", label: "Freeform" },
    { key: "spline_max_knots", label: "Maximum spline knots", min: 1, max: 100, step: 1 },
    { key: "bic_margin", label: "Model margin (BIC)", min: 0, max: 50, step: 0.1 },
    { key: "error_floor_px", label: "Error floor", min: 0.01, max: 10, step: 0.01 },
  ] },
  { title: "Rendering", fields: [
    { key: "label_equations", label: "Label equations" },
    { key: "max_labels", label: "Maximum labels", min: 0, max: 200, step: 1 },
    { key: "label_fontsize", label: "Label font size", min: 1, max: 40, step: 0.5 },
    { key: "overlay_linewidth", label: "Overlay line width", min: 0.1, max: 20, step: 0.1 },
    { key: "dpi", label: "Render DPI", min: 50, max: 600, step: 10 },
    { key: "color_by", label: "Colour by", options: ["original", "stroke", "segment"] },
  ] },
  { title: "Limits", fields: [
    { key: "max_strokes", label: "Maximum strokes", min: 1, max: 5000, step: 1 },
    { key: "float_precision", label: "Decimal precision", min: 0, max: 6, step: 1 },
  ] },
];

const SUPER = { 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶" };

const settings = {
  sensitivity: 50, kind: "sketchy", fit: 50,
  advanced: {},
};
const advancedMeta = { defaults: null, presets: {}, loading: null };

const state = {
  file: null, url: null, name: "", bytes: 0, width: 0, height: 0,
  runs: [], active: -1, selected: -1,
  busy: false, screen: "start", controller: null, workTimer: null, hovering: false,
  busyTimer: null, hoverSeg: null,
  libSelect: false, libSelected: new Set(), libView: "grid", libSort: "newest", restore: null,
  renaming: null, libMenuWork: null, libDialog: null, pendingUndo: null, undoTimer: null,
};

const view = { mode: "equations", labels: false, diff: false, blend: 70, yUp: false };

/* ------------------------------------------------------------------ theme */
/* System preference by default; a manual override is stored only when the
   target differs from the system. Theme state lives on documentElement. */
const THEME_KEY = "chawk.theme.v1";
const THEME_LIGHT = "#F5F3EC";
const THEME_DARK = "#131311";
const themeMQ = window.matchMedia("(prefers-color-scheme: dark)");
let sessionTheme = null; // private-mode fallback: works for this session only

function systemTheme() { return themeMQ.matches ? "dark" : "light"; }
function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : sessionTheme;
  } catch { return sessionTheme; }
}
function effectiveTheme() { return storedTheme() || systemTheme(); }
function themeIsDark() { return effectiveTheme() === "dark"; }

function setThemeMeta() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = effectiveTheme() === "dark" ? THEME_DARK : THEME_LIGHT;
}

function updateThemeToggles() {
  const dark = effectiveTheme() === "dark";
  const action = dark ? "Switch to light theme" : "Switch to dark theme";
  for (const id of ["theme-toggle", "theme-home"]) {
    const b = $(id);
    if (!b) continue;
    // The name is the setting ("Dark theme"); aria-pressed carries the state.
    b.setAttribute("aria-label", "Dark theme");
    b.setAttribute("aria-pressed", String(dark));
    b.title = action;
    const icon = b.querySelector(".ri");
    if (icon) icon.className = "ri " + (dark ? "ri-sun-line" : "ri-moon-line");
  }
}

function refreshThemeInk() {
  for (const dot of document.querySelectorAll("#eq-rows .dot")) {
    const c = dot.dataset.color;
    if (c) dot.style.background = dotColor(c);
  }
  const sel = $("sel-dot");
  if (sel && sel.dataset.color) sel.style.background = dotColor(sel.dataset.color);
}

function applyTheme(theme, persist) {
  const root = document.documentElement;
  root.classList.add("theme-cut");
  if (persist) {
    try {
      if (theme === systemTheme()) {
        localStorage.removeItem(THEME_KEY);
        sessionTheme = null;
      } else {
        localStorage.setItem(THEME_KEY, theme);
        sessionTheme = null;
      }
    } catch { sessionTheme = theme; }
  }
  const stored = storedTheme();
  if (stored) root.dataset.theme = stored;
  else delete root.dataset.theme;
  setThemeMeta();
  updateThemeToggles();
  refreshThemeInk();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-cut")));
}

function announceTheme(theme) {
  const live = $("theme-live");
  if (!live) return;
  live.textContent = theme === "dark"
    ? "Dark theme on"
    : (storedTheme() ? "Light theme on" : "Light theme on, following system");
}

function toggleTheme() {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  applyTheme(next, true);
  // The pressed state is announced by the focused toggle itself; the live
  // region is reserved for automatic OS changes.
}

function initTheme() {
  for (const id of ["theme-toggle", "theme-home"]) {
    const b = $(id);
    if (b) b.addEventListener("click", toggleTheme);
  }
  const onSystem = () => {
    if (!storedTheme()) {
      applyTheme(systemTheme(), false);
      announceTheme(systemTheme());
    } else {
      // Pinned: the OS change must not clear storage or change the theme.
      setThemeMeta();
      updateThemeToggles();
    }
  };
  if (typeof themeMQ.addEventListener === "function") themeMQ.addEventListener("change", onSystem);
  else if (typeof themeMQ.addListener === "function") themeMQ.addListener(onSystem);
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === null) applyTheme(effectiveTheme(), false);
  });
  setThemeMeta();
  updateThemeToggles();
}

/* ------------------------------------------------------------------ utils */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function eqHTML(text) {
  return String(text).split("\n").map((line) =>
    esc(line)
      .replace(/(^|[^A-Za-z])([xyt])(?![A-Za-z])/g, (_m, pre, v) => `${pre}<i>${v}</i>`)
      .replace(/(^|[\s(])-/g, "$1−")
  ).join("<br>");
}
function fmt(v, p = 4) {
  if (!Number.isFinite(v)) return "0";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(Math.max(2, p - 1));
  let s = v.toFixed(p).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}
function signed(v, p = 4) {
  return v < 0 ? " - " + fmt(-v, p) : " + " + fmt(v, p);
}
function round(v, d = 0) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
function toast(text, sub) {
  $("toast-text").innerHTML = esc(text) + (sub ? `<span class="m">${esc(sub)}</span>` : "");
  $("toast").hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $("toast").hidden = true; }, 3200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
function downloadURL(url, name) {
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
}

/* ------------------------------------------------------- side-by-side sheet */
function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function wrapLine(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (ctx.measureText(cand).width <= maxW || !cur) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const GITHUB_MARK = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z";

function formatCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function fitTextSize(g, text, maxW, maxSize, minSize, family, weight = "700", style = "") {
  let size = maxSize;
  const pre = style ? `${style} ` : "";
  while (size > minSize) {
    g.font = `${pre}${weight} ${size}px ${family}`;
    if (g.measureText(text).width <= maxW) break;
    size -= 2;
  }
  return size;
}

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  if (typeof g.roundRect === "function") { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* 4:5 social poster, drawn straight onto a 2x canvas (no DOM, no HTML rasteriser). */
async function fittedDataURL(url, w, h, pad = 0) {
  const img = await loadImageEl(url);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.fillStyle = "#FAF9F4";
  g.fillRect(0, 0, w, h);
  // graph-paper mat: the padding reads as a sheet the drawing sits on
  const step = 80;             // 40 css px
  const major = step * 5;
  for (let x = 0; x <= w; x += step) {
    const isMajor = x % major === 0;
    g.strokeStyle = isMajor ? "rgba(31,63,209,.16)" : "rgba(31,63,209,.075)";
    g.lineWidth = isMajor ? 3 : 2;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    const isMajor = y % major === 0;
    g.strokeStyle = isMajor ? "rgba(31,63,209,.16)" : "rgba(31,63,209,.075)";
    g.lineWidth = isMajor ? 3 : 2;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  // fit, never crop: a 2:3 source fills the padded window; anything else is
  // letterboxed inside it
  const innerW = Math.max(1, w - pad * 2);
  const innerH = Math.max(1, h - pad * 2);
  const scale = Math.min(innerW / (img.naturalWidth || 1), innerH / (img.naturalHeight || 1));
  const iw = (img.naturalWidth || 1) * scale;
  const ih = (img.naturalHeight || 1) * scale;
  const ix = pad + (innerW - iw) / 2;
  const iy = pad + (innerH - ih) / 2;
  g.drawImage(img, ix, iy, iw, ih);
  g.strokeStyle = "rgba(21,22,26,.12)";
  g.lineWidth = 2;
  g.strokeRect(ix, iy, iw, ih);
  return cv.toDataURL("image/png");
}

function splitAtOperator(text) {
  let depth = 0;
  const ops = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === "+" || ch === "−" || ch === "-")
      && text[i - 1] === " " && text[i + 1] === " ") ops.push(i);
  }
  if (!ops.length) return null;
  const mid = text.length / 2;
  let best = ops[0];
  for (const p of ops) if (Math.abs(p - mid) < Math.abs(best - mid)) best = p;
  return [text.slice(0, best).trim(), text.slice(best).trim()];
}

/* 1800x1800 square poster: drawn image left, KaTeX equations right. */
async function sheetCanvas(run) {
  await document.fonts.ready;
  const items = flattenSegments(run.report);
  const total = items.length;
  const label = formatCount(total);
  const artURL = await fittedDataURL(run.images.redraw || state.url, 2160, 1440, 48);

  const sheet = document.createElement("div");
  sheet.className = "social-sheet";
  sheet.dataset.art = "";

  const art = document.createElement("div");
  art.className = "social-art";
  const img = document.createElement("img");
  img.src = artURL;
  img.alt = "";
  art.append(img);

  const panel = document.createElement("div");
  panel.className = "social-panel";

  const lead = document.createElement("div");
  lead.className = "social-lead";
  lead.textContent = "drawn using";

  const count = document.createElement("div");
  count.className = "social-count";
  count.textContent = label;

  const word = document.createElement("div");
  word.className = "social-word";
  word.innerHTML = '<span class="hl"><i>equations</i></span>';

  const head = document.createElement("div");
  head.className = "social-head";
  head.append(lead, count, word);

  const list = document.createElement("div");
  list.className = "social-list";

  const more = document.createElement("div");
  more.className = "social-more";

  const footwrap = document.createElement("div");
  footwrap.className = "social-footwrap";
  const brand = document.createElement("div");
  brand.className = "social-brand";
  brand.innerHTML = `<svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-24 32 32)"><rect x="18" y="4" width="28" height="56" rx="8" fill="#fff" stroke="#15161A" stroke-width="3"></rect><path d="M18 46h28v6a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8z" fill="#ECE8DD" stroke="#15161A" stroke-width="3"></path><circle cx="26" cy="22" r="6" fill="#fff" stroke="#15161A" stroke-width="2.5"></circle><circle cx="38" cy="22" r="6" fill="#fff" stroke="#15161A" stroke-width="2.5"></circle><circle cx="27" cy="23" r="2" fill="#15161A"></circle><circle cx="37" cy="23" r="2" fill="#15161A"></circle><path d="M24 36c3-5 5-5 8 0s5 5 8 0" fill="none" stroke="#1F3FD1" stroke-width="3" stroke-linecap="round"></path></g></svg><span class="social-brandname">Chawk</span><span class="social-tag">open source</span>`;
  const url = document.createElement("div");
  url.className = "social-url";
  url.textContent = "github.com/hello2himel/chawk";
  footwrap.append(brand, url);

  const pool = [];
  for (const it of items) {
    for (const line of String(it.seg.equation || "").split("\n")) {
      if (line.trim()) pool.push({ line: line.trim().replace(/\s+/g, " "), model: it.seg.model });
    }
  }
  pool.slice(0, 24).forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "social-eq";
    const maths = document.createElement("div");
    maths.className = "social-maths";
    const q = document.createElement("div");
    q.className = "social-math";
    q.innerHTML = renderEquationHTML(p.line, p.model);
    maths.append(q);
    row.__eq = p;
    row.append(maths);
    list.append(row);
  });

  const fade = document.createElement("div");
  fade.className = "social-fade";
  list.append(fade);

  panel.append(head, list, more, footwrap);
  sheet.append(art, panel);
  document.body.append(sheet);
  try {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const fitLine = (el) => {
      let fs = 26;
      el.style.fontSize = `${fs}px`;
      while (el.scrollWidth > el.clientWidth && fs > 20) {
        fs -= 1;
        el.style.fontSize = `${fs}px`;
      }
    };
    for (const row of list.querySelectorAll(".social-eq")) {
      const maths = row.querySelector(".social-maths");
      const first = maths.querySelector(".social-math");
      fitLine(first);
      if (first.scrollWidth > first.clientWidth && row.__eq) {
        const parts = splitAtOperator(row.__eq.line);
        if (parts) {
          first.innerHTML = renderEquationHTML(parts[0], row.__eq.model);
          fitLine(first);
          const second = document.createElement("div");
          second.className = "social-math cont";
          second.innerHTML = renderEquationHTML(parts[1], row.__eq.model);
          maths.append(second);
          fitLine(second);
        }
      }
    }
    // let the last row run under the bottom fade, so the list reads as continuing
    const cut = list.clientHeight;
    let shown = 0;
    for (const row of list.querySelectorAll(".social-eq")) {
      if (row.offsetTop < cut) shown += 1;
    }
    if (total > shown) more.textContent = `… and ${formatCount(total - shown)} more.`;
    const leadW = lead.getBoundingClientRect().width;
    const drawW = word.getBoundingClientRect().width;
    let size = 110;
    count.style.fontSize = `${size}px`;
    while (size > 80 && leadW + 14 + count.getBoundingClientRect().width + 14 + drawW > 1016) {
      size -= 2;
      count.style.fontSize = `${size}px`;
    }
    return await html2canvas(sheet, {
      backgroundColor: "#F8F7F3", scale: 2, logging: false,
      width: 1080, height: 1350, windowWidth: 1080, windowHeight: 1350,
    });
  } finally {
    sheet.remove();
  }
}

async function sheetBlob(run) {
  if (run.sheetBlob) return run.sheetBlob;
  const cv = await sheetCanvas(run);
  const blob = await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The poster could not be encoded.");
  run.sheetBlob = blob;
  run.sheetURL = URL.createObjectURL(blob);
  return blob;
}

function startBusyCycle(phrases) {
  clearInterval(state.busyTimer);
  let i = 0;
  const show = (text) => {
    const el = $("busy-title");
    el.classList.remove("swap");
    void el.offsetWidth;
    el.textContent = text;
    el.classList.add("swap");
  };
  show(phrases[0]);
  state.busyTimer = setInterval(() => {
    i = (i + 1) % phrases.length;
    show(phrases[i]);
  }, 900);
}

function showBusy(title, sub, phrases) {
  $("busy-title").textContent = title || "one sec — setting the type…";
  $("busy-sub").textContent = sub || "";
  $("busy").hidden = false;
  if (phrases && phrases.length) startBusyCycle(phrases);
}
function hideBusy() {
  clearInterval(state.busyTimer);
  state.busyTimer = null;
  $("busy").hidden = true;
}

async function downloadSideBySide(run) {
  const items = flattenSegments(run.report);
  const total = formatCount(items.length);
  const phrases = [
    "one sec — setting the type…",
    `counting ${total} equations…`,
    "composing the poster…",
    "packing the PNG…",
    "handing it to your browser…",
  ];
  showBusy(phrases[0], `${total} equation${items.length === 1 ? "" : "s"} · 1800×1800 poster`, phrases);
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const t0 = performance.now();
    await sheetBlob(run);
    const wait = Math.max(0, 420 - (performance.now() - t0));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    downloadURL(run.sheetURL, baseName() + "-side-by-side.png");
    toast("Side-by-side sheet saved.", "2160×2700 PNG");
  } catch (e) {
    toast("Could not build the poster", e.message || String(e));
  } finally {
    hideBusy();
  }
}

function baseName() {
  return (state.name || "chawk").replace(/\.[^.]+$/, "") || "chawk";
}
function luminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return 0;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/* Chrome dots follow the room: a near-black ink is lifted to paper ink on the
   dark selected row, while coloured inks keep their hue and gain lightness. */
function dotColor(hex) {
  if (!themeIsDark()) return !hex || luminance(hex) > 0.82 ? "var(--text)" : hex;
  if (!hex) return "var(--text)";
  if (luminance(hex) >= 0.55) return hex;
  return `color-mix(in srgb, ${hex} 35%, var(--text))`;
}
/* Art dots are pinned: the selection overlay is drawn on light paper. */
function artDotColor(hex) {
  return !hex || luminance(hex) > 0.82 ? "#15161A" : hex;
}

/* ------------------------------------------------------------------ screens */
const ROUTE_PATH = { start: "/", library: "/library", check: "/check", result: "/result" };
const PATH_SCREEN = { "/": "start", "/library": "library", "/check": "check", "/result": "result" };

function pathName() {
  return location.pathname.replace(/\/+$/, "") || "/";
}
function routeName() {
  return PATH_SCREEN[pathName()] || "start";
}
function pageTitle(name) {
  if (name === "start") return "Chawk — every squiggle is a function";
  if (name === "library") return "Previous works — Chawk";
  if (name === "check") return state.name ? `Ready to do some maths — ${state.name} — Chawk` : "Ready to do some maths — Chawk";
  if (name === "result") return state.name ? `${state.name} — Chawk` : "Your equations — Chawk";
  return "Chawk";
}

function focusScreen(name) {
  const screen = $("screen-" + name);
  if (!screen) return;
  const h = screen.querySelector("h1, h2");
  if (!h) return;
  h.setAttribute("tabindex", "-1");
  requestAnimationFrame(() => h.focus({ preventScroll: true }));
}

function animateScreenIn(name) {
  const screen = $("screen-" + name);
  if (!screen) return;
  screen.classList.remove("screen-in");
  void screen.offsetWidth;
  screen.classList.add("screen-in");
  setTimeout(() => screen.classList.remove("screen-in"), 260);
}

function applyScreen(name) {
  state.screen = name;
  $("screen-start").hidden = name !== "start";
  $("screen-check").hidden = name !== "check";
  $("screen-working").hidden = name !== "working";
  $("screen-result").hidden = name !== "result";
  $("screen-library").hidden = name !== "library";
  $("check-change").hidden = name !== "check";
  $("nav-library-group").hidden = name !== "library";
  $("nav-check-group").hidden = name !== "check";
  $("nav-check-name").textContent = state.name || "";
  $("result-bar").hidden = name !== "result";
  $("library-btn").classList.toggle("on", name === "library");
  $("library-btn").setAttribute("aria-current", name === "library" ? "page" : "false");
  $("app").classList.toggle("home", name === "start");
  $("app").classList.toggle("project", name === "result" || name === "check" || name === "working");
  $("bar").classList.toggle("result", name === "result");
  $("app").classList.toggle("result", name === "result");
  $("app").classList.toggle("check", name === "check");
  closeMenus();
  document.title = pageTitle(name);
  if (name === "library") renderLibrary();
  if (name === "check") requestAnimationFrame(fitPreview);
  if (name === "result") requestAnimationFrame(fitPlot);
  window.scrollTo(0, 0);
}

function showScreen(name, opts = {}) {
  if (name === "check" && !state.file) name = "start";
  if (name === "result" && !activeRun()) name = "start";
  const route = ROUTE_PATH[name];
  const doPush = opts.history !== false && !!route && pathName() !== route;
  if (state.screen === name && !doPush && opts.force !== true) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canAnimate = opts.animate !== false && !reduced && typeof document.startViewTransition === "function"
    && state.screen !== name;

  const change = () => {
    applyScreen(name);
    if (doPush) {
      history[opts.replace ? "replaceState" : "pushState"]({ screen: name }, "", route);
    }
    if (opts.focus !== false) focusScreen(name);
  };

  if (canAnimate) {
    try {
      const transition = document.startViewTransition(change);
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
      return;
    } catch { /* fall through to the CSS transition */ }
  }
  change();
  if (opts.animate !== false && !reduced) animateScreenIn(name);
}

function projectIdFromURL() {
  try { return new URLSearchParams(location.search).get("work") || ""; } catch { return ""; }
}

function projectWork(id) {
  return id ? loadWorks().find((w) => w.id === id) || null : null;
}

function rememberProject(id) {
  try { if (id) sessionStorage.setItem("chawk.lastProject.v1", id); } catch { /* private mode */ }
}

function lastProjectId() {
  try { return sessionStorage.getItem("chawk.lastProject.v1") || ""; } catch { return ""; }
}

function restoreProjectId() {
  const fromURL = projectIdFromURL();
  if (fromURL && projectWork(fromURL)) return fromURL;
  const last = lastProjectId();
  if (last && projectWork(last)) return last;
  return "";
}

function closeRestorePrompt() {
  state.restore = null;
  $("restore").hidden = true;
}

function openRestorePrompt(id, screen) {
  state.restore = { id, screen };
  const hasWork = !!id;
  $("restore-title").textContent = hasWork ? "Re-run this project?" : "Project not available";
  $("restore-body").textContent = hasWork
    ? "This page was refreshed. Chawk can rebuild your drawing by re-processing the saved image."
    : screen === "result"
      ? "This project wasn’t saved in this browser. Choose the image again to rebuild it."
      : "This upload wasn’t saved. Choose the image again to continue.";
  $("restore-ok").textContent = hasWork ? "Re-run project" : "Choose image";
  $("restore-ok").classList.toggle("bp", true);
  $("restore").hidden = false;
  requestAnimationFrame(() => $("restore-ok").focus());
}

function restoreCancel() {
  closeRestorePrompt();
  history.replaceState({ screen: "start" }, "", "/");
  showScreen("start", { history: false });
}

function restoreConfirm() {
  const pending = state.restore;
  if (!pending) return;
  closeRestorePrompt();
  if (pending.id) {
    openWork(pending.id, { restore: true });
    return;
  }
  history.replaceState({ screen: "start" }, "", "/");
  showScreen("start", { history: false });
  $("file").click();
}

async function restoreCheck(id) {
  await openWork(id, { trace: false, restore: true, check: true });
}

function bootRoute() {
  const path = pathName();
  let name = PATH_SCREEN[path] || "start";
  const projectId = restoreProjectId();
  if (name === "check" && !state.file) {
    if (projectId) { restoreCheck(projectId); return; }
    openRestorePrompt("", "check");
    return;
  }
  if (name === "result" && !activeRun()) {
    const snapshot = projectId ? loadProjectSnapshot(projectId) : null;
    if (snapshot) {
      restoreProjectSnapshot(snapshot).then((ok) => { if (!ok) openRestorePrompt(projectId, "result"); });
      return;
    }
    openRestorePrompt(projectId, "result");
    return;
  }
  if (!PATH_SCREEN[path] && name === "start") history.replaceState({ screen: "start" }, "", "/");
  if (name === "library") { state.libSelect = false; state.libSelected.clear(); }
  showScreen(name, { history: false, focus: false, animate: false, force: true });
}

window.addEventListener("popstate", () => {
  const path = pathName();
  let name = PATH_SCREEN[path];
  if (!name) { name = "start"; history.replaceState({ screen: "start" }, "", "/"); }
  const projectId = restoreProjectId();
  if (name === "check" && !state.file) {
    if (projectId) { restoreCheck(projectId); return; }
    openRestorePrompt("", "check");
    return;
  }
  if (name === "result" && !activeRun()) {
    const snapshot = projectId ? loadProjectSnapshot(projectId) : null;
    if (snapshot) {
      restoreProjectSnapshot(snapshot).then((ok) => { if (!ok) openRestorePrompt(projectId, "result"); });
      return;
    }
    openRestorePrompt(projectId, "result");
    return;
  }
  showScreen(name, { history: false });
});

/* ------------------------------------------------------------------ library *//* ------------------------------------------------------------------ library */
const WORKS_KEY = "chawk.works.v1";
const MAX_WORKS = 12;
const PROJECT_KEY = "chawk.project.v1.";
const PROJECT_VIEW_KEY = "chawk.project.view.v1.";
const SORT_LABELS = { newest: "Newest", oldest: "Oldest", name: "Name A–Z", equations: "Most equations" };
const TITLE_MAX = 58;
const MODE_LABELS = { clean: "Clean lines", sketchy: "Sketchy", busy: "Busy" };

function cardTitle(name) {
  const raw = String(name || "untitled").trim();
  return raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1).trimEnd()}…` : raw;
}

function workInfo(work) {
  const bits = [];
  if (work.at) bits.push(workDate(work.at));
  const kind = work.settings && work.settings.kind;
  if (kind) bits.push(MODE_LABELS[kind] || kind);
  if (!bits.length && work.count) bits.push(`${formatCount(work.count)} equations`);
  return bits.join(" · ");
}


function loadWorks() {
  try {
    const raw = localStorage.getItem(WORKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function persistWorks(works) {
  let list = works.slice();
  while (list.length) {
    try { localStorage.setItem(WORKS_KEY, JSON.stringify(list)); return list; }
    catch { list.pop(); }
  }
  try { localStorage.setItem(WORKS_KEY, "[]"); } catch { /* private mode */ }
  return list;
}

function updateLibraryBadge() {
  const n = loadWorks().length;
  const badge = $("library-count");
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

async function imageUrlToWebP(url, max, quality) {
  if (!url) return null;
  const img = await loadImageEl(url);
  const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return cv.toDataURL("image/webp", quality);
}

function projectSnapshotKey(id) {
  return PROJECT_KEY + id;
}

function loadProjectSnapshot(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(projectSnapshotKey(id));
    const snap = raw ? JSON.parse(raw) : null;
    return snap && Array.isArray(snap.runs) && snap.runs.length ? snap : null;
  } catch { return null; }
}

function loadProjectView(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(PROJECT_VIEW_KEY + id);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProjectView() {
  if (!state.projectId) return;
  try { localStorage.setItem(PROJECT_VIEW_KEY + state.projectId, JSON.stringify(view)); } catch { /* quota */ }
}

function forgetProject(id) {
  if (!id) return;
  try {
    localStorage.removeItem(PROJECT_KEY + id);
    localStorage.removeItem(PROJECT_VIEW_KEY + id);
  } catch { /* ignore */ }
}

function pruneProjectSnapshots(keepId) {
  try {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROJECT_KEY)) continue;
      const id = key.slice(PROJECT_KEY.length);
      let at = 0;
      try { at = JSON.parse(localStorage.getItem(key)).savedAt || 0; } catch { /* corrupt */ }
      items.push({ key, id, at });
    }
    items.sort((a, b) => b.at - a.at);
    const keep = new Set([keepId, ...items.slice(0, 5).map((it) => it.id)]);
    for (const it of items) if (!keep.has(it.id)) localStorage.removeItem(it.key);
  } catch { /* ignore */ }
}

async function persistProjectSnapshot(workId) {
  if (!workId || !state.runs.length) return;
  try {
    const work = loadWorks().find((w) => w.id === workId);
    const source = work?.source
      || (state.url && state.url.startsWith("data:") ? state.url : await imageUrlToWebP(state.url, 1400, 0.86));
    const runs = [];
    for (const run of state.runs) {
      const images = {};
      for (const [key, url] of Object.entries(run.images || {})) {
        if (!url) continue;
        images[key] = url.startsWith("data:") ? url : await imageUrlToWebP(url, 1600, 0.88);
      }
      runs.push({
        report: run.report, images, seconds: run.seconds, meta: run.meta,
        settings: run.settings, config: run.config, label: run.label,
      });
    }
    const base = {
      version: 1, workId, name: state.name, width: state.width, height: state.height,
      bytes: state.bytes, source, runs, active: state.active, view: { ...view }, savedAt: Date.now(),
    };
    try {
      localStorage.setItem(projectSnapshotKey(workId), JSON.stringify(base));
    } catch {
      const active = runs[state.active] || runs[runs.length - 1];
      const slim = {
        ...base,
        runs: active ? [{
          ...active,
          images: { redraw: active.images.redraw, redrawLabels: active.images.redrawLabels || active.images.labeled },
        }] : [],
        active: 0,
      };
      localStorage.setItem(projectSnapshotKey(workId), JSON.stringify(slim));
    }
    pruneProjectSnapshots(workId);
  } catch {
    toast("Couldn't save the last run locally", "Browser storage is unavailable or full.");
  }
}

async function restoreProjectSnapshot(snap) {
  if (!snap || !Array.isArray(snap.runs) || !snap.runs.length) return false;
  try {
    const res = await fetch(snap.source);
    if (!res.ok) return false;
    const blob = await res.blob();
    state.file = new File([blob], snap.name || "saved.webp", { type: blob.type || "image/webp" });
    state.name = snap.name || state.name;
    state.width = snap.width || state.width;
    state.height = snap.height || state.height;
    state.bytes = snap.bytes || blob.size;
    state.url = snap.source;
    Object.assign(settings, snap.settings || {});
    Object.assign(view, snap.view || {});
    const savedView = loadProjectView(snap.workId);
    if (savedView) Object.assign(view, savedView);
    $("blend").value = String(view.blend ?? 70);
    state.runs = snap.runs.map((r) => ({
      report: r.report,
      images: { ...(r.images || {}) },
      seconds: r.seconds || 0,
      meta: r.meta || { name: state.name, width: state.width, height: state.height, bytes: state.bytes },
      settings: r.settings || snap.settings || { ...settings },
      config: r.config || {},
      label: r.label || "",
      saved: true,
      workId: snap.workId,
    }));
    state.active = Math.min(Math.max(0, snap.active || 0), state.runs.length - 1);
    state.selected = -1;
    state.hoverSeg = null;
    state.projectId = snap.workId;
    rememberProject(snap.workId);
    renderResult();
    showScreen("result", { history: false });
    history.replaceState({ screen: "result" }, "", `/result?work=${encodeURIComponent(snap.workId)}`);
    return true;
  } catch { return false; }
}

async function saveWork(run) {
  try {
    const source = await imageUrlToWebP(state.url, 900, 0.82);
    const thumb = await imageUrlToWebP(run.images.redraw, 460, 0.8);
    if (!source || !thumb) return;
    const count = run.report?.summary?.segment_count || 0;
    const equations = flattenSegments(run.report).map((it) => ({
      model: it.seg.model,
      equation: it.seg.equation,
    }));
    const record = {
      id: newWorkId(),
      name: run.meta.name || state.name || "untitled",
      at: Date.now(),
      w: run.meta.width || state.width,
      h: run.meta.height || state.height,
      count,
      settings: JSON.parse(JSON.stringify(settings)),
      source,
      thumb,
      equations,
    };
    let works = loadWorks().filter((w) => !(w.name === record.name && w.count === count));
    works.unshift(record);
    works = works.slice(0, MAX_WORKS);
    const stored = persistWorks(works);
    updateLibraryBadge();
    if (stored.length < works.length) toast("Library is full", "The oldest work was removed.");
    return record.id;
  } catch { /* storage may be unavailable; tracing still works */ return null; }
}

function newWorkId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function workDate(at) {
  try {
    return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch { return ""; }
}

function workBaseName(name) {
  return String(name || "chawk").replace(/\.[^.]+$/, "") || "chawk";
}

function sortedWorks(works) {
  const list = works.slice();
  if (state.libSort === "oldest") list.sort((a, b) => (a.at || 0) - (b.at || 0));
  else if (state.libSort === "name") list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  else if (state.libSort === "equations") list.sort((a, b) => (b.count || 0) - (a.count || 0));
  else list.sort((a, b) => (b.at || 0) - (a.at || 0));
  return list;
}

function selectedWorks() {
  const set = state.libSelected;
  return loadWorks().filter((w) => set.has(w.id));
}

function showUndo(works) {
  state.pendingUndo = works;
  const text = works.length === 1 ? `Deleted “${works[0].name}”` : `${works.length} works deleted`;
  $("undo-text").textContent = text;
  $("undo").hidden = false;
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(hideUndo, 6000);
}

function hideUndo() {
  state.pendingUndo = null;
  clearTimeout(state.undoTimer);
  $("undo").hidden = true;
}

function toggleWork(id) {
  if (state.libSelected.has(id)) state.libSelected.delete(id);
  else state.libSelected.add(id);
  if (state.libSelected.size === 0) state.libSelect = false;
  renderLibrary();
}

function selectCard(id) {
  state.libSelect = true;
  state.libSelected.add(id);
  renderLibrary();
}

async function openWork(id, opts = {}) {
  const work = loadWorks().find((w) => w.id === id);
  if (!work) return false;
  closeLibMenus();
  if (!opts.check) {
    const snapshot = loadProjectSnapshot(id);
    if (snapshot && await restoreProjectSnapshot(snapshot)) return true;
  }
  rememberProject(id);
  try {
    const blob = await (await fetch(work.source)).blob();
    const file = new File([blob], work.name || "saved.webp", { type: blob.type || "image/webp" });
    if (work.settings) {
      settings.kind = work.settings.kind || "sketchy";
      const kv = KIND_VALUES[settings.kind];
      settings.sensitivity = kv ? kv.sensitivity : 50;
      settings.fit = kv ? kv.fit : 50;
      settings.advanced = { ...(work.settings.advanced || {}) };
    }
    await chooseFile(file);
    state.projectId = id;
    if (opts.trace === false) {
      history.replaceState({ screen: "check" }, "", `/check?work=${encodeURIComponent(id)}`);
    } else {
      trace();
    }
    return true;
  } catch {
    toast("Could not open that work", "The saved copy may be damaged.");
    if (opts.restore) openRestorePrompt("", opts.trace === false ? "check" : "result");
    return false;
  }
}

function startRename(id) {
  closeLibMenus();
  state.renaming = id;
  renderLibrary();
  requestAnimationFrame(() => {
    const input = document.querySelector(".workrename input");
    if (input) { input.focus(); input.select(); }
  });
}

function cancelRename() {
  state.renaming = null;
  renderLibrary();
}

function saveRename(id, value) {
  if (state.renaming !== id) return;
  const name = String(value || "").trim();
  state.renaming = null;
  if (!name) { renderLibrary(); return; }
  const works = loadWorks();
  const work = works.find((w) => w.id === id);
  if (!work) { renderLibrary(); return; }
  work.name = name;
  persistWorks(works);
  renderLibrary();
  toast("Renamed", name);
}

function copyName(name, works) {
  const m = String(name || "untitled").match(/^(.*?)(\.[a-z0-9]+)?$/i);
  const base = m[1] || "untitled";
  const ext = m[2] || "";
  const names = new Set(works.map((w) => String(w.name).toLowerCase()));
  let n = 0;
  let candidate = `${base} (copy)${ext}`;
  while (names.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} (copy ${n + 1})${ext}`;
  }
  return candidate;
}

function duplicateWork(id) {
  closeLibMenus();
  const works = loadWorks();
  const work = works.find((w) => w.id === id);
  if (!work) return;
  const copy = {
    ...work,
    id: newWorkId(),
    name: copyName(work.name, works),
    at: Date.now(),
    settings: JSON.parse(JSON.stringify(work.settings || {})),
    equations: (work.equations || []).map((e) => ({ ...e })),
  };
  persistWorks([copy, ...works]);
  renderLibrary();
  updateLibraryBadge();
  toast("Duplicated", copy.name);
}

function duplicateWorks(list) {
  if (!list.length) return;
  const works = loadWorks();
  const copies = list.map((work) => ({
    ...work,
    id: newWorkId(),
    name: copyName(work.name, works.concat(list)),
    at: Date.now(),
    settings: JSON.parse(JSON.stringify(work.settings || {})),
    equations: (work.equations || []).map((e) => ({ ...e })),
  }));
  persistWorks([...copies, ...works]);
  state.libSelect = false;
  state.libSelected.clear();
  renderLibrary();
  updateLibraryBadge();
  toast(`Duplicated ${copies.length}`, copies.length === 1 ? copies[0].name : "The selected works");
}

async function exportWorkPNG(work) {
  const img = await loadImageEl(work.thumb || work.source);
  if (!img) throw new Error("Missing image");
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth || 1;
  cv.height = img.naturalHeight || 1;
  const g = cv.getContext("2d");
  g.fillStyle = "#FAF9F4";
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode PNG");
  downloadURL(URL.createObjectURL(blob), `${workBaseName(work.name)}.png`);
}

async function exportWorksPNG(list) {
  if (!list.length) return;
  for (const work of list) {
    try { await exportWorkPNG(work); } catch { /* skip a broken thumb */ }
    await new Promise((r) => setTimeout(r, 220));
  }
  toast(`Exported ${list.length} image${list.length === 1 ? "" : "s"}`, "Check your downloads.");
}

function exportWorkJSON(work) {
  const data = {
    name: work.name,
    count: work.count,
    at: work.at,
    settings: work.settings || {},
    equations: work.equations || [],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadURL(URL.createObjectURL(blob), `${workBaseName(work.name)}-equations.json`);
}

function closeLibMenus() {
  $("lib-sort-menu").hidden = true;
  $("lib-card-menu").hidden = true;
  $("lib-sort-btn").setAttribute("aria-expanded", "false");
  for (const b of document.querySelectorAll(".workmore[aria-expanded='true']")) b.setAttribute("aria-expanded", "false");
  state.libMenuWork = null;
}

function openCardMenu(work, button) {
  closeLibMenus();
  state.libMenuWork = work.id;
  const menu = $("lib-card-menu");
  menu.innerHTML = "";
  const add = (label, icon, action, danger) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (danger) b.className = "danger";
    b.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${esc(label)}</span>`;
    b.onclick = (e) => { e.stopPropagation(); closeLibMenus(); action(); };
    menu.append(b);
  };
  add("Open", "ri-arrow-right-line", () => openWork(work.id));
  add("Rename", "ri-pencil-line", () => startRename(work.id));
  add("Duplicate", "ri-file-copy-2-line", () => duplicateWork(work.id));
  add("Export as PNG", "ri-image-line", () => exportWorkPNG(work).catch(() => toast("Could not export", "The saved image may be damaged.")));
  add("Equations (json)", "ri-download-line", () => exportWorkJSON(work));
  const sep = document.createElement("div");
  sep.className = "libmenu-sep";
  menu.append(sep);
  add("Delete…", "ri-delete-bin-line", () => openDeleteDialog([work], "single"), true);
  menu.hidden = false;
  const rect = button.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.min(window.innerWidth - mw - 8, Math.max(8, rect.right - mw));
  let top = rect.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  button.setAttribute("aria-expanded", "true");
}

function openSortMenu() {
  closeLibMenus();
  const menu = $("lib-sort-menu");
  menu.innerHTML = '<p class="libmenu-label">SORT BY</p>';
  for (const [key, label] of Object.entries(SORT_LABELS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", state.libSort === key ? "true" : "false");
    b.innerHTML = `<span class="libmenu-check${state.libSort === key ? "" : " blank"}"><i class="ri-check-line" aria-hidden="true"></i></span><span>${label}</span>`;
    b.onclick = () => {
      state.libSort = key;
      closeLibMenus();
      renderLibrary();
    };
    menu.append(b);
  }
  menu.hidden = false;
  const btn = $("lib-sort-btn");
  const rect = btn.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const left = Math.min(window.innerWidth - mw - 8, Math.max(8, rect.left));
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  btn.setAttribute("aria-expanded", "true");
}

function openDeleteDialog(works, kind) {
  closeLibMenus();
  if (!works.length) return;
  state.libDialog = { kind, works };
  const n = works.length;
  $("lib-dialog-title").textContent = kind === "single"
    ? `Delete “${works[0].name}”?`
    : kind === "bulk" ? `Delete ${n} works?` : `Delete all ${n} works?`;
  $("lib-dialog-body").textContent = kind === "single"
    ? `This removes it from this browser. Its ${formatCount(works[0].count)} equations can’t be recovered.`
    : kind === "bulk" ? "These will be removed from this browser for good."
      : "Everything kept in this browser will be erased.";
  const list = $("lib-dialog-list");
  list.innerHTML = "";
  list.hidden = kind !== "bulk";
  if (kind === "bulk") {
    for (const w of works) {
      const item = document.createElement("div");
      item.className = "libdialog-item";
      item.innerHTML = `<img src="${w.thumb}" alt=""><span>${esc(w.name)}</span>`;
      list.append(item);
    }
  }
  const confirm = kind === "all";
  $("lib-dialog-confirm").hidden = !confirm;
  const input = $("lib-dialog-input");
  input.value = "";
  $("lib-dialog-ok").textContent = kind === "single" ? "Delete" : kind === "bulk" ? `Delete ${n} works` : "Delete all";
  $("lib-dialog-ok").disabled = confirm;
  $("lib-dialog").hidden = false;
  if (confirm) requestAnimationFrame(() => input.focus());
  else requestAnimationFrame(() => $("lib-dialog-ok").focus());
}

function closeLibDialog() {
  state.libDialog = null;
  $("lib-dialog").hidden = true;
}

function confirmLibDelete() {
  const dialog = state.libDialog;
  if (!dialog) return;
  const ids = new Set(dialog.works.map((w) => w.id));
  const works = loadWorks();
  const removed = dialog.kind === "all" ? works : works.filter((w) => ids.has(w.id));
  const kept = dialog.kind === "all" ? [] : works.filter((w) => !ids.has(w.id));
  for (const w of removed) forgetProject(w.id);
  persistWorks(kept);
  if (dialog.kind !== "single") { state.libSelect = false; state.libSelected.clear(); }
  closeLibDialog();
  renderLibrary();
  updateLibraryBadge();
  if (removed.length) showUndo(removed);
}

function enterSelect() {
  state.libSelect = true;
  state.libSelected.clear();
  renderLibrary();
}

function exitSelect() {
  state.libSelect = false;
  state.libSelected.clear();
  renderLibrary();
}

function renderLibrary() {
  const allWorks = loadWorks();
  const query = String(state.libQuery || "").trim().toLowerCase();
  const matching = query
    ? allWorks.filter((w) => String(w.name).toLowerCase().includes(query))
    : allWorks;
  const works = sortedWorks(matching);
  const selecting = state.libSelect;
  const empty = works.length === 0;
  const noMatches = empty && !!query;
  for (const id of [...state.libSelected]) {
    if (!allWorks.some((w) => w.id === id)) state.libSelected.delete(id);
  }
  if (empty) { state.libSelect = false; state.libSelected.clear(); }

  $("lib-title").innerHTML = 'Previous works, <span class="hl"><i>kept</i></span>.';
  $("lib-sub").textContent = "Open one to run it again, or tidy up.";
  $("lib-toolbar").hidden = empty;
  $("lib-count-line").textContent = query
    ? `${works.length} of ${allWorks.length} work${allWorks.length === 1 ? "" : "s"}`
    : `${works.length} work${works.length === 1 ? "" : "s"}`;
  $("lib-sort-label").textContent = SORT_LABELS[state.libSort] || "Newest";
  $("lib-view-grid").setAttribute("aria-pressed", state.libView === "grid" ? "true" : "false");
  $("lib-view-list").setAttribute("aria-pressed", state.libView === "list" ? "true" : "false");
  $("lib-delete-all").hidden = allWorks.length === 0;

  const full = allWorks.length >= MAX_WORKS;
  $("lib-limit").hidden = allWorks.length === 0 || !full;
  if (full) {
    $("lib-limit-text").textContent = `${allWorks.length} of ${MAX_WORKS} works used.`;
    $("lib-limit-fill").style.width = `${Math.round((allWorks.length / MAX_WORKS) * 100)}%`;
  }

  const grid = $("lib-grid");
  grid.className = "libgrid" + (state.libView === "list" ? " list" : "") + (selecting ? " selecting" : "");
  grid.hidden = empty;
  $("lib-listhead").hidden = empty || state.libView !== "list";
  $("lib-empty").hidden = !empty;
  $("lib-empty-title").textContent = noMatches ? "Nothing matches" : "Nothing kept yet";
  $("lib-empty-sub").textContent = noMatches ? "Try a different search." : "Doodles you run will show up here.";
  $("lib-empty-new").hidden = noMatches;
  $("lib-clear-search").hidden = !noMatches;
  $("lib-note").textContent = allWorks.length
    ? `${Math.round(JSON.stringify(allWorks).length / 1024)} KB in this browser · up to ${MAX_WORKS} works`
    : "";

  $("lib-bulk").hidden = !selecting || empty;
  $("lib-bulk-count").textContent = `${state.libSelected.size} selected`;
  $("lib-bulk-n").textContent = String(state.libSelected.size);
  $("lib-bulk-export").disabled = state.libSelected.size === 0;
  $("lib-bulk-duplicate").disabled = state.libSelected.size === 0;
  $("lib-bulk-delete").disabled = state.libSelected.size === 0;

  grid.innerHTML = "";
  for (const w of works) {
    const picked = state.libSelected.has(w.id);
    const card = document.createElement("article");
    card.className = "work" + (picked ? " sel" : "");
    card.tabIndex = 0;
    card.setAttribute("aria-label", `${w.name}, ${formatCount(w.count)} equations`);
    if (selecting) {
      card.setAttribute("role", "checkbox");
      card.setAttribute("aria-checked", picked ? "true" : "false");
    }

    const thumb = document.createElement("div");
    thumb.className = "workthumb";
    thumb.dataset.art = "";
    const img = document.createElement("img");
    img.src = w.thumb;
    img.alt = `${w.name}, rebuilt from ${formatCount(w.count)} equations`;
    img.loading = "lazy";
    img.decoding = "async";
    const badge = document.createElement("span");
    badge.className = "workbadge";
    badge.textContent = `${formatCount(w.count)} eq`;
    thumb.append(img, badge);

    const body = document.createElement("div");
    body.className = "yt-body";
    const info = document.createElement("div");
    info.className = "yt-info";

    if (state.renaming === w.id) {
      const wrap = document.createElement("div");
      wrap.className = "workrename";
      const input = document.createElement("input");
      input.type = "text";
      input.value = w.name;
      input.setAttribute("aria-label", `Rename ${w.name}`);
      input.onclick = (e) => e.stopPropagation();
      input.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveRename(w.id, input.value); }
        else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
      };
      input.onblur = () => saveRename(w.id, input.value);
      const help = document.createElement("span");
      help.className = "workrename-help";
      help.textContent = "Enter to save · Esc to cancel";
      wrap.append(input, help);
      info.append(wrap);
    } else {
      const title = document.createElement("div");
      title.className = "worktitle";
      title.textContent = cardTitle(w.name);
      title.title = w.name;
      const sub = document.createElement("div");
      sub.className = "workinfo";
      sub.textContent = workInfo(w);
      sub.hidden = !sub.textContent;
      info.append(title, sub);
    }

    const more = document.createElement("button");
    more.type = "button";
    more.className = "yt-more";
    more.setAttribute("aria-label", `More actions for ${w.name}`);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = '<i class="ri-more-2-fill" aria-hidden="true"></i>';
    more.hidden = selecting;
    more.onclick = (e) => {
      e.stopPropagation();
      if (state.libMenuWork === w.id && !$("lib-card-menu").hidden) closeLibMenus();
      else openCardMenu(w, more);
    };
    body.append(info, more);
    card.append(thumb, body);

    const chk = document.createElement("button");
    chk.type = "button";
    chk.className = "workcheck";
    chk.setAttribute("aria-label", `${picked ? "Deselect" : "Select"} ${w.name}`);
    chk.setAttribute("aria-pressed", picked ? "true" : "false");
    chk.innerHTML = picked ? '<i class="ri-check-line" aria-hidden="true"></i>' : "";
    chk.onclick = (e) => {
      e.stopPropagation();
      if (selecting) toggleWork(w.id); else selectCard(w.id);
    };
    card.append(chk);

    if (selecting) card.onclick = () => toggleWork(w.id);
    else if (state.renaming !== w.id) card.onclick = () => openWork(w.id);
    card.onkeydown = (e) => {
      if (e.target !== card) return;
      if (state.renaming === w.id) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (selecting) toggleWork(w.id); else openWork(w.id);
      }
    };
    grid.append(card);
  }
}

/* ------------------------------------------------------------------ intake *//* ------------------------------------------------------------------ intake */
async function chooseFile(file) {
  if (!file) return;
  const okType = /^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name);
  if (!okType) { toast("That is not an image.", "PNG, JPG, WebP, BMP or TIFF."); return; }
  if (file.size > MAX_BYTES) { toast(`Too large (${(file.size / 1048576).toFixed(1)} MB).`, "The limit is 15 MB."); return; }
  if (file.size === 0) { toast("Empty file (0 bytes)."); return; }
  let width = 0, height = 0;
  try {
    const bmp = await createImageBitmap(file);
    width = bmp.width; height = bmp.height; bmp.close();
  } catch { toast("Could not read that image."); return; }
  if (width < 2 || height < 2 || Math.max(width, height) > 6000) {
    toast("Unusable image size.", "Keep it under 6000 px on the long side.");
    return;
  }
  if (state.url) URL.revokeObjectURL(state.url);
  for (const run of state.runs) {
    for (const url of Object.values(run.images)) if (url) URL.revokeObjectURL(url);
    if (run.sheetURL) URL.revokeObjectURL(run.sheetURL);
    run.sheetBlob = null;
    run.sheetURL = null;
  }
  previewCache = null;
  state.file = file; state.name = file.name; state.bytes = file.size;
  state.width = width; state.height = height;
  state.url = URL.createObjectURL(file);
  state.runs = []; state.active = -1; state.selected = -1;
  resetView();
  renderCheck();
  showScreen("check");
}

function resetView() {
  view.original = true; view.equations = true; view.labels = false;
  view.mode = "equations"; view.diff = false; view.blend = 70; view.yUp = false;
  $("blend").value = "70";
}

/* ------------------------------------------------------------------ check */
/* The preview never overflows: it is sized to the free canvas area, so a tall
   phone photo or a wide panorama both fit inside the card and the viewport. */
function fitPreview() {
  const img = $("preview-img");
  const wrap = $("preview-wrap");
  if (!img || !wrap || !img.naturalWidth) return;
  const desktop = window.innerWidth >= 900;
  const chrome = 36; // card padding + border on both axes
  const maxW = Math.max(80, wrap.clientWidth - chrome);
  const maxH = desktop
    ? Math.max(120, wrap.clientHeight - chrome)
    : Math.min(window.innerHeight * 0.56, 620);
  const ar = img.naturalWidth / img.naturalHeight;
  let w = maxW;
  let h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  img.style.width = `${Math.max(40, Math.round(w))}px`;
  img.style.height = `${Math.max(40, Math.round(h))}px`;
}

function renderCheck() {
  $("file-meta").textContent = `${state.name} · ${state.width}×${state.height} · ${Math.max(1, Math.round(state.bytes / 1024))} KB`;
  $("check-error").hidden = true;
  const img = $("preview-img");
  img.src = state.url;
  const onLoad = () => { fitPreview(); drawPreviewMask(); };
  if (img.complete) onLoad();
  else img.onload = onLoad;
  for (const row of document.querySelectorAll("[data-kind]")) {
    const on = row.dataset.kind === settings.kind;
    row.classList.toggle("on", on);
    row.querySelector("input").checked = on;
  }
  updateAdvancedBadge();
}

/* Blue "what will be traced" wash over the upload, computed locally so the
   sensitivity preset shows the effect before spending a trace. */
let previewCache = null;

/* Paper luminance from a 96 px sample: cheap enough to run for every image
   and accurate for tinted/kraft paper. */
function samplePaper(img) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) return { paperLum: 250, lightPaper: true };
  const w = 96;
  const h = Math.max(8, Math.round((96 * H) / W));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    hist[Math.min(255, Math.max(0, Math.round(
      0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])))]++;
    total++;
  }
  let acc = 0, p10 = 0, p90 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (p10 === 0 && acc >= total * 0.1) p10 = i;
    if (acc >= total * 0.9) { p90 = i; break; }
  }
  const lightPaper = p90 > 60;
  return { paperLum: lightPaper ? p90 : p10, lightPaper };
}

/* Full luminance array: only needed by the Canvas2D fallback. */
function buildLum(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return lum;
}

function buildPreviewCache() {
  const img = $("preview-img");
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  const scale = Math.min(1, 1400 / Math.max(W, H));
  const w = Math.max(2, Math.round(W * scale));
  const h = Math.max(2, Math.round(H * scale));
  const paper = samplePaper(img);
  const useGL = typeof ChawkGL !== "undefined" && ChawkGL.maskAvailable();
  previewCache = {
    w, h,
    lightPaper: paper.lightPaper,
    paperLum: paper.paperLum,
    lum: useGL ? null : buildLum(img, w, h),
  };
  return previewCache;
}

let maskFrame = 0;
function drawPreviewMask() {
  cancelAnimationFrame(maskFrame);
  maskFrame = requestAnimationFrame(() => {
    const img = $("preview-img");
    if (!img.complete) { img.onload = drawPreviewMask; return; }
    const cache = previewCache || buildPreviewCache();
    if (!cache) return;
    const { w, h, lightPaper, paperLum } = cache;
    const advC = Number(settings.advanced.adaptive_C);
    const sens = Number.isFinite(advC)
      ? Math.max(0, Math.min(100, (14 - advC) / 0.13))
      : settings.sensitivity;
    const cut = 95 - 0.8 * sens;

    const canvas = $("preview-mask");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const glMask = (typeof ChawkGL !== "undefined" && ChawkGL.maskAvailable())
      ? ChawkGL.mask(img, w, h, { paper: paperLum, cut, light: lightPaper })
      : null;
    if (glMask) {
      ctx.filter = `blur(${Math.max(3, Math.round(Math.max(w, h) / 190))}px)`;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glMask, 0, 0, w, h);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      return;
    }

    const lum = cache.lum || (cache.lum = buildLum(img, w, h));
    const paper = paperLum;
    const mask = document.createElement("canvas");
    mask.width = w; mask.height = h;
    const mctx = mask.getContext("2d");
    const out = mctx.createImageData(w, h);
    const od = out.data;
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      const ink = lightPaper ? lum[p] < paper - cut : lum[p] > paper + cut;
      if (!ink) continue;
      od[i] = 31; od[i + 1] = 63; od[i + 2] = 209; od[i + 3] = 255;
    }
    mctx.putImageData(out, 0, 0);

    ctx.filter = `blur(${Math.max(3, Math.round(Math.max(w, h) / 190))}px)`;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(mask, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  });
}

function advancedBase() {
  const preset = KIND_PRESET[settings.kind] || "balanced";
  const base = {
    ...(advancedMeta.defaults || {}),
    ...((advancedMeta.presets || {})[preset] || {}),
  };
  delete base.extras;
  base.adaptive_C = Math.max(1, Math.round(14 - 0.13 * settings.sensitivity));
  base.rmse_tolerance = round(3.5 - 3.0 * (settings.fit / 100), 2);
  return base;
}

function buildConfig() {
  return { ...advancedBase(), ...settings.advanced };
}

async function trace() {
  if (state.busy || !state.file) return;
  state.busy = true;
  $("check-error").hidden = true;
  openWorking();

  const controller = new AbortController();
  state.controller = controller;
  const fd = new FormData();
  fd.append("file", state.file);
  fd.append("preset", KIND_PRESET[settings.kind] || "balanced");
  fd.append("config", JSON.stringify(buildConfig()));
  const t0 = performance.now();
  let cancelled = false;
  try {
    const res = await fetch("/api/process", { method: "POST", body: fd, signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = (body && body.detail) || `Server error (${res.status}).`;
      throw Object.assign(new Error(detail), { status: res.status });
    }
    addRun(body, Math.round(performance.now() - t0) / 1000);
    closeWorking();
    renderResult();
    showScreen("result");
  } catch (e) {
    if (e.name === "AbortError") {
      cancelled = true;
      closeWorking();
      showScreen("check");
    } else {
      const hint = e.status === 422 ? " Dark lines on plain paper work best — try a sample."
        : e.status === 504 ? " Try the “Busy” setting, or a smaller image."
        : e.status === 400 ? " Try resetting the curve types."
        : "";
      const msg = e instanceof TypeError ? "Couldn’t reach the server." : e.message;
      closeWorking();
      showScreen("check");
      $("check-error").textContent = msg + hint;
      $("check-error").hidden = false;
      toast("Trace failed", msg);
    }
  } finally {
    state.busy = false;
    state.controller = null;
    if (!cancelled) closeWorking();
  }
}

function openWorking() {
  $("working-img").src = state.url;
  $("working-fig").textContent = `Fig. 1 · scanning ${state.name} for strokes`;
  showScreen("working");
  const started = performance.now();
  $("working-time").textContent = "0:00";
  clearInterval(state.workTimer);
  state.workTimer = setInterval(() => {
    const s = Math.floor((performance.now() - started) / 1000);
    $("working-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 250);
}

function closeWorking() {
  clearInterval(state.workTimer);
  state.workTimer = null;
}

/* ------------------------------------------------------------------ runs */
function addRun(payload, seconds) {
  const r = payload.report;
  const png = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  };
  const images = {
    clean: png(payload.image_clean_b64),
    labeled: png(payload.image_png_b64),
    redraw: png(payload.image_redraw_b64),
    redrawLabels: payload.image_redraw_labels_b64 ? png(payload.image_redraw_labels_b64) : null,
  };
  const run = {
    report: r, images, seconds: seconds ?? payload.timings_sec?.server_total ?? 0,
    meta: { name: state.name, width: state.width, height: state.height, bytes: state.bytes },
    settings: { ...settings, advanced: { ...settings.advanced } },
    config: buildConfig(),
    label: "",
    diff: null,
  };
  run.label = "";
  state.runs.push(run);
  state.active = state.runs.length - 1;
  run.label = runLabel(run);
  state.selected = -1;
}

function runLabel(run) {
  const base = { clean: "Clean", sketchy: "Sketchy", busy: "Busy" }[run.settings.kind] || "Sketchy";
  const idx = state.runs.indexOf(run);
  if (idx <= 0) return base;
  const prev = state.runs[idx - 1];
  const d = run.settings.fit - prev.settings.fit;
  if (d <= -6) return "Closer fit";
  if (d >= 6) return "Fewer equations";
  return base;
}

function activeRun() {
  return state.runs[state.active] || null;
}

/* ------------------------------------------------------------------ result */
function fitPlot() {
  const run = activeRun();
  if (!run) return;
  const plot = $("plot");
  const box = $("artbox");
  if (!plot || !box) return;
  const W = run.report.image_size.width, H = run.report.image_size.height;
  const cs = getComputedStyle(box);
  const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const desktop = window.innerWidth >= 900;
  const availH = desktop ? Math.max(240, window.innerHeight - 250) : Infinity;
  let w = Math.max(40, availW);
  let h = w * (H / W);
  if (desktop && h > availH) { h = availH; w = h * (W / H); }
  plot.style.width = Math.round(w) + "px";
  plot.style.height = Math.round(h) + "px";
  plot.style.aspectRatio = "auto";
}
window.addEventListener("resize", () => {
  if (!$("sheet").hidden) closeMenus();
  if (state.screen === "result") {
    fitPlot();
    placeCard();
    const it = selectedItem();
    if (it) drawSelectionOverlay(it);
    else if (state.hoverSeg) drawSelectionOverlay(state.hoverSeg);
  }
  if (state.screen === "check") fitPreview();
});

function renderResult() {
  const run = activeRun();
  if (!run) return;
  const r = run.report;
  const segs = flattenSegments(r);
  state.selected = -1;
  state.hoverSeg = null;

  // header

  // stage
  const plot = $("plot");
  const W = r.image_size.width, H = r.image_size.height;
  plot.style.setProperty("--ar", `${W} / ${H}`);
  plot.classList.toggle("yup", false);
  $("layer-ghost").src = state.url;
  paintStage();
  fitPlot();
  renderAxes();
  paintChips();

  // list + card
  $("eq-count").textContent = `${segs.length} equation${segs.length === 1 ? "" : "s"}`;
  const tight = segs.filter((s) => !isWarn(s)).length;
  const loose = segs.length - tight;
  $("eq-summary").textContent = loose
    ? `${tight} spot-on fit${tight === 1 ? "" : "s"} · ${loose} a bit wobbly`
    : `${tight} spot-on fit${tight === 1 ? "" : "s"}`;
  hideCard();
  renderRows(segs);
  clearSelectionOverlay();
  paintStage();

  // lazy diff
  requestAnimationFrame(() => setTimeout(() => drawDiff(), 30));

  if (!run.saved) {
    run.saved = true;
    saveWork(run).then(async (id) => {
      if (!id) return;
      run.workId = id;
      state.projectId = id;
      rememberProject(id);
      if (state.screen === "result") {
        history.replaceState({ screen: "result" }, "", `/result?work=${encodeURIComponent(id)}`);
      }
      await persistProjectSnapshot(id);
    }).catch(() => {});
  }
}

function flattenSegments(report) {
  const out = [];
  for (const st of report.strokes || []) {
    for (const sg of st.segments || []) {
      out.push({ stroke: st, seg: sg });
    }
  }
  return out;
}

function strokeLabel(stroke) {
  if (stroke.filled) {
    return `Fill ${stroke.fill_group}${stroke.fill_role === "hole" ? " · hole" : ""}`;
  }
  return `Stroke ${stroke.stroke_id}`;
}

function isWarn(item) {
  const sg = item.seg || item;
  return (sg.max_error ?? 0) > 2 || (sg.rmse ?? 0) > 1.2;
}

function pickDefaultSegment(segs) {
  let best = 0, bestLen = -1;
  segs.forEach((it, i) => {
    const l = it.seg.arc_length ?? 0;
    if (l > bestLen) { bestLen = l; best = i; }
  });
  return best;
}

function paintStage() {
  const run = activeRun();
  if (!run) return;
  const b = view.blend / 100;
  const ghost = $("layer-ghost");
  const math = $("layer-math");
  const showGhost = view.mode !== "equations";
  const showMath = view.mode !== "original";
  const both = view.mode === "both";
  ghost.style.display = showGhost ? "" : "none";
  ghost.style.mixBlendMode = view.mode === "original" ? "normal" : "multiply";
  math.style.display = showMath ? "" : "none";
  const dim = state.selected >= 0 || state.hoverSeg ? 0.25 : 1;
  ghost.style.opacity = showGhost ? String((both ? Math.max(0, 1 - b) : 1) * dim) : "0";
  math.style.opacity = showMath ? String((both ? Math.min(1, b) : 1) * dim) : "0";
  const src = view.labels
    ? (run.images.redrawLabels || run.images.labeled)
    : run.images.redraw;
  if (math.getAttribute("src") !== src) math.src = src;
  $("layer-diff").style.display = view.diff && showMath ? "" : "none";
  $("blend-wrap").hidden = !both;
  $("t-labels").disabled = !showMath;
  $("t-diff").disabled = !showMath;
  $("plot").setAttribute("aria-label", view.labels
    ? "Your drawing redrawn from its equations, with equation labels"
    : "Your drawing with its fitted equations");
  paintChips();
  saveProjectView();
}

function paintChips() {
  const map = {
    "t-original": view.mode === "original", "t-both": view.mode === "both",
    "t-equations": view.mode === "equations",
    "t-labels": view.labels, "t-diff": view.diff,
    "coord-px": !view.yUp, "coord-up": view.yUp,
  };
  for (const [id, on] of Object.entries(map)) {
    const el = $(id);
    if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  saveProjectView();
}

function renderAxes() {
  const run = activeRun();
  if (!run) return;
  const W = run.report.image_size.width, H = run.report.image_size.height;
  const xs = $("ticks-x"), ys = $("ticks-y");
  xs.innerHTML = "";
  ys.innerHTML = "";
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((W * i) / 4);
    const s = document.createElement("span");
    s.textContent = String(v);
    s.style.left = `${(i * 100) / 4}%`;
    xs.append(s);
  }
  const n = 3;
  for (let i = 0; i <= n; i++) {
    const raw = Math.round((H * i) / n);
    const s = document.createElement("span");
    s.textContent = String(view.yUp ? H - raw : raw);
    s.style.top = `${(i * 100) / n}%`;
    ys.append(s);
  }
}

function renderRows(segs) {
  const wrap = $("eq-rows");
  wrap.innerHTML = "";
  segs.forEach((item, i) => {
    const { stroke, seg } = item;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row" + (i === state.selected ? " on" : "");
    btn.dataset.i = String(i);

    const head = document.createElement("span");
    head.style.cssText = "display:flex;align-items:center;gap:8px;width:100%";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.dataset.color = stroke.color || "";
    dot.style.background = dotColor(stroke.color);
    const name = document.createElement("b");
    name.textContent = MODEL_NAME[seg.model] || seg.model;
    const st = document.createElement("span");
    st.className = "m";
    st.textContent = strokeLabel(stroke);
    head.append(dot, name, st);
    const badge = document.createElement("span");
    if (isWarn(item)) {
      badge.className = "warn";
      badge.textContent = "a bit wobbly";
    } else {
      badge.className = "ok";
      badge.textContent = "spot on";
    }
    const num = document.createElement("span");
    num.className = "no";
    num.textContent = `(${i + 1})`;
    head.append(badge, num);

    const eq = document.createElement("span");
    eq.className = "eq";
    eq.innerHTML = eqHTML(displayEquation(seg));

    btn.append(head, eq);
    const note = noteFor(seg);
    if (note) {
      const p = document.createElement("span");
      p.className = "m";
      p.textContent = note;
      btn.append(p);
    }
    btn.onclick = () => {
      if (state.selected === i) { clearSelection(); return; }
      selectSegment(i, true, true);
    };
    btn.onmouseenter = () => { if (hoverable()) previewSegment(item); };
    btn.onmouseleave = () => { if (hoverable()) endPreview(); };
    btn.onfocus = () => { if (hoverable()) previewSegment(item); };
    btn.onblur = () => { if (hoverable()) endPreview(); };
    wrap.append(btn);
  });
}

function noteFor(seg) {
  const notes = [];
  if (isWarn(seg)) {
    const [a, b] = seg.x_range || [];
    const at = Number.isFinite(a) && Number.isFinite(b)
      ? ` near x = ${Math.round(a)}–${Math.round(b)}` : "";
    notes.push(`Up to ${fmt(seg.max_error, 1)} px off${at}.`);
  }
  if (seg.notes && seg.notes.length) notes.push(seg.notes.join("; "));
  return notes.join(" ");
}

function domainText(seg) {
  const d = seg.domain || {};
  if (d.variable === "x" || d.variable === "y") {
    return `for ${Math.round(d.start)} ≤ ${d.variable} ≤ ${Math.round(d.end)}`;
  }
  if (d.variable === "theta" || d.variable === "t") {
    if (d.end - d.start >= 359) return "full loop";
    return `for ${Math.round(d.start)}° ≤ θ ≤ ${Math.round(d.end)}°`;
  }
  return seg.closed ? "closed curve" : "open curve";
}

function hideCard() {
  $("eqcard").hidden = true;
}

function fillCard(i, stroke, seg) {
  $("sel-dot").dataset.color = stroke.color || "";
  $("sel-dot").style.background = dotColor(stroke.color);
  $("sel-model").textContent = MODEL_NAME[seg.model] || seg.model;
  $("sel-stroke").textContent = strokeLabel(stroke);
  $("sel-eq").innerHTML = eqHTML(displayEquation(seg));
  $("sel-meta").textContent = `${domainText(seg)} · within ${fmt(seg.rmse, 2)} px of your ink`;
  $("sel-ok").hidden = isWarn(seg);
  $("sel-no").textContent = `(${i + 1})`;
}

function hoverable() {
  return window.matchMedia("(hover: hover)").matches;
}

function selectedItem() {
  const run = activeRun();
  if (!run || state.selected < 0) return null;
  return flattenSegments(run.report)[state.selected] || null;
}

function previewSegment(item) {
  state.hoverSeg = item;
  paintStage();
  drawSelectionOverlay(item);
}

function endPreview() {
  state.hoverSeg = null;
  paintStage();
  const it = selectedItem();
  if (it) drawSelectionOverlay(it); else clearSelectionOverlay();
}

function selectSegment(i, scroll, showCardFlag) {
  const run = activeRun();
  if (!run) return;
  const segs = flattenSegments(run.report);
  if (i < 0 || i >= segs.length) return;
  state.selected = i;
  state.hoverSeg = null;
  const { stroke, seg } = segs[i];
  for (const row of document.querySelectorAll("#eq-rows .row")) {
    row.classList.toggle("on", Number(row.dataset.i) === i);
  }
  fillCard(i, stroke, seg);
  if (showCardFlag) $("eqcard").hidden = false;
  placeCard();
  paintStage();
  drawSelectionOverlay({ stroke, seg });
  if (scroll) {
    const row = document.querySelector(`#eq-rows .row[data-i="${i}"]`);
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function clearSelection() {
  state.selected = -1;
  state.hoverSeg = null;
  for (const row of document.querySelectorAll("#eq-rows .row")) row.classList.remove("on");
  hideCard();
  clearSelectionOverlay();
  paintStage();
}

function placeCard() {
  const card = $("eqcard");
  if (!card || card.hidden) return;
  const row = document.querySelector(`#eq-rows .row[data-i="${state.selected}"]`);
  if (window.innerWidth < 900 && row) {
    if (card.previousElementSibling !== row) row.after(card);
    card.classList.add("inline");
  } else {
    const dock = $("card-dock");
    if (dock && card.parentElement !== dock) dock.append(card);
    card.classList.remove("inline");
  }
}

/* The selected/previewed curve is highlighted from the equation raster itself:
   match the stroke colour inside its bbox, then draw those pixels with a white
   halo. No bounding-box guesswork. */
const selDrawn = { token: 0 };
function parseHexColor(hex) {
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function clearSelectionOverlay() {
  selDrawn.token += 1;
  const c = $("layer-sel");
  if (!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
}
async function drawSelectionOverlay(item) {
  const token = ++selDrawn.token;
  const c = $("layer-sel");
  const run = activeRun();
  if (!c || !run || !item) { clearSelectionOverlay(); return; }
  const plot = $("plot");
  const W = Math.max(1, plot.clientWidth), H = Math.max(1, plot.clientHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const im = await loadImage(run.images.redraw);
  if (!im || token !== selDrawn.token || activeRun() !== run) return;
  const off = document.createElement("canvas");
  off.width = Math.round(W); off.height = Math.round(H);
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.drawImage(im, 0, 0, W, H);

  const size = run.report.image_size;
  const sx = W / size.width, sy = H / size.height;
  const seg = item.seg;
  const [x0, x1] = seg.x_range || [0, 0];
  const [y0, y1] = seg.y_range || [0, 0];
  const pad = 8;
  const bx = Math.max(0, Math.floor(Math.min(x0, x1) * sx - pad));
  const by = Math.max(0, Math.floor(Math.min(y0, y1) * sy - pad));
  const bw = Math.min(W - bx, Math.ceil(Math.abs(x1 - x0) * sx + pad * 2));
  const bh = Math.min(H - by, Math.ceil(Math.abs(y1 - y0) * sy + pad * 2));
  if (bw < 1 || bh < 1) return;

  if (item.stroke.filled) {
    // A fill is an area: frame it cleanly instead of painting a noisy interior.
    const col = artDotColor(item.stroke.color);
    ctx.save();
    ctx.fillStyle = col + "14";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.lineWidth = 6;
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    ctx.restore();
    return;
  }

  const src = octx.getImageData(bx, by, bw, bh);
  const col = parseHexColor(item.stroke.color) || { r: 21, g: 22, b: 26 };
  const mask = document.createElement("canvas");
  mask.width = bw; mask.height = bh;
  const mctx = mask.getContext("2d");
  const md = mctx.createImageData(bw, bh);
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3];
    if (a < 40) continue;
    const d = Math.abs(src.data[i] - col.r) + Math.abs(src.data[i + 1] - col.g)
      + Math.abs(src.data[i + 2] - col.b);
    if (d < 120) {
      md.data[i] = 255; md.data[i + 1] = 255; md.data[i + 2] = 255; md.data[i + 3] = 255;
    }
  }
  mctx.putImageData(md, 0, 0);

  const colored = document.createElement("canvas");
  colored.width = bw; colored.height = bh;
  const cctx = colored.getContext("2d");
  cctx.drawImage(mask, 0, 0);
  cctx.globalCompositeOperation = "source-in";
  cctx.fillStyle = artDotColor(item.stroke.color);
  cctx.fillRect(0, 0, bw, bh);

  ctx.save();
  ctx.shadowColor = "#1F3FD1";
  ctx.shadowBlur = 9;
  ctx.drawImage(colored, bx, by);
  ctx.restore();
  ctx.drawImage(colored, bx, by);
}

/* ------------------------------------------------------------------ y up */
function displayEquation(seg) {
  if (!view.yUp) return seg.equation;
  const run = activeRun();
  const H = run?.report.image_size.height ?? 0;
  const up = yUpEquation(seg, H);
  return up ? up.eq : seg.equation;
}

function yUpEquation(seg, H) {
  const p = seg.params || {};
  const eq = seg.equation || "";
  const m = seg.model || "";
  const inner = (v) => `(${fmt(v)})`;
  if (m === "line" && p.form === "y = m*x + b") {
    return { eq: `y = ${fmt(-p.m)}x${signed(H - p.b)}` };
  }
  if (m === "line" && p.form === "x = m*y + b") {
    return { eq: `x = ${fmt(-p.m)}y${signed(p.m * H + p.b)}` };
  }
  if (/^polynomial\d$/.test(m) && p.dependent === "y" && Array.isArray(p.coefficients)) {
    const c = p.coefficients.slice();
    c[c.length - 1] = H - c[c.length - 1];
    for (let i = 0; i < c.length - 1; i++) c[i] = -c[i];
    return { eq: polyString(c, Number(m.slice(10)), "x", "y") };
  }
  if (m === "circle" && Number.isFinite(p.h)) {
    return { eq: `(x - ${fmt(p.h)})² + (y - ${fmt(H - p.k)})² = ${fmt(p.r)}²` };
  }
  if (m === "sinusoid" && p.independent === "x") {
    return { eq: `y = ${fmt(-p.A)}·sin(${fmt(p.B)}x${signed(p.C)})${signed(H - p.D)}` };
  }
  if ((m === "ellipse" || m === "elliptical_arc") && Number.isFinite(p.cx)) {
    const cy = H - p.cy, phi = -p.phi_deg;
    const base = `((x-${fmt(p.cx)})cosφ + (y-${fmt(cy)})sinφ)²/${fmt(p.a)}² + (-(x-${fmt(p.cx)})sinφ + (y-${fmt(cy)})cosφ)²/${fmt(p.b)}² = 1, φ = ${fmt(phi, 1)}°`;
    return { eq: base };
  }
  if (m === "point") {
    return { eq: `(${fmt(p.x)}, ${fmt(H - p.y)})` };
  }
  return null; // spline prose, x = f(y) polynomials: pixel coordinates only
}

function polyString(coeffs, degree, indep, dep) {
  const parts = [];
  for (let i = 0; i <= degree; i++) {
    const power = degree - i;
    const c = coeffs[i];
    if (Math.abs(c) < 1e-12 && power !== 0) continue;
    const mag = fmt(Math.abs(c));
    const body = power === 0 ? mag
      : (Math.abs(c) === 1 ? "" : mag) + (power === 1 ? indep : indep + (SUPER[power] || `^${power}`));
    parts.push({ neg: c < 0, body });
  }
  let s = parts.length ? (parts[0].neg ? "−" : "") + parts[0].body : "0";
  for (let i = 1; i < parts.length; i++) s += (parts[i].neg ? " − " : " + ") + parts[i].body;
  return `${dep} = ${s}`;
}

/* ------------------------------------------------------------------ diff */
function drawDiff() {
  const run = activeRun();
  if (!run || !view.diff) { clearDiff(); return; }
  const W = run.report.image_size.width, H = run.report.image_size.height;
  const max = 1100;
  const s = Math.min(1, max / Math.max(W, H));
  const w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
  if (typeof ChawkGL !== "undefined" && ChawkGL.diffAvailable()) drawDiffGPU(run, w, h);
  else drawDiffCPU(run, w, h);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/* GPU path: threshold + dilate in one fragment shader, read back a small
   mask and cluster it into ticks on the CPU (cheap: a few hundred cells). */
function drawDiffGPU(run, w, h) {
  Promise.all([loadImage(state.url), loadImage(run.images.redraw)]).then(([a, b]) => {
    if (!a || !b || activeRun() !== run) return;
    const targetW = Math.min(700, Math.max(200, w));
    const targetH = Math.max(1, Math.round((targetW * h) / w));
    const pa = samplePaper(a);
    const pb = samplePaper(b);
    const radius = Math.max(1, Math.round((2 * targetW) / w));
    const res = ChawkGL.diff(a, b, {
      width: targetW, height: targetH,
      paperA: pa.paperLum, lightA: pa.lightPaper,
      paperB: pb.paperLum, lightB: pb.lightPaper,
      radX: radius, radY: radius,
    });
    if (!res) { drawDiffCPU(run, w, h); return; }
    const { gl, width: tw, height: th } = res;
    const px = new Uint8Array(tw * th * 4);
    try {
      gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
    } catch {
      drawDiffCPU(run, w, h);
      return;
    }

    const canvas = $("layer-diff");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const cell = Math.max(8, Math.round(Math.max(w, h) / 60));
    const need = Math.max(4, Math.round(cell * cell * 0.05));
    const sx = w / tw, sy = h / th;
    ctx.strokeStyle = "#C2410C";
    ctx.lineWidth = Math.max(1.2, w / 700);
    ctx.lineCap = "round";
    for (let cy = 0; cy < th; cy += cell) {
      for (let cx = 0; cx < tw; cx += cell) {
        let miss = 0;
        const yEnd = Math.min(th, cy + cell), xEnd = Math.min(tw, cx + cell);
        for (let y = cy; y < yEnd; y++) {
          const row = (th - 1 - y) * tw; // readPixels rows are bottom-up
          for (let x = cx; x < xEnd; x++) {
            if (px[(row + x) * 4 + 3] > 140) miss++;
          }
        }
        if (miss >= need) {
          const tx = (cx + cell / 2) * sx;
          const ty = (cy + cell / 2) * sy;
          ctx.beginPath();
          ctx.moveTo(tx, ty - cell * sy * 0.45);
          ctx.lineTo(tx, ty + cell * sy * 0.45);
          ctx.stroke();
        }
      }
    }
  });
}

function drawDiffCPU(run, w, h) {
  const read = (src) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(im, 0, 0, w, h);
      resolve(x.getImageData(0, 0, w, h).data);
    };
    im.onerror = () => resolve(null);
    im.src = src;
  });

  Promise.all([read(state.url), read(run.images.redraw)]).then(([a, b]) => {
    if (!a || !b || activeRun() !== run) return;
    const inkA = inkMask(a), inkB = inkMask(b);
    const dilB = dilate(inkB, w, h, 2);

    const canvas = $("layer-diff");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const cell = Math.max(8, Math.round(Math.max(w, h) / 60));
    const need = Math.max(4, Math.round(cell * cell * 0.05));
    ctx.strokeStyle = "#C2410C";
    ctx.lineWidth = Math.max(1.2, w / 700);
    ctx.lineCap = "round";
    for (let cy = 0; cy < h; cy += cell) {
      for (let cx = 0; cx < w; cx += cell) {
        let miss = 0;
        const yEnd = Math.min(h, cy + cell), xEnd = Math.min(w, cx + cell);
        for (let y = cy; y < yEnd; y++) {
          const row = y * w;
          for (let x = cx; x < xEnd; x++) {
            if (inkA[row + x] && !dilB[row + x]) miss++;
          }
        }
        if (miss >= need) {
          const px = cx + cell / 2, py = cy + cell / 2;
          ctx.beginPath();
          ctx.moveTo(px, py - cell * 0.45);
          ctx.lineTo(px, py + cell * 0.45);
          ctx.stroke();
        }
      }
    }
  });
}

function clearDiff() {
  const c = $("layer-diff");
  c.width = 0; c.height = 0;
}

function inkMask(data) {
  // Paper colour from a luminance histogram (90th/10th percentile), so paper
  // texture and grain are not mistaken for ink.
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    hist[Math.min(255, Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]))]++;
    total++;
  }
  let acc = 0, p10 = 0, p90 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (p10 === 0 && acc >= total * 0.1) p10 = i;
    if (acc >= total * 0.9) { p90 = i; break; }
  }
  const light = p90 > 60;
  const paper = light ? p90 : p10;
  const out = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    out[p] = (light ? l < paper - 55 : l > paper + 55) ? 1 : 0;
  }
  return out;
}

function dilate(mask, w, h, r) {
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) { next[i] = 1; continue; }
        if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) ||
            (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/* ------------------------------------------------------------------ exports */
function currentItems() {
  const run = activeRun();
  if (!run) return [];
  return flattenSegments(run.report).map(({ stroke, seg }) => ({
    stroke, seg, model: seg.model, equation: displayEquation(seg),
  }));
}

function syntheticReport(items) {
  const run = activeRun();
  return {
    summary: run ? run.report.summary : {},
    strokes: items.map((it) => ({ segments: [{ model: it.model, equation: it.equation }] })),
  };
}

function latexFor(seg) {
  const eq = displayEquation(seg);
  return (typeof chawkToLatex === "function" && chawkToLatex(eq, seg.model)) || eq;
}

function copyAllTeX(items) {
  const report = syntheticReport(items);
  if (typeof chawkEquationsLatex === "function") return chawkEquationsLatex(report, { source: state.name });
  return items.map((it) => latexFor(it.seg)).join("\n");
}

function copyAllText(items) {
  const report = syntheticReport(items);
  if (typeof chawkEquationsText === "function") return chawkEquationsText(report, { source: state.name });
  return items.map((it) => it.equation).join("\n");
}

/* ------------------------------------------------------------------ menus */
function positionMenu(menu, button) {
  if (window.matchMedia("(min-width:900px)").matches) {
    const r = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const belowBar = $("bar").getBoundingClientRect().bottom + 6;
    menu.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, r.right - width))}px`;
    menu.style.right = "auto";
    menu.style.top = `${Math.max(r.bottom + 6, belowBar)}px`;
  } else {
    menu.style.left = "";
    menu.style.right = "";
    menu.style.top = "";
  }
}

let menuTrigger = null;

function openSheet(trigger) {
  closeMenus();
  const btn = trigger || $("download-menu-btn");
  const menu = $("sheet");
  menu.hidden = false;
  positionMenu(menu, btn);
  $("scrim").hidden = false;
  $("download-menu-btn").setAttribute("aria-expanded", String(btn === $("download-menu-btn")));
  $("download-mobile-menu").setAttribute("aria-expanded", String(btn === $("download-mobile-menu")));
  document.body.classList.add("menu-open");
  menuTrigger = btn;
  btn.focus({ preventScroll: true });
}
function closeMenus() {
  const wasOpen = !$("sheet").hidden;
  $("sheet").hidden = true;
  $("scrim").hidden = true;
  $("download-menu-btn").setAttribute("aria-expanded", "false");
  $("download-mobile-menu").setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
  if (wasOpen && menuTrigger && menuTrigger.offsetParent !== null) {
    menuTrigger.focus({ preventScroll: true });
  }
  menuTrigger = null;
}

/* ------------------------------------------------------------------ wiring */
/* ------------------------------------------------------------------ hero demo */
const demo = { slides: [], index: 0, raw: 1, timer: null, playing: true, reduced: false, fadeTimer: null };

function renderDemoText(slide) {
  const eqs = $("demo-eqs");
  const quip = $("demo-quip");
  clearTimeout(demo.fadeTimer);
  eqs.classList.add("is-fading");
  quip.classList.add("is-fading");
  demo.fadeTimer = setTimeout(() => {
    const equations = slide.equations || [];
    const more = Math.max(0, (slide.count || 0) - equations.length);
    eqs.innerHTML = equations
      .map((eq) => `<span class="f">${esc(eq)}</span>`)
      .join("") + (more ? `<span class="demo-more">…and ${more.toLocaleString()} more</span>` : "");
    quip.textContent = slide.quip || "";
    eqs.classList.remove("is-fading");
    quip.classList.remove("is-fading");
  }, 130);
}

async function initDemo() {
  try {
    const res = await fetch("assets/demo-slides.json");
    if (!res.ok) return;
    const slides = await res.json();
    if (!Array.isArray(slides) || !slides.length) return;
    demo.slides = slides;
    demo.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    demo.playing = !demo.reduced;

    const N = slides.length;
    const ordered = [slides[N - 1], ...slides, slides[0]];
    const deck = $("demo-deck");
    deck.innerHTML = ordered.map((s, raw) => {
      const real = raw === 0 ? N - 1 : raw === N + 1 ? 0 : raw - 1;
      const clone = raw === 0 || raw === N + 1;
      return `
        <figure class="deck-card${raw === 1 ? " is-active" : ""}${clone ? " is-clone" : ""}" data-raw="${raw}" data-real="${real}" data-art${clone ? ' aria-hidden="true"' : ""}>
          <img src="${esc(s.src)}" width="720" height="480" alt="${esc(s.alt || "")}" draggable="false">
          <figcaption class="deck-count">${Number(s.count || 0).toLocaleString()} equations</figcaption>
        </figure>`;
    }).join("");

    const dots = $("demo-dots");
    dots.innerHTML = slides.map((s, i) =>
      `<button class="dot${i === 0 ? " is-active" : ""}" type="button" data-i="${i}" aria-label="Show proof ${i + 1}" aria-pressed="${i === 0}"></button>`).join("");

    const cards = [...deck.querySelectorAll(".deck-card")];
    const dotEls = [...dots.querySelectorAll(".dot")];
    const gap = () => parseFloat(getComputedStyle(deck).gap) || 10;
    const step = () => cards[0] ? cards[0].getBoundingClientRect().width + gap() : 0;
    const realOf = (raw) => ((raw - 1) % N + N) % N;

    const setActive = (raw) => {
      const real = realOf(raw);
      const changed = real !== demo.index;
      demo.raw = raw;
      demo.index = real;
      cards.forEach((c, j) => c.classList.toggle("is-active", j === raw));
      dotEls.forEach((d, j) => {
        d.classList.toggle("is-active", j === real);
        d.setAttribute("aria-pressed", String(j === real));
      });
      cards[raw]?.append($("demo-overlay"));
      $("demo-play")?.closest(".deck-card")?.classList.toggle("is-paused", !demo.playing);
      if (changed) renderDemoText(slides[real]);
    };

    const go = (real, instant = false) => {
      const n = ((real % N) + N) % N;
      let raw = n + 1;
      if (demo.index === N - 1 && n === 0) raw = N + 1;
      else if (demo.index === 0 && n === N - 1) raw = 0;
      const card = cards[raw];
      if (!card) return;
      const s = step();
      deck.scrollTo({
        left: Math.max(0, raw * s),
        behavior: instant || demo.reduced ? "instant" : "smooth",
      });
      setActive(raw);
    };

    const normalize = () => {
      if (demo.raw !== 0 && demo.raw !== N + 1) return;
      // The clone is pixel-identical to the real card. Jump instantly so the
      // reset never animates backwards through the deck.
      const prevBehavior = deck.style.scrollBehavior;
      deck.style.scrollBehavior = "auto";
      if (demo.raw === 0) {
        deck.scrollLeft = step() * N;
        setActive(N);
      } else {
        deck.scrollLeft = step();
        setActive(1);
      }
      deck.style.scrollBehavior = prevBehavior;
    };

    let settleTimer = null;
    deck.addEventListener("scroll", () => {
      const s = step();
      if (!s) return;
      const raw = Math.max(0, Math.min(N + 1, Math.round(deck.scrollLeft / s)));
      if (raw !== demo.raw) setActive(raw);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(normalize, 220);
    }, { passive: true });

    dotEls.forEach((d) => d.addEventListener("click", () => go(Number(d.dataset.i))));
    $("demo-prev").addEventListener("click", () => go(demo.index - 1));
    $("demo-next").addEventListener("click", () => go(demo.index + 1));
    deck.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(demo.index + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(demo.index - 1); }
    });

    let down = null;
    deck.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      down = { x: e.clientX, left: deck.scrollLeft, id: e.pointerId };
      deck.setPointerCapture(e.pointerId);
      deck.style.scrollSnapType = "none";
    });
    deck.addEventListener("pointermove", (e) => {
      if (!down || e.pointerId !== down.id) return;
      deck.scrollLeft = down.left - (e.clientX - down.x);
    });
    const endDrag = () => {
      if (!down) return;
      down = null;
      deck.style.scrollSnapType = "x mandatory";
      const s = step();
      if (s) go(Math.round(deck.scrollLeft / s) - 1);
    };
    deck.addEventListener("pointerup", endDrag);
    deck.addEventListener("pointercancel", endDrag);

    const playBtn = $("demo-play");
    const updatePlay = () => {
      playBtn.setAttribute("aria-label", demo.playing ? "Pause auto-cycling" : "Start auto-cycling");
      playBtn.title = demo.playing ? "Pause auto-cycling" : "Start auto-cycling";
      playBtn.innerHTML = `<i class="ri ${demo.playing ? "ri-pause-fill" : "ri-play-fill"}" aria-hidden="true"></i>`;
    };
    const stopAuto = () => {
      clearInterval(demo.timer);
      demo.timer = null;
    };
    const startAuto = () => {
      stopAuto();
      if (!demo.playing || demo.reduced || document.hidden) return;
      demo.timer = setInterval(() => {
        if (!document.hidden) go(demo.index + 1);
      }, 9000);
    };
    const setPlaying = (v) => {
      demo.playing = v;
      updatePlay();
      if (v) startAuto(); else stopAuto();
    };
    playBtn.addEventListener("click", () => setPlaying(!demo.playing));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopAuto();
      else if (demo.playing && !demo.reduced) startAuto();
    });

    const modal = $("demo-modal");
    const compare = $("demo-compare");
    const compareInput = compare.querySelector("input");
    let modalTimer = 0;
    const openModal = () => {
      const s = demo.slides[demo.index];
      if (!s) return;
      $("demo-original").src = s.original || s.src;
      $("demo-original").alt = s.alt || "";
      $("demo-rebuilt").src = s.rebuilt || s.src;
      $("demo-rebuilt").alt = `${s.name || "This proof"}, rebuilt from equations`;
      $("demo-modal-title").textContent = s.name || s.alt || "Proof";
      $("demo-modal-count").textContent = `Rebuilt from ${Number(s.count || 0).toLocaleString()} equations.`;
      const equations = s.equations || [];
      const more = Math.max(0, (s.count || 0) - equations.length);
      $("demo-modal-eqs").innerHTML = equations.map((eq) => `<span class="f">${esc(eq)}</span>`).join("")
        + (more ? `<span class="demo-more">…and ${more.toLocaleString()} more</span>` : "");
      compare.style.setProperty("--pos", "50%");
      compareInput.value = "50";
      clearTimeout(modalTimer);
      modal.hidden = false;
      modal.classList.remove("is-closing");
      requestAnimationFrame(() => modal.classList.add("is-open"));
      document.body.classList.add("modal-open");
      $("demo-modal-card").focus({ preventScroll: true });
    };
    const closeModal = () => {
      if (modal.hidden) return;
      modal.classList.remove("is-open");
      modal.classList.add("is-closing");
      document.body.classList.remove("modal-open");
      clearTimeout(modalTimer);
      modalTimer = setTimeout(() => {
        modal.hidden = true;
        modal.classList.remove("is-closing");
      }, 220);
      $("demo-max")?.focus();
    };
    compareInput.addEventListener("input", (e) => {
      compare.style.setProperty("--pos", `${e.target.value}%`);
    });
    $("demo-max").addEventListener("click", (e) => { e.stopPropagation(); openModal(); });
    $("demo-modal-close").addEventListener("click", closeModal);
    $("demo-modal-scrim").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    $("demo-modal-project").addEventListener("click", async () => {
      const s = demo.slides[demo.index];
      if (!s) return;
      closeModal();
      try {
        const res = await fetch(s.original || s.src);
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "webp").replace("jpeg", "jpg");
        await chooseFile(new File([blob], `proof-${String(demo.index + 1).padStart(2, "0")}.${ext}`, {
          type: blob.type || "image/webp",
        }));
        await trace();
      } catch (e) {
        toast("Could not open the proof", e.message || String(e));
      }
    });

    setActive(1);
    updatePlay();
    requestAnimationFrame(() => {
      deck.scrollLeft = step();
      setActive(1);
      startAuto();
    });
  } catch { /* static first card remains */ }
}

function bind() {
  $("brand-home").addEventListener("click", (e) => {
    e.preventDefault();
    if (state.screen === "start") window.scrollTo({ top: 0, behavior: "smooth" });
    else showScreen("start");
  });
  $("drop").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", () => {
    chooseFile($("file").files[0]);
    $("file").value = "";
  });
  $("check-change").addEventListener("click", () => $("file").click());
  $("trace").addEventListener("click", trace);
  $("library-btn").addEventListener("click", () => {
    state.libSelect = false;
    state.libSelected.clear();
    showScreen("library");
  });
  $("nav-new").addEventListener("click", () => showScreen("start"));
  $("home-archive").addEventListener("click", () => showScreen("library"));
  $("lib-search").addEventListener("input", (e) => {
    state.libQuery = e.target.value;
    if (state.screen === "library") renderLibrary();
  });
  $("lib-clear-search").addEventListener("click", () => {
    state.libQuery = "";
    $("lib-search").value = "";
    renderLibrary();
    $("lib-search").focus();
  });
  $("lib-empty-new").addEventListener("click", () => showScreen("start"));
  $("lib-bulk-all").addEventListener("click", () => {
    for (const w of loadWorks()) state.libSelected.add(w.id);
    renderLibrary();
  });
  $("lib-bulk-close").addEventListener("click", exitSelect);
  $("lib-delete-all").addEventListener("click", () => openDeleteDialog(loadWorks(), "all"));
  $("lib-manage").addEventListener("click", enterSelect);
  $("lib-bulk-delete").addEventListener("click", () => openDeleteDialog(selectedWorks(), "bulk"));
  $("lib-bulk-export").addEventListener("click", () => exportWorksPNG(selectedWorks()));
  $("lib-bulk-duplicate").addEventListener("click", () => duplicateWorks(selectedWorks()));
  $("lib-sort-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if ($("lib-sort-menu").hidden) openSortMenu(); else closeLibMenus();
  });
  $("lib-view-grid").addEventListener("click", () => { state.libView = "grid"; renderLibrary(); });
  $("lib-view-list").addEventListener("click", () => { state.libView = "list"; renderLibrary(); });
  $("lib-dialog-cancel").addEventListener("click", closeLibDialog);
  $("lib-dialog-scrim").addEventListener("click", closeLibDialog);
  $("lib-dialog-ok").addEventListener("click", confirmLibDelete);
  $("lib-dialog-input").addEventListener("input", (e) => {
    $("lib-dialog-ok").disabled = e.target.value.trim().toUpperCase() !== "DELETE";
  });
  $("lib-dialog-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !$("lib-dialog-ok").disabled) { e.preventDefault(); confirmLibDelete(); }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#lib-card-menu") && !e.target.closest("#lib-sort-menu")
      && !e.target.closest(".workmore") && !e.target.closest("#lib-sort-btn")) closeLibMenus();
  });
  window.addEventListener("scroll", () => {
    if (!$("lib-card-menu").hidden || !$("lib-sort-menu").hidden) closeLibMenus();
  }, true);
  $("undo-btn").addEventListener("click", () => {
    if (!state.pendingUndo) return;
    const restored = state.pendingUndo.concat(loadWorks()).slice(0, MAX_WORKS);
    persistWorks(restored);
    hideUndo();
    renderLibrary();
    updateLibraryBadge();
  });
  $("undo-close").addEventListener("click", hideUndo);
  $("restore-cancel").addEventListener("click", restoreCancel);
  $("restore-scrim").addEventListener("click", restoreCancel);
  $("restore-ok").addEventListener("click", restoreConfirm);
  updateLibraryBadge();
  initDemo();
  $("cancel").addEventListener("click", () => { if (state.controller) state.controller.abort(); });

  document.addEventListener("dragover", (e) => { e.preventDefault(); $("drop")?.classList.add("drag"); });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) $("drop")?.classList.remove("drag"); });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    $("drop")?.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) chooseFile(f);
  });
  document.addEventListener("paste", (e) => {
    const f = e.clipboardData?.files?.[0];
    if (f) chooseFile(f);
  });

  document.querySelectorAll("[data-sample]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        const res = await fetch("samples/" + b.dataset.sample);
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        chooseFile(new File([blob], b.dataset.sample, { type: "image/png" }));
      } catch { toast("Couldn’t load the sample.", "Is the server running?"); }
    });
  });

  $("adv-open").addEventListener("click", openAdvanced);
  $("adv-close").addEventListener("click", closeAdvanced);
  $("adv-cancel").addEventListener("click", closeAdvanced);
  $("adv-scrim").addEventListener("click", closeAdvanced);
  $("adv-apply").addEventListener("click", applyAdvanced);
  $("adv-reset").addEventListener("click", resetAdvanced);

  document.querySelectorAll("[data-kind]").forEach((row) => {
    row.addEventListener("click", () => {
      settings.kind = row.dataset.kind;
      const v = KIND_VALUES[settings.kind];
      if (v) { settings.sensitivity = v.sensitivity; settings.fit = v.fit; }
      for (const r of document.querySelectorAll("[data-kind]")) r.classList.toggle("on", r === row);
      for (const r of document.querySelectorAll("[data-kind] input")) r.checked = r.closest("[data-kind]") === row;
      drawPreviewMask();
    });
  });

  // result toggles
  const setMode = (mode) => {
    view.mode = mode;
    if (mode === "both" && view.blend === 0) view.blend = 50;
    paintStage();
  };
  $("t-original").addEventListener("click", () => setMode("original"));
  $("t-both").addEventListener("click", () => setMode("both"));
  $("t-equations").addEventListener("click", () => setMode("equations"));
  const toggle = (id, key) => $(id).addEventListener("click", () => {
    view[key] = !view[key];
    paintStage();
  });
  toggle("t-labels", "labels");
  $("t-diff").addEventListener("click", () => {
    view.diff = !view.diff;
    paintStage();
    if (view.diff) drawDiff(); else clearDiff();
  });
  $("coord-px").addEventListener("click", () => { view.yUp = false; paintChips(); renderAxes(); renderRows(flattenSegments(activeRun().report)); selectSegment(state.selected, false); });
  $("coord-up").addEventListener("click", () => { view.yUp = true; paintChips(); renderAxes(); renderRows(flattenSegments(activeRun().report)); selectSegment(state.selected, false); });
  $("blend").addEventListener("input", (e) => { view.blend = Number(e.target.value); paintStage(); });
  $("t-hold").addEventListener("pointerdown", (e) => { e.preventDefault(); flip(true); });
  $("t-hold").addEventListener("pointerup", () => flip(false));
  $("t-hold").addEventListener("pointerleave", () => flip(false));
  $("t-hold").addEventListener("pointercancel", () => flip(false));

  $("copy-all").addEventListener("click", async () => {
    const items = currentItems();
    if (!items.length) return;
    const ok = await copyText(copyAllTeX(items));
    toast(ok ? "Copied all equations as LaTeX" : "Could not copy", ok ? `${items.length} equations` : "Select the text manually.");
  });
  $("sel-copy").addEventListener("click", async () => {
    const items = currentItems();
    const it = items[state.selected];
    if (!it) return;
    const ok = await copyText(latexFor(it.seg));
    toast(ok ? "Copied LaTeX" : "Could not copy", ok ? it.seg.equation : "");
  });
  $("sel-desmos").addEventListener("click", async () => {
    const it = currentItems()[state.selected];
    if (!it) return;
    await copyText(it.equation);
    window.open("https://www.desmos.com/calculator", "_blank", "noopener");
  });

  function downloadPoster() {
    const run = activeRun();
    if (!run) return;
    closeMenus();
    downloadSideBySide(run);
  }
  $("download-btn").addEventListener("click", downloadPoster);
  $("download-mobile").addEventListener("click", downloadPoster);
  $("download-menu-btn").addEventListener("click", () => {
    if ($("sheet").hidden) openSheet($("download-menu-btn")); else closeMenus();
  });
  $("download-mobile-menu").addEventListener("click", () => {
    if ($("sheet").hidden) openSheet($("download-mobile-menu")); else closeMenus();
  });
  $("scrim").addEventListener("click", () => closeMenus());
  document.addEventListener("pointerdown", (e) => {
    if ($("sheet").hidden) return;
    if (e.target.closest("#sheet,#download-menu-btn,#download-mobile-menu")) return;
    closeMenus();
  });

  document.querySelectorAll("[data-img]").forEach((b) => {
    b.addEventListener("click", () => {
      const run = activeRun();
      if (!run) return;
      if (b.dataset.img === "sidebyside") {
        closeMenus();
        downloadSideBySide(run);
        return;
      }
      const map = { clean: run.images.clean, redraw: run.images.redraw };
      const suffix = { clean: "", redraw: "-equations" }[b.dataset.img];
      downloadURL(map[b.dataset.img], baseName() + suffix + ".png");
      closeMenus();
    });
  });
  document.querySelectorAll("[data-math]").forEach((b) => {
    b.addEventListener("click", async () => {
      const items = currentItems();
      const kind = b.dataset.math;
      if (kind === "desmos") {
        await copyText(items.map((it) => it.equation).join("\n"));
        window.open("https://www.desmos.com/calculator", "_blank", "noopener");
        closeMenus();
        return;
      }
      if (kind === "latex") {
        const text = copyAllTeX(items);
        downloadURL(URL.createObjectURL(new Blob([text], { type: "text/x-tex" })), baseName() + "-equations.tex");
      } else if (kind === "text") {
        const text = copyAllText(items);
        downloadURL(URL.createObjectURL(new Blob([text], { type: "text/plain" })), baseName() + "-equations.txt");
      } else if (kind === "json") {
        const run = activeRun();
        const text = JSON.stringify(run.report, null, 2);
        downloadURL(URL.createObjectURL(new Blob([text], { type: "application/json" })), baseName() + ".json");
      }
      closeMenus();
    });
  });

  $("retrace").addEventListener("click", () => { renderCheck(); showScreen("check"); });
  $("retrace-mobile").addEventListener("click", () => { renderCheck(); showScreen("check"); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("advanced").hidden) { closeAdvanced(); return; }
    if (e.key === "Escape" && !$("restore").hidden) { restoreCancel(); return; }
    if (e.key === "Escape" && !$("lib-dialog").hidden) { closeLibDialog(); return; }
    if (e.key === "Escape" && (!$("lib-card-menu").hidden || !$("lib-sort-menu").hidden)) { closeLibMenus(); return; }
    if (e.key === "Escape" && state.renaming) { cancelRename(); return; }
    if (state.libMenuWork && !isTyping(e.target)) {
      const work = loadWorks().find((w) => w.id === state.libMenuWork);
      if (work) {
        if (e.key === "r" || e.key === "R") { e.preventDefault(); startRename(work.id); return; }
        if (e.key === "d" || e.key === "D") { e.preventDefault(); duplicateWork(work.id); return; }
        if (e.key === "Delete") { e.preventDefault(); openDeleteDialog([work], "single"); return; }
      }
    }
    if (e.key === "Escape") { closeMenus(); clearSelection(); }
    if (e.code === "Space" && state.screen === "result" && !isTyping(e.target)) {
      e.preventDefault();
      flip(true);
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && state.screen === "result") { flip(false); }
  });

  $("plot").addEventListener("pointerenter", () => {
    state.hovering = true;
  });
  $("plot").addEventListener("pointermove", (e) => {
    const run = activeRun();
    if (!run) return;
    const r = $("plot").getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * run.report.image_size.width;
    const y = ((e.clientY - r.top) / r.height) * run.report.image_size.height;
    const yy = view.yUp ? run.report.image_size.height - y : y;
    $("coords").textContent = `x ${Math.round(x)} · y ${Math.round(yy)} px`;
  });
  $("plot").addEventListener("pointerleave", () => {
    state.hovering = false;
    $("coords").textContent = "x — · y — px";
  });
}


/* ------------------------------------------------------------------ advanced */
function loadAdvancedMeta() {
  if (advancedMeta.defaults) return Promise.resolve();
  if (advancedMeta.loading) return advancedMeta.loading;
  advancedMeta.loading = fetch("/api/presets")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && j.defaults) {
        advancedMeta.defaults = j.defaults;
        advancedMeta.presets = j.preset_values || {};
      }
    })
    .catch(() => {})
    .finally(() => { advancedMeta.loading = null; });
  return advancedMeta.loading;
}

function updateAdvancedBadge() {
  const n = Object.keys(settings.advanced || {}).length;
  const badge = $("adv-count");
  if (!badge) return;
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

async function openAdvanced() {
  const dlg = $("advanced");
  dlg.hidden = false;
  $("adv-open").setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
  $("adv-error").hidden = true;
  $("adv-body").innerHTML = '<p class="m">Loading the full config…</p>';
  await loadAdvancedMeta();
  if (!advancedMeta.defaults) {
    $("adv-body").innerHTML = "";
    $("adv-error").hidden = false;
    $("adv-error").textContent = "Could not load advanced settings. Is the server running?";
    return;
  }
  renderAdvanced();
  const first = $("adv-body").querySelector("input,select");
  if (first) first.focus();
}

function closeAdvanced() {
  $("advanced").hidden = true;
  $("adv-open").setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

function renderAdvanced() {
  const base = advancedBase();
  const vals = { ...base, ...settings.advanced };
  const body = $("adv-body");
  body.innerHTML = "";
  $("adv-error").hidden = true;
  for (const group of ADV_GROUPS) {
    const section = document.createElement("section");
    section.className = "advgroup";
    const h = document.createElement("h3");
    h.textContent = group.title;
    section.append(h);
    for (const f of group.fields) {
      const v = vals[f.key];
      const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
      if (f.options) {
        const row = document.createElement("label");
        row.className = "advrow";
        row.innerHTML = `<span>${esc(f.label)}${hint}</span>`;
        const sel = document.createElement("select");
        sel.dataset.key = f.key;
        for (const opt of f.options) {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          sel.append(o);
        }
        sel.value = String(v);
        row.append(sel);
        section.append(row);
      } else if (typeof v === "boolean" || typeof base[f.key] === "boolean") {
        const lab = document.createElement("label");
        lab.className = "advcheck";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.key = f.key;
        cb.checked = !!v;
        const span = document.createElement("span");
        span.innerHTML = `${esc(f.label)}${hint}`;
        lab.append(cb, span);
        section.append(lab);
      } else {
        const row = document.createElement("label");
        row.className = "advrow";
        row.innerHTML = `<span>${esc(f.label)}${hint}</span>`;
        const input = document.createElement("input");
        input.type = "number";
        input.dataset.key = f.key;
        if (f.min != null) input.min = String(f.min);
        if (f.max != null) input.max = String(f.max);
        if (f.step != null) input.step = String(f.step);
        input.value = v == null ? "" : String(v);
        row.append(input);
        section.append(row);
      }
    }
    body.append(section);
  }
}

function applyAdvanced() {
  const base = advancedBase();
  const next = {};
  let error = "";
  for (const input of $("adv-body").querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    let v;
    if (input.type === "checkbox") {
      v = input.checked;
    } else if (input.tagName === "SELECT") {
      v = input.value;
    } else {
      v = Number(input.value);
      if (!Number.isFinite(v)) { error = `“${key}” needs a number.`; break; }
      const min = input.min === "" ? null : Number(input.min);
      const max = input.max === "" ? null : Number(input.max);
      if ((min != null && v < min) || (max != null && v > max)) {
        error = `“${key}” must be between ${min} and ${max}.`;
        break;
      }
    }
    if (String(v) !== String(base[key])) next[key] = v;
  }
  if (error) {
    $("adv-error").hidden = false;
    $("adv-error").textContent = error;
    return;
  }
  settings.advanced = next;
  updateAdvancedBadge();
  drawPreviewMask();
  closeAdvanced();
}

function resetAdvanced() {
  settings.advanced = {};
  updateAdvancedBadge();
  renderAdvanced();
  drawPreviewMask();
}

function isTyping(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function flip(on) {
  if (!activeRun()) return;
  if (on) {
    $("layer-ghost").style.opacity = "1";
    $("layer-ghost").style.display = "";
    $("layer-math").style.display = "none";
  } else {
    paintStage();
  }
}


async function health() {
  try { await fetch("/health"); } catch { /* offline; the UI still works */ }
}

initTheme();
bind();
loadAdvancedMeta();
health();
bootRoute();
