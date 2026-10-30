// transforms/invert.h — per-pixel inversion.
#pragma once

#include <vector>

#include "transform.h"

class Invert final : public Transform {
 public:
  const char *name() const override { return "invert"; }

  VImage apply(VImage im) const override {
    return im.linear(std::vector<double>{-1.0, -1.0, -1.0},
                     std::vector<double>{1.0, 1.0, 1.0});
  }
};
