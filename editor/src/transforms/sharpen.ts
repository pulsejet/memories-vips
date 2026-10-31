// sharpen.ts — glfx-style unsharp mask (gaussian + mix).
import { clampf, gaussianKernel } from '../math.js';
import {
  isNumInRange,
  setFloatUniform,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface SharpenEdit {
  edit: 'sharpen';
  /** Blur radius for the unsharp mask, in pixels, 0..50. Default 2. */
  radius?: number;
  /** 0 (no change) .. 5. Default 0.5. */
  amount?: number;
}

type Full = Required<SharpenEdit>;

const MIX_FRAG = `
precision mediump float;
uniform sampler2D blurredTexture;
uniform sampler2D originalTexture;
uniform float strength;
varying vec2 texCoord;
void main() {
  vec4 blurred = texture2D(blurredTexture, texCoord);
  vec4 original = texture2D(originalTexture, texCoord);
  gl_FragColor = vec4(mix(blurred.rgb, original.rgb, 1.0 + strength), original.a);
}
`;

export class SharpenTransform implements Transform<'sharpen', SharpenEdit> {
  public readonly edit = 'sharpen' as const;
  public controls: ParamControl[] = [
    { key: 'radius', label: 'radius px', min: 0, max: 20, step: 0.5, def: 2 },
    { key: 'amount', label: 'amount', min: 0, max: 5, step: 0.05, def: 0.5 },
  ];

  public defaults(): Full {
    return { edit: 'sharpen', radius: 2, amount: 0.5 };
  }

  public validate(params: SharpenEdit): string[] {
    const errs: string[] = [];
    if (params.radius !== undefined && !isNumInRange(params.radius, 0, 50))
      errs.push('radius must be a number in [0,50]');
    if (params.amount !== undefined && !isNumInRange(params.amount, 0, 5))
      errs.push('amount must be a number in [0,5]');
    return errs;
  }

  public normalize(params: SharpenEdit): Full {
    return {
      edit: 'sharpen',
      radius: clampf(0, params.radius ?? 2, 50),
      amount: clampf(0, params.amount ?? 0.5, 5),
    };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    const radius = params.radius * ctx.resolutionScale;
    if (radius <= 0 || params.amount <= 0) {
      ctx.blit(from, to);
      return to;
    }
    ctx.blit(from, ctx.extra);
    const kernel = gaussianKernel(radius);
    ctx.gauss(from, to, true, kernel);
    ctx.gauss(to, from, false, kernel);
    ctx.pass(
      MIX_FRAG,
      from,
      to,
      (gl, p) => {
        const uB = gl.getUniformLocation(p, 'blurredTexture');
        if (uB) gl.uniform1i(uB, 0);
        setFloatUniform(gl, p, 'strength', params.amount);
      },
      { tex: ctx.extra.tex, unit: 1, name: 'originalTexture' },
    );
    return to;
  }
}
