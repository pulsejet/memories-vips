// transform.ts — generic signature every transform implements.
//
// A transform is one named pixel edit (brightnessContrast, sepia, ...).
// The pipeline (pipeline.ts) stays generic: it looks the transform up by
// `edit.edit` in the registry (transforms/index.ts), normalizes params
// through it, and calls apply(). The VIPS side mirrors this shape with a
// `Transform` base class plus one header per transform (src/transforms/).
import type { EditName } from '../types.js';

export interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  /** Pixel size of the target (targets are reallocated on geometry change). */
  w: number;
  h: number;
}

export interface ExtraTex {
  tex: WebGLTexture;
  unit: number;
  name: string;
}

export type UniformSetter = (gl: WebGLRenderingContext, prog: WebGLProgram) => void;

/** What a transform may do: single passes, blits, separable gaussian. */
export interface RenderContext {
  /** Input (source) size for the current edit. */
  width: number;
  height: number;
  /** Output size for the current edit (differs for crop/rotate). */
  outWidth: number;
  outHeight: number;
  /** Fragment-shader highp support (rotate picks precision accordingly). */
  highp: boolean;
  /** Working/native resolution ratio; pixel-unit radii scale by this (1 when no downscale). */
  resolutionScale: number;
  extra: Target;
  pass(
    frag: string,
    from: Target,
    to: Target,
    setUniforms?: UniformSetter,
    extraTex?: ExtraTex,
  ): void;
  blit(from: Target, to: Target): void;
  gauss(from: Target, to: Target, horizontal: boolean, kernel: number[]): void;
}

export interface ParamControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export interface Transform<Name extends string, P extends object> {
  /** Discriminator, e.g. 'sepia'. Matches the "edit" JSON key. */
  readonly edit: Name;
  /** No-change params (used by Add flows and normalize()). */
  defaults(): Required<P>;
  /** Slider schema for generic UIs (demo). */
  controls: ParamControl[];
  /** Human-readable problems; empty means VIPS-appliable. */
  validate(params: P): string[];
  /** Fill defaults + clamp, so output always passes validate(). */
  normalize(params: P): Required<P>;
  /** Render one edit reading `from`, writing `to`; returns result target. */
  apply(ctx: RenderContext, from: Target, to: Target, params: Required<P>): Target;
  /**
   * Output size for the given input size (pixel ops omit this: identity).
   * Geometric edits (crop/rotate) implement it with the exact VIPS formula
   * so the pipeline can pre-size `to`; `apply` must fill exactly that.
   */
  outputDims?(inW: number, inH: number, params: Required<P>): { w: number; h: number };
}

/** Number in [lo,hi], finite. Shared range check for validate(). */
export function isNumInRange(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

export function setFloatUniform(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  name: string,
  value: number,
): void {
  const u = gl.getUniformLocation(prog, name);
  if (u) gl.uniform1f(u, value);
}

/** Unknown runtime names (including Object.prototype keys) yield undefined. */
export function lookup(
  registry: Record<EditName, Transform<string, object>>,
  name: unknown,
): Transform<string, object> | undefined {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(registry, name)) {
    return undefined;
  }
  return registry[name as EditName];
}
