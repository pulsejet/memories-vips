// vignette.ts — glfx.js vignette port (closed-form smoothstep).
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface VignetteEdit {
  edit: 'vignette';
  /** 0 (center) .. 1 (edge). Default 0.5. */
  size?: number;
  /** 0 (none) .. 1 (max darkening). Default 0.5. */
  amount?: number;
}

type Full = Required<VignetteEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float size;
uniform float amount;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  float dx = texCoord.x - 0.5;
  float dy = texCoord.y - 0.5;
  float dist = sqrt(dx * dx + dy * dy);
  float d = dist * (amount + size);
  float e0 = 0.8;
  float e1 = size * 0.799;
  float t = clamp((d - e0) / (e1 - e0), 0.0, 1.0);
  float s = t * t * (3.0 - 2.0 * t);
  color.rgb *= s;
  gl_FragColor = color;
}
`;

export class VignetteTransform implements Transform<'vignette', VignetteEdit> {
  public readonly edit = 'vignette' as const;
  public controls: ParamControl[] = [
    { key: 'size', label: 'size', min: 0, max: 1, step: 0.01, def: 0.5 },
    { key: 'amount', label: 'amount', min: 0, max: 1, step: 0.01, def: 0.5 },
  ];

  public defaults(): Full {
    return { edit: 'vignette', size: 0.5, amount: 0.5 };
  }

  public validate(params: VignetteEdit): string[] {
    const errs: string[] = [];
    if (params.size !== undefined && !isNumInRange(params.size, 0, 1))
      errs.push('size must be a number in [0,1]');
    if (params.amount !== undefined && !isNumInRange(params.amount, 0, 1))
      errs.push('amount must be a number in [0,1]');
    return errs;
  }

  public normalize(params: VignetteEdit): Full {
    return {
      edit: 'vignette',
      size: clampf(0, params.size ?? 0.5, 1),
      amount: clampf(0, params.amount ?? 0.5, 1),
    };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'size', params.size);
      setFloatUniform(gl, p, 'amount', params.amount);
    });
    return to;
  }
}
