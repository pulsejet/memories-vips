#!/usr/bin/env bash
set -euo pipefail
# build-camera-extras.sh — delta static deps + static libvips + static C++ CLI.
# Runs INSIDE the unmodified upstream container image (vips-dev-$PLATFORM),
# in the SAME `docker run` lifetime as build-deps-only.sh, right after it.
#   docker run --rm -v $PWD:/packaging vips-dev-$PLATFORM \
#     sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"
# This satisfies PLAN "no fork": upstream build.sh/platforms/* are never modified.
# build-deps-only.sh leaves /target warm (all .a + .pc + cmake configs intact,
# shared libvips.so installed, NO cleanup). We add delta deps static, rebuild
# libheif + libvips static, link preview.cc -static.

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

: "${PLATFORM:?PLATFORM must be set (linux-x64, linux-arm64, linux-musl-x64, linux-musl-arm64)}"
: "${VERSION_BROTLI:?}" "${VERSION_DAV1D:?}" "${VERSION_LIBDE265:?}" "${VERSION_X265:?}"
: "${VERSION_OPENJPEG:?}" "${VERSION_IMATH:?}" "${VERSION_OPENEXR:?}"
: "${VERSION_LIBRAW:?}" "${VERSION_LIBJXL:?}"

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

without_patch() { echo "${1%.[[:digit:]]*}"; }

echo "=== camera-extras: PLATFORM=$PLATFORM CHOST=$CHOST TARGET=$TARGET ==="

# --- 1. brotli (libjxl needs it; upstream freetype builds with brotli disabled, keep that) ---
rm -rf "${DEPS}/brotli"
mkdir "${DEPS}/brotli"
$CURL "https://github.com/google/brotli/archive/v${VERSION_BROTLI}.tar.gz" | tar xzC "${DEPS}/brotli" --strip-components=1
cmake -S "${DEPS}/brotli" -B "${DEPS}/brotli/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DBUILD_SHARED_LIBS=OFF -DBROTLI_DISABLE_TESTS=ON -DBROTLI_BUNDLED_MODE=OFF
cmake --build "${DEPS}/brotli/_build" --target install -- -s 2>/dev/null || cmake --build "${DEPS}/brotli/_build" --target install
# cmake install does not strip when using --build; strip manually, ignore failures on scripts
find "${TARGET}/lib" -maxdepth 1 -name 'libbrotli*.a' -exec strip --strip-unneeded {} + 2>/dev/null || true

# --- 2. dav1d (AV1 decode for libheif) ---
rm -rf "${DEPS}/dav1d"
mkdir "${DEPS}/dav1d"
$CURL "https://code.videolan.org/videolan/dav1d/-/archive/${VERSION_DAV1D}/dav1d-${VERSION_DAV1D}.tar.gz" | tar xzC "${DEPS}/dav1d" --strip-components=1
cd "${DEPS}/dav1d"
meson setup _build --default-library=static --buildtype=release --strip --prefix="${TARGET}" ${MESON:-} \
  -Denable_tools=false -Denable_tests=false
meson install -C _build --tag devel

# --- 3. libde265 (HEVC decode for libheif). GitHub archive ships no
# pre-generated ./configure, so use CMake (also avoids libtool, which the
# Rocky image lacks). Library only: no SDL, no dec265/enc265 tools. ---
rm -rf "${DEPS}/libde265"
mkdir "${DEPS}/libde265"
$CURL "https://github.com/strukturag/libde265/archive/v${VERSION_LIBDE265}.tar.gz" | tar xzC "${DEPS}/libde265" --strip-components=1
cmake -S "${DEPS}/libde265" -B "${DEPS}/libde265/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DBUILD_SHARED_LIBS=OFF -DENABLE_SDL=OFF -DENABLE_DECODER=OFF -DENABLE_ENCODER=OFF
cmake --build "${DEPS}/libde265/_build" --target install -- -s 2>/dev/null || cmake --build "${DEPS}/libde265/_build" --target install

# --- 4. x265 (HEVC encode for libheif). Sources live under source/. ---
rm -rf "${DEPS}/x265"
mkdir "${DEPS}/x265"
# x265 release tarballs (bitbucket is canonical; ftp.videolan.org is unreachable
# from some networks and curl without --fail would feed an error page to tar).
$CURL "https://bitbucket.org/multicoreware/x265_git/downloads/x265_${VERSION_X265}.tar.gz" | tar xzC "${DEPS}/x265" --strip-components=1
cmake -S "${DEPS}/x265/source" -B "${DEPS}/x265/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DENABLE_PIC=ON -DENABLE_CLI=OFF -DENABLE_TESTS=OFF
cmake --build "${DEPS}/x265/_build" -j"$(nproc 2>/dev/null || echo 4)"
cmake --install "${DEPS}/x265/_build" --strip
# x265.pc seeds Libs.private from CMAKE_CXX_IMPLICIT_LINK_LIBRARIES, which
# includes -lgcc_s. Alpine/musl ships no libgcc_s (only libgcc.a/libgcc_eh.a),
# so any `-static` consumer of this .pc fails in ld. Strip it (libgcc.a,
# linked via -static-libgcc, still provides the unwinder for static builds).
sed -i 's/ -lgcc_s//g' "${TARGET}/lib/pkgconfig/x265.pc"
grep -q "lgcc_s" "${TARGET}/lib/pkgconfig/x265.pc" && { echo "x265.pc still references lgcc_s" >&2; exit 1; } || true

