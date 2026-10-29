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
// crop/size/no_rotate contract as the slow path via thumbnail_buffer().
#pragma once

#include <libraw/libraw.h>

#include <cstring>
#include <string>
#include <vector>

#include <vips/vips8>

#include "util.h"

using namespace vips;

/// True for extensions routed to libraw (keep in sync with vips rawload).
inline bool is_raw_extension(const std::string &path) {
  std::string o = lower(path);
  static const char *kRawExts[] = {
      ".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".srf", ".sr2",
      ".raf", ".orf", ".rw2",  ".pef", ".dng", ".rwl", ".iiq", ".3fr",
      ".ari", ".bay", ".cap",  ".data", ".dcs", ".dcr", ".drf", ".eip",
      ".erf", ".fff", ".gpr",  ".iiq", ".k25",  ".kdc", ".mdc", ".mef",
      ".mos", ".mrw", ".obm",  ".ptx", ".pxn",  ".r3d", ".raw", ".rwz",
      ".x3f", nullptr,
  };
  for (int i = 0; kRawExts[i]; ++i)
    if (ends_with(o, kRawExts[i])) return true;
  return false;
}

/// Try thumbnail via embedded JPEG preview. Returns true + sets @p out on
/// success; returns false when the caller should fall back to full decode
/// (not a RAW, no preview, preview too small, bitmap thumb, any error).
inline bool try_raw_thumbnail_fast(const std::string &input, int width,
                                   int height, VipsInteresting crop, VImage *out) {
  if (!is_raw_extension(input)) return false;
  // Only a win for small previews; large requests need real pixels.
  // Embedded previews are typically 1616px (Sony) to full-res (Canon/Nikon);
  // above 1024 the quality/size tradeoff favors full (now OpenMP) decode.
  if (width > 1024 || height > 1024) return false;

  LibRaw raw;
  if (raw.open_file(input.c_str()) != LIBRAW_SUCCESS) return false;

  // Thumbnail dimensions are known after open_file; reject tiny previews
  // (e.g. Leica M240 DNG ships 160x120) before paying unpack costs.
  int tw = raw.imgdata.thumbnail.twidth;
  int th = raw.imgdata.thumbnail.theight;
  int need = width > height ? width : height;
  int have = tw > th ? tw : th;
  // have==0 means LibRaw doesn't know yet (some formats); proceed to
  // unpack and judge from the decoded bytes instead of rejecting here.
  if (have > 0 && have < need) {
    raw.recycle();
    return false;
  }

  if (raw.unpack_thumb() != LIBRAW_SUCCESS) {
    raw.recycle();
    return false;
  }
  libraw_processed_image_t *thumb = raw.dcraw_make_mem_thumb();
  if (!thumb) {
    raw.recycle();
    return false;
  }
  bool ok = false;
  if (thumb->type == LIBRAW_IMAGE_JPEG && thumb->data_size > 0) {
    // Copy JPEG bytes out before clearing LibRaw (it owns the buffer).
    std::vector<unsigned char> jpg(thumb->data_size);
    std::memcpy(jpg.data(), thumb->data, thumb->data_size);
    LibRaw::dcraw_clear_mem(thumb);
    raw.recycle();
    thumb = nullptr;
    try {
      // Same contract as file-path thumbnail(): shrink-on-load JPEG
      // decode + crop/resize, auto-rotate from preview EXIF.
      VOption *opts = VImage::option()
                          ->set("height", height)
                          ->set("size", (int)VIPS_SIZE_DOWN)
                          ->set("no_rotate", false);
      if (crop != VIPS_INTERESTING_NONE)
        opts->set("crop", (int)crop);
      VImage fast = VImage::thumbnail_buffer(jpg.data(), jpg.size(), width, opts);
      // SIZE_DOWN never upscales: a too-small preview (have==0 unknown-size
      // case) comes back smaller than requested. Treat as a miss so the
      // caller falls back to full decode.
      if (fast.width() >= width || fast.height() >= height) {
        *out = fast;
        ok = true;
      } else {
        ok = false;
      }
    } catch (...) {
      ok = false;
    }
  } else {
    // Bitmap/layer thumbs: small and uncalibrated; full decode instead.
    LibRaw::dcraw_clear_mem(thumb);
    raw.recycle();
  }
  return ok;
}
