// transforms/shadows.h — lift/crush the dark end (nonlinear weight, so a
// CPU loop rather than linear). Identical loop to the preview shader.
#pragma once

#include <algorithm>

#include "transform.h"

class Shadows final : public Transform {
 public:
  explicit Shadows(double amount = 0.0) : amount_(amount) {}

  const char *name() const override { return "shadows"; }

  VImage apply(VImage im) const override {
    double a = amount_;
    return transform_cpu_map(im, [a](float *buf, int w, int h) {
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          float *p = buf + ((size_t)y * (size_t)w + (size_t)x) * 3u;
          float avg = (p[0] + p[1] + p[2]) / 3.0f;
          float l = std::min(1.0f, std::max(0.0f, avg));
          float wt = (1.0f - l) * (1.0f - l);
          float d = (float)(a * 0.5) * wt;
          p[0] += d;
          p[1] += d;
          p[2] += d;
        }
      }
    });
  }

 private:
  double amount_;
};
