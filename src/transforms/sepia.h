// transforms/sepia.h — glfx sepia coefficients, clipped at final cast.
#pragma once

#include "transform.h"

class Sepia final : public Transform {
 public:
  explicit Sepia(double amount = 1.0) : amount_(amount) {}

  const char *name() const override { return "sepia"; }

  VImage apply(VImage im) const override {
    double a = amount_;
    VImage r = im.extract_band(0);
    VImage g = im.extract_band(1);
    VImage b = im.extract_band(2);
    VImage or_ = r * (1.0 - 0.607 * a) + g * (0.769 * a) + b * (0.189 * a);
    VImage og = r * (0.349 * a) + g * (1.0 - 0.314 * a) + b * (0.168 * a);
    VImage ob = r * (0.272 * a) + g * (0.534 * a) + b * (1.0 - 0.869 * a);
    return or_.bandjoin(og).bandjoin(ob);
  }

 private:
  double amount_;
};
