#!/usr/bin/env bash
set -euo pipefail
# build-deps-only.sh — run upstream build/posix.sh MINUS its Cleanup/packaging tail.
#
# Why: posix.sh ends with `rm -rf $TARGET/lib/{pkgconfig,cmake,...}` + copydeps
# tarball. That deletion breaks every later cmake/meson find that relies on
# .pc files or *-config.cmake (e.g. libheif's FindAOM degrades to "headers but
# AOM_LIBRARY=<not found>", libjxl's FindHWY fails hard). Our static extras
# need that metadata, and we don't ship the shared fallback tarball anyway.
#
# How: operate on a COPY (upstream files unmodified), cut before `^# Cleanup$`.
SRC="${1:-/packaging/build/posix.sh}"
TMP="$(mktemp -d)/posix-deps-only.sh"
awk '/^# Cleanup$/{exit} {print}' "$SRC" > "$TMP"
# Harden downloads in the COPY only (upstream files unmodified): fail fast on
# HTTP errors instead of piping error pages into tar/patch, and retry harder
# (transient 429s from github after many fetches kill `patch` otherwise).
sed -i 's|--retry 3 --retry-max-time 30|--retry 5 --retry-max-time 60 --fail --retry-all-errors|' "$TMP"
# Sanity: must keep the shared-vips install, must drop the tarball step.
grep -q "meson install -C _build --tag runtime,devel" "$TMP" \
  || { echo "ERROR: cut dropped the vips install" >&2; exit 1; }
grep -q "tar chzf" "$TMP" \
  && { echo "ERROR: cut kept the packaging step" >&2; exit 1; } || true
echo "=== upstream deps-only build (no cleanup/packaging) ==="
# Execute directly so the upstream `#!/usr/bin/env bash` shebang applies
# (the script uses bash-only `export VAR+=...`; `sh` would fail).
chmod +x "$TMP"
"$TMP"
echo "=== upstream deps-only build done, /target metadata intact ==="
