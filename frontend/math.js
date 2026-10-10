/* Convert Chawk plain-text equations into LaTeX for KaTeX rendering.
 *
 * Pure functions, no DOM: `chawkToLatex(equation, model)` returns a TeX
 * string, or null when the model has no closed form (spline prose).
 * Works in browsers (globals) and in node harnesses alike.
 */
"use strict";

const SUPERSCRIPT_DIGIT = {
  "\u00B2": "2", "\u00B3": "3", "\u2074": "4", "\u2075": "5",
  "\u2076": "6", "\u2077": "7", "\u2078": "8", "\u2079": "9",
};

/* Models whose `equation` is prose rather than math. */
const PROSE_MODELS = { spline: true };

function chawkToLatex(equation, model) {
  if (!equation || PROSE_MODELS[model]) return null;
  let s = String(equation);
  // a·b -> a\cdot b
  s = s.replace(/\u00B7/g, "\\cdot ");
  // unicode superscripts x² -> x^{2}
  s = s.replace(
    /[\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079]/g,
    (m) => "^{" + SUPERSCRIPT_DIGIT[m] + "}"
  );
  // backend "^n" fallback for degree > 9 -> ^{n}
  s = s.replace(/\^(\d+)/g, "^{$1}");
  // 1.20e-05 -> 1.20\times 10^{-05}
  s = s.replace(/(\d+\.?\d*)e([+-]?\d+)/g, "$1\\times 10^{$2}");
  // trig functions (backend only ever emits sin/cos)
  s = s.replace(/sin\b/g, "\\sin").replace(/cos\b/g, "\\cos");
  // ellipse angle
  s = s.replace(/\u03C6/g, "\\varphi");
  s = s.replace(/\u00B0/g, "^{\\circ}");
  return s;
}

/* Render one equation to HTML. Falls back to escaped plain text when KaTeX
 * is unavailable or rejects the input. `katexImpl` injectable for tests. */
function renderEquationHTML(equation, model, katexImpl) {
  const k = katexImpl || (typeof katex !== "undefined" ? katex : null);
  const tex = chawkToLatex(equation, model);
  if (tex && k && typeof k.renderToString === "function") {
    try {
      const html = k.renderToString(tex, { throwOnError: false, displayMode: false });
      if (html && html.indexOf("katex-error") === -1) return html;
    } catch (e) { /* fall through to plain text */ }
  }
  return escapeHTML(equation);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
