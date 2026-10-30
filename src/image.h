// image.h — libvips edits for vips-preview.
//
// Saver is picked from the OUTPUT extension; output streams straight to
// the file (or /dev/stdout when "stdout" is true) without buffering —
// except generic formats (png/tiff/...) to stdout, which must buffer
// (/dev/stdout has no extension to dispatch on).
//
// Contract: stdout = file bytes only (empty in file mode). One JSON info
// line goes to fd 3 (stderr fallback if closed) per command (input dims for
// info, output dims for thumbnail/convert — free from the in-memory image);
// errors are {"error":...} on fd 3. Uses VImage::thumbnail() (shrink-on-load).
#pragma once

#include <vips/vips8>

#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>

#include "protocol.h"
#include "transforms/transform.h"
#include "raw_fast.h"
#include "util.h"

using namespace vips;

/// Save @p im per the OUTPUT extension (.jpg/.webp/.avif/.heic, else
/// generic dispatch for png/tiff/...). @p strip drops EXIF etc. (true for
/// thumbnails, false for convert) but keeps ICC + gainmap, so UHDR stays
/// UHDR and wide-gamut stays saturated. @p to_stdout streams to /dev/stdout
/// (`output` still selects the format, no file written).
inline void save_image(VImage im, const std::string &output, int quality,
                       bool strip, bool to_stdout) {
  // Thumbnails: keep ICC + gainmap, drop EXIF/IPTC.
  static const VipsForeignKeep kThumbnailKeep =
      (VipsForeignKeep)(VIPS_FOREIGN_KEEP_ICC | VIPS_FOREIGN_KEEP_GAINMAP);
  // Real file, or the stdout pipe (extension still from output).
  const char *dest = to_stdout ? "/dev/stdout" : output.c_str();

  std::string o = lower(output);

  if (ends_with(o, ".jpg") || ends_with(o, ".jpeg")) {
    // keep=icc,gainmap (not strip) so UHDR thumbnails stay UHDR.
    VOption *opts = VImage::option()->set("Q", quality);
    if (strip) opts->set("keep", kThumbnailKeep);
    im.jpegsave(dest, opts);
  } else if (ends_with(o, ".webp")) {
    VOption *opts = VImage::option()->set("Q", quality);
    if (strip) opts->set("keep", kThumbnailKeep);
    im.webpsave(dest, opts);
  } else if (ends_with(o, ".avif")) {
    // AV1 in HEIF container (SVT-AV1 encode).
    VOption *opts = VImage::option()->set("Q", quality)->set("compression",
                                                              "av1");
    if (strip) opts->set("keep", kThumbnailKeep);
    im.heifsave(dest, opts);
  } else if (ends_with(o, ".heic") || ends_with(o, ".heif")) {
    // HEVC in HEIF container (encode disabled: no x265; heifsave errors).
    VOption *opts = VImage::option()->set("Q", quality)->set("compression",
                                                              "hevc");
    if (strip) opts->set("keep", kThumbnailKeep);
    im.heifsave(dest, opts);
  } else {
    // No dedicated binding: buffer via the output suffix, emit on stdout.
    if (to_stdout) {
      size_t n = 0;
      void *buf = nullptr;
      if (strip)
        im.write_to_buffer(output.c_str(), &buf, &n,
                           VImage::option()->set("keep", kThumbnailKeep));
      else
        im.write_to_buffer(output.c_str(), &buf, &n);
      if (fwrite(buf, 1, n, stdout) != n) {
        free(buf);
        throw std::runtime_error("failed writing image bytes to stdout");
      }
      free(buf);
    } else if (strip)
      im.write_to_file(dest,
                       VImage::option()->set("keep", kThumbnailKeep));
    else
      im.write_to_file(dest);
  }
}

/// One JSON info line on fd 3 (stdout = file bytes only).
inline void print_result_info(const json &o) { emit_json(o.dump()); }

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

/// info: image metadata as JSON on stderr (stdout stays empty).
inline int run_info(const Request &r) {
  // Header-only read, no full decode.
  VImage im = VImage::new_from_file(r.input.c_str(),
                                    VImage::option()->set("access", "sequential"));

  print_result_info(image_info_json(im, r.input, ""));

  return 0;
}

/// thumbnail: shrink-on-load crop/resize, then save (file or stdout).
inline int run_thumbnail(const Request &r) {
  // Map crop name to vips interest; attention is default ("attention"/"none"
  // need no mapping; parse_request rejects the rest).
  VipsInteresting interesting = VIPS_INTERESTING_ATTENTION;
  if (r.crop == "low")
    interesting = VIPS_INTERESTING_LOW;
  else if (r.crop == "high")
    interesting = VIPS_INTERESTING_HIGH;

  // Fast path: embedded JPEG preview (full demosaic is 7-30s). Falls
  // back to full decode when there is no usable preview (tiny thumbs,
  // bitmap, non-RAW). Slow path below keeps the exact same contract.
  // Edit edits run after the resize (radii are output pixels); metadata
  // keep=icc,gainmap is unchanged so UHDR thumbs stay UHDR.
  {
    VImage fast;
    VipsInteresting fast_crop =
        (r.crop == "none") ? VIPS_INTERESTING_NONE : interesting;
    if (try_raw_thumbnail_fast(r.input, r.width, r.height, fast_crop, &fast)) {
      if (!r.edits.empty()) {
        fast = apply_transforms(fast, r.edits);
      }
      save_image(fast, r.output, r.quality, true, r.to_stdout);
      print_result_info(image_info_json(fast, r.input, r.output));
      return 0;
    }
  }

  // "none" fits aspect; otherwise exact w x h crop.
  VImage im = (r.crop == "none")
                  ? VImage::thumbnail(r.input.c_str(), r.width,
                                      VImage::option()
                                          ->set("height", r.height)
                                          ->set("size", (int)VIPS_SIZE_DOWN)
                                          ->set("no_rotate", false))
                  : VImage::thumbnail(r.input.c_str(), r.width,
                                      VImage::option()
                                          ->set("height", r.height)
                                          ->set("crop", (int)interesting)
                                          ->set("size", (int)VIPS_SIZE_DOWN)
                                          ->set("no_rotate", false));

  // Thumbnails strip metadata (convert preserves it).
  if (!r.edits.empty()) {
    im = apply_transforms(im, r.edits);
  }
  save_image(im, r.output, r.quality, true, r.to_stdout);

  // Report OUTPUT dims (free from `im`).
  print_result_info(image_info_json(im, r.input, r.output));

  return 0;
}

/// convert: full decode, optional edit edits, then save (file or stdout).
inline int run_convert(const Request &r) {
  // Full decode (no shrink-on-load fast path).
  VImage im = VImage::new_from_file(r.input.c_str());

  // Edits run on the full-res pixels before saving.
  if (!r.edits.empty()) {
    im = apply_transforms(im, r.edits);
  }

  // Never strip: preserve EXIF/metadata.
  save_image(im, r.output, r.quality, false, r.to_stdout);

  // Report OUTPUT dims (free from `im`).
  print_result_info(image_info_json(im, r.input, r.output));

  return 0;
}
