// warmth.ts — white-balance-style temperature shift (red/blue gains).
//
// r *= 1 + 0.3*amount, b *= 1 - 0.3*amount, g unchanged: +1 is warm
// (amber), -1 is cool (blue). Blacks stay black (multiplicative, like a
// white-balance gain). Same factors in src/transforms/warmth.h and
// math.ts warmthGains, so the canvas preview is WYSIWYG.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface WarmthEdit {
  edit: 'warmth';
  /** -1 (cool) .. 1 (warm). Default 0. */
  amount?: number;
}

type Full = Required<WarmthEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float amount;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  color.r *= 1.0 + amount * 0.3;
  color.b *= 1.0 - amount * 0.3;
  gl_FragColor = color;
}
`;

export class WarmthTransform implements Transform<'warmth', WarmthEdit> {
  public readonly edit = 'warmth' as const;
  public controls: ParamControl[] = [
    { key: 'amount', label: 'amount', min: -1, max: 1, step: 0.01, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'warmth', amount: 0 };
  }

  public validate(params: WarmthEdit): string[] {
    if (params.amount !== undefined && !isNumInRange(params.amount, -1, 1))
      return ['amount must be a number in [-1,1]'];
    return [];
  }

  public normalize(params: WarmthEdit): Full {
    return { edit: 'warmth', amount: clampf(-1, params.amount ?? 0, 1) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'amount', params.amount);
    });
    return to;
  }
}
