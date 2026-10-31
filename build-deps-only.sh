#!/usr/bin/env bash
set -euo pipefail
# build-deps-only.sh — run upstream build/posix.sh MINUS its Cleanup/packaging tail.
#
# Why: posix.sh ends with `rm -rf $TARGET/lib/{pkgconfig,cmake,...}` + copydeps
# tarball. That deletion breaks every later cmake/meson find that relies on
# .pc files or *Config.cmake (e.g. libheif's dav1d/SVT-AV1 detection,
# OpenEXR's Imath config). Our static extras need that metadata, and we don't
# ship the shared fallback tarball anyway.
#
# How: operate on a COPY (upstream files unmodified), cut before `^# Cleanup$`,
# then strip the text/SVG stack (fontconfig/harfbuzz/freetype/pixman/cairo/
# fribidi/pango/rsvg) — libvips `text` + `svgload` only; preview.cc never uses
# them. expat stays (unconditional vips core dep).
SRC="${1:-/packaging/build/posix.sh}"
TMP="$(mktemp -d)/posix-deps-only.sh"
awk '/^# Cleanup$/{exit} {print}' "$SRC" > "$TMP"
# Strip text/SVG stack from the COPY only (upstream files unmodified):
# drop mkdir ${DEPS}/<dir> ... meson install blocks for the 7 dirs, plus the
# build_freetype function + both its calls (only needed for fontconfig/pango).
python3 - "$TMP" <<'EOF'
import re, sys
path = sys.argv[1]
skip_dirs = {"fontconfig", "harfbuzz", "pixman", "cairo", "fribidi", "pango", "rsvg"}
mkdir_re = re.compile(r"^mkdir \$\{DEPS\}/(\S+)")
with open(path) as f:
    lines = f.readlines()
out = []
in_block = False
in_func = False
for line in lines:
    if in_func:
        if line.startswith("}"):
            in_func = False
        continue
    if line.startswith("build_freetype()"):
        in_func = True
        continue
    if line.startswith("build_freetype "):
        continue
    if in_block:
        if "meson install -C _build --tag devel" in line:
            in_block = False
        continue
    m = mkdir_re.match(line)
    if m and m.group(1) in skip_dirs:
        in_block = True
        continue
    out.append(line)
with open(path, "w") as f:
    f.writelines(out)
print(f"text/SVG stack stripped: {len(lines) - len(out)} lines dropped")
EOF
# Harden downloads in the COPY only (upstream files unmodified): fail fast on
# HTTP errors instead of piping error pages into tar/patch, and retry harder
# (transient 429s from github after many fetches kill `patch` otherwise).
sed -i 's|--retry 3 --retry-max-time 30|--retry 5 --retry-max-time 60 --fail --retry-all-errors|' "$TMP"
# Perf over size (COPY only): upstream defaults to -Os/MinSizeRel/OPT_LEVEL=z.
# This project ships a 26MB static binary where decode/resize dominate, so
# build everything -O3/Release. Explicit per-dep -O3 lines stay harmless.
sed -i 's/-Os -fPIC/-O3 -fPIC/' "$TMP"
sed -i 's/MinSizeRel/Release/g' "$TMP"
sed -i 's/OPT_LEVEL=z/OPT_LEVEL=3/' "$TMP"
# No text/SVG rendering: vips `text` (pangocairo+fontconfig) and `svgload`
# (rsvg+cairo) are unused by preview.cc. Force them off in the COPY's vips
# setup (auto_features would otherwise re-enable them while the libs exist;
# after the strip above they are absent, so this is a hard gate).
sed -i 's/-Dauto_features=enabled/-Dauto_features=enabled -Dpangocairo=disabled -Drsvg=disabled -Dfontconfig=disabled/' "$TMP"
# Sanity: must keep the shared-vips install, must drop the tarball step.
grep -q "meson install -C _build --tag runtime,devel" "$TMP" \
  || { echo "ERROR: cut dropped the vips install" >&2; exit 1; }
grep -q "pangocairo=disabled" "$TMP" \
  || { echo "ERROR: text/SVG disable flags missing" >&2; exit 1; }
for _d in fontconfig harfbuzz pixman cairo fribidi pango rsvg; do
  if grep -q "mkdir \${DEPS}/${_d}" "$TMP"; then
    echo "ERROR: text/SVG strip missed ${_d}" >&2; exit 1
  fi
done
if grep -q "^build_freetype" "$TMP"; then
  echo "ERROR: text/SVG strip missed build_freetype" >&2; exit 1
fi
if grep -q "tar chzf" "$TMP"; then
  echo "ERROR: cut kept the packaging step" >&2; exit 1
fi
echo "=== upstream deps-only build (no cleanup/packaging) ==="
# Execute directly so the upstream `#!/usr/bin/env bash` shebang applies
# (the script uses bash-only `export VAR+=...`; `sh` would fail).
chmod +x "$TMP"
"$TMP"
echo "=== upstream deps-only build done, /target metadata intact ==="
