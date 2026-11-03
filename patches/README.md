# Patches applied in `build-camera-extras.sh` (own deltas, upstream tarball untouched)
# TODO: Remove all patches in this dir once upstream libvips ships HEIC HDR
# gainmap support natively (heifload extraction + jpegsave forward).

- `heifload-iso21496-gainmap.patch`: extracts ISO 21496-1 / Adobe `hdrgm:`
  HDR gainmaps from HEIC auxiliary images (`heifload.c` only).
  Detects `*hdrgainmap` aux URNs (Samsung `urn:com:samsung:photo:2024:aux:hdrgainmap`,
  Apple `urn:com:apple:photo:2020:aux:hdrgainmap`), decodes the aux raster
  (Y-plane for monochrome, RGB for multi-channel), attaches it as `"gainmap"`,
  parses the `hdrgm:` XML (log2 → linear via `exp2`) into `gainmap-*` fields
  matching `uhdrload.c`, and sets `gainmap-scale-factor`.
  Apple `HDRGainMap:` gainmaps (iPhone 12+ HEIC) are mapped to the same
  fields: headroom H from XMP `HDRGainMapHeadroom` (linear, version ≥ 2) or
  the Apple maker note tags 0x21/0x30 (version 1, Apple's published
  formula), and Apple's linear-domain curve `1 + (H-1)·sRGB_EOTF(g)` is
  made exact in ISO terms (min 1, max H, gamma 1, offsets 0) by passing the
  gain map bytes through a 256-entry LUT (≤0.6% boost error, 8-bit
  quantisation only).
  The gainmap is attached only when the `gainmap-*` fields are populated:
  attaching one without them made `uhdrsave` fail on
  `gainmap-max-content-boost`, breaking the whole thumbnail (every iPhone
  HDR HEIC failed this way before the Apple mapping).
  Local fixes on top of PR #5132: aux planes are copied
  (`new_from_memory_copy`; the PR wrapped libheif's plane and then freed
  it), non-8-bit gain maps are skipped, `hdrgm:` optional fields take the
  Adobe spec defaults (Gamma 1, offsets 1/64; the PR used 0) and
  GainMapMax/HDRCapacityMax are required, `gainmap-use-base-cg` is always 1
  (the PR derived it from `BaseRenditionIsHDR`, so a file without that
  attribute failed in `uhdrsave` for lack of an ICC in the gainmap), and an
  HDR base rendition is left without a gainmap.
  Without it, `heifload` decodes only the SDR primary and drops the Samsung
  HEIC aux, so `vips thumbnail` (which already uses `keep=icc,gainmap`) has
  no gainmap to re-encode and produces SDR-only JPEGs (no MPF/XMP hdrgm).

  Source: upstream PR #5132 (`cosminpolifronie/libvips`, closed/unmerged,
  626-line `heifload.c` portion only; colour `uhdr2scRGB`/`CICP2scRGB`
  refactors omitted — not needed for thumbnail preservation via existing
  `thumbnail` + `uhdrsave` paths). Verified to apply cleanly to `v8.18.7`
  (`patch -p1 --dry-run` succeeds with 2 hunks, one with fuzz).
  Applied in `build-camera-extras.sh` after libvips tarball extraction,
  before `meson setup`.

- `jpegsave-gainmap-forward.patch`: forward `jpegsave` to `uhdrsave` when a
  `"gainmap"` image is present (`jpegsave.c`, 1 condition).
  Upstream only checks `"gainmap-data"` or scRGB; HEIC `heifload` (patched
  above) attaches only `"gainmap"` (no `"gainmap-data"`), so without this
  Samsung/Apple HEIC thumbs fall through to plain JPEG (SDR, no MPF).
  Local fix complementing PR #5132 (whose tests never cover JPEG save).
  Also requires `gainmap-max-content-boost`, so a gainmap without its
  metadata falls back to plain SDR JPEG instead of failing in `uhdrsave`.
  TODO: Remove with the heifload patch once upstream forwards on `"gainmap"`
  (or heifload provides `"gainmap-data"`).
