// crop.ts — relative-rect crop (geometric, resolution-independent).
//
// Params are fractions of the current image size (origin top-left), so the
// same JSON means the same framing at any resolution. The pixel rect uses
// the exact VIPS formula (src/transforms/crop.h): round + clamp to
// [1px, remainder]; outputDims() shares it so the pipeline pre-sizes `to`.
import { clampf } from '../math.js';
import {
  isNumInRange,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface CropEdit {
  edit: 'crop';
  /** Left edge, fraction of width, 0..1. Default 0. */
  x?: number;
  /** Top edge, fraction of height, 0..1. Default 0. */
  y?: number;
  /** Width, fraction of width, >0..1. Default 1. */
  width?: number;
  /** Height, fraction of height, >0..1. Default 1. */
  height?: number;
}

type Full = Required<CropEdit>;

const MIN_EXTENT = 1e-4;

/** Pixel rect for the given input size; identical to src/transforms/crop.h. */
export function cropRect(
  inW: number,
  inH: number,
  params: Full,
): { left: number; top: number; w: number; h: number } {
  const left = Math.min(inW - 1, Math.max(0, Math.round(params.x * inW)));
  const top = Math.min(inH - 1, Math.max(0, Math.round(params.y * inH)));
  const w = Math.min(inW - left, Math.max(1, Math.round(params.width * inW)));
  const h = Math.min(inH - top, Math.max(1, Math.round(params.height * inH)));
  return { left, top, w, h };
}

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform vec2 offset;
uniform vec2 scale;
varying vec2 texCoord;
void main() {
  gl_FragColor = texture2D(texture, offset + texCoord * scale);
}
`;

export class CropTransform implements Transform<'crop', CropEdit> {
  public readonly edit = 'crop' as const;
  public controls: ParamControl[] = [
    { key: 'x', label: 'x', min: 0, max: 1, step: 0.01, def: 0 },
    { key: 'y', label: 'y', min: 0, max: 1, step: 0.01, def: 0 },
    { key: 'width', label: 'width', min: 0, max: 1, step: 0.01, def: 1 },
    { key: 'height', label: 'height', min: 0, max: 1, step: 0.01, def: 1 },
  ];

  public defaults(): Full {
    return { edit: 'crop', x: 0, y: 0, width: 1, height: 1 };
  }

  public validate(params: CropEdit): string[] {
    const errs: string[] = [];
    if (params.x !== undefined && !isNumInRange(params.x, 0, 1))
      errs.push('x must be a number in [0,1]');
    if (params.y !== undefined && !isNumInRange(params.y, 0, 1))
      errs.push('y must be a number in [0,1]');
    if (params.width !== undefined && !isNumInRange(params.width, 0, 1))
      errs.push('width must be a number in [0,1]');
    if (params.height !== undefined && !isNumInRange(params.height, 0, 1))
      errs.push('height must be a number in [0,1]');
    if (errs.length > 0) return errs;
    const x = params.x ?? 0;
    const y = params.y ?? 0;
    const w = params.width ?? 1;
    const h = params.height ?? 1;
    if (!(w > 0) || !(h > 0)) errs.push('width/height must be > 0');
    const eps = 1e-9;
    if (x + w > 1 + eps || y + h > 1 + eps)
      errs.push('crop region x+width/y+height must not exceed 1');
    return errs;
  }

  public normalize(params: CropEdit): Full {
    // Keep at least MIN_EXTENT of frame: the renderer rounds that to 1px.
    const x = clampf(0, params.x ?? 0, 1 - MIN_EXTENT);
    const y = clampf(0, params.y ?? 0, 1 - MIN_EXTENT);
    const width = clampf(MIN_EXTENT, params.width ?? 1, 1 - x);
    const height = clampf(MIN_EXTENT, params.height ?? 1, 1 - y);
    return { edit: 'crop', x, y, width, height };
  }

  public outputDims(inW: number, inH: number, params: Full): { w: number; h: number } {
    const r = cropRect(inW, inH, params);
    return { w: r.w, h: r.h };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    const r = cropRect(ctx.width, ctx.height, params);
    ctx.pass(FRAG, from, to, (gl, p) => {
      const uOff = gl.getUniformLocation(p, 'offset');
      if (uOff) gl.uniform2f(uOff, r.left / ctx.width, r.top / ctx.height);
      const uScale = gl.getUniformLocation(p, 'scale');
      if (uScale) gl.uniform2f(uScale, r.w / ctx.width, r.h / ctx.height);
    });
    return to;
  }
}
