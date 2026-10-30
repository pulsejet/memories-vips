// rotate.ts — clockwise rotation, exact 90s + arbitrary angles.
//
// angle is clockwise degrees in [-180,180] (matches vips_rotate() and
// src/transforms/rotate.h). Multiples of 90 use the exact axis swap (no
// resample, no band change); other angles expand the canvas to the VIPS
// bounding box and sample with bilinear over a transparent background —
// the VIPS side likewise appends an alpha band for non-90 angles, so
// preview and VIPS agree on dims and corners.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface RotateEdit {
  edit: 'rotate';
  /** Clockwise degrees, -180..180. Default 0. */
  angle?: number;
}

type Full = Required<RotateEdit>;

/** Normalize like src/transforms/rotate.h: fmod + wrap to (-180,180]. */
export function normAngle(angle: number): number {
  let a = angle % 360;
  if (a <= -180) a += 360;
  else if (a > 180) a -= 360;
  return a;
}

/** Quarter turns when snapped to a multiple of 90, else null. */
export function snapQuarters(angle: number): number | null {
  const a = normAngle(angle);
  if (a === 0) return 0;
  const q = Math.round(a / 90);
  if (Math.abs(a - q * 90) < 1e-9) return q;
  return null;
}

/** Snapped cos/sin for the shader (exact 0/±1 at multiples of 90). */
export function cosSin(angle: number): { c: number; s: number } {
  const q = snapQuarters(angle);
  if (q !== null) {
    const qq = ((q % 4) + 4) % 4;
    return [
      { c: 1, s: 0 },
      { c: 0, s: 1 },
      { c: -1, s: 0 },
      { c: 0, s: -1 },
    ][qq] as { c: number; s: number };
  }
  const rad = (normAngle(angle) * Math.PI) / 180;
  return { c: Math.cos(rad), s: Math.sin(rad) };
}

/** Bounding box; identical to the VIPS rotate output for all probed sizes. */
export function rotateDims(inW: number, inH: number, params: Full): { w: number; h: number } {
  const q = snapQuarters(params.angle);
  if (q !== null) return ((q % 2) + 2) % 2 === 0 ? { w: inW, h: inH } : { w: inH, h: inW };
  const { c, s } = cosSin(params.angle);
  const ac = Math.abs(c);
  const as = Math.abs(s);
  return { w: Math.round(inW * ac + inH * as), h: Math.round(inW * as + inH * ac) };
}

/**
 * Output origin (top-left of the output in transform space): round() of the
 * forward-mapped bounding-box min, exactly like vips_affine's oarea for
 * vips_rotate (integer texel lattice, texel (i,j) at (i,j); output texel
 * (x,y) samples the input at Minv*(x+ox, y+oy)).
 */
export function rotateOrigin(inW: number, inH: number, params: Full): { ox: number; oy: number } {
  const { c, s } = cosSin(params.angle);
  const xs = [0, c * inW, -s * inH, c * inW - s * inH];
  const ys = [0, s * inW, c * inH, s * inW + c * inH];
  return { ox: Math.round(Math.min(...xs)), oy: Math.round(Math.min(...ys)) };
}

