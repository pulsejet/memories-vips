// transforms/sharpen.h — glfx-style unsharp mask via gaussblur + mix.
#pragma once

#include "transform.h"

class Sharpen final : public Transform {
 public:
  Sharpen(double radius = 2.0, double amount = 0.5)
      : radius_(radius), amount_(amount) {}

  const char *name() const override { return "sharpen"; }

  VImage apply(VImage im) const override {
    if (radius_ <= 0.0 || amount_ <= 0.0) return im;
    VImage blurred = im.gaussblur(radius_ / 2.0);
    return im * (1.0 + amount_) - blurred * amount_;
  }

 private:
  double radius_;
  double amount_;
};
