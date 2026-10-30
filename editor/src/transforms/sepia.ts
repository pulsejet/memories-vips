// sepia.ts — glfx.js sepia port.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface SepiaEdit {
  edit: 'sepia';
  /** 0 (original) .. 1 (full sepia). Default 1. */
  amount?: number;
}

type Full = Required<SepiaEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float amount;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  float r = color.r;
  float g = color.g;
  float b = color.b;
  color.r = min(1.0, (r * (1.0 - (0.607 * amount))) + (g * (0.769 * amount)) + (b * (0.189 * amount)));
  color.g = min(1.0, (r * 0.349 * amount) + (g * (1.0 - (0.314 * amount))) + (b * 0.168 * amount));
  color.b = min(1.0, (r * 0.272 * amount) + (g * 0.534 * amount) + (b * (1.0 - (0.869 * amount))));
  gl_FragColor = color;
}
`;

export class SepiaTransform implements Transform<'sepia', SepiaEdit> {
  public readonly edit = 'sepia' as const;
  public controls: ParamControl[] = [
    { key: 'amount', label: 'amount', min: 0, max: 1, step: 0.01, def: 1 },
  ];

  public defaults(): Full {
    return { edit: 'sepia', amount: 1 };
  }

  public validate(params: SepiaEdit): string[] {
    if (params.amount !== undefined && !isNumInRange(params.amount, 0, 1))
      return ['amount must be a number in [0,1]'];
    return [];
  }

  public normalize(params: SepiaEdit): Full {
    return { edit: 'sepia', amount: clampf(0, params.amount ?? 1, 1) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'amount', params.amount);
    });
    return to;
  }
}
