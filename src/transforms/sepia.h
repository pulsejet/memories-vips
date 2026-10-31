// transforms/sepia.h — glfx sepia coefficients, clipped at final cast.
#pragma once

#include "transform.h"

class Sepia final : public Transform {
 public:
  explicit Sepia(double amount = 1.0) : amount_(amount) {}

  const char *name() const override { return "sepia"; }

  VImage apply(VImage im) const override {
    const double a = amount_;
    const double m[3][3] = {
        {1.0 - 0.607 * a, 0.769 * a, 0.189 * a},
        {0.349 * a, 1.0 - 0.314 * a, 0.168 * a},
        {0.272 * a, 0.534 * a, 1.0 - 0.869 * a},
    };
    return color_matrix(im, m);
  }

 private:
  double amount_;
};
