#!/usr/bin/env bash
set -euo pipefail
# build-camera-extras.sh — delta static deps + static libvips + static C++ CLI.
# Runs INSIDE the unmodified upstream container image (vips-dev-$PLATFORM),
# in the SAME `docker run` lifetime as build-deps-only.sh, right after it.
#   docker run --rm -v $PWD:/packaging vips-dev-$PLATFORM \
#     sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"
# Upstream build.sh/platforms/* are never modified (PLAN "no fork").
# build-deps-only.sh leaves /target warm (.a + .pc + cmake configs, shared
# libvips.so, NO cleanup). We add delta deps static, rebuild libheif + libvips
# static, link preview.cc -static.

# --- versions ---
PACKAGE="${PACKAGE:-/packaging}"
# shellcheck disable=SC1091
source "${PACKAGE}/versions.properties"
# shellcheck disable=SC1091
source "${PACKAGE}/versions.camera.properties"

: "${PLATFORM:?PLATFORM must be set (linux-musl-x64, linux-musl-arm64)}"
: "${VERSION_VIPS:?}" "${VERSION_HEIF:?}"
: "${VERSION_DAV1D:?}" "${VERSION_LIBDE265:?}" "${VERSION_SVT_AV1:?}"
: "${VERSION_IMATH:?}" "${VERSION_OPENEXR:?}"
: "${VERSION_LIBRAW:?}"
: "${HEIF_WITH_X265:?}" "${HEIF_WITH_LIBDE265:?}" "${HEIF_WITH_AOM_ENCODER:?}" "${HEIF_WITH_AOM_DECODER:?}" "${HEIF_WITH_DAV1D:?}" "${HEIF_WITH_SVTENC:?}"

# --- env (mirror upstream build/posix.sh; tolerate already-set values) ---
DEPS="${DEPS:-/deps}"
TARGET="${TARGET:-/target}"
ROOT="${ROOT:-/root}"
CHOST="${CHOST:-$(gcc -dumpmachine 2>/dev/null || echo "")}"
FLAGS="${FLAGS:--O3 -fPIC}"
export TARGET_SYSROOT="${TARGET_SYSROOT:-${TARGET}}"
export PKG_CONFIG_LIBDIR="${PKG_CONFIG_LIBDIR:-${TARGET}/lib/pkgconfig}"
export PATH="${PATH}:${TARGET}/bin"
export LD_LIBRARY_PATH="${TARGET}/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export CFLAGS="${CFLAGS:-${FLAGS}}"
export CXXFLAGS="${CXXFLAGS:-${FLAGS}}"
export CPPFLAGS="-I${TARGET}/include"
export LDFLAGS="-L${TARGET}/lib"
export MAKEFLAGS="-j$(nproc 2>/dev/null || echo 4)"
export CMAKE_PREFIX_PATH="${TARGET}${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
CURL="curl --silent --location --fail --retry 3 --retry-max-time 30"
mkdir -p "${DEPS}" "${TARGET}"
unset PKG_CONFIG_PATH
PKG_CONFIG_BIN="${PKG_CONFIG:-pkg-config}"

echo "=== camera-extras: PLATFORM=$PLATFORM CHOST=$CHOST TARGET=$TARGET ==="

# Fetch $url, cmake-configure + install static into $TARGET.
# cmake_dep <name> <url> <srcdir> <build-type> [extra cmake args...]
cmake_dep() {
  local name="$1" url="$2" srcdir="$3" btype="$4"; shift 4
  rm -rf "${DEPS}/${name}"
  mkdir -p "${DEPS}/${name}"
  $CURL "$url" | tar xzC "${DEPS}/${name}" --strip-components=1
  cmake -S "${DEPS}/${name}/${srcdir}" -B "${DEPS}/${name}/_build" -G"Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" \
    -DCMAKE_INSTALL_PREFIX="${TARGET}" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_BUILD_TYPE="${btype}" -DCMAKE_PREFIX_PATH="${TARGET}" \
    -DBUILD_SHARED_LIBS=OFF "$@"
  cmake --build "${DEPS}/${name}/_build"
  cmake --install "${DEPS}/${name}/_build" --strip
}

# dav1d (AV1 decode for libheif)
rm -rf "${DEPS}/dav1d" && mkdir -p "${DEPS}/dav1d"
$CURL "https://code.videolan.org/videolan/dav1d/-/archive/${VERSION_DAV1D}/dav1d-${VERSION_DAV1D}.tar.gz" \
  | tar xzC "${DEPS}/dav1d" --strip-components=1
(cd "${DEPS}/dav1d" && \
  meson setup _build --default-library=static --buildtype=release --strip --prefix="${TARGET}" ${MESON:-} \
    -Denable_tools=false -Denable_tests=false && \
  meson install -C _build --tag devel)

