#!/bin/sh
# Incremental rebuild in the warm container: re-apply patches/*.patch onto
# pristine heifload.c/jpegsave.c, ninja, install, relink vips-preview, then
# copy it to ./out/vips-preview. ~1 min instead of a ~50 min full build.
# Requires a warmed `vipsedit` container (.agents/skills/build).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
C=${CONTAINER:-vipsedit}
. "$REPO/versions.camera.properties" 2>/dev/null || true
V=${VERSION_VIPS:-$(docker exec "$C" sh -c '. /packaging/versions.properties; echo $VERSION_VIPS')}
mkdir -p "$HERE/out"
docker exec "$C" sh -c "
set -e
export TARGET=/target PKG_CONFIG_LIBDIR=/target/lib/pkgconfig CPPFLAGS=-I/target/include LDFLAGS=-L/target/lib
cd /deps/vips-static-camera
if [ ! -f /tmp/pristine-$V/heifload.c ]; then
  mkdir -p /tmp/pristine-$V
  curl -sfL https://github.com/libvips/libvips/releases/download/v$V/vips-$V.tar.xz \
    | tar xJ -C /tmp/pristine-$V --strip-components=3 vips-$V/libvips/foreign/heifload.c vips-$V/libvips/foreign/jpegsave.c
fi
cp /tmp/pristine-$V/heifload.c /tmp/pristine-$V/jpegsave.c libvips/foreign/
for p in heifload-iso21496-gainmap jpegsave-gainmap-forward; do patch -sp1 < /packaging/patches/\$p.patch; done
ninja -C _build | grep -iE 'warning|error' || true
meson install -C _build --tag devel >/dev/null
c++ -O3 -fopenmp -I/packaging/src /packaging/src/preview.cc -o /target/bin/vips-preview \
  \$(pkg-config --cflags vips-cpp) \$(pkg-config --cflags libraw 2>/dev/null || true) \
  -Wl,--start-group \$(pkg-config --libs --static vips-cpp) \$(pkg-config --libs --static libraw 2>/dev/null || echo '-lraw -lraw_r') -Wl,--end-group -lz \
  -static -static-libstdc++ -static-libgcc
strip /target/bin/vips-preview
echo NEEDED=\$(readelf -d /target/bin/vips-preview | grep -c NEEDED || true)
"
docker cp "$C:/target/bin/vips-preview" "$HERE/out/vips-preview"
echo "built $HERE/out/vips-preview"
