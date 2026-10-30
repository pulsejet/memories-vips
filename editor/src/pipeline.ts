// pipeline.ts — headless WebGL preview for an ordered edit list.
//
// Headless means: the caller owns the <canvas> (layout, sizing policy, DOM).
// The pipeline takes over its WebGL context, uploads the source image, and
// runs each edit through its Transform (transforms/) — single shader passes
// or multi-pass sequences (blur/sharpen) ping-ponging between two RGBA
// textures, the same structure as glfx.js Canvas — and leaves the result on
// the canvas.
//
// Serialization (toJSON) emits the canonical {version, edits} state; the same
// array (normalized) is what vips-preview accepts as "edits".
import { BLIT_FRAG, COPY_FRAG, GAUSS_FRAG, VERT } from './shaders.js';
import { TRANSFORMS, normalizeEdit } from './transforms/index.js';
import type { RenderContext, Target, UniformSetter, ExtraTex } from './transforms/transform.js';
import { emptyState, type Edit, type EditState } from './types.js';

export class EditPipeline {
  private gl: WebGLRenderingContext;
  private canvas: HTMLCanvasElement;
  private programs = new Map<string, WebGLProgram>();
  // Fullscreen quad (-1..1 triangle strip) shared by every draw call.
  private quad: WebGLBuffer | null = null;
  // src holds the uploaded image; ping/pong are the working pair that
  // edits bounce between; extra is scratch (sharpen keeps its unblurred
  // original there while blurring the working copy in place).
  private src: Target | null = null;
  private ping: Target | null = null;
  private pong: Target | null = null;
  private extra: Target | null = null;
  private imgW = 0;
  private imgH = 0;
  private state: EditState = emptyState();
  private floatOK = false;

  /**
   * Take over the canvas' WebGL context. preserveDrawingBuffer stays true
   * so the demo can read pixels back; premultipliedAlpha stays false
   * so alpha survives the passes unmodified. Throws when WebGL is missing.
   */
  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error('WebGL is not available on this canvas');
    this.gl = gl;
    this.floatOK = this.probeFloat();
    const buf = gl.createBuffer();
    if (!buf) throw new Error('WebGL: createBuffer failed');
    this.quad = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  /** Source image size (canvas backing store matches it after setImage). */
  public get width(): number {
    return this.imgW;
  }
  public get height(): number {
    return this.imgH;
  }

  /** Ordered edit list (live reference — mutate via setEdits/addEdit/...). */
  public getEdits(): Edit[] {
    return this.state.edits;
  }

  /** Replace the whole edit list (normalizing each edit) and re-render. */
  public setEdits(edits: Edit[]): void {
    this.state = { version: 1, edits: edits.map(normalizeEdit) };
    this.render();
  }

  /** Append one edit (normalized) and re-render. */
  public addEdit(edit: Edit): void {
    this.state.edits.push(normalizeEdit(edit));
    this.render();
  }

  /** Drop the edit at `index` and re-render. */
  public removeEdit(index: number): void {
    this.state.edits.splice(index, 1);
    this.render();
  }

  /** Reorder one edit and re-render. */
  public moveEdit(from: number, to: number): void {
    const [edit] = this.state.edits.splice(from, 1);
    if (edit !== undefined) this.state.edits.splice(to, 0, edit);
    this.render();
  }

  /** Drop all edits (back to the bare source image) and re-render. */
  public clearEdits(): void {
    this.state.edits = [];
    this.render();
  }

  /** Canonical JSON state for the VIPS side. */
  public toJSON(): string {
    return JSON.stringify({ version: 1 as const, edits: this.state.edits.map(normalizeEdit) });
  }

  /**
   * Longest side of the working image. Camera JPEGs (12-50MP) would need
   * hundreds of MB as float ping-pong targets and exceed
   * MAX_TEXTURE_SIZE on weak GPUs — both failure modes render black with
   * no exception. The preview is resolution-capped (reported via
   * width/height); the VIPS side always renders full-res from the JSON.
   */
  public static readonly MAX_DIM = 2048;

  /** Resolve the pixel size of any TexImageSource upload. */
  private sourceDims(source: TexImageSource): { w: number; h: number } {
    const anySrc = source as unknown as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    // HTMLImageElement (natural size, unaffected by CSS/attributes).
    const nw = num(anySrc['naturalWidth']);
    const nh = num(anySrc['naturalHeight']);
    if (nw > 0 && nh > 0) return { w: nw, h: nh };
    // HTMLVideoElement.
    const vw = num(anySrc['videoWidth']);
    const vh = num(anySrc['videoHeight']);
    if (vw > 0 && vh > 0) return { w: vw, h: vh };
    // HTMLCanvasElement / ImageBitmap / OffscreenCanvas.
    return { w: num(anySrc['width']), h: num(anySrc['height']) };
  }

