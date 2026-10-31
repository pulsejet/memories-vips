// highlights.ts — boost/recover the bright end, weighted by brightness.
//
// weight w = clamp(avg,0,1)^2 (0 in blacks, 1 in whites, quadratic falloff),
// then rgb += (amount * 0.5) * w. The 0.5 keeps the gray curve monotonic over
// the whole slider range (a full-strength recovery would push white below
// near-white). Same formula in src/transforms/highlights.h and
// math.ts applyHighlights, so the canvas preview is WYSIWYG.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface HighlightsEdit {
  edit: 'highlights';
  /** -1 (recover highlights) .. 1 (boost highlights). Default 0. */
  amount?: number;
}

type Full = Required<HighlightsEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float amount;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  float avg = (color.r + color.g + color.b) / 3.0;
  float l = clamp(avg, 0.0, 1.0);
  float w = l * l;
  color.rgb += (amount * 0.5) * w;
  gl_FragColor = color;
}
`;

export class HighlightsTransform implements Transform<'highlights', HighlightsEdit> {
  public readonly edit = 'highlights' as const;
  public controls: ParamControl[] = [
    { key: 'amount', label: 'amount', min: -1, max: 1, step: 0.01, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'highlights', amount: 0 };
  }

  public validate(params: HighlightsEdit): string[] {
    if (params.amount !== undefined && !isNumInRange(params.amount, -1, 1))
      return ['amount must be a number in [-1,1]'];
    return [];
  }

  public normalize(params: HighlightsEdit): Full {
    return { edit: 'highlights', amount: clampf(-1, params.amount ?? 0, 1) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'amount', params.amount);
    });
    return to;
  }
}
