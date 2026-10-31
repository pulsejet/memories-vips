// raw_fast.h — embedded-JPEG fast path for RAW thumbnails.
//
// Most camera RAWs contain a full-resolution (or 1-2MP) JPEG preview.
// Full LibRaw demosaic of a 20-50MP Bayer file to make a 512px preview
// costs 7-30s single-threaded; decoding the embedded JPEG + vips
// shrink-on-load resize costs ~0.1-0.3s. So thumbnail() tries this first
// and falls back to full VImage::thumbnail() when there is no usable
// preview (tiny 160x120 thumbs e.g. Leica M240 DNG, bitmap thumbs,
// unpack errors).
//
// Only used for thumbnails: info stays header-only, convert stays full
// decode (it must preserve raw quality). The fast path honors the same
// crop/size contract as the slow path via thumbnail_buffer().
#pragma once

#include <libraw/libraw.h>

#include <vips/vips8>

#include <algorithm>
#include <memory>
#include <string>

#include "util.h"

using namespace vips;

/// True for extensions routed to libraw (keep in sync with vips rawload).
inline bool is_raw_extension(const std::string &path) {
  static const char *const kRawExts[] = {
      ".cr2", ".cr3", ".crw", ".nef",  ".nrw", ".arw", ".srf", ".sr2",
      ".raf", ".orf", ".rw2", ".pef",  ".dng", ".rwl", ".iiq", ".3fr",
      ".ari", ".bay", ".cap", ".data", ".dcs", ".dcr", ".drf", ".eip",
      ".erf", ".fff", ".gpr", ".k25",  ".kdc", ".mdc", ".mef", ".mos",
      ".mrw", ".obm", ".ptx", ".pxn",  ".r3d", ".raw", ".rwz", ".x3f",
  };
  const std::string o = lower(path);
  for (const char *ext : kRawExts)
    if (ends_with(o, ext)) return true;
  return false;
}

/// Try thumbnail via embedded JPEG preview. Returns true + sets @p out on
/// success; returns false when the caller should fall back to full decode
/// (not a RAW, no preview, preview too small, bitmap thumb, any error).
inline bool try_raw_thumbnail_fast(const std::string &input, int width,
                                   int height, VipsInteresting crop,
                                   VImage *out) {
  if (!is_raw_extension(input)) return false;
  // Only a win for small previews; large requests need real pixels.
  // Embedded previews are typically 1616px (Sony) to full-res (Canon/Nikon);
  // above 1024 the quality/size tradeoff favors full (now OpenMP) decode.
  if (width > 1024 || height > 1024) return false;

  LibRaw raw;
  if (raw.open_file(input.c_str()) != LIBRAW_SUCCESS) return false;

  // Thumbnail dimensions are known after open_file; reject tiny previews
  // (e.g. Leica M240 DNG ships 160x120) before paying unpack costs.
  // have==0 means LibRaw doesn't know yet (some formats); proceed to
  // unpack and judge from the decoded bytes instead of rejecting here.
  const int need = std::max(width, height);
  const int have = std::max<int>(raw.imgdata.thumbnail.twidth,
                                 raw.imgdata.thumbnail.theight);
  if (have > 0 && have < need) return false;

  if (raw.unpack_thumb() != LIBRAW_SUCCESS) return false;
  std::unique_ptr<libraw_processed_image_t,
                  void (*)(libraw_processed_image_t *)>
      thumb(raw.dcraw_make_mem_thumb(), LibRaw::dcraw_clear_mem);

  // Bitmap/layer thumbs are small and uncalibrated: full decode instead.
  // Some bodies mislabel the thumb type, so check the JPEG magic too.
  if (!thumb || thumb->type != LIBRAW_IMAGE_JPEG || thumb->data_size <= 2 ||
      thumb->data[0] != 0xFF || thumb->data[1] != 0xD8)
    return false;

  try {
    // Same contract as file-path thumbnail(): shrink-on-load JPEG decode +
    // crop/resize, auto-rotate from preview EXIF.
    VImage fast =
        VImage::thumbnail_buffer(thumb->data, thumb->data_size, width,
                                 VImage::option()
                                     ->set("height", height)
                                     ->set("crop", (int)crop)
                                     ->set("size", (int)VIPS_SIZE_DOWN));
    // SIZE_DOWN never upscales: a too-small preview (have==0 unknown-size
    // case) comes back smaller than requested. Treat as a miss so the
    // caller falls back to full decode.
    if (fast.width() < width && fast.height() < height) return false;
    // thumbnail_buffer() is lazy over thumb's bytes: render now while they
    // are alive, and throw corrupt payloads here so they fall back instead
    // of failing at save.
    *out = fast.copy_memory();
    return true;
  } catch (...) {
    return false;
  }
}
