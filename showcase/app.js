/* ------------------------------------------------------------------
   Chawk showcase: static carousel, compare modal, theme, copy.
   No API. All proofs come from assets/demo-slides.json.
   ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ theme */
const THEME_KEY = "chawk.theme.v1";
const THEME_LIGHT = "#F5F3EC";
const THEME_DARK = "#131311";
const themeMQ = window.matchMedia("(prefers-color-scheme: dark)");
let sessionTheme = null;

const systemTheme = () => (themeMQ.matches ? "dark" : "light");
function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : sessionTheme;
  } catch { return sessionTheme; }
}
const effectiveTheme = () => storedTheme() || systemTheme();

function updateThemeButton() {
  const btn = $("theme-toggle");
  if (!btn) return;
  const dark = effectiveTheme() === "dark";
  btn.setAttribute("aria-label", "Dark theme");
  btn.setAttribute("aria-pressed", String(dark));
  btn.title = dark ? "Switch to light theme" : "Switch to dark theme";
  const icon = btn.querySelector(".ri");
  if (icon) icon.className = "ri " + (dark ? "ri-sun-line" : "ri-moon-line");
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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = effectiveTheme() === "dark" ? THEME_DARK : THEME_LIGHT;
  updateThemeButton();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-cut")));
}

function initTheme() {
  const btn = $("theme-toggle");
  if (btn) btn.addEventListener("click", () => {
    applyTheme(effectiveTheme() === "dark" ? "light" : "dark", true);
  });
  themeMQ.addEventListener("change", () => {
    if (!storedTheme()) applyTheme(systemTheme(), false);
    else updateThemeButton();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY || e.key === null) applyTheme(effectiveTheme(), false);
  });
  updateThemeButton();
}

/* ------------------------------------------------------------------ modal */
const modal = $("compare-modal");
const compare = $("compare");
const compareRange = $("compare-range");
let modalIndex = 0;
let modalTimer = 0;
let lastFocus = null;
let carousel = null;

function renderProofText(slide, eqsEl, quipEl = null) {
  const equations = slide.equations || [];
  const more = Math.max(0, (slide.count || 0) - equations.length);
  eqsEl.innerHTML = equations.map((eq) => `<span class="f">${esc(eq)}</span>`).join("")
    + (more ? `<span class="more">…and ${more.toLocaleString()} more</span>` : "");
  if (quipEl) quipEl.textContent = slide.quip || "";
}

function openModal(index) {
  const s = (carousel && carousel.slides[index]) || null;
  if (!s) return;
  modalIndex = index;
  lastFocus = document.activeElement;
  if (carousel) carousel.stop();
  $("compare-original").src = s.original || s.src;
  $("compare-original").alt = s.alt || "";
  $("compare-rebuilt").src = s.rebuilt || s.src;
  $("compare-rebuilt").alt = `${s.name || "This proof"}, rebuilt from equations`;
  $("compare-title").textContent = s.name || "Proof";
  $("compare-meta").textContent = `Rebuilt from ${Number(s.count || 0).toLocaleString()} equations.`;
  renderProofText(s, $("compare-eqs"));
  compare.style.setProperty("--pos", "50%");
  compareRange.value = "50";
  clearTimeout(modalTimer);
  modal.hidden = false;
  modal.classList.remove("is-closing");
  requestAnimationFrame(() => modal.classList.add("is-open"));
  document.body.classList.add("modal-open");
  $("compare-card").focus({ preventScroll: true });
}

function closeModal() {
  if (modal.hidden) return;
  modal.classList.remove("is-open");
  modal.classList.add("is-closing");
  document.body.classList.remove("modal-open");
  clearTimeout(modalTimer);
  modalTimer = setTimeout(() => {
    modal.hidden = true;
    modal.classList.remove("is-closing");
    if (carousel && carousel.playing) carousel.start();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }, 220);
}

