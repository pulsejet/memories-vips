// image.h — load, edit and save for vips-preview.
//
// Saver is picked from the OUTPUT extension; output streams straight to
// the file, or to stdout when "stdout" is true (through a target on fd 1:
// /dev/stdout can't be reopened when stdout is a socket, e.g. Node spawn).
//
// Contract: stdout = file bytes only (empty in file mode). One JSON info
// line goes to fd 3 (stderr fallback if closed) per command (input dims for
// info, output dims for thumbnail/convert — free from the in-memory image);
// errors are {"error":...} on fd 3. Uses VImage::thumbnail() (shrink-on-load).
#pragma once

#include <vips/vips8>

#include <string>

#include "protocol.h"
#include "raw_fast.h"
#include "transforms/transform.h"
#include "util.h"

using namespace vips;

/// Save @p im per the OUTPUT extension. @p strip drops EXIF etc. (true for
/// thumbnails, false for convert) but keeps ICC + gainmap, so UHDR stays
/// UHDR and wide-gamut stays saturated. @p to_stdout writes the encoded
/// bytes to stdout (`output` still selects the format, no file written).
inline void save_image(VImage im, const std::string &output, int quality,
                       bool strip, bool to_stdout) {
  const std::string o = lower(output);
  const bool jpeg = ends_with(o, ".jpg") || ends_with(o, ".jpeg");
  const bool webp = ends_with(o, ".webp");
  const bool avif = ends_with(o, ".avif");
  // HEVC encode is disabled (no x265): heifsave errors.
  const bool heic = ends_with(o, ".heic") || ends_with(o, ".heif");

  VOption *opts = VImage::option();
  if (jpeg || webp || avif || heic) opts->set("Q", quality);
  if (avif) opts->set("compression", "av1");  // AV1 in HEIF (SVT-AV1 encode)
  if (heic) opts->set("compression", "hevc");
  if (strip)
    opts->set("keep", (int)(VIPS_FOREIGN_KEEP_ICC | VIPS_FOREIGN_KEEP_GAINMAP));

  if (to_stdout)
    im.write_to_target(output.c_str(), VTarget::new_to_descriptor(1), opts);
  else
    im.write_to_file(output.c_str(), opts);
}

/// Info JSON for @p im (dims free from memory, no re-read): @p output
/// labels thumbnail/convert results, else filename is used (info).
/// By value: VImage copies are cheap (ref-counted).
inline json image_info_json(VImage im, const std::string &input,
                            const std::string &output) {
  json o;
  o["width"] = im.width();
  o["height"] = im.height();
  o["bands"] = im.bands();
  o["format"] = (int)im.format();
  o["interpretation"] = (int)im.interpretation();
  if (!output.empty())
    o["output"] = output;
  else
    o["filename"] = im.filename() ? im.filename() : input;
  return o;
}

/// Apply edits, save, and report the OUTPUT dims.
inline int finish(VImage im, const Request &r, bool strip) {
  im = apply_transforms(im, r.edits);
  save_image(im, r.output, r.quality, strip, r.to_stdout);
  emit_json(image_info_json(im, r.input, r.output));
  return 0;
}

/// info: image metadata as JSON on fd 3 (stdout stays empty).
inline int run_info(const Request &r) {
  // Header-only read, no full decode.
  VImage im = VImage::new_from_file(
      r.input.c_str(), VImage::option()->set("access", "sequential"));
  emit_json(image_info_json(im, r.input, ""));
  return 0;
}

/// thumbnail: shrink-on-load crop/resize, edits (radii are output pixels),
/// then save (file or stdout). Strips metadata except ICC + gainmap.
inline int run_thumbnail(const Request &r) {
  // parse_request rejected anything else.
  VipsInteresting crop = VIPS_INTERESTING_ATTENTION;
  if (r.crop == "none") crop = VIPS_INTERESTING_NONE;
  if (r.crop == "low") crop = VIPS_INTERESTING_LOW;
  if (r.crop == "high") crop = VIPS_INTERESTING_HIGH;

  // Fast path: embedded JPEG preview (full demosaic is 7-30s). Falls back to
  // full decode when there is no usable preview (tiny thumbs, bitmap,
  // non-RAW).
  VImage im;
  if (!try_raw_thumbnail_fast(r.input, r.width, r.height, crop, &im))
    im = VImage::thumbnail(r.input.c_str(), r.width,
                           VImage::option()
                               ->set("height", r.height)
                               ->set("crop", (int)crop)
                               ->set("size", (int)VIPS_SIZE_DOWN));
  return finish(im, r, true);
}

/// convert: full decode, optional edits, then save (file or stdout).
/// Never strips: EXIF/metadata is preserved.
inline int run_convert(const Request &r) {
  return finish(VImage::new_from_file(r.input.c_str()), r, false);
}
