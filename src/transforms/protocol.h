// transforms/protocol.h — parse the "edits" array into concrete Transforms.
//
// Mirrors editor/src/transforms/index.ts: one branch per edit name that
// constructs the matching Transform subclass (validating params through
// transform_param(), so defaults and ranges agree with the editor).
// image.h then runs the ordered list through apply_transforms().
#pragma once

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "json.hpp"
#include "blur.h"
#include "brightness_contrast.h"
#include "exposure.h"
#include "grayscale.h"
#include "hue_saturation.h"
#include "invert.h"
#include "sepia.h"
#include "sharpen.h"
#include "transform.h"
#include "vibrance.h"
#include "vignette.h"

using nlohmann::json;

/// Fetch an optional numeric transform param: missing -> @p dflt, else it
/// must be a number in [lo,hi]. Throws with an edits[i].key-qualified message.
inline double transform_param(const json &o, int idx, const char *key,
                              double dflt, double lo, double hi) {
  if (!o.contains(key)) return dflt;
  if (!o.at(key).is_number())
    throw std::runtime_error(std::string("edits[") + std::to_string(idx) +
                             "]." + key + " must be a number");
  double d = o.at(key).get<double>();
  if (!(d >= lo && d <= hi))
    throw std::runtime_error(std::string("edits[") + std::to_string(idx) +
                             "]." + key + " out of range");
  return d;
}

/// Parse the optional "edits" array (thumbnail/convert only) into an
/// ordered list of concrete Transforms. Missing -> []. Unknown fields
/// besides the known params are ignored (forward compat).
inline std::vector<TransformPtr> parse_transforms(const json &j) {
  std::vector<TransformPtr> out;
  if (!j.contains("edits")) return out;
  const json &arr = j.at("edits");
  if (!arr.is_array())
    throw std::runtime_error("\"edits\" must be an array");
  for (size_t i = 0; i < arr.size(); i++) {
    const json &o = arr.at(i);
    int idx = (int)i;
    if (!o.is_object())
      throw std::runtime_error(std::string("edits[") + std::to_string(idx) +
                               "] must be an object");
    if (!o.contains("edit") || !o.at("edit").is_string())
      throw std::runtime_error(std::string("edits[") + std::to_string(idx) +
                               "] missing string \"edit\"");
    std::string name = o.at("edit").get<std::string>();
    if (name == "brightnessContrast") {
      out.push_back(std::make_unique<BrightnessContrast>(
          transform_param(o, idx, "brightness", 0.0, -1.0, 1.0),
          transform_param(o, idx, "contrast", 0.0, -1.0, 1.0)));
    } else if (name == "exposure") {
      out.push_back(std::make_unique<Exposure>(
          transform_param(o, idx, "stops", 0.0, -5.0, 5.0)));
    } else if (name == "hueSaturation") {
      out.push_back(std::make_unique<HueSaturation>(
          transform_param(o, idx, "hue", 0.0, -1.0, 1.0),
          transform_param(o, idx, "saturation", 0.0, -1.0, 1.0)));
    } else if (name == "sepia") {
      out.push_back(std::make_unique<Sepia>(
          transform_param(o, idx, "amount", 1.0, 0.0, 1.0)));
    } else if (name == "vibrance") {
      out.push_back(std::make_unique<Vibrance>(
          transform_param(o, idx, "amount", 0.0, -1.0, 1.0)));
    } else if (name == "blur") {
      out.push_back(std::make_unique<Blur>(
          transform_param(o, idx, "radius", 0.0, 0.0, 100.0)));
    } else if (name == "sharpen") {
      out.push_back(std::make_unique<Sharpen>(
          transform_param(o, idx, "radius", 2.0, 0.0, 50.0),
          transform_param(o, idx, "amount", 0.5, 0.0, 5.0)));
    } else if (name == "vignette") {
      out.push_back(std::make_unique<Vignette>(
          transform_param(o, idx, "size", 0.5, 0.0, 1.0),
          transform_param(o, idx, "amount", 0.5, 0.0, 1.0)));
    } else if (name == "invert") {
      out.push_back(std::make_unique<Invert>());
    } else if (name == "grayscale") {
      out.push_back(std::make_unique<Grayscale>());
    } else {
      throw std::runtime_error(std::string("edits[") + std::to_string(idx) +
                               "]: unknown edit \"" + name + "\"");
    }
  }
  return out;
}
