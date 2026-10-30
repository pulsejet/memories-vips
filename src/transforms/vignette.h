// transforms/vignette.h — edge darkening, closed form of glfx's
// smoothstep(0.8, size*0.799, dist*(amount+size)).
#pragma once

#include <cmath>

#include "transform.h"

class Vignette final : public Transform {
 public:
  Vignette(double size = 0.5, double amount = 0.5)
      : size_(size), amount_(amount) {}

  const char *name() const override { return "vignette"; }

  VImage apply(VImage im) const override {
    double sz = size_, am = amount_;
    return transform_cpu_map(im, [sz, am](float *buf, int w, int h) {
      double e0 = 0.8;
      double e1 = sz * 0.799;
      double denom = e1 - e0;  // never 0 for size in [0,1]
      for (int y = 0; y < h; y++) {
        double y01 = ((double)y + 0.5) / (double)h;
        for (int x = 0; x < w; x++) {
          double x01 = ((double)x + 0.5) / (double)w;
          double dx = x01 - 0.5;
          double dy = y01 - 0.5;
          double dist = std::sqrt(dx * dx + dy * dy);
          double d = dist * (am + sz);
          double t = (d - e0) / denom;
          if (t < 0.0) t = 0.0;
          if (t > 1.0) t = 1.0;
          double s = t * t * (3.0 - 2.0 * t);
          float *p = buf + ((size_t)y * (size_t)w + (size_t)x) * 3u;
          p[0] = (float)(p[0] * s);
          p[1] = (float)(p[1] * s);
          p[2] = (float)(p[2] * s);
        }
      }
    });
  }

 private:
  double size_;
  double amount_;
};
