// transforms/blur.h — separable gaussian with the shared preview kernel.
#pragma once

#include "gaussian.h"
#include "transform.h"

class Blur final : public Transform {
 public:
  explicit Blur(double radius = 0.0) : radius_(radius) {}

  const char *name() const override { return "blur"; }

  VImage apply(VImage im) const override { return gaussian_blur(im, radius_); }

 private:
  double radius_;
};
