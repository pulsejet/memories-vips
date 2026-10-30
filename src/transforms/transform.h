// transforms/transform.h — parent class for all pixel + geometric transforms.
//
// Mirrors editor/src/transforms/transform.ts: one concrete Transform per
// edit, constructed by transforms/protocol.h, applied in order by
// apply_transforms(). Pixel transforms map a 3-band FLOAT 0..1 sRGB image
// to the same layout; geometric transforms (crop/rotate) additionally
// change dimensions and run over the alpha-joined FLOAT image so corners
// and coverage stay consistent. The orchestrator owns the alpha split,
// gray promotion, float conversion, and the single clip back to uchar.
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
  /// Apply to a 3-band FLOAT 0..1 image; pixel transforms return the same
  /// layout, geometric ones may change dimensions (and rotate may append
  /// a transparent alpha band for non-90 angles).
  virtual VImage apply(VImage im) const = 0;
  /// True for dimension-changing edits (crop/rotate): apply_transforms()
  /// runs them over the alpha-joined FLOAT image instead of RGB alone.
  virtual bool is_geometric() const { return false; }
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
///
/// Alpha is normalized to 0..1 FLOAT alongside RGB (same per-depth scale)
/// so geometric edits can join and resample RGBA consistently; pixel edits
/// still leave it untouched and it is quantized back to uchar once at the
/// end. A 3-band rotate by a non-90 angle appends a transparent alpha band
/// (corners + fringes); otherwise band flow is unchanged.
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
  double alpha_scale = 1.0;  // per-depth 0..1 scale, shared with alpha below
  switch (rgb.format()) {
    case VIPS_FORMAT_UCHAR:
      f = rgb.cast(VIPS_FORMAT_FLOAT).linear(1.0 / 255.0, 0.0);
      alpha_scale = 1.0 / 255.0;
      break;
    case VIPS_FORMAT_USHORT:
      f = rgb.cast(VIPS_FORMAT_FLOAT).linear(1.0 / 65535.0, 0.0);
      alpha_scale = 1.0 / 65535.0;
      break;
    case VIPS_FORMAT_FLOAT:
    case VIPS_FORMAT_DOUBLE:
      f = rgb.cast(VIPS_FORMAT_FLOAT);
      alpha_scale = 1.0;
      break;
    default:
      throw std::runtime_error(
          "transform: unsupported format for edits (uchar/ushort/float only)");
  }
  VImage alpha_f;
  if (has_alpha) alpha_f = alpha.cast(VIPS_FORMAT_FLOAT).linear(alpha_scale, 0.0);

  for (const auto &t : transforms) {
    if (!t->is_geometric()) {
      f = t->apply(f);
      continue;
    }
    // Geometric: resample RGB and alpha together (joined 0..1 FLOAT) so
    // interpolation and output dims agree. A 3-band non-90 rotate appends
    // a transparent band, adopted as the new alpha plane.
    if (has_alpha) {
      VImage out = t->apply(f.bandjoin(alpha_f));
      int nb = out.bands();
      if (nb < 2)
        throw std::runtime_error("transform: geometric edit lost bands");
      alpha_f = out.extract_band(nb - 1);
      f = out.extract_band(0, VImage::option()->set("n", nb - 1));
    } else {
      VImage out = t->apply(f);
      if (out.bands() == f.bands()) {
        f = out;
      } else {
        int nb = out.bands();
        alpha_f = out.extract_band(nb - 1);
        f = out.extract_band(0, VImage::option()->set("n", nb - 1));
        has_alpha = true;
      }
    }
  }

  // Single clip back to uchar, reattach untouched alpha (quantized to
  // 8-bit to match the output depth).
  VImage out = f.linear(255.0, 0.0).cast(VIPS_FORMAT_UCHAR);
  if (has_alpha)
    out = out.bandjoin(alpha_f.linear(255.0, 0.0).cast(VIPS_FORMAT_UCHAR));
  return out;
}
