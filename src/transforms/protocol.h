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
#include "crop.h"
#include "exposure.h"
#include "flip.h"
#include "grayscale.h"
#include "highlights.h"
#include "hue_saturation.h"
#include "invert.h"
#include "rotate.h"
#include "sepia.h"
#include "shadows.h"
#include "sharpen.h"
#include "transform.h"
#include "vibrance.h"
#include "vignette.h"
#include "warmth.h"

using nlohmann::json;

/// Error prefixed with the offending entry, e.g. "edits[2].amount out of
/// range".
inline std::runtime_error edit_error(size_t idx, const std::string &msg) {
  return std::runtime_error("edits[" + std::to_string(idx) + "]" + msg);
}

/// Fetch an optional numeric transform param: missing -> @p dflt, else it
/// must be a number in [lo,hi]. Throws with an edits[i].key-qualified message.
inline double transform_param(const json &o, size_t idx, const char *key,
                              double dflt, double lo, double hi) {
  if (!o.contains(key)) return dflt;
  if (!o.at(key).is_number())
    throw edit_error(idx, std::string(".") + key + " must be a number");
  double d = o.at(key).get<double>();
  if (!(d >= lo && d <= hi))
    throw edit_error(idx, std::string(".") + key + " out of range");
  return d;
}

/// Construct the Transform for one validated "edits" entry.
inline TransformPtr parse_transform(const json &o, size_t idx) {
  if (!o.is_object()) throw edit_error(idx, " must be an object");
  if (!o.contains("edit") || !o.at("edit").is_string())
    throw edit_error(idx, " missing string \"edit\"");

  auto p = [&](const char *key, double dflt, double lo, double hi) {
    return transform_param(o, idx, key, dflt, lo, hi);
  };
  const std::string name = o.at("edit").get<std::string>();

  if (name == "brightnessContrast")
    return std::make_unique<BrightnessContrast>(p("brightness", 0, -1, 1),
                                                p("contrast", 0, -1, 1));
  if (name == "exposure")
    return std::make_unique<Exposure>(p("stops", 0, -5, 5));
  if (name == "hueSaturation")
    return std::make_unique<HueSaturation>(p("hue", 0, -1, 1),
                                           p("saturation", 0, -1, 1));
  if (name == "sepia") return std::make_unique<Sepia>(p("amount", 1, 0, 1));
  if (name == "vibrance")
    return std::make_unique<Vibrance>(p("amount", 0, -1, 1));
  if (name == "shadows")
    return std::make_unique<Shadows>(p("amount", 0, -1, 1));
  if (name == "highlights")
    return std::make_unique<Highlights>(p("amount", 0, -1, 1));
  if (name == "warmth")
    return std::make_unique<Warmth>(p("amount", 0, -1, 1));
  if (name == "blur") return std::make_unique<Blur>(p("radius", 0, 0, 100));
  if (name == "sharpen")
    return std::make_unique<Sharpen>(p("radius", 2, 0, 50),
                                     p("amount", 0.5, 0, 5));
  if (name == "vignette")
    return std::make_unique<Vignette>(p("size", 0.5, 0, 1),
                                      p("amount", 0.5, 0, 1));
  if (name == "invert") return std::make_unique<Invert>();
  if (name == "grayscale") return std::make_unique<Grayscale>();
  if (name == "rotate")
    return std::make_unique<Rotate>(p("angle", 0, -180, 180));
  if (name == "flip") {
    std::string direction = "horizontal";
    if (o.contains("direction")) {
      if (!o.at("direction").is_string())
        throw edit_error(idx, ".direction must be a string");
      direction = o.at("direction").get<std::string>();
    }
    if (direction != "horizontal" && direction != "vertical")
      throw edit_error(idx, ".direction must be \"horizontal\" or \"vertical\"");
    return std::make_unique<Flip>(direction == "vertical");
  }
  if (name == "crop") {
    double x = p("x", 0, 0, 1), y = p("y", 0, 0, 1);
    double w = p("width", 1, 0, 1), h = p("height", 1, 0, 1);
    if (!(w > 0.0) || !(h > 0.0))
      throw edit_error(idx, ".width/height must be > 0");
    const double eps = 1e-9;
    if (x + w > 1.0 + eps || y + h > 1.0 + eps)
      throw edit_error(idx, ": crop region x+width/y+height exceeds 1");
    return std::make_unique<Crop>(x, y, w, h);
  }
  throw edit_error(idx, ": unknown edit \"" + name + "\"");
}

/// Parse the optional "edits" array (thumbnail/convert only) into an
/// ordered list of concrete Transforms. Missing -> []. Unknown fields
/// besides the known params are ignored (forward compat).
inline std::vector<TransformPtr> parse_transforms(const json &j) {
  std::vector<TransformPtr> out;
  if (!j.contains("edits")) return out;
  const json &arr = j.at("edits");
  if (!arr.is_array()) throw std::runtime_error("\"edits\" must be an array");
  for (size_t i = 0; i < arr.size(); i++)
    out.push_back(parse_transform(arr.at(i), i));
  return out;
}
