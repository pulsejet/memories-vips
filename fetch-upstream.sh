#!/usr/bin/env bash
set -euo pipefail
# fetch-upstream.sh — fetch kleisauke/libvips-packaging at our pin, overlay its
# build.sh/build/platforms/versions.properties here (upstream never vendored).
# Used by CI and local builds alike.
cd "$(dirname "$0")"
source ./versions.camera.properties

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -sSL --fail --retry 3 "https://github.com/$UPSTREAM_REPO/archive/refs/tags/$UPSTREAM_TAG.tar.gz" \
  | tar xzC "$TMP" --strip-components=1

rm -rf ./build ./platforms
cp -r "$TMP/build" "$TMP/platforms" "$TMP/build.sh" "$TMP/versions.properties" .
ls build platforms
