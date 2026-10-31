// transforms/brightness_contrast.h — glfx brightness/contrast as one linear.
#pragma once

#include <vector>

#include "transform.h"

class BrightnessContrast final : public Transform {
 public:
  BrightnessContrast(double brightness = 0.0, double contrast = 0.0)
      : brightness_(brightness), contrast_(contrast) {}

  const char *name() const override { return "brightnessContrast"; }

  VImage apply(VImage im) const override {
    double mult = (contrast_ > 0.0) ? 1.0 / (1.0 - contrast_) : 1.0 + contrast_;
    double bias = mult * (brightness_ - 0.5) + 0.5;
    return im.linear(std::vector<double>{mult, mult, mult},
                     std::vector<double>{bias, bias, bias});
  }

 private:
  double brightness_;
  double contrast_;
};
