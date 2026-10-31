// flip.ts — mirror left-right (horizontal) or top-bottom (vertical).
//
// Pure UV swizzle (like rotate's quarter-turn path): exact under any
// precision, dims unchanged, alpha mirrors along untouched. The VIPS side
// (src/transforms/flip.h) uses fliphor()/flipver() and marks the edit
// geometric so the gainmap mirrors with the base image.
import type { ParamControl, RenderContext, Target, Transform } from './transform.js';

export type FlipDirection = 'horizontal' | 'vertical';

export interface FlipEdit {
  edit: 'flip';
  /** Mirror axis: 'horizontal' mirrors left-right. Default 'horizontal'. */
  direction?: FlipDirection;
}

type Full = Required<FlipEdit>;

const FRAG = `
precision mediump float;
uniform sampler2D texture;
uniform int vertical;
varying vec2 texCoord;
void main() {
  vec2 uv = vertical == 1
    ? vec2(texCoord.x, 1.0 - texCoord.y)
    : vec2(1.0 - texCoord.x, texCoord.y);
  gl_FragColor = texture2D(texture, uv);
}
`;

export class FlipTransform implements Transform<'flip', FlipEdit> {
  public readonly edit = 'flip' as const;
  public controls: ParamControl[] = [];

  public defaults(): Full {
    return { edit: 'flip', direction: 'horizontal' };
  }

  public validate(params: FlipEdit): string[] {
    if (
      params.direction !== undefined &&
      params.direction !== 'horizontal' &&
      params.direction !== 'vertical'
    )
      return ['direction must be "horizontal" or "vertical"'];
    return [];
  }

  public normalize(params: FlipEdit): Full {
    return {
      edit: 'flip',
      direction: params.direction === 'vertical' ? 'vertical' : 'horizontal',
    };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    ctx.pass(FRAG, from, to, (gl, p) => {
      const uV = gl.getUniformLocation(p, 'vertical');
      if (uV) gl.uniform1i(uV, params.direction === 'vertical' ? 1 : 0);
    });
    return to;
  }
}
