// transforms/exposure.h — stop-based gain (2^stops).
#pragma once

#include <cmath>
#include <vector>

#include "transform.h"

class Exposure final : public Transform {
 public:
  explicit Exposure(double stops = 0.0) : stops_(stops) {}

  const char *name() const override { return "exposure"; }

  VImage apply(VImage im) const override {
    double m = std::pow(2.0, stops_);
    return im.linear(std::vector<double>{m, m, m},
                     std::vector<double>{0.0, 0.0, 0.0});
  }

 private:
  double stops_;
};
