// transforms/transform.h — parent class for all pixel transforms.
//
// Mirrors editor/src/transforms/transform.ts: one concrete Transform per
// edit, constructed by transforms/protocol.h, applied in order by
// apply_transforms(). Each transform maps a 3-band FLOAT 0..1 sRGB image to
// the same layout; the orchestrator owns the alpha split, gray promotion,
// float conversion, and the single clip back to uchar.
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <glib.h>
#include <vips/vips8>

using namespace vips;

class Transform {
 public:
  virtual ~Transform() = default;
  /// Edit name, e.g. "sepia". Matches the "edit" JSON key.
  virtual const char *name() const = 0;
  /// Apply to a 3-band FLOAT 0..1 image; returns the same layout.
  virtual VImage apply(VImage im) const = 0;
};

using TransformPtr = std::unique_ptr<Transform>;

/// Copy every metadata field from @p src to @p dst (fresh images from
/// new_from_memory_copy carry none: no icc-profile-data, no gainmap-data,
/// no EXIF). Dims/format match by construction, so structural fields
/// round-trip harmlessly; blobs and params come along, preserving the
/// keep=icc,gainmap save contract and convert's metadata preservation.
inline void graft_image_fields(VImage dst, VImage src) {
  gchar **fields = vips_image_get_fields(src.get_image());
  if (!fields) return;
  for (gchar **p = fields; *p; p++) {
    GValue value = G_VALUE_INIT;
    if (vips_image_get(src.get_image(), *p, &value)) continue;
    vips_image_set(dst.get_image(), *p, &value);
    g_value_unset(&value);
  }
  g_strfreev(fields);
}

/// Per-pixel CPU pass over a 3-band FLOAT 0..1 image (for transforms whose
/// math is per-pixel nonlinear or spatial and has no direct VIPS primitive).
/// The returned image owns its own copy; the scratch buffer is freed here.
/// Metadata is grafted from the input (fresh memory images carry none).
inline VImage transform_cpu_map(
    VImage im, const std::function<void(float *, int, int)> &fn) {
  VImage mem = im.copy_memory();
  size_t n = 0;
  void *buf = mem.write_to_memory(&n);
  if (!buf) throw std::runtime_error("transform: write_to_memory failed");
  int w = mem.width();
  int h = mem.height();
  if (mem.format() != VIPS_FORMAT_FLOAT || mem.bands() != 3) {
    g_free(buf);
    throw std::runtime_error("transform: expected 3-band float image");
  }
  size_t expect = (size_t)w * (size_t)h * 3u * sizeof(float);
  if (n < expect) {
    g_free(buf);
    throw std::runtime_error("transform: short memory buffer");
  }
  fn((float *)buf, w, h);
  VImage out =
      VImage::new_from_memory_copy(buf, n, w, h, 3, VIPS_FORMAT_FLOAT);
  g_free(buf);
  graft_image_fields(out, im);
  return out;
}

/// Run an ordered transform list: normalize once, apply each in order,
/// clip back to uchar once. Callers skip the call when the list is empty.
inline VImage apply_transforms(VImage im,
                               const std::vector<TransformPtr> &transforms) {
  if (transforms.empty()) return im;

  // Decode packed codings first: RAD (Radiance RGBE) reports 4 bands but
  // the shared-exponent band can't be extracted or split as alpha.
  // rad2float() unpacks to plain 3-band float; anything else coded is
  // rejected rather than misread.
  if (im.coding() == VIPS_CODING_RAD) {
    im = im.rad2float();
  } else if (im.coding() != VIPS_CODING_NONE) {
    throw std::runtime_error("transform: unsupported image coding for edits");
  }

  // Normalize to 3-band float 0..1 sRGB, splitting alpha first.
  // - CMYK band 3 is K (black), not alpha: convert the whole image.
  // - Otherwise split the trailing alpha band when present (any depth),
  //   so gray+alpha and RGBA share one path.
  // - Anything non-sRGB (scRGB HDR, LAB, ...) goes through colourspace;
  //   4-band non-alpha that isn't CMYK is rejected rather than
  //   misinterpreted as RGBA.
  VImage alpha;
  bool has_alpha = false;
  VImage rgb = im;
  if (im.interpretation() == VIPS_INTERPRETATION_CMYK) {
    rgb = im.colourspace(VIPS_INTERPRETATION_sRGB);
  } else if (im.has_alpha()) {
    int n = im.bands();
    alpha = im.extract_band(n - 1);
    has_alpha = true;
    rgb = im.extract_band(0, VImage::option()->set("n", n - 1));
  }
  if (rgb.bands() == 1) {
    rgb = rgb.colourspace(VIPS_INTERPRETATION_sRGB);
  } else if (rgb.bands() != 3) {
    throw std::runtime_error("transform: expected 1 or 3 color bands");
  }
  if (rgb.interpretation() != VIPS_INTERPRETATION_sRGB)
    rgb = rgb.colourspace(VIPS_INTERPRETATION_sRGB);

  // Depth-normalize to nominal 0..1 float. Float inputs are assumed
  // already nominal (e.g. scRGB HDR); integer depths scale by type max.
  // Anything else is rejected rather than silently mis-scaled.
  VImage f;
  switch (rgb.format()) {
    case VIPS_FORMAT_UCHAR:
      f = rgb.cast(VIPS_FORMAT_FLOAT).linear(1.0 / 255.0, 0.0);
      break;
    case VIPS_FORMAT_USHORT:
      f = rgb.cast(VIPS_FORMAT_FLOAT).linear(1.0 / 65535.0, 0.0);
      break;
    case VIPS_FORMAT_FLOAT:
    case VIPS_FORMAT_DOUBLE:
      f = rgb.cast(VIPS_FORMAT_FLOAT);
      break;
    default:
      throw std::runtime_error(
          "transform: unsupported format for edits (uchar/ushort/float only)");
  }

  for (const auto &t : transforms) f = t->apply(f);

  // Single clip back to uchar, reattach untouched alpha (quantized to
  // 8-bit to match the output depth).
  VImage out = f.linear(255.0, 0.0).cast(VIPS_FORMAT_UCHAR);
  if (has_alpha) out = out.bandjoin(alpha.cast(VIPS_FORMAT_UCHAR));
  return out;
}
