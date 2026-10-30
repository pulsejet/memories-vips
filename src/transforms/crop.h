// transforms/crop.h — relative-rect crop (geometric, resolution-independent).
//
// Params are fractions of the current image size (origin top-left), so the
// same JSON means the same framing at any resolution (preview downscale,
// thumbnail resize, full-res convert). Pixel rect is rounded and clamped
// to [1px, remainder]; the editor (editor/src/transforms/crop.ts) uses the
// identical formula, so preview dims match VIPS dims exactly.
#pragma once

#include <algorithm>
#include <cmath>

#include "transform.h"

class Crop final : public Transform {
 public:
  Crop(double x = 0.0, double y = 0.0, double width = 1.0, double height = 1.0)
      : x_(x), y_(y), w_(width), h_(height) {}

  const char *name() const override { return "crop"; }
  bool is_geometric() const override { return true; }

  /// Works on any band count (RGB float, joined RGBA float, alpha plane):
  /// plain extract_area, no interpolation, metadata preserved by libvips.
  VImage apply(VImage im) const override {
    int W = im.width();
    int H = im.height();
    int left = (int)std::lround(x_ * W);
    int top = (int)std::lround(y_ * H);
    int w = (int)std::lround(w_ * W);
    int h = (int)std::lround(h_ * H);
    left = std::max(0, std::min(left, W - 1));
    top = std::max(0, std::min(top, H - 1));
    w = std::max(1, std::min(w, W - left));
    h = std::max(1, std::min(h, H - top));
    if (left == 0 && top == 0 && w == W && h == H) return im;
    return im.extract_area(left, top, w, h);
  }

 private:
  double x_;
  double y_;
  double w_;
  double h_;
};
