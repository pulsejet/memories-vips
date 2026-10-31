// transforms/hue_saturation.h — gray-axis rotation + saturation, fused to
// one 3x3 (M = S*H) applied as band arithmetic (== recomb).
#pragma once

#include <cmath>

#include "transform.h"

class HueSaturation final : public Transform {
 public:
  HueSaturation(double hue = 0.0, double saturation = 0.0)
      : hue_(hue), saturation_(saturation) {}

  const char *name() const override { return "hueSaturation"; }

  VImage apply(VImage im) const override {
    // Fully desaturated with no rotation: identical to the grayscale
    // transform (and to the preview shader, which lerps 100% to the channel
    // average here) instead of ±1 LSB off.
    if (hue_ == 0.0 && saturation_ == -1.0) return channel_average(im);

    const double angle = hue_ * M_PI;
    const double sn = std::sin(angle), cs = std::cos(angle);
    const double sq3 = std::sqrt(3.0);
    const double wx = (2.0 * cs + 1.0) / 3.0;
    const double wy = (-sq3 * sn - cs + 1.0) / 3.0;
    const double wz = (sq3 * sn - cs + 1.0) / 3.0;
    const double H[3][3] = {{wx, wy, wz}, {wz, wx, wy}, {wy, wz, wx}};

    const double t =
        (saturation_ > 0.0) ? 1.0 - 1.0 / (1.001 - saturation_) : -saturation_;
    const double d = 1.0 - t + t / 3.0, o = t / 3.0;
    const double S[3][3] = {{d, o, o}, {o, d, o}, {o, o, d}};

    double m[3][3];  // M = S*H
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++)
        m[i][j] = S[i][0] * H[0][j] + S[i][1] * H[1][j] + S[i][2] * H[2][j];
    return color_matrix(im, m);
  }

 private:
  double hue_;
  double saturation_;
};
