// blur.ts — separable gaussian with the shared preview kernel
// (see math.ts gaussianKernel; VIPS side: src/transforms/gaussian.h).
import { clampf, gaussianKernel } from '../math.js';
import {
  isNumInRange,
  type ParamControl,
  type RenderContext,
  type Target,
  type Transform,
} from './transform.js';

export interface BlurEdit {
  edit: 'blur';
  /** Gaussian radius in output pixels, 0..100. 0 = no-op. Default 0. */
  radius?: number;
}

type Full = Required<BlurEdit>;

export class BlurTransform implements Transform<'blur', BlurEdit> {
  public readonly edit = 'blur' as const;
  public controls: ParamControl[] = [
    { key: 'radius', label: 'radius px', min: 0, max: 30, step: 0.5, def: 0 },
  ];

  public defaults(): Full {
    return { edit: 'blur', radius: 0 };
  }

  public validate(params: BlurEdit): string[] {
    if (params.radius !== undefined && !isNumInRange(params.radius, 0, 100))
      return ['radius must be a number in [0,100]'];
    return [];
  }

  public normalize(params: BlurEdit): Full {
    return { edit: 'blur', radius: clampf(0, params.radius ?? 0, 100) };
  }

  public apply(ctx: RenderContext, from: Target, to: Target, params: Full): Target {
    const radius = params.radius * ctx.resolutionScale;
    if (radius <= 0) {
      ctx.blit(from, to);
      return to;
    }
    const kernel = gaussianKernel(radius);
    ctx.gauss(from, to, true, kernel);
    ctx.gauss(to, from, false, kernel);
    return from;
  }
}
