// transforms/gaussian.h — discrete gaussian kernel shared with the preview.
//
// Must stay bit-identical to editor/src/math.ts::gaussianKernel:
//   sigma = radius/2, half = min(15, max(1, ceil(2*sigma))),
//   w[i] = exp(-0.5*(i/sigma)^2), normalized to sum 1.
// Blur/sharpen convolve with this exact mask (convsep, float precision,
// clamp edges) instead of gaussblur, whose integer precision, min_ampl 0.2
// truncation, and uncapped mask size all diverge from the WebGL preview
// (notably radius > ~15, where the preview's 31-tap shader cap truncates
// the tails and gaussblur does not).
#pragma once

#include <cmath>
#include <vector>

#include "transform.h"

/// 1D kernel weights for a blur radius (mirrors math.ts gaussianKernel).
inline std::vector<double> gaussian_weights(double radius) {
  double r = radius;
  if (r < 0.0) r = 0.0;
  if (r > 100.0) r = 100.0;
  if (r <= 0.0) return {1.0};
  double sigma = r / 2.0;
  int half = (int)std::ceil(sigma * 2.0);
  if (half < 1) half = 1;
  if (half > 15) half = 15;
  std::vector<double> w;
  w.reserve((size_t)(2 * half + 1));
  double sum = 0.0;
  for (int i = -half; i <= half; i++) {
    double v = std::exp(-0.5 * (i / sigma) * (i / sigma));
    w.push_back(v);
    sum += v;
  }
  for (double &v : w) v /= sum;
  return w;
}

/// Separable blur with the shared kernel. Mask is 1xn (convsep applies it
/// horizontally, then rotated 90 degrees — same order as the preview's
/// two gauss() passes). Float precision keeps the exact weights;
/// convolution edge handling is extend-copy, matching CLAMP_TO_EDGE.
inline VImage gaussian_blur(VImage im, double radius) {
  if (radius <= 0.0) return im;
  std::vector<double> w = gaussian_weights(radius);
  int n = (int)w.size();
  VImage mask = VImage::new_matrix(n, 1, w.data(), n);
  return im.convsep(mask, VImage::option()->set("precision", VIPS_PRECISION_FLOAT));
}
