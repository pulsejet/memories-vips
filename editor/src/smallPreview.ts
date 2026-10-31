// smallPreview.ts — cheap small previews for an edit list.
//
// A SmallPreview owns one hidden WebGL canvas + EditPipeline plus a
// downscaled 2D copy of the source (longest side <= maxDim, default 512).
// setSource() downscales and uploads once; each render() then only re-runs
// the edit passes and snapshots the result into a fresh caller-owned 2D
// canvas — no re-upload, no shader recompile, no disturbance of any main
// preview canvas. Returning a snapshot (not the live canvas) keeps repeated
// renders safe to hold (e.g. a filmstrip of edit variants).
//
// Pixel radii (blur/sharpen) are in preview pixels here, so large radii look
// relatively stronger than at full res; everything else matches the main
// preview. Each instance holds one WebGL context: call dispose() when done
// (browsers cap live contexts at ~16 per page).
import { EditPipeline } from './pipeline.js';
import type { Edit } from './types.js';

export class SmallPreview {
  /** Default longest side of the downscaled working copy. */
  public static readonly MAX_DIM = 512;

  private pipe: EditPipeline | null = null;
  private view: HTMLCanvasElement | null = null;
  private hasSource = false;
  private readonly maxDim: number;

  public constructor(maxDim: number = SmallPreview.MAX_DIM) {
    if (!Number.isFinite(maxDim) || maxDim < 1)
      throw new Error('SmallPreview: maxDim must be a number >= 1');
    this.maxDim = Math.floor(maxDim);
  }

  /** Last render output size (downscaled source size when no geometric edit applies). */
  public get width(): number {
    return this.pipe?.width ?? 0;
  }
  public get height(): number {
    return this.pipe?.height ?? 0;
  }

  /**
   * Downscale `source` to <= maxDim (aspect-fit, never upscaled) through a
   * 2D canvas and upload it once to the hidden pipeline. Replaces any
   * previous source. Throws when WebGL/2D is unavailable.
   */
  public setSource(source: TexImageSource): void {
    const dims = this.sourceDims(source);
    if (!dims.w || !dims.h) throw new Error('setSource: source has no width/height');
    // drawImage() rejects ImageData: stage it through a 2D canvas first.
    const drawable = EditPipeline.toDrawableSource(source);
    const longest = Math.max(dims.w, dims.h);
    const scale = longest > this.maxDim ? this.maxDim / longest : 1;
    const w = Math.max(1, Math.round(dims.w * scale));
    const h = Math.max(1, Math.round(dims.h * scale));
    const base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const g = base.getContext('2d');
    if (!g) throw new Error('setSource: 2D context unavailable for downscale');
    g.imageSmoothingQuality = 'high';
    g.drawImage(drawable, 0, 0, w, h);
    if (!this.pipe || !this.view) {
      const view = document.createElement('canvas');
      this.view = view;
      this.pipe = new EditPipeline(view);
    }
    this.pipe.setImage(base);
    this.hasSource = true;
  }

  /**
   * Render `edits` over the downscaled source and return the result as a
   * fresh caller-owned 2D canvas (sized to the rendered output area).
   * The hidden pipeline keeps its compiled programs between calls, so
   * repeated renders only pay for the edit passes plus a small copy.
   */
  public render(edits: Edit[]): HTMLCanvasElement {
    const pipe = this.pipe;
    const view = this.view;
    if (!pipe || !view || !this.hasSource)
      throw new Error('render: no source (call setSource first)');
    pipe.setEdits(edits);
    const out = document.createElement('canvas');
    out.width = pipe.width;
    out.height = pipe.height;
    const g = out.getContext('2d');
    if (!g) throw new Error('render: 2D context unavailable for snapshot');
    // preserveDrawingBuffer (set by EditPipeline) keeps this reliable.
    g.drawImage(view, 0, 0);
    return out;
  }

  /** Release the hidden WebGL context; render() throws until setSource again. */
  public dispose(): void {
    const view = this.view;
    this.pipe = null;
    this.view = null;
    this.hasSource = false;
    if (!view) return;
    try {
      // getContext('webgl') returns the existing context for this canvas.
      view.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Context already gone — nothing to release.
    }
  }

  /** Pixel size of any TexImageSource upload (mirrors EditPipeline). */
  private sourceDims(source: TexImageSource): { w: number; h: number } {
    const anySrc = source as unknown as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const nw = num(anySrc['naturalWidth']);
    const nh = num(anySrc['naturalHeight']);
    if (nw > 0 && nh > 0) return { w: nw, h: nh };
    const vw = num(anySrc['videoWidth']);
    const vh = num(anySrc['videoHeight']);
    if (vw > 0 && vh > 0) return { w: vw, h: vh };
    return { w: num(anySrc['width']), h: num(anySrc['height']) };
  }
}
