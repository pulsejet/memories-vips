#!/bin/bash
# Old-vs-new matrix: thumbnail -> jpg/webp, convert -> jpg, then check the
# JPEG thumb's gainmap with ./gminfo against the expected max boost.
#
#   NEW=out/vips-preview [OLD=/path/to/release/vips-preview] ./matrix.sh [extra files...]
#
# Extra files (e.g. a private iPhone HEIC) get no expectation, just a report.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
NEW=${NEW:-$HERE/out/vips-preview}
OLD=${OLD:-}
GM=$HERE/gminfo
O=$HERE/out/matrix; mkdir -p "$O"; rm -f "$O"/*
SM=$HERE/samples
REPO_DATA=$HERE/../data
# file|expected max boost of JPEG thumb gainmap ("none" = plain SDR JPEG)
CASES="
$SM/apple-v1-iphone13pro.heic|7.3717
$SM/apple-v2-ios18-iphone15pro.heic|2.7692
$SM/libheif-example.heic|none
$SM/libheif-example.avif|none
$SM/chan-iso-01.avif|none
$SM/chan-iso-02.avif|none
$SM/chan-iso-03.avif|none
$SM/synth/synth_iso_hdrgm_minimal.heic|4
$SM/synth/synth_apple_attr_headroom3.heic|3
$SM/synth/synth_apple_noheadroom.heic|none
$SM/synth/synth_badxml.heic|none
$REPO_DATA/samsung-heic-gainmap.heic|4.9246
$REPO_DATA/apple-heic-gainmap.heic|7.3717
"
for f in "$@"; do CASES="$CASES
$f|?"; done

run() { echo "$2" | timeout 120 "$1" 3>"$O/err" >/dev/null 2>&1; echo $?; }
boost() { # jpg -> max boost or none
  [ -f "$1" ] || { echo missing; return; }
  "$GM" "$1" 2>/dev/null | awk '/gainmap: \(none\)/{print "none"; exit} /max-content-boost:/{print $2; exit}'
}
fail=0
printf "%-36s %-5s %-5s %-5s %-5s %-9s %-9s %s\n" file old jpg webp conv boost expect result
while IFS='|' read -r f exp; do
  [ -n "$f" ] || continue
  n=$(basename "$f")
  [ -f "$f" ] || { printf "%-36s (missing, run fetch_samples.sh / make_synth.py)\n" "$n"; continue; }
  o=-; [ -n "$OLD" ] && o=$(run "$OLD" '{"cmd":"thumbnail","input":"'$f'","output":"'$O/$n.old.jpg'"}')
  j=$(run "$NEW" '{"cmd":"thumbnail","input":"'$f'","output":"'$O/$n.jpg'"}')
  w=$(run "$NEW" '{"cmd":"thumbnail","input":"'$f'","output":"'$O/$n.webp'"}')
  c=$(run "$NEW" '{"cmd":"convert","input":"'$f'","output":"'$O/$n.conv.jpg'","quality":85}')
  b=$(boost "$O/$n.jpg")
  r=PASS
  [ "$j$w$c" = 000 ] || r=FAIL
  [ "$exp" = "?" ] || [ "$b" = "$exp" ] || r=FAIL
  [ "$exp" = "?" ] && [ $r = PASS ] && r=ok
  [ $r = FAIL ] && fail=1
  printf "%-36s %-5s %-5s %-5s %-5s %-9s %-9s %s\n" "$n" "$o" "$j" "$w" "$c" "$b" "$exp" "$r"
done <<< "$CASES"
exit $fail
