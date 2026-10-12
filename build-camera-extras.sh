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
if [ -f /packaging/versions.properties ]; then
  # shellcheck disable=SC1091
  source /packaging/versions.properties
fi
if [ -f /packaging/versions.camera.properties ]; then
  # shellcheck disable=SC1091
  source /packaging/versions.camera.properties
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../versions.camera.properties"
fi

: "${PLATFORM:?PLATFORM must be set (linux-musl-x64, linux-musl-arm64)}"
: "${VERSION_BROTLI:?}" "${VERSION_DAV1D:?}" "${VERSION_LIBDE265:?}" "${VERSION_X265:?}"
: "${VERSION_OPENJPEG:?}" "${VERSION_IMATH:?}" "${VERSION_OPENEXR:?}"
: "${VERSION_LIBRAW:?}" "${VERSION_LIBJXL:?}"
: "${HEIF_WITH_X265:?}" "${HEIF_WITH_LIBDE265:?}" "${HEIF_WITH_AOM:?}" "${HEIF_WITH_DAV1D:?}"

# --- env (mirror upstream build/posix.sh; tolerate already-set values) ---
LINUX=true
DEPS="${DEPS:-/deps}"
TARGET="${TARGET:-/target}"
PACKAGE="${PACKAGE:-/packaging}"
ROOT="${ROOT:-/root}"
CHOST="${CHOST:-$(gcc -dumpmachine 2>/dev/null || echo "")}"
FLAGS="${FLAGS:--Os -fPIC}"
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

# brotli (libjxl needs it; upstream freetype stays brotli-disabled)
cmake_dep brotli "https://github.com/google/brotli/archive/v${VERSION_BROTLI}.tar.gz" \
  . MinSizeRel -DBROTLI_DISABLE_TESTS=ON -DBROTLI_BUNDLED_MODE=OFF

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
  . MinSizeRel -DENABLE_SDL=OFF -DENABLE_DECODER=OFF -DENABLE_ENCODER=OFF

# x265 (HEVC encode for libheif; sources under source/; bitbucket is canonical,
# ftp.videolan.org is unreachable from some networks)
cmake_dep x265 "https://bitbucket.org/multicoreware/x265_git/downloads/x265_${VERSION_X265}.tar.gz" \
  source MinSizeRel -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DENABLE_PIC=ON \
  -DENABLE_CLI=OFF -DENABLE_TESTS=OFF
# x265.pc seeds Libs.private from CMAKE_CXX_IMPLICIT_LINK_LIBRARIES incl. -lgcc_s,
# which musl lacks (only libgcc.a); strip it or every -static consumer fails in ld.
sed -i 's/ -lgcc_s//g' "${TARGET}/lib/pkgconfig/x265.pc"
grep -q "lgcc_s" "${TARGET}/lib/pkgconfig/x265.pc" \
  && { echo "x265.pc still references lgcc_s" >&2; exit 1; } || true

# libheif rebuilt with HEVC + AV1 built-in, no plugins, no dlopen
# (svt-av1/rav1e stay OFF: aom already covers AV1 encode)
CFLAGS="${CFLAGS} -O3" CXXFLAGS="${CXXFLAGS} -O3" \
cmake_dep heif "https://github.com/strukturag/libheif/releases/download/v${VERSION_HEIF}/libheif-${VERSION_HEIF}.tar.gz" \
  . Release -DBUILD_DOCUMENTATION=0 -DBUILD_TESTING=0 -DENABLE_PLUGIN_LOADING=0 \
  -DWITH_EXAMPLES=0 -DWITH_GDK_PIXBUF=0 \
  -DWITH_X265="${HEIF_WITH_X265}" -DWITH_LIBDE265="${HEIF_WITH_LIBDE265}" \
  -DWITH_AOM="${HEIF_WITH_AOM}" -DWITH_DAV1D="${HEIF_WITH_DAV1D}" \
  -DWITH_RAV1E=0 -DWITH_SvtEnc=0

# openjpeg (JP2)
cmake_dep openjpeg "https://github.com/uclouvain/openjpeg/archive/v${VERSION_OPENJPEG}.tar.gz" \
  . MinSizeRel -DBUILD_CODEC=OFF -DBUILD_MJ2=OFF -DBUILD_JPIP=OFF -DBUILD_JPWL=OFF \
  -DBUILD_JP3D=OFF -DBUILD_TESTING=OFF -DBUILD_DOC=OFF

# Imath + OpenEXR
cmake_dep imath "https://github.com/AcademySoftwareFoundation/Imath/archive/v${VERSION_IMATH}.tar.gz" \
  . MinSizeRel -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF
cmake_dep openexr "https://github.com/AcademySoftwareFoundation/openexr/archive/v${VERSION_OPENEXR}.tar.gz" \
  . MinSizeRel -DOPENEXR_BUILD_TOOLS=OFF -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF \
  -DOPENEXR_INSTALL_EXAMPLES=OFF

