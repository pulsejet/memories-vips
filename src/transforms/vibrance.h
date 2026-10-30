// transforms/vibrance.h — per-pixel vibrance (nonlinear: amt varies per
// pixel, so no recomb). Identical loop to the preview shader.
#pragma once

#include "transform.h"

class Vibrance final : public Transform {
 public:
  explicit Vibrance(double amount = 0.0) : amount_(amount) {}

  const char *name() const override { return "vibrance"; }

  VImage apply(VImage im) const override {
    double a = amount_;
    return transform_cpu_map(im, [a](float *buf, int w, int h) {
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          float *p = buf + ((size_t)y * (size_t)w + (size_t)x) * 3u;
          float r = p[0], g = p[1], b = p[2];
          float avg = (r + g + b) / 3.0f;
          float mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
          float amt = (mx - avg) * (float)(-a * 3.0);
          float k = 1.0f - amt;
          p[0] = r * k + mx * amt;
          p[1] = g * k + mx * amt;
          p[2] = b * k + mx * amt;
        }
      }
    });
  }

 private:
  double amount_;
};
