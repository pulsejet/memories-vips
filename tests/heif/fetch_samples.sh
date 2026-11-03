#!/bin/sh
# Download public HEIC/AVIF samples used by matrix.sh into samples/.
# Idempotent; checks sizes where pinned.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
D="$HERE/samples"
mkdir -p "$D"
get() { # name url [bytes]
  if [ -f "$D/$1" ] && { [ -z "${3:-}" ] || [ "$(wc -c <"$D/$1")" -eq "$3" ]; }; then return; fi
  echo "fetch $1"
  curl -sfL -o "$D/$1" "$2"
  if [ -n "${3:-}" ] && [ "$(wc -c <"$D/$1")" -ne "$3" ]; then echo "size mismatch: $1" >&2; exit 1; fi
}
# iPhone 13 Pro, Apple gainmap v1 (maker note headroom 7.3717). MIT.
get apple-v1-iphone13pro.heic https://media.githubusercontent.com/media/johncf/apple-hdr-heic/master/tests/data/hdr-sample.heic 238982
# iPhone 15 Pro on iOS 18, Apple gainmap v2 (XMP headroom 2.769) + tmap item.
# From libheif issue #1190 (license unspecified: test use only, don't commit).
if [ ! -f "$D/apple-v2-ios18-iphone15pro.heic" ]; then
  get IMG_1159.zip https://github.com/user-attachments/files/15864812/IMG_1159.zip
  (cd "$D" && unzip -oq IMG_1159.zip IMG_1159.HEIC && mv IMG_1159.HEIC apple-v2-ios18-iphone15pro.heic && rm IMG_1159.zip)
fi
# Plain HEIC/AVIF (no gainmap). MIT.
get libheif-example.heic https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic 718114
get libheif-example.avif https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.avif
# ISO 21496-1 AVIF (tmap item, not an aux gainmap: expected SDR).
for i in 01 02 03; do
  get chan-iso-$i.avif https://people.csail.mit.edu/ericchan/hdr/gain_map_images_iso_avif/${i}_base_sdr.avif
done
echo "samples in $D"
