// transforms/warmth.h — white-balance-style temperature shift as one
// per-channel linear (red/blue gains, green fixed).
#pragma once

#include <vector>

#include "transform.h"

class Warmth final : public Transform {
 public:
  explicit Warmth(double amount = 0.0) : amount_(amount) {}

  const char *name() const override { return "warmth"; }

  VImage apply(VImage im) const override {
    double rm = 1.0 + amount_ * 0.3;
    double bm = 1.0 - amount_ * 0.3;
    return im.linear(std::vector<double>{rm, 1.0, bm},
                     std::vector<double>{0.0, 0.0, 0.0});
  }

 private:
  double amount_;
};
