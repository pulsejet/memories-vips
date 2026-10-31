// transforms/flip.h — mirror left-right (horizontal) or top-bottom
// (vertical) via fliphor()/flipver() (exact pixel shuffle, any band
// count). Geometric so the gainmap mirrors with the base image; dims are
// unchanged, so no band juggling applies.
#pragma once

#include "transform.h"

class Flip final : public Transform {
 public:
  explicit Flip(bool vertical = false) : vertical_(vertical) {}

  const char *name() const override { return "flip"; }
  bool is_geometric() const override { return true; }

  VImage apply(VImage im) const override {
    return vertical_ ? im.flipver() : im.fliphor();
  }

 private:
  bool vertical_;
};
