// transforms/grayscale.h — channel average replicated to 3 bands.
#pragma once

#include "transform.h"

class Grayscale final : public Transform {
 public:
  const char *name() const override { return "grayscale"; }

  VImage apply(VImage im) const override {
    VImage r = im.extract_band(0);
    VImage g = im.extract_band(1);
    VImage b = im.extract_band(2);
    VImage avg = (r + g + b) / 3.0;
    return avg.bandjoin(avg).bandjoin(avg);
  }
};
