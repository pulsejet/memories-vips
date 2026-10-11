# PLAN: portable static-contained libvips for C++ CLI

## Goal
Ship `libvips` + C++ preview/manip CLI as tarballs for `x86_64/aarch64 × glibc≥2.28/musl≥1.2.5`. No system imaging libs required. License: ignore (consumers AGPL3).

## Coverage
- Normal: `JPEG(mozjpeg) PNG WebP TIFF GIF(cgif) SVG(rsvg) AVIF/HEIC BMP PPM QOI?` + `vips/dz/raw/csv/matrix`.
- RAW: `ARW CR2 CR3 CRW DNG NEF NRW ORF PEF RAF RW2 SRW` via `libraw_r` (`dcrawload`); `CR3/HEIC` needs HEVC decode.
- HDR/special: `JPEG-XL(libjxl) JP2(openjpeg) OpenEXR AVIF-HDR(uhdr)`.
- Keep off: `pdfium/poppler openslide magick fftw nifti cfitsio matio` (not camera).

## Base (no fork)
Pin `kleisauke/libvips-packaging` at tag (submodule/archive), run its `build.sh`+`platforms/*` Docker builds unmodified, then run our `build-camera-extras.sh` in the same container before packaging: builds delta deps static + rebuilds `libvips.a` (`modules=disabled`). Own files only: `versions.camera.properties`, `build-camera-extras.sh`, CI workflow. Rebase by bumping pin.

## Alpine reuse? No
Checked `edge/main+community APKINDEX`: only `aom/cairo/lcms2/archive/de265/jpeg-turbo/png/webp/brotli/glib/expat-static` exist; missing `vips/libraw/libheif/libjxl/openjpeg/openexr/rsvg-static`. Alpine `vips` also splits `heif/jxl/magick/poppler` into `vips-modules/*.so` (`dlopen`) — incompatible with `-static`.

## New deps to add (pin in `versions.properties`)
`libraw libjxl brotli openjpeg libde265 x265 dav1d openexr Imath svt-av1? rav1e?` + existing `aom heif uhdr highway lcms exif webp tiff png archive xml2 glib ffi zlib-ng fontconfig freetype harfbuzz fribidi pixman cairo pango rsvg cgif imagequant`.

`libheif`: `-DWITH_X265=1 -DWITH_LIBDE265=1 -DWITH_AOM=1 -DWITH_DAV1D=1 -DENABLE_PLUGIN_LOADING=0`.
`vips meson`: `-Draw=enabled -Dheif=enabled -Djpeg-xl=enabled -Dopenjpeg=enabled -Dspng=enabled -Dopenexr=enabled -Dcgif=enabled -Dauto_features=enabled` (rest as upstream).

## Artifacts (primary: fully static)
Primary: 2 fully-static PIE CLIs `vips-cli-{linux-x64,linux-arm64}-static` built on `alpine:static` with `musl-gcc -static -static-libstdc++ -static-libgcc`, `libvips.a` + all deps `.a` (`-Ddefault-library=static`, `ENABLE_PLUGIN_LOADING=0`, `modules=disabled`, no `dlopen`). A musl-static binary runs on both musl and glibc hosts (kernel-only dep), so 2 files cover all 4 combos.
Fallback (only if static hits a data-file issue, e.g. `fontconfig`): per-platform portable-shared tarballs as before (`libvips.so.42`, `RPATH=$ORIGIN`).

## C++ CLI link
Static: `c++ preview.cc $(pkg-config --libs --static vips) -static -static-libstdc++ -static-libgcc`. No `dlopen` deps allowed (assert `readelf -d` has no `NEEDED`). Use `vips_thumbnail[_buffer]` / `*_shrink_on_load` + `heifload thumbnail` for previews.

## Build matrix (GH Actions, native arm)
`ubuntu-24.04(x64) ubuntu-24.04-arm(arm64+musl-arm64 via docker) + musl-x64 docker`. Reuse upstream `build.sh PLATFORM` + `Toolchain.cmake/meson.ini` per platform.

## Validate
`NEEDED` allowlist check; smoke on `ubuntu/debian/rhel/fedora/alpine` × arch; corpus (`rawsamples.ch` + `heic/avif/jxl/jp2/webp`) → `thumbnail` + roundtrip; `hevc` + `av1` `heifsave` must both succeed (unlike upstream AV1-only).

## Maintain
Bump via `check-latest-versions.sh` + pinned `versions.properties`; tag `v*` → release tarballs; record versions in `versions.json`.
