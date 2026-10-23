// image.h — libvips operations for vips-preview.
//
// Output goes straight to its destination, never through a memory buffer:
// the saver is picked from the output filename extension and streams to
// the file — or to /dev/stdout when the request sets stdout, so piped
// output needs no more memory than file output.
//
// Uses VImage::thumbnail() (the vips thumbnail op) so shrink-on-load +
// embedded heif thumbnails apply.
#pragma once

#include <vips/vips8>

#include <iostream>
#include <stdexcept>
#include <string>

#include "protocol.h"
#include "util.h"

using namespace vips;

/// Save @p im per the @p output filename extension (the request's format:
/// .jpg/.jpeg, .webp, .avif, .heic/.heif, .jxl, .jp2, anything else via
/// generic filename dispatch for png/tiff/exr/ppm/...). @p quality maps to
/// saver options (Q/compression) where the saver supports them. Metadata
/// policy: @p strip removes EXIF etc. — true for thumbnails (smaller
/// payloads, no location leaks), false for convert (preserve metadata).
/// Thumbnails still keep the gainmap (`keep=gainmap`): UltraHDR JPEGs are
/// SDR base + gainmap metadata and jpegsave auto-forwards to uhdrsave only
/// when the gainmap is present — `strip` would drop it and force SDR.
/// When @p to_stdout, the same saver streams to /dev/stdout and no file is
/// written (`output` still selects the format).
inline void save_image(VImage im, const std::string &output, int quality,
                       bool strip, bool to_stdout) {
  // Destination: real file, or the stdout pipe (extension still from output).
  const char *dest = to_stdout ? "/dev/stdout" : output.c_str();

  // Saver dispatch on the output filename extension.
  std::string o = lower(output);

  if (ends_with(o, ".jpg") || ends_with(o, ".jpeg")) {
    // MozJPEG path; strip only for thumbnails, never for convert.
    // keep=gainmap (not strip) so UHDR thumbnails stay UHDR: jpegsave
    // forwards to uhdrsave when gainmap-data is present.
    VOption *opts = VImage::option()->set("Q", quality);
    if (strip) opts->set("keep", VIPS_FOREIGN_KEEP_GAINMAP);
    im.jpegsave(dest, opts);
  } else if (ends_with(o, ".webp")) {
    VOption *opts = VImage::option()->set("Q", quality);
    if (strip) opts->set("keep", VIPS_FOREIGN_KEEP_GAINMAP);
    im.webpsave(dest, opts);
  } else if (ends_with(o, ".avif")) {
    // AV1 in HEIF container (aom encode).
    VOption *opts = VImage::option()->set("Q", quality)->set("compression",
                                                              "av1");
    if (strip) opts->set("keep", VIPS_FOREIGN_KEEP_GAINMAP);
    im.heifsave(dest, opts);
  } else if (ends_with(o, ".heic") || ends_with(o, ".heif")) {
    // HEVC in HEIF container (x265 encode).
    VOption *opts = VImage::option()->set("Q", quality)->set("compression",
                                                              "hevc");
    if (strip) opts->set("keep", VIPS_FOREIGN_KEEP_GAINMAP);
    im.heifsave(dest, opts);
  } else if (ends_with(o, ".jxl")) {
    // JXL saver takes no quality options here; keep gainmap when stripping
    // so HDR gainmap metadata survives thumbnailing.
    if (strip)
      im.jxlsave(dest,
                 VImage::option()->set("keep", VIPS_FOREIGN_KEEP_GAINMAP));
    else
      im.jxlsave(dest);
  } else if (ends_with(o, ".jp2")) {
    if (strip)
      im.jp2ksave(dest,
                  VImage::option()->set("keep", VIPS_FOREIGN_KEEP_GAINMAP));
    else
      im.jp2ksave(dest);
  } else {
    // png/tiff/exr/ppm/...: no dedicated binding needed.
    if (strip)
      im.write_to_file(
          dest, VImage::option()->set("keep", VIPS_FOREIGN_KEEP_GAINMAP));
    else
      im.write_to_file(dest);
  }
}

/// info: print image metadata as a JSON object on stdout.
inline int run_info(const Request &r) {
  // Sequential access: header-only read, no full decode needed.
  VImage im = VImage::new_from_file(r.input.c_str(),
                                    VImage::option()->set("access", "sequential"));

  // Same fields as the old text output, now as JSON.
  json o;
  o["width"] = im.width();
  o["height"] = im.height();
  o["bands"] = im.bands();
  o["format"] = (int)im.format();
  o["interpretation"] = (int)im.interpretation();
  o["filename"] = im.filename() ? im.filename() : r.input;

  std::cout << o.dump() << "\n";

  return 0;
}

/// thumbnail: shrink-on-load crop/resize, then save (file or stdout).
inline int run_thumbnail(const Request &r) {
  // Map the crop name to vips' interest point; attention is the default.
  VipsInteresting interesting = VIPS_INTERESTING_ATTENTION;
  if (r.crop == "low")
    interesting = VIPS_INTERESTING_LOW;
  else if (r.crop == "high")
    interesting = VIPS_INTERESTING_HIGH;
  // "attention" (default) and "none" need no mapping; other values are
  // rejected by parse_request, so no error branch here.

  // "none" keeps aspect (fit); otherwise crop to exactly w x h.
  VImage im = (r.crop == "none")
                  ? VImage::thumbnail(r.input.c_str(), r.width,
                                      VImage::option()
                                          ->set("height", r.height)
                                          ->set("no_rotate", false))
                  : VImage::thumbnail(r.input.c_str(), r.width,
                                      VImage::option()
                                          ->set("height", r.height)
                                          ->set("crop", (int)interesting)
                                          ->set("no_rotate", false));

  // Stream straight to the destination; nothing buffered in memory.
  // Thumbnails strip metadata; convert (below) preserves it.
  save_image(im, r.output, r.quality, true, r.to_stdout);

  return 0;
}

/// convert: full decode, then save (file or stdout, no resize).
inline int run_convert(const Request &r) {
  // Full decode (unlike thumbnail, no shrink-on-load fast path).
  VImage im = VImage::new_from_file(r.input.c_str());

  // Never strip here: convert must preserve EXIF/metadata.
  save_image(im, r.output, r.quality, false, r.to_stdout);

  return 0;
}
