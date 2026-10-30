// math.ts — CPU reference for every edit's pixel math.
//
// These functions are the single source of truth shared (by port, not by
// import) with the GLSL in shaders.ts and the libvips code in src/edit.h:
//   preview (WebGL)  ==  math.ts  ==  VIPS applier
// all operate on sRGB-encoded 0..1 floats and apply in array order.
//
// glfx.js inspiration: brightnessContrast / hueSaturation / sepia / vibrance /
// vignette shaders are direct ports of evanw/glfx.js adjust filters (see
// shaders.ts); the matrix derivations below match those shaders term for term
// so a VIPS `recomb`/`linear` does exactly what the canvas showed.

export function clampf(lo: number, v: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Exposure gain for a stop shift. */
export function exposureMult(stops: number): number {
  return Math.pow(2, clampf(-5, stops, 5));
}

/** 1D gaussian kernel for a blur radius (sigma = radius/2). Preview + docs. */
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
