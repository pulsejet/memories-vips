#!/usr/bin/env bash
set -euo pipefail
# fetch-upstream.sh — fetch kleisauke/libvips-packaging at our pin, overlay its
# build.sh/build/platforms/versions.properties here (upstream never vendored).
# Used by CI and local builds alike.
source ./versions.camera.properties
curl -sL --retry 3 "https://github.com/$UPSTREAM_REPO/archive/refs/tags/$UPSTREAM_TAG.tar.gz" \
  -o /tmp/upstream.tar.gz
rm -rf /tmp/upstream && mkdir -p /tmp/upstream
tar xzC /tmp/upstream --strip-components=1 -f /tmp/upstream.tar.gz
cp /tmp/upstream/build.sh ./build.sh
rm -rf ./build ./platforms
cp -r /tmp/upstream/build ./build
cp -r /tmp/upstream/platforms ./platforms
cp /tmp/upstream/versions.properties ./versions.properties
ls build platforms
