// exposure.ts — stop-based gain (2^stops).
import { clampf, exposureMult } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface ExposureEdit {
  edit: 'exposure';
  /** Exposure shift in stops, -5..5. Pixel gain is 2^stops. Default 0. */
  stops?: number;
}

type Full = Required<ExposureEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float mult;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  color.rgb *= mult;
  gl_FragColor = color;
}
`;

export class ExposureTransform implements Transform<'exposure', ExposureEdit> {
  public readonly edit = 'exposure' as const;
  public controls: ParamControl[] = [
    { key: 'stops', label: 'stops', min: -5, max: 5, step: 0.05, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'exposure', stops: 0 };
  }

  public validate(params: ExposureEdit): string[] {
    if (params.stops !== undefined && !isNumInRange(params.stops, -5, 5))
      return ['stops must be a number in [-5,5]'];
    return [];
  }

  public normalize(params: ExposureEdit): Full {
    return { edit: 'exposure', stops: clampf(-5, params.stops ?? 0, 5) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    const mult = exposureMult(params.stops);
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'mult', mult);
    });
    return to;
  }
}
