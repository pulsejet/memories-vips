// transforms/blur.h — separable gaussian (sigma = radius/2).
#pragma once

#include "transform.h"

class Blur final : public Transform {
 public:
  explicit Blur(double radius = 0.0) : radius_(radius) {}

  const char *name() const override { return "blur"; }

  VImage apply(VImage im) const override {
    if (radius_ <= 0.0) return im;
    return im.gaussblur(radius_ / 2.0);
  }

 private:
  double radius_;
};
