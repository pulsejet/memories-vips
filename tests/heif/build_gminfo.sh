#!/bin/sh
# Build gminfo (prints gainmap + gainmap-* fields via libvips) statically in
# the warm build container (see .agents/skills/build). Output: ./gminfo
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
C=${CONTAINER:-vipsedit}
docker cp "$HERE/gminfo.c" "$C:/tmp/gminfo.c"
docker exec "$C" sh -c 'export PKG_CONFIG_LIBDIR=/target/lib/pkgconfig
cc -O1 /tmp/gminfo.c -o /tmp/gminfo $(pkg-config --cflags vips) \
  -Wl,--start-group $(pkg-config --libs --static vips) -Wl,--end-group -lz -static -fopenmp'
docker cp "$C:/tmp/gminfo" "$HERE/gminfo"
echo "built $HERE/gminfo"
