/* Chawk — GPU path for the per-pixel canvas work.
 *
 * The ink preview and the "wobble" mask are threshold operations over ~1–2 MP
 * images. They run as WebGL fragment shaders when a context is available
 * (hardware or software), with the existing CPU path as a fallback so the app
 * works on every device, including GPUs that are blocklisted or lose context.
 *
 * WebGL 1 / GLSL ES 1.00 + mediump on purpose: oldest possible baseline.
 */
"use strict";

const ChawkGL = (() => {
  const VERT = [
    "attribute vec2 aPos;",
    "varying vec2 vUV;",
    "void main() {",
    "  vUV = vec2((aPos.x + 1.0) * 0.5, 1.0 - (aPos.y + 1.0) * 0.5);",
    "  gl_Position = vec4(aPos, 0.0, 1.0);",
    "}",
  ].join("\n");

  const MASK_FRAG = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "uniform sampler2D uTex;",
    "uniform float uPaper, uCut, uLight;",
    "void main() {",
    "  vec3 c = texture2D(uTex, vUV).rgb;",
    "  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * 255.0;",
    "  float edge = uLight > 0.5 ? (uPaper - uCut) - l : l - (uPaper + uCut);",
    "  float a = clamp(edge / 14.0, 0.0, 1.0);",
    "  gl_FragColor = vec4(0.122, 0.247, 0.820, a);",
    "}",
  ].join("\n");

  const DIFF_FRAG = [
    "precision mediump float;",
    "varying vec2 vUV;",
    "uniform sampler2D uA, uB;",
    "uniform float uPaperA, uPaperB, uLightA, uLightB, uRadX, uRadY;",
    "float ink(vec3 c, float paper, float light) {",
    "  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * 255.0;",
    "  return light > 0.5 ? step(l, paper - 55.0) : step(paper + 55.0, l);",
    "}",
    "void main() {",
    "  float a = ink(texture2D(uA, vUV).rgb, uPaperA, uLightA);",
    "  float b = 0.0;",
    "  for (int i = -1; i <= 1; i++) {",
    "    for (int j = -1; j <= 1; j++) {",
    "      vec2 uv = clamp(vUV + vec2(float(i) * uRadX, float(j) * uRadY), 0.0, 1.0);",
    "      b = max(b, ink(texture2D(uB, uv).rgb, uPaperB, uLightB));",
    "    }",
    "  }",
    "  gl_FragColor = vec4(0.760, 0.254, 0.047, a * (1.0 - b));",
    "}",
  ].join("\n");

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("Chawk GL: shader compile failed:", gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  class Program {
    constructor(fragSrc) {
      this.canvas = document.createElement("canvas");
      this.fragSrc = fragSrc;
      this.ok = false;
      this.gl = null;
      try {
        const opts = {
          alpha: true, antialias: false, depth: false, stencil: false,
          premultipliedAlpha: false, preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        };
        this.gl = this.canvas.getContext("webgl", opts)
          || this.canvas.getContext("experimental-webgl", opts);
      } catch { this.gl = null; }
      if (!this.gl) return;
      this.canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        this.ok = false;
        this.texCache = {}; // invalid after loss; rebuilt on restore
      }, false);
      this.canvas.addEventListener("webglcontextrestored", () => {
        this.ok = this.build();
      }, false);
      this.ok = this.build();
    }

    build() {
      const gl = this.gl;
      if (!gl) return false;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, this.fragSrc);
      if (!vs || !fs) return false;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("Chawk GL: link failed:", gl.getProgramInfoLog(prog));
        return false;
      }
      this.prog = prog;
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.pos = gl.getAttribLocation(prog, "aPos");
      this.uniforms = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        if (info) this.uniforms[info.name] = gl.getUniformLocation(prog, info.name);
      }
      this.texCache = {};
      return true;
    }

    maxSize() {
      try { return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 2048; } catch { return 2048; }
    }

    /* Upload an image once per (source, size) key; reuse the texture otherwise. */
    texture(unit, image, w, h, key) {
      const gl = this.gl;
      let entry = this.texCache[unit];
      if (!entry) {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        entry = this.texCache[unit] = { tex, key: null };
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      if (entry.key !== key) {
        // Draw through a scratch canvas: avoids uploading multi-megapixel
        // originals on phones and gives a predictable texture size.
        const scratch = document.createElement("canvas");
        scratch.width = w;
        scratch.height = h;
        scratch.getContext("2d").drawImage(image, 0, 0, w, h);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
        entry.key = key;
      }
      return entry.tex;
    }

    begin(w, h) {
      const gl = this.gl;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(this.pos);
      gl.vertexAttribPointer(this.pos, 2, gl.FLOAT, false, 0, 0);
    }

    finish() {
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    fit(w, h) {
      const max = this.maxSize();
      if (w <= max && h <= max) return [w, h];
      const s = Math.min(max / w, max / h);
      return [Math.max(1, Math.floor(w * s)), Math.max(1, Math.floor(h * s))];
    }
  }

  class Mask extends Program {
    constructor() { super(MASK_FRAG); }

    render(image, w, h, opts) {
      if (!this.ok || !image || !image.complete || !image.naturalWidth) return null;
      try {
        const gl = this.gl;
        const [W, H] = this.fit(w, h);
        this.begin(W, H);
        const key = (image.currentSrc || image.src) + "|" + W + "x" + H;
        this.texture(0, image, W, H, key);
        gl.uniform1i(this.uniforms.uTex, 0);
        gl.uniform1f(this.uniforms.uPaper, opts.paper);
        gl.uniform1f(this.uniforms.uCut, opts.cut);
        gl.uniform1f(this.uniforms.uLight, opts.light ? 1 : 0);
        this.finish();
        return this.canvas;
      } catch (err) {
        console.warn("Chawk GL: mask failed, falling back to CPU", err);
        this.ok = false;
        return null;
      }
    }
  }

  class Diff extends Program {
    constructor() { super(DIFF_FRAG); }

    render(a, b, opts) {
      if (!this.ok || !a || !b) return null;
      if (!a.complete || !b.complete || !a.naturalWidth || !b.naturalWidth) return null;
      try {
        const gl = this.gl;
        const [W, H] = this.fit(opts.width, opts.height);
        this.begin(W, H);
        this.texture(0, a, W, H, (a.currentSrc || a.src) + "|" + W + "x" + H);
        this.texture(1, b, W, H, (b.currentSrc || b.src) + "|" + W + "x" + H);
        gl.uniform1i(this.uniforms.uA, 0);
        gl.uniform1i(this.uniforms.uB, 1);
        gl.uniform1f(this.uniforms.uPaperA, opts.paperA);
        gl.uniform1f(this.uniforms.uPaperB, opts.paperB);
        gl.uniform1f(this.uniforms.uLightA, opts.lightA ? 1 : 0);
        gl.uniform1f(this.uniforms.uLightB, opts.lightB ? 1 : 0);
        gl.uniform1f(this.uniforms.uRadX, opts.radX / W);
        gl.uniform1f(this.uniforms.uRadY, opts.radY / H);
        this.finish();
        return { gl, width: W, height: H };
      } catch (err) {
        console.warn("Chawk GL: diff failed, falling back to CPU", err);
        this.ok = false;
        return null;
      }
    }
  }

  const mask = new Mask();
  const diff = new Diff();

  function info() {
    try {
      const gl = mask.gl || diff.gl;
      if (!gl) return null;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        version: gl.getParameter(gl.VERSION),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    } catch { return null; }
  }

  return {
    maskAvailable: () => mask.ok,
    diffAvailable: () => diff.ok,
    mask: (...args) => mask.render(...args),
    diff: (...args) => diff.render(...args),
    info,
  };
})();

if (typeof window !== "undefined") {
  window.__chawkGPU = () => ({
    mask: ChawkGL.maskAvailable(),
    diff: ChawkGL.diffAvailable(),
    info: ChawkGL.info(),
  });
}