# --- 5. rebuild libheif static with HEVC + AV1 built-in, no plugins, no dlopen ---
rm -rf "${DEPS}/heif"
mkdir "${DEPS}/heif"
$CURL "https://github.com/strukturag/libheif/releases/download/v${VERSION_HEIF}/libheif-${VERSION_HEIF}.tar.gz" | tar xzC "${DEPS}/heif" --strip-components=1
cd "${DEPS}/heif"
CFLAGS="${CFLAGS} -O3" CXXFLAGS="${CXXFLAGS} -O3" cmake -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="${TARGET}" \
  -DBUILD_SHARED_LIBS=FALSE -DBUILD_DOCUMENTATION=0 -DBUILD_TESTING=0 \
  -DENABLE_PLUGIN_LOADING=0 \
  -DWITH_EXAMPLES=0 -DWITH_GDK_PIXBUF=0 \
  -DWITH_X265=1 -DWITH_LIBDE265=1 -DWITH_AOM=1 -DWITH_DAV1D=1 \
  -DWITH_RAV1E=0 -DWITH_SvtEnc=0
make install/strip

# --- 6. openjpeg (JP2) ---
rm -rf "${DEPS}/openjpeg"
mkdir "${DEPS}/openjpeg"
$CURL "https://github.com/uclouvain/openjpeg/archive/v${VERSION_OPENJPEG}.tar.gz" | tar xzC "${DEPS}/openjpeg" --strip-components=1
cmake -S "${DEPS}/openjpeg" -B "${DEPS}/openjpeg/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_CODEC=OFF -DBUILD_MJ2=OFF -DBUILD_JPIP=OFF \
  -DBUILD_JPWL=OFF -DBUILD_JP3D=OFF -DBUILD_TESTING=OFF -DBUILD_DOC=OFF
cmake --build "${DEPS}/openjpeg/_build" --target install -- -s 2>/dev/null || cmake --build "${DEPS}/openjpeg/_build" --target install

# --- 7. Imath + 8. OpenEXR ---
rm -rf "${DEPS}/imath"
mkdir "${DEPS}/imath"
$CURL "https://github.com/AcademySoftwareFoundation/Imath/archive/v${VERSION_IMATH}.tar.gz" | tar xzC "${DEPS}/imath" --strip-components=1
cmake -S "${DEPS}/imath" -B "${DEPS}/imath/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF
cmake --build "${DEPS}/imath/_build" --target install -- -s 2>/dev/null || cmake --build "${DEPS}/imath/_build" --target install

rm -rf "${DEPS}/openexr"
mkdir "${DEPS}/openexr"
$CURL "https://github.com/AcademySoftwareFoundation/openexr/archive/v${VERSION_OPENEXR}.tar.gz" | tar xzC "${DEPS}/openexr" --strip-components=1
cmake -S "${DEPS}/openexr" -B "${DEPS}/openexr/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_PREFIX_PATH="${TARGET}" \
  -DBUILD_SHARED_LIBS=OFF -DOPENEXR_BUILD_TOOLS=OFF -DBUILD_TESTING=OFF -DBUILD_DOCS=OFF \
  -DOPENEXR_INSTALL_EXAMPLES=OFF
cmake --build "${DEPS}/openexr/_build" --target install -- -s 2>/dev/null || cmake --build "${DEPS}/openexr/_build" --target install

# --- 9. libraw (camera RAW via dcrawload). --disable-openmp avoids static libgomp issues on musl.
# NOTE: use the libraw.org release tarball — it ships a pre-generated ./configure,
# the GitHub archive has only configure.ac. ---
rm -rf "${DEPS}/libraw"
mkdir "${DEPS}/libraw"
$CURL "https://www.libraw.org/data/LibRaw-${VERSION_LIBRAW}.tar.gz" | tar xzC "${DEPS}/libraw" --strip-components=1
cd "${DEPS}/libraw"
./configure --host="${CHOST}" --prefix="${TARGET}" --enable-static --disable-shared --disable-dependency-tracking \
  --disable-examples --disable-jasper --disable-openmp
make install-strip

# --- 10. libjxl (JPEG-XL). Force system libs so it links our static brotli/hwy/lcms/png. ---
rm -rf "${DEPS}/libjxl"
mkdir "${DEPS}/libjxl"
$CURL "https://github.com/libjxl/libjxl/archive/v${VERSION_LIBJXL}.tar.gz" | tar xzC "${DEPS}/libjxl" --strip-components=1
cmake -S "${DEPS}/libjxl" -B "${DEPS}/libjxl/_build" -G"Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="${ROOT}/Toolchain.cmake" -DCMAKE_INSTALL_PREFIX="${TARGET}" \
  -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_PREFIX_PATH="${TARGET}" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
  -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_BENCHMARK=OFF \
  -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_ENABLE_JNI=OFF \
  -DJPEGXL_ENABLE_VIEWERS=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF \
  -DJPEGXL_ENABLE_SKCMS=OFF -DJPEGXL_ENABLE_SJPEG=OFF \
  -DJPEGXL_STATIC=ON -DJPEGXL_BUNDLE_LIBPNG=OFF \
  -DJPEGXL_FORCE_SYSTEM_BROTLI=ON -DJPEGXL_FORCE_SYSTEM_HWY=ON -DJPEGXL_FORCE_SYSTEM_LCMS2=ON
