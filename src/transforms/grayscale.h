// transforms/grayscale.h — channel average replicated to 3 bands.
#pragma once

#include "transform.h"

class Grayscale final : public Transform {
 public:
  const char *name() const override { return "grayscale"; }

  VImage apply(VImage im) const override { return channel_average(im); }
};
