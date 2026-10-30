// transforms/sharpen.h — glfx-style unsharp mask via shared gaussian + mix.
#pragma once

#include "gaussian.h"
#include "transform.h"

class Sharpen final : public Transform {
 public:
  Sharpen(double radius = 2.0, double amount = 0.5)
      : radius_(radius), amount_(amount) {}

  const char *name() const override { return "sharpen"; }

  VImage apply(VImage im) const override {
    if (radius_ <= 0.0 || amount_ <= 0.0) return im;
    VImage blurred = gaussian_blur(im, radius_);
    return im * (1.0 + amount_) - blurred * amount_;
  }

 private:
  double radius_;
  double amount_;
};
