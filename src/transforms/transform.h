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
#include <stdexcept>
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

/// Mean of the RGB bands, replicated to 3 bands.
inline VImage channel_average(VImage im) {
  VImage avg = (im[0] + im[1] + im[2]) / 3.0;
  return avg.bandjoin(avg).bandjoin(avg);
}

/// Apply a 3x3 colour matrix as band arithmetic (== recomb).
inline VImage color_matrix(VImage im, const double (&m)[3][3]) {
  VImage r = im[0], g = im[1], b = im[2];
  VImage out_r = r * m[0][0] + g * m[0][1] + b * m[0][2];
  VImage out_g = r * m[1][0] + g * m[1][1] + b * m[1][2];
  VImage out_b = r * m[2][0] + g * m[2][1] + b * m[2][2];
  return out_r.bandjoin(out_g).bandjoin(out_b);
}

/// Copy every metadata field from @p src to @p dst (fresh images from
/// new_from_memory carry none: no icc-profile-data, no gainmap-data, no
/// EXIF), preserving the keep=icc,gainmap save contract and convert's
/// metadata preservation. Structural fields are header struct members that
/// vips_image_set() can't reach, so resolution is restored by the copy().
inline VImage graft_image_fields(VImage dst, VImage src) {
  VImage out = dst.copy(VImage::option()
                            ->set("xres", src.xres())
                            ->set("yres", src.yres())
                            ->set("interpretation", (int)src.interpretation()));
  gchar **fields = vips_image_get_fields(src.get_image());
  if (!fields) return out;
  for (gchar **p = fields; *p; p++) {
    GValue value = G_VALUE_INIT;
    if (vips_image_get(src.get_image(), *p, &value)) continue;
    vips_image_set(out.get_image(), *p, &value);
    g_value_unset(&value);
  }
  g_strfreev(fields);
  return out;
}

/// Per-pixel CPU pass over a 3-band FLOAT 0..1 image (for transforms whose
/// math is per-pixel nonlinear or spatial and has no direct VIPS primitive).
/// Renders into one private buffer, edited in place and handed to the result.
inline VImage transform_cpu_map(
    VImage im, const std::function<void(float *, int, int)> &fn) {
  if (im.format() != VIPS_FORMAT_FLOAT || im.bands() != 3)
    throw std::runtime_error("transform: expected 3-band float image");
  const int w = im.width(), h = im.height();
  size_t n = 0;
  void *buf = im.write_to_memory(&n);
  fn((float *)buf, w, h);
  VImage out =
      VImage::new_from_memory_steal(buf, n, w, h, 3, VIPS_FORMAT_FLOAT);
  return graft_image_fields(out, im);
}

/// The image's gainmap (decompressed on demand), or an empty VImage.
inline VImage get_gainmap(VImage im) {
  VipsImage *gainmap = vips_image_get_gainmap(im.get_image());
  return gainmap ? VImage(gainmap) : VImage();
}

/// Bake EXIF orientation into the pixels so edits address the upright image
/// the editor canvas showed. autorot() ignores the attached gainmap (it
/// carries no orientation of its own), so rotate that the same way here.
inline VImage upright(VImage im) {
  if (!im.get_typeof(VIPS_META_ORIENTATION)) return im;
  const int orientation = im.get_int(VIPS_META_ORIENTATION);
  VImage out = im.autorot();
  if (VImage gainmap = get_gainmap(im); gainmap.get_image()) {
    gainmap = gainmap.copy();
    gainmap.set(VIPS_META_ORIENTATION, orientation);
    vips_image_set_image(out.get_image(), "gainmap",
                         gainmap.autorot().get_image());
  }
  return out;
}

/// Run an ordered transform list: normalize once, apply each in order,
/// clip back to uchar once. No-op on an empty list.
///
/// Alpha is normalized to 0..1 FLOAT alongside RGB so geometric edits can
/// join and resample RGBA consistently; pixel edits leave it untouched and
/// it is quantized back to uchar once at the end. A 3-band rotate by a
/// non-90 angle appends a transparent alpha band (corners + fringes);
/// otherwise band flow is unchanged. Geometric edits also apply to the
/// gainmap, which would otherwise no longer line up with the base image.
inline VImage apply_transforms(VImage im,
                               const std::vector<TransformPtr> &transforms) {
  if (transforms.empty()) return im;
  im = upright(im);

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
  // - CMYK band 3 is K (black), not alpha: convert before looking for alpha.
  // - Otherwise split the trailing alpha band when present (any depth),
  //   so gray+alpha and RGBA share one path.
  // - Anything non-sRGB (scRGB HDR, LAB, ...) goes through colourspace;
  //   4-band non-alpha that isn't CMYK is rejected rather than
  //   misinterpreted as RGBA.
  if (im.interpretation() == VIPS_INTERPRETATION_CMYK)
    im = im.colourspace(VIPS_INTERPRETATION_sRGB);

  VImage rgb = im;
  VImage alpha_f;
  bool has_alpha = im.has_alpha();
  if (has_alpha) {
    // Scale from the source's own range: colourspace() below may change the
    // depth of the color bands (RGB16 -> uchar), but never of this split band.
    const int n = im.bands();
    const double max_alpha =
        im.format() == VIPS_FORMAT_USHORT
            ? 65535.0
            : vips_interpretation_max_alpha(im.interpretation());
    alpha_f = im.extract_band(n - 1)
                  .cast(VIPS_FORMAT_FLOAT)
                  .linear(1.0 / max_alpha, 0.0);
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

  VImage gainmap;
  bool gainmap_loaded = false;

  for (const auto &t : transforms) {
    if (!t->is_geometric()) {
      f = t->apply(f);
      continue;
    }

    // Resample RGB and alpha together (joined 0..1 FLOAT) so interpolation
    // and output dims agree. A 3-band non-90 rotate returns 4 bands: its
    // transparent band is adopted as the new alpha plane.
    VImage out = t->apply(has_alpha ? f.bandjoin(alpha_f) : f);
    has_alpha = out.bands() == 4;
    if (has_alpha) {
      alpha_f = out.extract_band(3);
      f = out.extract_band(0, VImage::option()->set("n", 3));
    } else {
      f = out;
    }

    if (!gainmap_loaded) {
      gainmap = get_gainmap(im);
      gainmap_loaded = true;
    }
    if (gainmap.get_image()) {
      // Crop fractions and rotation angles are resolution independent. The
      // alpha band a non-90 rotate adds is meaningless here: drop it again.
      VImage mapped = t->apply(gainmap);
      if (mapped.bands() != gainmap.bands())
        mapped =
            mapped.extract_band(0, VImage::option()->set("n", gainmap.bands()));
      gainmap = mapped.cast(gainmap.format());
    }
  }

  // Single clip back to uchar, reattach alpha (quantized to 8-bit to match
  // the output depth).
  VImage out = f.linear(255.0, 0.0).cast(VIPS_FORMAT_UCHAR);
  if (has_alpha)
    out = out.bandjoin(alpha_f.linear(255.0, 0.0).cast(VIPS_FORMAT_UCHAR));
  if (gainmap.get_image())
    vips_image_set_image(out.get_image(), "gainmap", gainmap.get_image());
  return out;
}
