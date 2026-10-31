// brightnessContrast.ts — glfx.js brightness/contrast port.
import { clampf } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface BrightnessContrastEdit {
  edit: 'brightnessContrast';
  /** Additive brightness, -1 (solid black) .. 1 (solid white). Default 0. */
  brightness?: number;
  /** Contrast, -1 (solid gray) .. 1 (max). Default 0. */
  contrast?: number;
}

type Full = Required<BrightnessContrastEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform float brightness;
uniform float contrast;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  color.rgb += brightness;
  if (contrast > 0.0) {
    color.rgb = (color.rgb - 0.5) / max(1.0 - contrast, 0.0009765625) + 0.5;
  } else {
    color.rgb = (color.rgb - 0.5) * (1.0 + contrast) + 0.5;
  }
  gl_FragColor = color;
}
`;

export class BrightnessContrastTransform implements Transform<
  'brightnessContrast',
  BrightnessContrastEdit
> {
  public readonly edit = 'brightnessContrast' as const;
  public controls: ParamControl[] = [
    { key: 'brightness', label: 'brightness', min: -1, max: 1, step: 0.01, def: 0 },
    { key: 'contrast', label: 'contrast', min: -1, max: 1, step: 0.01, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'brightnessContrast', brightness: 0, contrast: 0 };
  }

  public validate(params: BrightnessContrastEdit): string[] {
    const errs: string[] = [];
    if (params.brightness !== undefined && !isNumInRange(params.brightness, -1, 1))
      errs.push('brightness must be a number in [-1,1]');
    if (params.contrast !== undefined && !isNumInRange(params.contrast, -1, 1))
      errs.push('contrast must be a number in [-1,1]');
    return errs;
  }

  public normalize(params: BrightnessContrastEdit): Full {
    return {
      edit: 'brightnessContrast',
      brightness: clampf(-1, params.brightness ?? 0, 1),
      contrast: clampf(-1, params.contrast ?? 0, 1),
    };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      setFloatUniform(gl, p, 'brightness', params.brightness);
      setFloatUniform(gl, p, 'contrast', params.contrast);
    });
    return to;
  }
}
