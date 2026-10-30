// hueSaturation.ts — glfx.js hue/saturation port.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface HueSaturationEdit {
  edit: 'hueSaturation';
  /** Hue rotation, -1 (-180deg) .. 1 (+180deg). Default 0. */
  hue?: number;
  /** Saturation, -1 (gray) .. 1 (max). Default 0. */
  saturation?: number;
}

type Full = Required<HueSaturationEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float hue;
uniform float saturation;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);

  float angle = hue * 3.14159265;
  float s = sin(angle), c = cos(angle);
  vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
  color.rgb = vec3(
    dot(color.rgb, weights.xyz),
    dot(color.rgb, weights.zxy),
    dot(color.rgb, weights.yzx)
  );

  float average = (color.r + color.g + color.b) / 3.0;
  if (saturation > 0.0) {
    color.rgb += (average - color.rgb) * (1.0 - 1.0 / (1.001 - saturation));
  } else {
    color.rgb += (average - color.rgb) * (-saturation);
  }

  gl_FragColor = color;
}
`;

export class HueSaturationTransform implements Transform<'hueSaturation', HueSaturationEdit> {
  public readonly edit = 'hueSaturation' as const;
  public controls: ParamControl[] = [
    { key: 'hue', label: 'hue', min: -1, max: 1, step: 0.01, def: 0 },
    { key: 'saturation', label: 'saturation', min: -1, max: 1, step: 0.01, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'hueSaturation', hue: 0, saturation: 0 };
  }

  public validate(params: HueSaturationEdit): string[] {
    const errs: string[] = [];
    if (params.hue !== undefined && !isNumInRange(params.hue, -1, 1))
      errs.push('hue must be a number in [-1,1]');
    if (params.saturation !== undefined && !isNumInRange(params.saturation, -1, 1))
      errs.push('saturation must be a number in [-1,1]');
    return errs;
  }

  public normalize(params: HueSaturationEdit): Full {
    return {
      edit: 'hueSaturation',
      hue: clampf(-1, params.hue ?? 0, 1),
      saturation: clampf(-1, params.saturation ?? 0, 1),
    };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'hue', params.hue);
      setFloatUniform(gl, p, 'saturation', params.saturation);
    });
    return to;
  }
}