cmake --build "${DEPS}/libjxl/_build" --target install -- -s 2>/dev/null || cmake --build "${DEPS}/libjxl/_build" --target install

# --- 11. rebuild libvips STATIC with camera loaders enabled, modules disabled (no dlopen) ---
rm -rf "${DEPS}/vips-static-camera"
mkdir "${DEPS}/vips-static-camera"
$CURL "https://github.com/libvips/libvips/releases/download/v${VERSION_VIPS}/vips-${VERSION_VIPS}.tar.xz" | tar xJC "${DEPS}/vips-static-camera" --strip-components=1
cd "${DEPS}/vips-static-camera"
# Keep upstream man/po/tools/tests disabled.
sed -i'.bak' "/subdir('man')/{N;N;N;N;d;}" meson.build
CFLAGS="${CFLAGS} -O3" CXXFLAGS="${CXXFLAGS} -O3" meson setup _build --default-library=static \
  --buildtype=release --strip --prefix="${TARGET}" ${MESON:-} \
  -Ddeprecated=false -Dexamples=false -Dauto_features=enabled \
  -Dintrospection=disabled -Dmodules=disabled \
  -Dcfitsio=disabled -Dfftw=disabled -Dmagick=disabled -Dmatio=disabled -Dnifti=disabled \
  -Dopenslide=disabled -Dpdfium=disabled -Dpoppler=disabled -Dquantizr=disabled \
  -Dheif-module=disabled -Djpeg-xl-module=disabled -Dmagick-module=disabled \
  -Dopenslide-module=disabled -Dpoppler-module=disabled \
  -Draw=enabled -Dheif=enabled -Djpeg-xl=enabled -Dopenjpeg=enabled \
  -Dspng=enabled -Dopenexr=enabled -Dcgif=enabled \
  -Dppm=true -Dradiance=true -Danalyze=false
meson install -C _build --tag devel

# --- 12. link fully-static C++ CLI ---
CLI_SRC="/packaging/src/preview.cc"
if [ ! -f "$CLI_SRC" ]; then
  CLI_SRC="$PACKAGE/src/preview.cc"
fi
if [ ! -f "$CLI_SRC" ]; then
  echo "ERROR: src/preview.cc not found ($CLI_SRC)" >&2
  exit 1
fi
CXX_BIN="${CXX:-c++}"
# Static archives link single-pass left-to-right; pkg-config order isn't
# guaranteed to place -lz after every user (libraw/libpng/libtiff), so close
# the whole closure in --start-group/--end-group and trail an explicit -lz
# (harmless duplicate when already correctly ordered).
# shellcheck disable=SC2086
echo "diag: -lz occurrences in static closure: $($PKG_CONFIG_BIN --libs --static vips-cpp | grep -o '\-lz\>' | wc -l)"
$CXX_BIN $CLI_SRC -o "${TARGET}/bin/vips-preview" \
  $($PKG_CONFIG_BIN --cflags vips-cpp) \
  -Wl,--start-group $($PKG_CONFIG_BIN --libs --static vips-cpp) -Wl,--end-group -lz \
  -static -static-libstdc++ -static-libgcc
# Slim the binary (meson --strip doesn't cover our manual link; ~44M -> ~15M).
strip "${TARGET}/bin/vips-preview" 2>/dev/null || true

# --- 13. assert fully static (no NEEDED) ---
if readelf -d "${TARGET}/bin/vips-preview" 2>/dev/null | grep -q NEEDED; then
  readelf -d "${TARGET}/bin/vips-preview"
  echo "ERROR: static binary has NEEDED entries" >&2
  exit 1
fi
file "${TARGET}/bin/vips-preview" || true

# --- 14. write versions.json (upstream tail is skipped, so seed it here
# from both properties files) ---
if command -v python3 >/dev/null 2>&1; then
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
fi

# --- 15. package static CLI tarball (single -C: busybox tar mishandles
# multiple -C flags, silently dropping members) ---
chmod 755 "${TARGET}/bin/vips-preview"
STAGE="$(mktemp -d)"
cp "${TARGET}/bin/vips-preview" "${TARGET}/versions.json" "$STAGE/"
tar czf "${PACKAGE}/vips-cli-${PLATFORM}-static.tar.gz" \
  -C "$STAGE" vips-preview versions.json
rm -rf "$STAGE"
chmod 644 "${PACKAGE}/vips-cli-${PLATFORM}-static.tar.gz"
ls -lh "${PACKAGE}/vips-cli-${PLATFORM}-static.tar.gz"
echo "OK: camera-extras static build complete for $PLATFORM"
