// invert.ts — per-pixel inversion.
import type { ParamControl, RenderContext, Target, Transform } from './transform.js';

export interface InvertEdit {
  edit: 'invert';
}

type Full = Required<InvertEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
varying vec2 texCoord;
void main() {
  vec4 color = texture2D(texture, texCoord);
  color.rgb = 1.0 - color.rgb;
  gl_FragColor = color;
}
`;

export class InvertTransform implements Transform<'invert', InvertEdit> {
  public readonly edit = 'invert' as const;
  public controls: ParamControl[] = [];

  public defaults(): Full {
    return { edit: 'invert' };
  }

  public validate(_params: InvertEdit): string[] {
    return [];
  }

  public normalize(_params: InvertEdit): Full {
    return { edit: 'invert' };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, _params: Full): Target {
    ctx.pass(FRAG, from, to);
    return to;
  }
}
