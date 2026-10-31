// math.ts — CPU reference for every edit's pixel math.
//
// These functions are the single source of truth shared (by port, not by
// import) with the GLSL in transforms/ and the libvips code in src/transforms/:
//   preview (WebGL)  ==  math.ts  ==  VIPS applier
// all operate on sRGB-encoded 0..1 floats and apply in array order.
//
// glfx.js inspiration: brightnessContrast / hueSaturation / sepia / vibrance /
// vignette shaders are direct ports of evanw/glfx.js adjust filters, so a VIPS
// `linear` or matrix does exactly what the canvas showed.

export function clampf(lo: number, v: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Exposure gain for a stop shift. */
export function exposureMult(stops: number): number {
  return Math.pow(2, clampf(-5, stops, 5));
}

/** Shadows weight for a clamped 0..1 luma: (1-l)^2 (dark-localized). */
export function shadowsWeight(luma01: number): number {
  const l = clampf(0, luma01, 1);
  return (1 - l) * (1 - l);
}

/** Highlights weight for a clamped 0..1 luma: l^2 (bright-localized). */
export function highlightsWeight(luma01: number): number {
  const l = clampf(0, luma01, 1);
  return l * l;
}

/** Gray-pixel output of the shadows edit: v + (a*0.5)*(1-v)^2.
 *
 * The 0.5 keeps the curve monotonic increasing over the whole amount range
 * (d/dv = 1-2k(1-v) >= 0 for k <= 0.5): without it black would lift past
 * mid-gray at high amounts. Reference for the GLSL in shadows.ts and the
 * loop in src/transforms/shadows.h.
 */
export function applyShadowsGray(v: number, amount: number): number {
  return v + clampf(-1, amount, 1) * 0.5 * shadowsWeight(v);
}

/** Gray-pixel output of the highlights edit: v + (a*0.5)*v^2.
 *
 * The 0.5 keeps the curve monotonic increasing over the whole amount range
 * (d/dv = 1+2kv >= 0 for k >= -0.5): without it white would recover below
 * near-white at high negative amounts. Reference for the GLSL in
 * highlights.ts and the loop in src/transforms/highlights.h.
 */
export function applyHighlightsGray(v: number, amount: number): number {
  return v + clampf(-1, amount, 1) * 0.5 * highlightsWeight(v);
}

/** Red/blue white-balance gains for a warmth amount in [-1,1]. */
export function warmthGains(amount: number): { r: number; b: number } {
  const a = clampf(-1, amount, 1);
  return { r: 1 + a * 0.3, b: 1 - a * 0.3 };
}

/** 1D gaussian kernel for a blur radius (sigma = radius/2). Preview + docs.
 *
 * Single source of truth, ported term-for-term to src/transforms/gaussian.h:
 * both sides convolve these exact weights (separable, clamp edges), so
 * preview and VIPS agree to ±1 LSB at every radius.
 */
export function gaussianKernel(radius: number): number[] {
  const r = clampf(0, radius, 100);
  if (r <= 0) return [1];
  const sigma = r / 2;
  const half = Math.min(15, Math.max(1, Math.ceil(sigma * 2)));
  const w: number[] = [];
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-0.5 * (i / sigma) * (i / sigma));
    w.push(v);
    sum += v;
  }
  return w.map((v) => v / sum);
}