function initModal() {
  $("compare-close").addEventListener("click", closeModal);
  $("compare-scrim").addEventListener("click", closeModal);
  compareRange.addEventListener("input", (e) => {
    compare.style.setProperty("--pos", `${e.target.value}%`);
  });
  document.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const items = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
      .filter((el) => !el.disabled && el.offsetParent !== null && el.getAttribute("aria-hidden") !== "true");
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $("compare-card"))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/* ------------------------------------------------------------------ carousel */
async function initCarousel() {
  let slides;
  try {
    const res = await fetch("assets/demo-slides.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    slides = await res.json();
    if (!Array.isArray(slides) || !slides.length) throw new Error("No slides");
  } catch (err) {
    console.warn("Could not load proofs", err);
    const deck = $("deck");
    deck.innerHTML = `<figure class="deck-card is-active"><img src="assets/cat-still.webp" width="720" height="480" alt="The pixel-shades cat rebuilt from 1,672 equations"><figcaption class="deck-count">1,672 equations</figcaption></figure>`;
    $("deck-dots").hidden = true;
    return;
  }

  const N = slides.length;
  const ordered = [slides[N - 1], ...slides, slides[0]];
  const deck = $("deck");
  deck.innerHTML = ordered.map((s, raw) => {
    const real = raw === 0 ? N - 1 : raw === N + 1 ? 0 : raw - 1;
    const clone = raw === 0 || raw === N + 1;
    return `<figure class="deck-card${raw === 1 ? " is-active" : ""}${clone ? " is-clone" : ""}" data-raw="${raw}" data-real="${real}" data-art${clone ? ' aria-hidden="true"' : ""}>
      <img src="${esc(s.src)}" width="720" height="480" alt="${esc(s.alt || "")}" draggable="false">
      <figcaption class="deck-count">${Number(s.count || 0).toLocaleString()} equations</figcaption>
    </figure>`;
  }).join("");

  const dots = $("deck-dots");
  dots.innerHTML = slides.map((s, i) =>
    `<button class="dot${i === 0 ? " is-active" : ""}" type="button" data-i="${i}" aria-label="Show proof ${i + 1}" aria-pressed="${i === 0}"></button>`).join("");

  const gallery = $("proof-grid");
  gallery.innerHTML = slides.map((s, i) => `
    <figure class="proof-card">
      <button class="proof-open" type="button" data-proof="${i}" aria-label="Compare ${esc(s.name || "this proof")}">
        <span class="proof-media"><img src="${esc(s.src)}" width="720" height="480" alt="${esc(s.alt || "")}" loading="lazy" decoding="async"><span class="deck-count">${Number(s.count || 0).toLocaleString()} equations</span></span>
        <span class="proof-meta"><span class="proof-title">${esc(s.name || "Proof")}</span><span class="proof-count">${Number(s.count || 0).toLocaleString()} eq</span><i class="ri ri-arrow-right-line proof-arrow" aria-hidden="true"></i></span>
      </button>
    </figure>`).join("");

  const cards = $$(".deck-card", deck);
  const dotEls = $$(".dot", dots);
  const gap = () => parseFloat(getComputedStyle(deck).gap) || 10;
  const step = () => (cards[0] ? cards[0].getBoundingClientRect().width + gap() : 0);
  const realOf = (raw) => ((raw - 1) % N + N) % N;

  const demo = {
    slides, index: 0, raw: 1, timer: null, playing: !reduced,
    stop() { clearInterval(demo.timer); demo.timer = null; },
    start() {
      demo.stop();
      if (!demo.playing || reduced || document.hidden) return;
      demo.timer = setInterval(() => { if (!document.hidden) go(demo.index + 1); }, 9000);
    },
  };
  carousel = demo;

  const playBtn = $("deck-play");
  const updatePlay = () => {
    playBtn.setAttribute("aria-label", demo.playing ? "Pause auto-cycling" : "Start auto-cycling");
    playBtn.title = demo.playing ? "Pause auto-cycling" : "Start auto-cycling";
    playBtn.innerHTML = `<i class="ri ${demo.playing ? "ri-pause-fill" : "ri-play-fill"}" aria-hidden="true"></i>`;
    $("deck-overlay")?.closest(".deck-card")?.classList.toggle("is-paused", !demo.playing);
  };
  const setPlaying = (v) => {
    demo.playing = v;
    updatePlay();
    if (v) demo.start(); else demo.stop();
  };
  playBtn.addEventListener("click", () => setPlaying(!demo.playing));

  function setActive(raw) {
    const real = realOf(raw);
    const changed = real !== demo.index;
    demo.raw = raw;
    demo.index = real;
    cards.forEach((c, j) => c.classList.toggle("is-active", j === raw));
    dotEls.forEach((d, j) => {
      d.classList.toggle("is-active", j === real);
      d.setAttribute("aria-pressed", String(j === real));
    });
    cards[raw]?.append($("deck-overlay"));
    $("deck-overlay")?.closest(".deck-card")?.classList.toggle("is-paused", !demo.playing);
    if (changed) {
      const s = slides[real];
      const quip = $("demo-quip");
      const eqs = $("demo-eqs");
      quip.classList.add("is-fading");
      eqs.classList.add("is-fading");
      setTimeout(() => {
        renderProofText(s, eqs, quip);
        quip.classList.remove("is-fading");
        eqs.classList.remove("is-fading");
      }, 130);
    }
  }

  function go(real, instant = false) {
    const n = ((real % N) + N) % N;
    let raw = n + 1;
    if (demo.index === N - 1 && n === 0) raw = N + 1;
    else if (demo.index === 0 && n === N - 1) raw = 0;
    const card = cards[raw];
    if (!card) return;
    deck.scrollTo({ left: Math.max(0, raw * step()), behavior: instant || reduced ? "instant" : "smooth" });
    setActive(raw);
  }

  function normalize() {
    if (demo.raw !== 0 && demo.raw !== N + 1) return;
    // The clone is pixel-identical; jump instantly so the reset never
    // animates backwards through the deck.
    const prev = deck.style.scrollBehavior;
    deck.style.scrollBehavior = "auto";
    if (demo.raw === 0) { deck.scrollLeft = step() * N; setActive(N); }
    else { deck.scrollLeft = step(); setActive(1); }
    deck.style.scrollBehavior = prev;
  }

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
  $("deck-prev").addEventListener("click", () => go(demo.index - 1));
  $("deck-next").addEventListener("click", () => go(demo.index + 1));
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

  $("deck-max").addEventListener("click", (e) => { e.stopPropagation(); openModal(demo.index); });

  $$("[data-proof]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(Number(btn.dataset.proof)));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) demo.stop();
    else if (demo.playing) demo.start();
  });

  updatePlay();
  setActive(1);
  requestAnimationFrame(() => {
    deck.scrollLeft = step();
    setActive(1);
    demo.start();
  });
}

/* ------------------------------------------------------------------ copy */
function initCopy() {
  const command = "docker run --rm -p 8010:8000 ghcr.io/hello2himel/chawk:latest";
  const bind = (btn, label, state) => {
    if (!btn || !label) return;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(command);
        label.textContent = "Copied";
        if (state) state.textContent = "command copied";
        setTimeout(() => {
          label.textContent = "Copy";
          if (state) state.textContent = "";
        }, 1800);
      } catch {
        label.textContent = "Select & copy";
        setTimeout(() => { label.textContent = "Copy"; }, 1800);
      }
    });
  };
  bind($("copy-command"), $("copy-label"), $("copy-state"));
  bind($("hero-copy"), $("hero-copy-label"), null);
}

/* ------------------------------------------------------------------ boot */
initTheme();
initModal();
initCopy();
initCarousel();