# libde265 (HEVC decode for libheif; GitHub archive has no ./configure, and the
# Rocky image lacks libtool, so CMake library-only instead of autotools)
cmake_dep libde265 "https://github.com/strukturag/libde265/archive/v${VERSION_LIBDE265}.tar.gz" \
  . Release -DENABLE_SDL=OFF -DENABLE_DECODER=OFF -DENABLE_ENCODER=OFF

# SVT-AV1 (AV1 encode for libheif; GitLab is canonical; LOG_QUIET keeps
# stderr clean for the JSON-line protocol — SVT logs to stderr by default)
cmake_dep svt-av1 "https://gitlab.com/AOMediaCodec/SVT-AV1/-/archive/v${VERSION_SVT_AV1}/SVT-AV1-v${VERSION_SVT_AV1}.tar.gz" \
  . Release -DBUILD_APPS=OFF -DBUILD_TESTING=OFF -DLOG_QUIET=ON

# libheif rebuilt with AV1 (SVT-AV1 encode + dav1d decode) + HEVC decode only,
# built-in, no plugins, no dlopen (HEVC encode/X265 and AOM are OFF)
CFLAGS="${CFLAGS} -O3" CXXFLAGS="${CXXFLAGS} -O3" \
cmake_dep heif "https://github.com/strukturag/libheif/releases/download/v${VERSION_HEIF}/libheif-${VERSION_HEIF}.tar.gz" \
  . Release -DBUILD_DOCUMENTATION=0 -DBUILD_TESTING=0 -DENABLE_PLUGIN_LOADING=0 \
  -DWITH_EXAMPLES=0 -DWITH_GDK_PIXBUF=0 \
  -DWITH_X265="${HEIF_WITH_X265}" -DWITH_LIBDE265="${HEIF_WITH_LIBDE265}" \
  -DWITH_AOM_ENCODER="${HEIF_WITH_AOM_ENCODER}" -DWITH_AOM_DECODER="${HEIF_WITH_AOM_DECODER}" \
  -DWITH_DAV1D="${HEIF_WITH_DAV1D}" -DWITH_SvtEnc="${HEIF_WITH_SVTENC}" \
  -DWITH_RAV1E=0

# Imath + OpenEXR
cmake_dep imath "https://github.com/AcademySoftwareFoundation/Imath/archive/v${VERSION_IMATH}.tar.gz" \
  . Release -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF
cmake_dep openexr "https://github.com/AcademySoftwareFoundation/openexr/archive/v${VERSION_OPENEXR}.tar.gz" \
  . Release -DOPENEXR_BUILD_TOOLS=OFF -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF \
  -DOPENEXR_INSTALL_EXAMPLES=OFF

# libraw (camera RAW via dcrawload; OpenMP ON for multi-thread demosaic;
# musl static libgomp works: `gcc -fopenmp -static` links libgomp.a cleanly
# on Alpine 3.20, verified in-container. libraw.org tarball ships
# ./configure, GitHub archive has only configure.ac)
rm -rf "${DEPS}/libraw" && mkdir -p "${DEPS}/libraw"
$CURL "https://www.libraw.org/data/LibRaw-${VERSION_LIBRAW}.tar.gz" \
  | tar xzC "${DEPS}/libraw" --strip-components=1
(cd "${DEPS}/libraw" && \
  CFLAGS="${CFLAGS} -fopenmp -O3" CXXFLAGS="${CXXFLAGS} -fopenmp -O3" \
  ./configure --host="${CHOST}" --prefix="${TARGET}" --enable-static --disable-shared \
    --disable-dependency-tracking --disable-examples --disable-jasper --enable-openmp && \
  make install-strip)

# libvips STATIC with camera loaders, modules disabled (no dlopen).
# -Dppm/-Dradiance are built-in (no deps); upstream leaves them off.
rm -rf "${DEPS}/vips-static-camera" && mkdir -p "${DEPS}/vips-static-camera"
$CURL "https://github.com/libvips/libvips/releases/download/v${VERSION_VIPS}/vips-${VERSION_VIPS}.tar.xz" \
  | tar xJC "${DEPS}/vips-static-camera" --strip-components=1
# HEIC HDR gainmap (Samsung urn:com:samsung:photo:2024:aux:hdrgainmap, Apple):
# upstream PR #5132 (closed, unmerged) extracts ISO 21496-1 aux + hdrgm XML
# into gainmap-* metadata so thumbnails stay UHDR via keep=icc,gainmap,
# plus local jpegsave forward on "gainmap" (heifload provides image only,
# no "gainmap-data", so plain jpegsave would stay SDR).
# Patches live in-tree (patches/), upstream tarball untouched.
# TODO: Remove this block + patches/heifload-iso21496-gainmap.patch +
# patches/jpegsave-gainmap-forward.patch once upstream libvips ships HEIC
# HDR gainmap support natively (heifload + jpegsave forward).
for _p in heifload-iso21496-gainmap.patch jpegsave-gainmap-forward.patch; do
  (cd "${DEPS}/vips-static-camera" && patch -p1 < "${PACKAGE}/patches/${_p}")
