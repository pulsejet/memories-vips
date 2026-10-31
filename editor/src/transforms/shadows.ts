// shadows.ts — lift/crush the dark end, weighted by darkness.
//
// weight w = (1 - clamp(avg,0,1))^2 (1 in blacks, 0 in whites, quadratic
// falloff), then rgb += (amount * 0.5) * w. The 0.5 keeps the gray curve
// monotonic over the whole slider range (a full-strength lift would reverse
// deep shadows past mid-gray). Same formula in src/transforms/shadows.h
// and math.ts applyShadows, so the canvas preview is WYSIWYG.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface ShadowsEdit {
  edit: 'shadows';
  /** -1 (crush shadows) .. 1 (lift shadows). Default 0. */
  amount?: number;
}

type Full = Required<ShadowsEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float amount;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  float avg = (color.r + color.g + color.b) / 3.0;
  float l = clamp(avg, 0.0, 1.0);
  float w = (1.0 - l) * (1.0 - l);
  color.rgb += (amount * 0.5) * w;
  gl_FragColor = color;
}
`;

export class ShadowsTransform implements Transform<'shadows', ShadowsEdit> {
  public readonly edit = 'shadows' as const;
  public controls: ParamControl[] = [
    { key: 'amount', label: 'amount', min: -1, max: 1, step: 0.01, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'shadows', amount: 0 };
  }

  public validate(params: ShadowsEdit): string[] {
    if (params.amount !== undefined && !isNumInRange(params.amount, -1, 1))
      return ['amount must be a number in [-1,1]'];
    return [];
  }

  public normalize(params: ShadowsEdit): Full {
    return { edit: 'shadows', amount: clampf(-1, params.amount ?? 0, 1) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'amount', params.amount);
    });
    return to;
  }
}
