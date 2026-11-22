/* Chawk — front-end. Implements the "Chawk — UI UX design" boards:
   start → check → result, with run history, layered stage, diff overlay,
   equation list, downloads and coordinate toggle. Vanilla JS, no build step. */
"use strict";

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 15 * 1024 * 1024;

const KIND_PRESET = { clean: "precise", sketchy: "balanced", busy: "complex" };
const MODEL_NAME = {
  line: "Line", polynomial2: "Parabola", polynomial3: "Cubic", polynomial4: "Quartic",
  polynomial5: "Quintic", polynomial6: "Curve", circle: "Circle", ellipse: "Ellipse",
  elliptical_arc: "Arc", sinusoid: "Wave", spline: "Freeform", point: "Point",
  closed_spline: "Closed curve",
};
const SUPER = { 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶" };

const settings = {
  sensitivity: 55, kind: "sketchy", fit: 50,
  fill: true,
  types: { circle: true, ellipse: true, sinusoid: true, spline: true },
};

const state = {
  file: null, url: null, name: "", bytes: 0, width: 0, height: 0,
  runs: [], active: -1, selected: -1,
  busy: false, screen: "start", controller: null, workTimer: null, hovering: false,
  cardPinned: false, cardTimer: 0, busyTimer: null,
  libSelect: false, libSelected: new Set(), pendingUndo: null, undoTimer: null,
  confirmAll: false, confirmTimer: null,
};

const view = { original: true, equations: true, labels: false, diff: true, blend: 70, yUp: false };

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
async function sheetCanvas(run) {
  await document.fonts.ready;
  const items = flattenSegments(run.report);
  const total = items.length;
  const label = formatCount(total);
  const W = 1080, H = 1350, S = 2;
  const hi = document.createElement("canvas");
  hi.width = W * S; hi.height = H * S;
  const g = hi.getContext("2d");
  g.scale(S, S);

  const LEFT = 648, PANEL = W - LEFT, SAFE = 50;
  const TX = LEFT + SAFE, TW = PANEL - SAFE * 2;
  const paper = "#F8F7F3", ink = "#111111", accent = "#FFE066";

  g.fillStyle = paper;
  g.fillRect(0, 0, W, H);

  // left: a 2:3 artwork window at the top — the usual source aspect, no
  // letterboxing and no forced full-height crop.
  const img = await loadImageEl(state.url || run.images.redraw);
  const ART_W = LEFT, ART_H = Math.round(LEFT * 1.5);
  const cover = Math.max(ART_W / (img.naturalWidth || 1), ART_H / (img.naturalHeight || 1));
  const cw = (img.naturalWidth || 1) * cover;
  const ch = (img.naturalHeight || 1) * cover;
  g.save();
  g.beginPath(); g.rect(0, 0, ART_W, ART_H); g.clip();
  g.drawImage(img, (ART_W - cw) / 2, (ART_H - ch) / 2, cw, ch);
  g.restore();

  // count + "equations" in the paper band under the artwork
  const headX = 50, headW = LEFT - 100;
  const numTop = ART_H + 62;
  const numSize = fitTextSize(g, label, headW, 168, 64, "'STIX Two Text', Georgia, serif", "800");
  g.font = `800 ${numSize}px 'STIX Two Text', Georgia, serif`;
  g.fillStyle = ink;
  g.textBaseline = "alphabetic";
  const numBaseline = numTop + numSize * 0.84;
  g.fillText(label, headX, numBaseline);

  const wordSize = fitTextSize(g, "equations", headW, 52, 28, "'STIX Two Text', Georgia, serif", "700", "italic");
  g.font = `italic 700 ${wordSize}px 'STIX Two Text', Georgia, serif`;
  const wordW = g.measureText("equations").width;
  const wordBaseline = numBaseline + wordSize * 1.18;
  g.fillStyle = accent;
  g.fillRect(headX - 3, wordBaseline - wordSize * 0.58, Math.min(headW, wordW) + 6, wordSize * 0.7);
  g.fillStyle = ink;
  g.fillText("equations", headX, wordBaseline);

  // equation texture: actual fitted equations, clipped and faded
  const pool = [];
  for (const it of items) {
    for (const line of String(it.seg.equation || "").split("\n")) {
      if (line.trim()) pool.push(line.trim());
    }
  }
  if (!pool.length) pool.push("x(t) = 0");
  const wallTop = 50;
  g.save();
  g.beginPath(); g.rect(LEFT, wallTop, PANEL, H - wallTop); g.clip();
  g.font = "400 11px 'JetBrains Mono', monospace";
  g.fillStyle = "#B7B3AB";
  g.textBaseline = "top";
  let y = wallTop, i = 0;
  while (y < H) {
    const line = pool[i % pool.length];
    g.fillText(line.length > 50 ? line.slice(0, 50) : line, TX, y);
    y += 16;
    i += 1;
  }
  g.restore();

  const fade = g.createLinearGradient(0, 860, 0, 1090);
  fade.addColorStop(0, "rgba(248,247,243,0)");
  fade.addColorStop(1, "rgba(248,247,243,1)");
  g.fillStyle = fade;
  g.fillRect(LEFT, 860, PANEL, 230);
  // Clean band for the card and footer: no texture behind readable text.
  g.fillStyle = paper;
  g.fillRect(LEFT, 1088, PANEL, H - 1088);

  // one equation, big, in an outlined card
  const cardX = TX, cardY = 990, cardW = TW, cardH = 178;
  g.fillStyle = paper;
  g.strokeStyle = ink;
  g.lineWidth = 3;
  roundedRect(g, cardX, cardY, cardW, cardH, 14);
  g.fill();
  g.stroke();
  g.fillStyle = "#6F6B63";
  g.font = "700 10px 'JetBrains Mono', monospace";
  g.textBaseline = "top";
  g.fillText(`EQUATION #1 OF ${label}`, cardX + 16, cardY + 14);

  const first = (items[0]?.seg.equation || "x(t) = 0").split("\n")[0].trim();
  let eqSize = fitTextSize(g, first, cardW - 32, 26, 16, "'STIX Two Text', Georgia, serif", "700");
  g.font = `700 ${eqSize}px 'STIX Two Text', Georgia, serif`;
  let eqLines = wrapLine(g, first, cardW - 32);
  if (eqLines.length > 3) {
    eqSize = 18;
    g.font = `700 ${eqSize}px 'STIX Two Text', Georgia, serif`;
    eqLines = wrapLine(g, first, cardW - 32);
  }
  g.fillStyle = ink;
  let ey = cardY + 50;
  for (const line of eqLines.slice(0, 3)) {
    g.fillText(line, cardX + 16, ey);
    ey += eqSize * 1.16;
  }

  // footer
  const footX = TX, footY = 1190;
  g.save();
  g.translate(footX, footY - 12);
  g.scale(22 / 16, 22 / 16);
  g.fillStyle = ink;
  g.fill(new Path2D(GITHUB_MARK));
  g.restore();

  g.fillStyle = ink;
  g.textBaseline = "middle";
  g.font = "800 26px 'Instrument Sans', sans-serif";
  g.fillText("OPEN SOURCE", footX + 32, footY);

  const url = "github.com/hello2himel/chawk";
  const urlSize = fitTextSize(g, url, TW, 24, 15, "'Instrument Sans', sans-serif", "700");
  g.font = `700 ${urlSize}px 'Instrument Sans', sans-serif`;
  g.fillText(url, footX, footY + 30);

  g.font = "600 21px 'Instrument Sans', sans-serif";
  g.fillStyle = "#5A5D68";
  g.fillText("@hello2himel", footX, footY + 58);

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  out.getContext("2d").drawImage(hi, 0, 0, W, H);
  return out;
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

function openSheetPreview(run) {
  state.sheetRun = run;
  $("sheet-img").src = run.sheetURL;
  $("crop-bars").hidden = true;
  $("sheet-crop-toggle").checked = false;
  $("sheet-preview").hidden = false;
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
  const renderPhrases = [
    "one sec — setting the type…",
    `counting ${total} equations…`,
    "composing the poster…",
    "lining up the math…",
  ];
  showBusy(renderPhrases[0], `${total} equation${items.length === 1 ? "" : "s"} · 1080×1350 poster`, renderPhrases);
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const t0 = performance.now();
    await sheetBlob(run);
    const wait = Math.max(0, 420 - (performance.now() - t0));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    openSheetPreview(run);
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
function dotColor(hex) {
  return !hex || luminance(hex) > 0.82 ? "#15161A" : hex;
}

/* ------------------------------------------------------------------ screens */
function showScreen(name) {
  state.screen = name;
  $("screen-start").hidden = name !== "start";
  $("screen-check").hidden = name !== "check";
  $("screen-working").hidden = name !== "working";
  $("screen-result").hidden = name !== "result";
  $("screen-library").hidden = name !== "library";
  $("start-meta").hidden = name !== "start";
  $("check-change").hidden = name !== "check";
  $("result-bar").hidden = name !== "result";
  $("bar").classList.toggle("result", name === "result");
  $("app").classList.toggle("result", name === "result");
  $("app").classList.toggle("check", name === "check");
  closeMenus();
  if (name === "check") requestAnimationFrame(fitPreview);
  if (name !== "result") window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ library */
const WORKS_KEY = "chawk.works.v1";
const MAX_WORKS = 12;

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

async function saveWork(run) {
  try {
    const source = await imageUrlToWebP(state.url, 900, 0.82);
    const thumb = await imageUrlToWebP(run.images.redraw, 460, 0.8);
    if (!source || !thumb) return;
    const count = run.report?.summary?.segment_count || 0;
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: run.meta.name || state.name || "untitled",
      at: Date.now(),
      w: run.meta.width || state.width,
      h: run.meta.height || state.height,
      count,
      settings: JSON.parse(JSON.stringify(settings)),
      source,
      thumb,
    };
    let works = loadWorks().filter((w) => !(w.name === record.name && w.count === count));
    works.unshift(record);
    works = works.slice(0, MAX_WORKS);
    const stored = persistWorks(works);
    updateLibraryBadge();
    if (stored.length < works.length) {
      toast("Library is full", "The oldest work was removed.");
    }
  } catch { /* storage may be unavailable; tracing still works */ }
}

function workDate(at) {
  try {
    return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch { return ""; }
}

function showUndo(works) {
  state.pendingUndo = works;
  $("undo-text").textContent = `${works.length} work${works.length === 1 ? "" : "s"} deleted`;
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
  renderLibrary();
}

async function openWork(id) {
  const work = loadWorks().find((w) => w.id === id);
  if (!work) return;
  try {
    const blob = await (await fetch(work.source)).blob();
    const file = new File([blob], work.name || "saved.webp", { type: blob.type || "image/webp" });
    if (work.settings) {
      Object.assign(settings, work.settings);
      settings.types = { ...settings.types };
    }
    await chooseFile(file);
    trace();
  } catch {
    toast("Could not open that work", "The saved copy may be damaged.");
  }
}

function deleteWork(id) {
  const works = loadWorks();
  const removed = works.filter((w) => w.id === id);
  if (!removed.length) return;
  persistWorks(works.filter((w) => w.id !== id));
  state.libSelected.delete(id);
  renderLibrary();
  updateLibraryBadge();
  showUndo(removed);
}

function deleteSelected() {
  if (!state.libSelected.size) return;
  const works = loadWorks();
  const removed = works.filter((w) => state.libSelected.has(w.id));
  persistWorks(works.filter((w) => !state.libSelected.has(w.id)));
  state.libSelected.clear();
  state.libSelect = false;
  renderLibrary();
  updateLibraryBadge();
  if (removed.length) showUndo(removed);
}

function renderLibrary() {
  const works = loadWorks();
  const grid = $("lib-grid");
  grid.innerHTML = "";
  grid.hidden = works.length === 0;
  $("lib-empty").hidden = works.length > 0;
  $("lib-select").hidden = works.length === 0;
  $("lib-delete-all").hidden = works.length === 0 || state.libSelect;
  $("lib-select").textContent = state.libSelect ? "Done" : "Select";
  $("lib-select").setAttribute("aria-pressed", state.libSelect ? "true" : "false");
  $("lib-bar").hidden = !(state.libSelect && works.length > 0);
  $("lib-selcount").textContent = `${state.libSelected.size} selected`;
  $("lib-sel-delete").disabled = state.libSelected.size === 0;
  $("lib-note").textContent = works.length
    ? `${works.length} of ${MAX_WORKS} works · ${Math.round(JSON.stringify(works).length / 1024)} KB in this browser`
    : "";

  for (const w of works) {
    const card = document.createElement("article");
    const picked = state.libSelected.has(w.id);
    card.className = "work" + (picked ? " sel" : "");
    card.tabIndex = 0;

    const thumb = document.createElement("div");
    thumb.className = "workthumb";
    const img = document.createElement("img");
    img.src = w.thumb;
    img.alt = "";
    thumb.append(img);

    const body = document.createElement("div");
    body.className = "workbody";
    const name = document.createElement("div");
    name.className = "workname";
    name.textContent = w.name;
    const meta = document.createElement("div");
    meta.className = "workmeta";
    meta.textContent = `${w.count} equation${w.count === 1 ? "" : "s"} · ${workDate(w.at)}`;
    const row = document.createElement("div");
    row.className = "workrow";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn workopen";
    open.textContent = "Open";
    open.hidden = state.libSelect;
    open.onclick = (e) => { e.stopPropagation(); openWork(w.id); };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "workdel";
    del.setAttribute("aria-label", `Delete ${w.name}`);
    del.innerHTML = '<i class="ri-delete-bin-line" aria-hidden="true"></i>';
    del.hidden = state.libSelect;
    del.onclick = (e) => { e.stopPropagation(); deleteWork(w.id); };
    row.append(open, del);
    body.append(name, meta, row);

    if (state.libSelect) {
      const chk = document.createElement("span");
      chk.className = "workcheck";
      chk.innerHTML = picked ? '<i class="ri-check-line" aria-hidden="true"></i>' : "";
      card.append(chk);
    }

    card.append(thumb, body);
    card.onclick = () => { if (state.libSelect) toggleWork(w.id); else openWork(w.id); };
    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (state.libSelect) toggleWork(w.id); else openWork(w.id);
      }
    };
    grid.append(card);
  }
}

/* ------------------------------------------------------------------ intake */
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
  view.diff = true; view.blend = 70; view.yUp = false;
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
  $("sensitivity").value = String(settings.sensitivity);
  $("fit").value = String(settings.fit);
  $("fill-toggle").checked = settings.fill;
  for (const row of document.querySelectorAll("[data-kind]")) {
    const on = row.dataset.kind === settings.kind;
    row.classList.toggle("on", on);
    row.querySelector("input").checked = on;
  }
  for (const btn of document.querySelectorAll("[data-type]")) {
    btn.setAttribute("aria-pressed", settings.types[btn.dataset.type] ? "true" : "false");
  }
}

/* Blue "what will be traced" wash over the upload, computed locally so the
   sensitivity slider shows the effect before spending a trace. */
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
    const cut = 95 - 0.8 * settings.sensitivity;

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

function buildConfig() {
  return {
    threshold_mode: "adaptive",
    adaptive_C: Math.max(1, Math.round(14 - 0.13 * settings.sensitivity)),
    rmse_tolerance: round(3.5 - 3.0 * (settings.fit / 100), 2),
    enable_circle: settings.types.circle,
    enable_ellipse: settings.types.ellipse,
    enable_sinusoid: settings.types.sinusoid,
    enable_spline: settings.types.spline,
    enable_fill: settings.fill,
  };
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
    showScreen("result");
    renderResult();
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
    settings: { ...settings, types: { ...settings.types } },
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
  if (state.screen === "result") fitPlot();
  if (state.screen === "check") fitPreview();
});

