// protocol.h — stdin JSON request parsing for vips-preview.
//
// Owns the wire format: field extraction with types/defaults, per-command
// validation, and normalization (cmd/crop lowercased, "thumb" alias).
// All failures throw std::runtime_error with a human message; main renders
// them as {"error":...} on fd 3 so image-bytes stdout stays clean.
#pragma once

#include <stdexcept>
#include <string>

#include "json.hpp"
#include "transforms/protocol.h"
#include "util.h"

using nlohmann::json;

/// A validated vips-preview request.
///
/// - cmd: "info" | "thumbnail" | "convert" (lowercased; "thumb" accepted).
/// - input: source image path (always required).
/// - output: dest filename; its extension selects the saver (no format
///   field) (thumbnail/convert only).
/// - to_stdout: "stdout" flag; when true, stream encoded bytes to stdout
///   instead of writing the file (`output` still selects the format).
///   Default false (thumbnail/convert only).
/// - width/height: thumbnail size, default 512x512, must be positive.
/// - crop: attention (default) | none | low | high (thumbnail only).
/// - quality: thumbnail default 80, convert default 90.
/// - edits: ordered pixel-edit list applied after decode (thumbnail: after
///   resize) and before save; see edit.h. Default [] (no-edit).
struct Request {
  std::string cmd;
  std::string input;
  std::string output;
  bool to_stdout = false;
  int width = 512;
  int height = 512;
  std::string crop = "attention";
  int quality = 80;
  std::vector<TransformPtr> edits;
};

/// Fetch a required string field; throws if missing or not a string.
inline std::string required_string(const json &j, const char *key) {
  if (!j.contains(key) || !j[key].is_string())
    throw std::runtime_error(std::string("missing or non-string \"") + key +
                             "\"");
  return j[key].get<std::string>();
}

/// Fetch an optional string field; returns @p dflt when absent.
/// Throws if present but not a string.
inline std::string optional_string(const json &j, const char *key,
                                   const std::string &dflt) {
  if (!j.contains(key)) return dflt;
  if (!j[key].is_string())
    throw std::runtime_error(std::string("\"") + key + "\" must be a string");
  return j[key].get<std::string>();
}

/// Fetch an optional numeric field; returns @p dflt when absent.
/// Throws if present but not a number.
inline int optional_int(const json &j, const char *key, int dflt) {
  if (!j.contains(key)) return dflt;
  if (!j[key].is_number())
    throw std::runtime_error(std::string("\"") + key + "\" must be a number");
  return j[key].get<int>();
}

/// Fetch an optional boolean flag; returns @p dflt when absent.
/// Throws if present but not a boolean (truthy strings/numbers rejected).
inline bool optional_bool(const json &j, const char *key, bool dflt) {
  if (!j.contains(key)) return dflt;
  if (!j[key].is_boolean())
    throw std::runtime_error(std::string("\"") + key + "\" must be a boolean");
  return j[key].get<bool>();
}

/// Parse and validate a stdin JSON value into a Request.
/// Throws std::runtime_error on any shape/validation problem.
inline Request parse_request(const json &j) {
  // Top level must be an object, not an array/scalar.
  if (!j.is_object()) throw std::runtime_error("stdin JSON must be an object");

  Request r;

  // Command decides which fields below are required.
  r.cmd = lower(required_string(j, "cmd"));
  if (r.cmd == "thumb") r.cmd = "thumbnail"; // historical alias
  if (r.cmd != "info" && r.cmd != "thumbnail" && r.cmd != "convert")
    throw std::runtime_error("\"cmd\" must be info|thumbnail|convert");

  // Source image; every command needs it.
  r.input = required_string(j, "input");
  if (r.cmd == "info") return r; // info takes nothing else

  // Destination filename; its extension picks the saver (no format field).
  r.output = required_string(j, "output");

  // Stdout streaming flag; the file is skipped when true.
  r.to_stdout = optional_bool(j, "stdout", false);

  // Convert is decode + re-encode; quality + optional edit edits apply.
  if (r.cmd == "convert") {
    r.quality = optional_int(j, "quality", 90);
    r.edits = parse_transforms(j);
    return r;
  }

  // Thumbnail geometry; vips would reject these anyway, fail early instead.
  r.width = optional_int(j, "width", 512);
  r.height = optional_int(j, "height", 512);
  if (r.width <= 0 || r.height <= 0)
    throw std::runtime_error("\"width\" and \"height\" must be positive");

  // Smart-crop mode; normalized so "Attention"/"NONE" etc. all work.
  r.crop = lower(optional_string(j, "crop", "attention"));
  if (r.crop != "attention" && r.crop != "none" && r.crop != "low" &&
      r.crop != "high")
    throw std::runtime_error("\"crop\" must be attention|none|low|high");

  r.quality = optional_int(j, "quality", 80);
  r.edits = parse_transforms(j);

  return r;
}
