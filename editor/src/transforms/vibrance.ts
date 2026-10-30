// vibrance.ts — glfx.js vibrance port.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface VibranceEdit {
  edit: 'vibrance';
  /** -1 (muted) .. 1 (max). Default 0. */
  amount?: number;
}

type Full = Required<VibranceEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float amount;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  float average = (color.r + color.g + color.b) / 3.0;
  float mx = max(color.r, max(color.g, color.b));
  float amt = (mx - average) * (-amount * 3.0);
  color.rgb = mix(color.rgb, vec3(mx), amt);
  gl_FragColor = color;
}
`;

export class VibranceTransform implements Transform<'vibrance', VibranceEdit> {
  public readonly edit = 'vibrance' as const;
  public controls: ParamControl[] = [
    { key: 'amount', label: 'amount', min: -1, max: 1, step: 0.01, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'vibrance', amount: 0 };
  }

  public validate(params: VibranceEdit): string[] {
    if (params.amount !== undefined && !isNumInRange(params.amount, -1, 1))
      return ['amount must be a number in [-1,1]'];
    return [];
  }

  public normalize(params: VibranceEdit): Full {
    return { edit: 'vibrance', amount: clampf(-1, params.amount ?? 0, 1) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'amount', params.amount);
    });
    return to;
  }
}
