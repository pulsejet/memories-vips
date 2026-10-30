// grayscale.ts — channel-average desaturation (== saturation -1).
import type { ParamControl, RenderContext, Target, Transform } from './transform.js';

export interface GrayscaleEdit {
  edit: 'grayscale';
}

type Full = Required<GrayscaleEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  float average = (color.r + color.g + color.b) / 3.0;
  color.rgb = vec3(average);
  gl_FragColor = color;
}
`;

export class GrayscaleTransform implements Transform<'grayscale', GrayscaleEdit> {
  public readonly edit = 'grayscale' as const;
  public controls: ParamControl[] = [];

  public defaults(): Full {
    return { edit: 'grayscale' };
  }

  public validate(_params: GrayscaleEdit): string[] {
    return [];
  }

  public normalize(_params: GrayscaleEdit): Full {
    return { edit: 'grayscale' };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, _params: Full): Target {
    ctx.pass(FRAG, from, to);
    return to;
  }
}
