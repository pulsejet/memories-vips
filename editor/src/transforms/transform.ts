// transform.ts — generic signature every transform implements.
//
// A transform is one named pixel edit (brightnessContrast, sepia, ...).
// The pipeline (pipeline.ts) stays generic: it looks the transform up by
// `edit.edit` in the registry (transforms/index.ts), normalizes params
// through it, and calls apply(). The VIPS side mirrors this shape with an
// `Edit` base class plus one header per transform (src/edits/).
import type { EditName } from '../types.js';

export interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
}

export interface ExtraTex {
  tex: WebGLTexture;
  unit: number;
  name: string;
}

export type UniformSetter = (gl: WebGLRenderingContext, prog: WebGLProgram) => void;

/** What a transform may do: single passes, blits, separable gaussian. */
export interface RenderContext {
  width: number;
  height: number;
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

/** Lookup helper: unknown runtime names yield undefined (guarded by callers). */
export function lookup(
  registry: Record<EditName, Transform<string, object>>,
  name: string,
): Transform<string, object> | undefined {
  return (registry as Record<string, Transform<string, object> | undefined>)[name];
}