function renderResult() {
  const run = activeRun();
  if (!run) return;
  const r = run.report;
  const segs = flattenSegments(r);
  if (state.selected < 0 || state.selected >= segs.length) {
    state.selected = pickDefaultSegment(segs);
  }

  // header
  $("run-meta").textContent = `${run.meta.name} · traced in ${(run.seconds || 0).toFixed(2)} s`;
  renderRunChips();
  $("run-menu-btn").innerHTML = `Run ${state.active + 1} <i class="ri-arrow-down-s-line" aria-hidden="true"></i>`;

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
  $("eq-count").innerHTML = `${segs.length} equation${segs.length === 1 ? "" : "s"}, <span class="hl"><i>plotted</i></span>`;
  const tight = segs.filter((s) => !isWarn(s)).length;
  const loose = segs.length - tight;
  $("eq-summary").textContent = loose
    ? `${tight} spot-on fit${tight === 1 ? "" : "s"} · ${loose} a bit wobbly`
    : `${tight} spot-on fit${tight === 1 ? "" : "s"}`;
  state.cardPinned = false;
  hideCard();
  renderRows(segs);
  selectSegment(state.selected, false);

  // lazy diff
  requestAnimationFrame(() => setTimeout(() => drawDiff(), 30));

  if (!run.saved) {
    run.saved = true;
    saveWork(run).catch(() => {});
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

function renderRunChips() {
  const runs = $("runs");
  runs.innerHTML = "";
  state.runs.forEach((run, i) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = `Run ${i + 1} · ${run.label}`;
    b.setAttribute("aria-pressed", i === state.active ? "true" : "false");
    b.onclick = () => { state.active = i; state.selected = -1; renderResult(); };
    runs.append(b);
  });
  const add = document.createElement("button");
  add.className = "chip";
  add.type = "button";
  add.setAttribute("aria-label", "New run");
  add.innerHTML = '<i class="ri-add-line" aria-hidden="true"></i>';
  add.onclick = () => { showScreen("check"); renderCheck(); };
  runs.append(add);
}

function paintStage() {
  const run = activeRun();
  if (!run) return;
  const b = view.blend / 100;
  const ghost = $("layer-ghost");
  const math = $("layer-math");
  ghost.style.opacity = view.original ? String((1 - b) * 0.45) : "0";
  ghost.style.display = view.original ? "" : "none";
  math.style.display = view.equations ? "" : "none";
  const src = view.labels
    ? (run.images.redrawLabels || run.images.labeled)
    : run.images.redraw;
  if (math.getAttribute("src") !== src) math.src = src;
  // "Show the wobble" marks are an inspection aid: they appear only while the
  // pointer is over the artwork, so the equation-drawn picture stays clean.
  $("layer-diff").style.display = view.diff && state.hovering ? "" : "none";
  $("plot").setAttribute("aria-label", view.labels
    ? "Your drawing redrawn from its equations, with equation labels"
    : "Your drawing with its fitted equations");
}

function paintChips() {
  const map = {
    "t-original": view.original, "t-equations": view.equations,
    "t-labels": view.labels, "t-diff": view.diff,
    "coord-px": !view.yUp, "coord-up": view.yUp,
  };
  for (const [id, on] of Object.entries(map)) {
    const el = $(id);
    if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
  }
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
      if (state.cardPinned && state.selected === i) {
        unpinCard();
        return;
      }
      selectSegment(i, true);
      state.cardPinned = true;
      cancelCardHide();
      showCard(i);
    };
    btn.onmouseenter = () => { showHighlight(item); if (!state.cardPinned) showCard(i); };
    btn.onmouseleave = () => { hideHighlight(); scheduleCardHide(); };
    btn.onfocus = () => { showHighlight(item); if (!state.cardPinned) showCard(i); };
    btn.onblur = () => scheduleCardHide();
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

function showCard(i) {
  const run = activeRun();
  if (!run) return;
  const segs = flattenSegments(run.report);
  if (i < 0 || i >= segs.length) return;
  const { stroke, seg } = segs[i];
  fillCard(i, stroke, seg);
  $("eqcard").hidden = false;
}
function hideCard() {
  $("eqcard").hidden = true;
}
function cancelCardHide() {
  clearTimeout(state.cardTimer);
}
function scheduleCardHide() {
  if (state.cardPinned) return;
  cancelCardHide();
  state.cardTimer = setTimeout(hideCard, 600);
}
function unpinCard() {
  state.cardPinned = false;
  cancelCardHide();
  hideCard();
}

function fillCard(i, stroke, seg) {
  $("sel-dot").style.background = dotColor(stroke.color);
  $("sel-model").textContent = MODEL_NAME[seg.model] || seg.model;
  $("sel-stroke").textContent = strokeLabel(stroke);
  $("sel-eq").innerHTML = eqHTML(displayEquation(seg));
  $("sel-meta").textContent = `${domainText(seg)} · within ${fmt(seg.rmse, 2)} px of your ink`;
  $("sel-ok").hidden = isWarn(seg);
  $("sel-no").textContent = `(${i + 1})`;
}

function selectSegment(i, scroll) {
  const run = activeRun();
  if (!run) return;
  const segs = flattenSegments(run.report);
  if (i < 0 || i >= segs.length) return;
  state.selected = i;
  const { stroke, seg } = segs[i];
  for (const row of document.querySelectorAll("#eq-rows .row")) {
    row.classList.toggle("on", Number(row.dataset.i) === i);
  }
  fillCard(i, stroke, seg);
  if (scroll) {
    const row = document.querySelector(`#eq-rows .row[data-i="${i}"]`);
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function showHighlight(item) {
  const run = activeRun();
  if (!run) return;
  const { seg } = item;
  const H = run.report.image_size.height;
  const [x0, x1] = seg.x_range || [0, 0];
  const [y0, y1] = seg.y_range || [0, 0];
  const hl = $("hl");
  hl.hidden = false;
  hl.style.left = `${(x0 / run.report.image_size.width) * 100}%`;
  hl.style.top = `${(Math.min(y0, y1) / H) * 100}%`;
  hl.style.width = `${(Math.max(1, x1 - x0) / run.report.image_size.width) * 100}%`;
  hl.style.height = `${(Math.max(1, Math.abs(y1 - y0)) / H) * 100}%`;
}
function hideHighlight() { $("hl").hidden = true; }

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
function openSheet() {
  $("sheet").hidden = false;
  $("scrim").hidden = false;
  $("download-btn").setAttribute("aria-expanded", "true");
}
function openRunMenu() {
  const menu = $("run-menu");
  menu.innerHTML = "";
  state.runs.forEach((run, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "row" + (i === state.active ? " on" : "");
    b.innerHTML = `<span class="dot" style="background:${dotColor(run.report.strokes?.[0]?.color)}"></span>
      <span><b>Run ${i + 1} · ${esc(run.label)}</b><br><span class="m">${esc(run.meta.name)} · ${run.seconds.toFixed(2)} s</span></span>`;
    b.onclick = () => { state.active = i; state.selected = -1; renderResult(); closeMenus(); };
    menu.append(b);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "row";
  add.innerHTML = '<i class="ri-add-line" aria-hidden="true"></i><b>New run</b>';
  add.onclick = () => { closeMenus(); showScreen("check"); renderCheck(); };
  menu.append(add);
  menu.hidden = false;
  $("scrim").hidden = false;
  $("run-menu-btn").setAttribute("aria-expanded", "true");
}
function closeMenus() {
  $("sheet").hidden = true;
  $("run-menu").hidden = true;
  $("scrim").hidden = true;
  $("download-btn").setAttribute("aria-expanded", "false");
  $("run-menu-btn").setAttribute("aria-expanded", "false");
}

/* ------------------------------------------------------------------ wiring */
function bind() {
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
    renderLibrary();
    showScreen("library");
  });
  $("lib-new").addEventListener("click", () => showScreen("start"));
  $("lib-empty-new").addEventListener("click", () => showScreen("start"));
  $("lib-select").addEventListener("click", () => {
    state.libSelect = !state.libSelect;
    state.libSelected.clear();
    renderLibrary();
  });
  $("lib-delete-all").addEventListener("click", () => {
    if (!state.confirmAll) {
      state.confirmAll = true;
      $("lib-delete-all").textContent = "Really delete all?";
      clearTimeout(state.confirmTimer);
      state.confirmTimer = setTimeout(() => {
        state.confirmAll = false;
        $("lib-delete-all").textContent = "Delete all";
      }, 3200);
      return;
    }
    state.confirmAll = false;
    clearTimeout(state.confirmTimer);
    $("lib-delete-all").textContent = "Delete all";
    const works = loadWorks();
    persistWorks([]);
    renderLibrary();
    updateLibraryBadge();
    if (works.length) showUndo(works);
  });
  $("lib-sel-cancel").addEventListener("click", () => {
    state.libSelect = false;
    state.libSelected.clear();
    renderLibrary();
  });
  $("lib-sel-delete").addEventListener("click", deleteSelected);
  $("undo-btn").addEventListener("click", () => {
    if (!state.pendingUndo) return;
    const restored = state.pendingUndo.concat(loadWorks()).slice(0, MAX_WORKS);
    persistWorks(restored);
    hideUndo();
    renderLibrary();
    updateLibraryBadge();
  });
  updateLibraryBadge();
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

  $("fill-toggle").addEventListener("change", (e) => { settings.fill = e.target.checked; });
  $("sensitivity").addEventListener("input", (e) => {
    settings.sensitivity = Number(e.target.value);
    drawPreviewMask();
  });
  $("fit").addEventListener("input", (e) => { settings.fit = Number(e.target.value); });
  document.querySelectorAll("[data-kind]").forEach((row) => {
    row.addEventListener("click", () => {
      settings.kind = row.dataset.kind;
      for (const r of document.querySelectorAll("[data-kind]")) r.classList.toggle("on", r === row);
      for (const r of document.querySelectorAll("[data-kind] input")) r.checked = r.closest("[data-kind]") === row;
    });
  });
  document.querySelectorAll("[data-type]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.type;
      settings.types[k] = !settings.types[k];
      b.setAttribute("aria-pressed", settings.types[k] ? "true" : "false");
    });
  });

  // result toggles
  const toggle = (id, key) => $(id).addEventListener("click", () => {
    view[key] = !view[key];
    paintChips();
    paintStage();
  });
  toggle("t-original", "original");
  toggle("t-equations", "equations");
  toggle("t-labels", "labels");
  toggle("t-diff", "diff");
  $("coord-px").addEventListener("click", () => { view.yUp = false; paintChips(); renderAxes(); renderRows(flattenSegments(activeRun().report)); selectSegment(state.selected); });
  $("coord-up").addEventListener("click", () => { view.yUp = true; paintChips(); renderAxes(); renderRows(flattenSegments(activeRun().report)); selectSegment(state.selected); });
  $("blend").addEventListener("input", (e) => { view.blend = Number(e.target.value); paintStage(); });
  $("t-hold").addEventListener("pointerdown", () => flip(true));
  $("t-hold").addEventListener("pointerup", () => flip(false));
  $("t-hold").addEventListener("pointerleave", () => flip(false));

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

  $("download-btn").addEventListener("click", () => { openSheet(); });
  $("sheet-close").addEventListener("click", () => { $("sheet-preview").hidden = true; });
  $("sheet-download").addEventListener("click", () => {
    const run = state.sheetRun;
    if (run && run.sheetURL) downloadURL(run.sheetURL, baseName() + "-side-by-side.png");
  });
  $("sheet-crop-toggle").addEventListener("change", (e) => {
    $("crop-bars").hidden = !e.target.checked;
  });
  $("sheet-preview").addEventListener("click", (e) => {
    if (e.target.id === "sheet-preview") $("sheet-preview").hidden = true;
  });
  $("download-mobile").addEventListener("click", () => { openSheet(); });
  $("scrim").addEventListener("click", () => closeMenus());
  $("run-menu-btn").addEventListener("click", () => { openRunMenu(); });
  $("new-mobile").addEventListener("click", () => showScreen("start"));

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

  $("retrace").addEventListener("click", () => { showScreen("check"); renderCheck(); });
  $("retrace-mobile").addEventListener("click", () => { showScreen("check"); renderCheck(); });
  $("new-run").addEventListener("click", () => showScreen("start"));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenus(); unpinCard(); }
    if (e.code === "Space" && state.screen === "result" && !isTyping(e.target)) {
      e.preventDefault();
      flip(true);
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && state.screen === "result") { flip(false); }
  });

  $("eqcard").addEventListener("mouseenter", () => {
    cancelCardHide();
    const run = activeRun();
    if (run && state.selected >= 0) showHighlight(flattenSegments(run.report)[state.selected]);
  });
  $("eqcard").addEventListener("mouseleave", () => {
    hideHighlight();
    scheduleCardHide();
  });

  $("plot").addEventListener("click", () => {
    if (state.cardPinned) unpinCard();
  });
  $("plot").addEventListener("pointerenter", () => {
    state.hovering = true;
    paintStage();
    const run = activeRun();
    if (run && state.selected >= 0) showHighlight(flattenSegments(run.report)[state.selected]);
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
    paintStage();
    hideHighlight();
    $("coords").textContent = "x — · y — px";
  });
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
  try {
    const r = await fetch("/health");
    if (!r.ok) throw new Error();
    const j = await r.json();
    $("start-meta").textContent = `v${j.version} · connected`;
  } catch {
    $("start-meta").textContent = "offline";
  }
}

bind();
health();
showScreen("start");
