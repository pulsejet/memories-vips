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
  `"gainmap"` image is present (`jpegsave.c`, 1 line).
  Upstream only checks `"gainmap-data"` or scRGB; HEIC `heifload` (patched
  above) attaches only `"gainmap"` (no `"gainmap-data"`), so without this
  Samsung/Apple HEIC thumbs fall through to plain JPEG (SDR, no MPF).
  Local fix complementing PR #5132 (whose tests never cover JPEG save).
  TODO: Remove with the heifload patch once upstream forwards on `"gainmap"`
  (or heifload provides `"gainmap-data"`).