function frag(precision: string): string {
  return `
precision ${precision} float;
uniform sampler2D texture;
uniform float cosA;
uniform float sinA;
uniform vec2 inSize;
uniform vec2 outSize;
uniform vec2 outOrigin;
varying vec2 texCoord;

// One bilinear tap on the integer texel lattice (texel (i,j) at (i,j));
// outside [0,W-1]x[0,H-1] reads the transparent background, exactly like
// the vips_affine embed behind vips_rotate. The 1e-4 epsilon keeps
// near-integer coordinates (float error) on their texel centers.
vec4 tap(vec2 lattice) {
  if (lattice.x < -0.0001 || lattice.x > inSize.x - 1.0 + 0.0001 ||
      lattice.y < -0.0001 || lattice.y > inSize.y - 1.0 + 0.0001) {
    return vec4(0.0);
  }
  return texture2D(texture, (lattice + 0.5) / inSize);
}

void main() {
  // Output texel (x,y) <=> lattice point (x+ox, y+oy), backward-mapped
  // with the inverse rotation (y-down, clockwise-positive).
  vec2 lat = vec2(texCoord.x * outSize.x - 0.5 + outOrigin.x,
                  texCoord.y * outSize.y - 0.5 + outOrigin.y);
  vec2 inp = vec2(cosA * lat.x + sinA * lat.y,
                  -sinA * lat.x + cosA * lat.y);
  vec2 p0 = floor(inp);
  vec2 f = inp - p0;
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;
  vec4 t00 = tap(p0);
  vec4 t10 = tap(p0 + vec2(1.0, 0.0));
  vec4 t01 = tap(p0 + vec2(0.0, 1.0));
  vec4 t11 = tap(p0 + vec2(1.0, 1.0));
  // vips_affine premultiplies alpha before resampling and unpremultiplies
  // after (float path: factor 0 when |alpha| < 0.01, else rgb /= alpha).
  vec3 prgb = t00.rgb * (t00.a * w00) + t10.rgb * (t10.a * w10) +
              t01.rgb * (t01.a * w01) + t11.rgb * (t11.a * w11);
  float pa = t00.a * w00 + t10.a * w10 + t01.a * w01 + t11.a * w11;
  if (abs(pa) < 0.01) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, pa);
  } else {
    gl_FragColor = vec4(prgb / pa, pa);
  }
}
`;
}

const FRAG_HIGH = frag('highp');
const FRAG_MED = frag('mediump');

// Exact multiples of 90 go through vips_rot() on the VIPS side (pixel
// shuffle, no resampling, no band change) — the preview mirrors that with
// a pure UV swizzle (O(1) math, exact under any precision). Quarter q is
// clockwise: out(x,y) = in(y,H-1-x) / in(W-1-x,H-1-y) / in(W-1-y,x).
const FRAG_QUARTER = `
precision mediump float;
uniform sampler2D texture;
uniform int quarter;
varying vec2 texCoord;
void main() {
  vec2 uv = texCoord;
  if (quarter == 1) {
    uv = vec2(texCoord.y, 1.0 - texCoord.x);
  } else if (quarter == 2) {
    uv = vec2(1.0 - texCoord.x, 1.0 - texCoord.y);
  } else if (quarter == 3) {
    uv = vec2(1.0 - texCoord.y, texCoord.x);
  }
  gl_FragColor = texture2D(texture, uv);
}
`;

export class RotateTransform implements Transform<'rotate', RotateEdit> {
  public readonly edit = 'rotate' as const;
  public controls: ParamControl[] = [
    { key: 'angle', label: 'angle °', min: -180, max: 180, step: 1, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'rotate', angle: 0 };
  }

  public validate(params: RotateEdit): string[] {
    if (params.angle !== undefined && !isNumInRange(params.angle, -180, 180))
      return ['angle must be a number in [-180,180]'];
    return [];
  }

  public normalize(params: RotateEdit): Full {
    return { edit: 'rotate', angle: clampf(-180, params.angle ?? 0, 180) };
  }

  public outputDims(inW: number, inH: number, params: Full): { w: number; h: number } {
    return rotateDims(inW, inH, params);
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    const q = snapQuarters(params.angle);
    if (q !== null) {
      const quarter = ((q % 4) + 4) % 4;
      ctx.pass(FRAG_QUARTER, from, to, (gl, p) => {
        const uQ = gl.getUniformLocation(p, 'quarter');
        if (uQ) gl.uniform1i(uQ, quarter);
      });
      return to;
    }
    const { c, s } = cosSin(params.angle);
    const o = rotateOrigin(ctx.width, ctx.height, params);
    const shader = ctx.highp ? FRAG_HIGH : FRAG_MED;
    ctx.pass(shader, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'cosA', c);
      setFloatUniform(gl, p, 'sinA', s);
      const uIn = gl.getUniformLocation(p, 'inSize');
      if (uIn) gl.uniform2f(uIn, ctx.width, ctx.height);
      const uOut = gl.getUniformLocation(p, 'outSize');
      if (uOut) gl.uniform2f(uOut, ctx.outWidth, ctx.outHeight);
      const uOrigin = gl.getUniformLocation(p, 'outOrigin');
      if (uOrigin) gl.uniform2f(uOrigin, o.ox, o.oy);
    });
    return to;
  }
}
