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
  // typographic minus and ellipsis -> TeX
  s = s.replace(/\u2212/g, "-");
  s = s.replace(/\u2026/g, "\\ldots ");
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

/* ---------- downloadable equation exports (pure, no DOM) ----------
 *
 * `chawkEquationsText(report, meta)` and `chawkEquationsLatex(report, meta)`
 * turn a /api/process report into a file containing only the fitted
 * equations - no image, no base64. `meta` is `{ source, preset }`.
 */

function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

function chawkEquationLines(report) {
  const out = [];
  for (const st of (report && report.strokes) || []) {
    for (const sg of st.segments || []) {
      const eq = sg && typeof sg.equation === "string" ? sg.equation.trim() : "";
      if (eq) out.push(eq);
    }
  }
  return out;
}

/* Comment header: source + counts + fit quality. Never contains a newline. */
function chawkExportHeader(report, meta, comment) {
  const s = (report && report.summary) || {};
  const source = String((meta && meta.source) || "untitled").replace(/[\r\n]+/g, " ");
  const preset = meta && meta.preset ? " · " + String(meta.preset).replace(/[\r\n]+/g, " ") : "";
  const lines = [comment + " Chawk · " + source + preset];
  const bits = [];
  if (typeof s.stroke_count === "number") bits.push(plural(s.stroke_count, "stroke", "strokes"));
  if (typeof s.segment_count === "number") bits.push(plural(s.segment_count, "equation", "equations"));
  if (typeof s.mean_r_squared === "number") bits.push("mean R² " + s.mean_r_squared.toFixed(4));
  if (typeof s.mean_rmse_px === "number") bits.push("mean RMSE " + s.mean_rmse_px.toFixed(2) + "px");
  if (bits.length) lines.push(comment + " " + bits.join(" · "));
  return lines;
}

/* Plain text: equations only, one per line, # comments for provenance. */
function chawkEquationsText(report, meta) {
  const lines = chawkExportHeader(report, meta, "#");
  lines.push("");
  for (const eq of chawkEquationLines(report)) lines.push(eq);
  lines.push("");
  return lines.join("\n");
}

/* Escape a plain sentence for \text{...} in LaTeX. */
function chawkTexText(s) {
  return String(s).replace(/[\\&%$#_{}~^]/g, (c) => ({
    "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#",
    "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  }[c]));
}

/* LaTeX: an align block, one fitted equation per row. */
function chawkEquationsLatex(report, meta) {
  const lines = chawkExportHeader(report, meta, "%");
  const rows = [];
  for (const st of (report && report.strokes) || []) {
    for (const sg of st.segments || []) {
      const eq = sg && typeof sg.equation === "string" ? sg.equation.trim() : "";
      if (!eq) continue;
      const tex = chawkToLatex(eq, sg.model);
      if (!tex) { rows.push("  \\text{" + chawkTexText(eq) + "}"); continue; }
      const at = tex.indexOf(" = ");
      rows.push(at === -1 ? "  " + tex : "  " + tex.slice(0, at) + " &= " + tex.slice(at + 3));
    }
  }
  lines.push("\\begin{align}");
  rows.forEach((row, i) => lines.push(row + (i === rows.length - 1 ? "" : " \\\\")));
  lines.push("\\end{align}");
  lines.push("");
  return lines.join("\n");
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