# libraw (camera RAW via dcrawload; --disable-openmp avoids static libgomp on musl;
# libraw.org tarball ships ./configure, GitHub archive has only configure.ac)
rm -rf "${DEPS}/libraw" && mkdir -p "${DEPS}/libraw"
$CURL "https://www.libraw.org/data/LibRaw-${VERSION_LIBRAW}.tar.gz" \
  | tar xzC "${DEPS}/libraw" --strip-components=1
(cd "${DEPS}/libraw" && \
  ./configure --host="${CHOST}" --prefix="${TARGET}" --enable-static --disable-shared \
    --disable-dependency-tracking --disable-examples --disable-jasper --disable-openmp && \
  make install-strip)

# libjxl (JPEG-XL; system libs only, no absent-submodule skcms/sjpeg)
cmake_dep libjxl "https://github.com/libjxl/libjxl/archive/v${VERSION_LIBJXL}.tar.gz" \
  . MinSizeRel -DBUILD_TESTING=OFF \
  -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_BENCHMARK=OFF \
  -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_ENABLE_JNI=OFF \
  -DJPEGXL_ENABLE_VIEWERS=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF \
  -DJPEGXL_ENABLE_SKCMS=OFF -DJPEGXL_ENABLE_SJPEG=OFF \
  -DJPEGXL_STATIC=ON -DJPEGXL_BUNDLE_LIBPNG=OFF \
  -DJPEGXL_FORCE_SYSTEM_BROTLI=ON -DJPEGXL_FORCE_SYSTEM_HWY=ON -DJPEGXL_FORCE_SYSTEM_LCMS2=ON

# libvips STATIC with camera loaders, modules disabled (no dlopen).
# -Dppm/-Dradiance are built-in (no deps); upstream leaves them off.
rm -rf "${DEPS}/vips-static-camera" && mkdir -p "${DEPS}/vips-static-camera"
$CURL "https://github.com/libvips/libvips/releases/download/v${VERSION_VIPS}/vips-${VERSION_VIPS}.tar.xz" \
  | tar xJC "${DEPS}/vips-static-camera" --strip-components=1
(cd "${DEPS}/vips-static-camera" && \
  sed -i'.bak' "/subdir('man')/{N;N;N;N;d;}" meson.build && \
  CFLAGS="${CFLAGS} -O3" CXXFLAGS="${CXXFLAGS} -O3" \
  meson setup _build --default-library=static --buildtype=release --strip --prefix="${TARGET}" ${MESON:-} \
    -Ddeprecated=false -Dexamples=false -Dauto_features=enabled \
    -Dintrospection=disabled -Dmodules=disabled \
    -Dcfitsio=disabled -Dfftw=disabled -Dmagick=disabled -Dmatio=disabled -Dnifti=disabled \
    -Dopenslide=disabled -Dpdfium=disabled -Dpoppler=disabled -Dquantizr=disabled \
    -Dheif-module=disabled -Djpeg-xl-module=disabled -Dmagick-module=disabled \
    -Dopenslide-module=disabled -Dpoppler-module=disabled \
    -Draw=enabled -Dheif=enabled -Djpeg-xl=enabled -Dopenjpeg=enabled \
    -Dspng=enabled -Dopenexr=enabled -Dcgif=enabled \
    -Dppm=true -Dradiance=true -Danalyze=false && \
  meson install -C _build --tag devel)

# --- link fully-static C++ CLI ---
CLI_SRC="${PACKAGE}/src/preview.cc"
[ -f "$CLI_SRC" ] || { echo "ERROR: src/preview.cc not found ($CLI_SRC)" >&2; exit 1; }
# Static archives link single-pass; pkg-config order can place -lz before its
# users (libraw/libpng/libtiff), so close the closure in --start-group and
# trail -lz (harmless duplicate when already ordered).
# shellcheck disable=SC2086
CXX_BIN="${CXX:-c++}"
# shellcheck disable=SC2086
"$CXX_BIN" "$CLI_SRC" -o "${TARGET}/bin/vips-preview" \
  $($PKG_CONFIG_BIN --cflags vips-cpp) \
  -Wl,--start-group $($PKG_CONFIG_BIN --libs --static vips-cpp) -Wl,--end-group -lz \
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
python3 - "$TARGET/versions.json" <<'EOF'
import json, sys
path = sys.argv[1]
data = {}
for f in ("/packaging/versions.properties", "/packaging/versions.camera.properties"):
    try:
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                if k == "UPSTREAM_TAG":
                    data["upstream"] = v.strip()
                elif k.startswith("VERSION_"):
                    data[k[len("VERSION_"):].lower()] = v.strip()
    except FileNotFoundError:
        pass
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