done
(cd "${DEPS}/vips-static-camera" && \
  sed -i'.bak' "/subdir('man')/{N;N;N;N;d;}" meson.build && \
  CFLAGS="${CFLAGS} -O3" CXXFLAGS="${CXXFLAGS} -O3" \
  meson setup _build --default-library=static --buildtype=release --strip --prefix="${TARGET}" ${MESON:-} \
    -Ddeprecated=false -Dexamples=false -Dauto_features=enabled \
    -Dintrospection=disabled -Dmodules=disabled \
    -Dcfitsio=disabled -Dfftw=disabled -Dmagick=disabled -Dmatio=disabled -Dnifti=disabled \
    -Dopenslide=disabled -Dpdfium=disabled -Dpoppler=disabled -Dquantizr=disabled \
    -Dpangocairo=disabled -Drsvg=disabled -Dfontconfig=disabled \
    -Dheif-module=disabled -Djpeg-xl-module=disabled -Dmagick-module=disabled \
    -Dopenslide-module=disabled -Dpoppler-module=disabled \
    -Draw=enabled -Dheif=enabled -Djpeg-xl=disabled -Dopenjpeg=disabled \
    -Dspng=enabled -Dopenexr=enabled -Dcgif=enabled \
    -Dppm=true -Dradiance=true -Danalyze=false && \
  meson install -C _build --tag devel)

# --- link fully-static C++ CLI ---
CLI_SRC="${PACKAGE}/src/preview.cc"
[ -f "$CLI_SRC" ] || { echo "ERROR: src/preview.cc not found ($CLI_SRC)" >&2; exit 1; }
# Static archives link single-pass; pkg-config order can place -lz before its
# users (libraw/libpng/libtiff), so close the closure in --start-group and
# trail -lz (harmless duplicate when already ordered).
# -I.../src lets headers in src/transforms/ include siblings (json.hpp, ...)
# by short name.
CXX_BIN="${CXX:-c++}"
# shellcheck disable=SC2086
"$CXX_BIN" -O3 -fopenmp -I"${PACKAGE}/src" "$CLI_SRC" -o "${TARGET}/bin/vips-preview" \
  $($PKG_CONFIG_BIN --cflags vips-cpp) $($PKG_CONFIG_BIN --cflags libraw 2>/dev/null || true) \
  -Wl,--start-group $($PKG_CONFIG_BIN --libs --static vips-cpp) $($PKG_CONFIG_BIN --libs --static libraw 2>/dev/null || echo "-lraw -lraw_r") -Wl,--end-group -lz \
  -static -static-libstdc++ -static-libgcc
strip "${TARGET}/bin/vips-preview" 2>/dev/null || true

# --- assert fully static (no NEEDED) ---
if readelf -d "${TARGET}/bin/vips-preview" 2>/dev/null | grep -q NEEDED; then
  readelf -d "${TARGET}/bin/vips-preview"
  echo "ERROR: static binary has NEEDED entries" >&2
  exit 1
fi
file "${TARGET}/bin/vips-preview" || true

# --- versions.json (upstream tail is skipped, so seed it from both properties files) ---
# Text/SVG stack (cairo/pango/etc.) is stripped from the build, so drop those
# pins even though they remain in upstream versions.properties.
python3 - "$TARGET/versions.json" "$PACKAGE" <<'EOF'
import json, sys
path, package = sys.argv[1:3]
dropped = {"cairo", "pango", "pixman", "fribidi", "fontconfig", "freetype", "harfbuzz", "rsvg"}
data = {}
for f in ("versions.properties", "versions.camera.properties"):
    with open(f"{package}/{f}") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = (s.strip() for s in line.split("=", 1))
            if k == "UPSTREAM_TAG":
                data["upstream"] = v
            elif k.startswith("VERSION_"):
                name = k[len("VERSION_"):].lower()
                if name not in dropped:
                    data[name] = v
with open(path, "w") as f:
    json.dump(data, f, indent=2, sort_keys=True)
    f.write("\n")
print("versions.json written:", path)
EOF

# --- package (single -C: busybox tar drops members under multiple -C flags) ---
chmod 755 "${TARGET}/bin/vips-preview"
STAGE="$(mktemp -d)"
cp "${TARGET}/bin/vips-preview" "${TARGET}/versions.json" "$STAGE/"
tar czf "${PACKAGE}/vips-cli-${PLATFORM}-static.tar.gz" \
  -C "$STAGE" vips-preview versions.json
rm -rf "$STAGE"
chmod 644 "${PACKAGE}/vips-cli-${PLATFORM}-static.tar.gz"
ls -lh "${PACKAGE}/vips-cli-${PLATFORM}-static.tar.gz"
echo "OK: camera-extras static build complete for $PLATFORM"
