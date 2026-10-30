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
    if (hue_ == 0.0 && saturation_ == -1.0) {
      // Fully desaturated with no rotation: identical to the grayscale
      // transform (and to the preview shader, which lerps 100% to the
      // channel average here) instead of ±1 LSB off.
      VImage r = im.extract_band(0);
      VImage g = im.extract_band(1);
      VImage b = im.extract_band(2);
      VImage avg = (r + g + b) / 3.0;
      return avg.bandjoin(avg).bandjoin(avg);
    }
    const double kPi = 3.14159265358979323846;
    double angle = hue_ * kPi;
    double sn = std::sin(angle);
    double cs = std::cos(angle);
    double sq3 = std::sqrt(3.0);
    double wx = (2.0 * cs + 1.0) / 3.0;
    double wy = (-sq3 * sn - cs + 1.0) / 3.0;
    double wz = (sq3 * sn - cs + 1.0) / 3.0;
    // H rows.
    double h00 = wx, h01 = wy, h02 = wz;
    double h10 = wz, h11 = wx, h12 = wy;
    double h20 = wy, h21 = wz, h22 = wx;
    double t =
        (saturation_ > 0.0) ? 1.0 - 1.0 / (1.001 - saturation_) : -saturation_;
    double k = 1.0 - t;
    double d = k + t / 3.0;
    double o = t / 3.0;
    // M = S*H.
    double m[3][3];
    double H[3][3] = {
        {h00, h01, h02}, {h10, h11, h12}, {h20, h21, h22}};
    double S[3][3] = {{d, o, o}, {o, d, o}, {o, o, d}};
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++)
        m[i][j] = S[i][0] * H[0][j] + S[i][1] * H[1][j] + S[i][2] * H[2][j];
    VImage r = im.extract_band(0);
    VImage g = im.extract_band(1);
    VImage b = im.extract_band(2);
    VImage or_ = r * m[0][0] + g * m[0][1] + b * m[0][2];
    VImage og = r * m[1][0] + g * m[1][1] + b * m[1][2];
    VImage ob = r * m[2][0] + g * m[2][1] + b * m[2][2];
    return or_.bandjoin(og).bandjoin(ob);
  }

 private:
  double hue_;
  double saturation_;
};