  /** Turn a sticky GL error flag into a thrown message naming the stage. */
  private checkGLError(stage: string): void {
    const gl = this.gl;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      throw new Error(`WebGL error ${err} during ${stage} (image may be too large for this GPU)`);
    }
  }

  /**
   * Upload a new source image, resizing the canvas and all targets to it.
   * Oversized sources are downscaled through a 2D canvas first (see
   * MAX_DIM); old GL targets are deleted. Ends with a full render().
   * Throws with a message instead of rendering black on failure.
   */
  public setImage(source: TexImageSource): void {
    const gl = this.gl;
    const dims = this.sourceDims(source);
    if (!dims.w || !dims.h) throw new Error('setImage: source has no width/height');
    // Downscale oversized sources through a 2D canvas before upload.
    let upload: TexImageSource = source;
    let w = dims.w;
    let h = dims.h;
    const longest = Math.max(w, h);
    if (longest > EditPipeline.MAX_DIM) {
      const scale = EditPipeline.MAX_DIM / longest;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const scratch = document.createElement('canvas');
      scratch.width = w;
      scratch.height = h;
      const g = scratch.getContext('2d');
      if (!g) throw new Error('setImage: 2D context unavailable for downscale');
      g.imageSmoothingQuality = 'high';
      g.drawImage(source as CanvasImageSource, 0, 0, w, h);
      upload = scratch;
    }
    this.imgW = w;
    this.imgH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of [this.src, this.ping, this.pong, this.extra]) {
      if (t) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fb);
      }
    }
    const type = this.floatOK ? gl.FLOAT : gl.UNSIGNED_BYTE;
    this.src = this.makeTarget(w, h, gl.UNSIGNED_BYTE);
    this.ping = this.makeTarget(w, h, type);
    this.pong = this.makeTarget(w, h, type);
    this.extra = this.makeTarget(w, h, type);
    this.checkGLError('target allocation');
    gl.bindTexture(gl.TEXTURE_2D, this.src.tex);
    // NOTE: no UNPACK_FLIP_Y here — like glfx.js, the source is uploaded
    // unflipped and the final blit flips Y once (double flip = upside down).
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload);
    this.checkGLError('texture upload');
    // Framebuffer completeness is the other silent-black cause.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ping.fb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error('WebGL: ping framebuffer incomplete at this size');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.render();
  }

  /**
   * Re-run all passes: copy source -> ping, then apply each edit in order,
   * ping-ponging between the two working targets (`cur` holds the latest
   * result, `nxt` is the scratch target; multi-pass edits may bounce
   * between them internally and return either side). No-op when no image
   * is loaded yet.
   */
  public render(): void {
    if (!this.src || !this.ping || !this.pong || !this.extra || this.imgW === 0) return;
    // Start from the source image.
    this.blit(this.src, this.ping);
    let cur: Target = this.ping;
    let nxt: Target = this.pong;
    const ctx = this.renderContext();
    for (const edit of this.state.edits) {
      const t = TRANSFORMS[edit.edit];
      if (!t) continue; // validated on set; skip defensively
      cur = t.apply(ctx, cur, nxt, normalizeEdit(edit) as never);
      nxt = cur === this.ping ? this.pong : this.ping;
    }
    this.toCanvas(cur);
  }

  /**
   * RenderContext facade for Transform.apply(): exposes the pass/blit/gauss
   * drawing primitives plus the scratch `extra` target, without handing
   * out the raw WebGL context.
   */
  private renderContext(): RenderContext {
    const extra = this.extra;
    if (!extra) throw new Error('render: no targets');
    return {
      width: this.imgW,
      height: this.imgH,
      extra,
      pass: (frag, from, to, setUniforms, extraTex) =>
        this.pass(frag, from, to, setUniforms, extraTex),
      blit: (from, to) => this.blit(from, to),
      gauss: (from, to, horizontal, kernel) => this.gauss(from, to, horizontal, kernel),
    };
  }

  // --- internals ---

  /**
   * Decide float vs 8-bit ping-pong targets. Float needs both the
   * renderable-float extension and float-linear filtering (every pass
   * samples with LINEAR); either missing falls back to UNSIGNED_BYTE.
   * Also verifies float renderability with a throwaway 4x4 target.
   */
  private probeFloat(): boolean {
    const gl = this.gl;
    // glfx.js requires both: renderable float targets AND float-linear
    // filtering (all passes sample with LINEAR). Without the latter the
    // float textures are incomplete and every pass outputs black.
    if (!gl.getExtension('OES_texture_float')) return false;
    if (!gl.getExtension('OES_texture_float_linear')) return false;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fb);
    return ok;
  }

  /**
   * Allocate one offscreen RGBA render target (texture + framebuffer) with
   * linear filtering and clamp-to-edge (NPOT-safe: no mipmaps, no repeat).
   */
  private makeTarget(w: number, h: number, type: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new Error('WebGL: target allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb };
  }

  /**
   * Compile one shader stage, throwing the info log on failure (a bad
   * shader would otherwise render black with no indication why).
   */
  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) throw new Error('WebGL: createShader failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? 'unknown';
      gl.deleteShader(sh);
      throw new Error(`WebGL shader compile failed: ${log}`);
    }
    return sh;
  }

  /** Compile+link the quad vertex shader with `frag`, cached by source. */
  private program(frag: string): WebGLProgram {
    let p = this.programs.get(frag);
    if (p) return p;
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERT);
    const fs = this.compile(gl.FRAGMENT_SHADER, frag);
    p = gl.createProgram();
    if (!p) throw new Error('WebGL: createProgram failed');
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`WebGL link failed: ${gl.getProgramInfoLog(p) ?? 'unknown'}`);
    }
    this.programs.set(frag, p);
    return p;
  }

  /**
   * Draw one fullscreen pass: render `from` through `frag` into `to`.
   * `from` is bound to unit 0 (`texture` uniform) unless the shader uses
   * other sampler names; `extraTex` optionally binds a second texture
   * (used by the sharpen mix pass). `setUniforms` fills the rest.
   */
  public pass(
    frag: string,
    from: Target,
    to: Target,
    setUniforms?: UniformSetter,
    extraTex?: ExtraTex,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
    gl.viewport(0, 0, this.imgW, this.imgH);
    const prog = this.program(frag);
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    const uTex = gl.getUniformLocation(prog, 'texture');
    if (uTex) gl.uniform1i(uTex, 0);
    if (extraTex) {
      gl.activeTexture(gl.TEXTURE0 + extraTex.unit);
      gl.bindTexture(gl.TEXTURE_2D, extraTex.tex);
      const u = gl.getUniformLocation(prog, extraTex.name);
      if (u) gl.uniform1i(u, extraTex.unit);
      gl.activeTexture(gl.TEXTURE0);
    }
    setUniforms?.(gl, prog);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Copy one target to another with the identity shader. */
  public blit(from: Target, to: Target): void {
    this.pass(COPY_FRAG, from, to);
  }

  /**
   * One axis of the separable gaussian: `horizontal` picks the sample
   * direction (offsets are in UV units, hence the 1/width division).
   * The shader loops over a fixed 31-tap array; `kernel.length` tells it
   * how many center taps carry real weight, the rest are zero-padded.
   */
  public gauss(from: Target, to: Target, horizontal: boolean, kernel: number[]): void {
    const padded = kernel.slice();
    while (padded.length < 31) padded.push(0);
    this.pass(GAUSS_FRAG, from, to, (gl, p) => {
      const uDir = gl.getUniformLocation(p, 'dir');
      if (uDir) {
        gl.uniform2f(uDir, horizontal ? 1 / this.imgW : 0, horizontal ? 0 : 1 / this.imgH);
      }
      const uK = gl.getUniformLocation(p, 'kernel');
      if (uK) gl.uniform1fv(uK, padded);
      const uC = gl.getUniformLocation(p, 'count');
      if (uC) gl.uniform1i(uC, kernel.length);
    });
  }

  /**
   * Present the final result on the canvas. Rendering goes to the default
   * framebuffer (null) instead of a target, and the blit shader flips Y:
   * uploads are stored unflipped (texture v=0 is the image top row), while
   * the framebuffer's row 0 is displayed at the canvas bottom — sampling
   * `1-y` puts the image top back at the canvas top.
   */
  private toCanvas(from: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.imgW, this.imgH);
    const prog = this.program(BLIT_FRAG);
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    const uTex = gl.getUniformLocation(prog, 'texture');
    if (uTex) gl.uniform1i(uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  }
}
