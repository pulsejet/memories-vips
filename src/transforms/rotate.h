// transforms/rotate.h — clockwise rotation, exact 90s + arbitrary angles.
//
// angle is clockwise degrees in [-180,180] (matches vips_rotate(), which
// takes clockwise degrees). Multiples of 90 use rot() (exact, no resample,
// no band change). Any other angle expands the canvas to fit and resamples
// with the default interpolator over a transparent background: a 3-band
// input gains an opaque-alpha band first so corners come out transparent
// (and edges get correct semi-transparent fringes) instead of black.
// The editor (editor/src/transforms/rotate.ts) mirrors the direction,
// the 90-degree fast path, and the bounding-box dims.
#pragma once

#include <cmath>
#include <vector>

#include "transform.h"

class Rotate final : public Transform {
 public:
  explicit Rotate(double angle = 0.0) : angle_(angle) {}

  const char *name() const override { return "rotate"; }
  bool is_geometric() const override { return true; }

  /// Works on any band count. 3-band (no alpha) arbitrary angles return
  /// 4-band (transparent corners); everything else preserves band count.
  VImage apply(VImage im) const override {
    double a = std::fmod(angle_, 360.0);
    if (a <= -180.0)
      a += 360.0;
    else if (a > 180.0)
      a -= 360.0;
    if (a == 0.0) return im;

    long q = std::lround(a / 90.0);
    if (std::fabs(a - (double)q * 90.0) < 1e-9) {
      int qq = (int)(((q % 4) + 4) % 4);
      if (qq == 0) return im;
      VipsAngle ang = (qq == 1)   ? VIPS_ANGLE_D90
                      : (qq == 2) ? VIPS_ANGLE_D180
                                  : VIPS_ANGLE_D270;
      return im.rot(ang);
    }

    int nb = im.bands();
    VImage rgba = im;
    if (nb != 2 && nb != 4) {
      // No alpha band: join opaque alpha (float 1.0, matching the 0..1
      // pipeline domain) so the background below reads as transparent.
      VImage alpha = im.extract_band(0) * 0.0 + 1.0;
      rgba = im.bandjoin(alpha);
      nb = rgba.bands();
    }
    std::vector<double> bg((size_t)nb, 0.0);
    return rgba.rotate(a, VImage::option()->set("background", bg));
  }

 private:
  double angle_;
};
