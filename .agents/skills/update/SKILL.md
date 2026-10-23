---
name: update
description: Bump UPSTREAM_TAG and delta dep pins safely (patch-only for extras, full upstream rebase via overlay)
---

Bump lib versions in this repo (`vips-static`).

## Pins

- `versions.camera.properties`: owns `UPSTREAM_TAG` + 9 delta pins (`BROTLI DAV1D LIBDE265 X265 OPENJPEG IMATH OPENEXR LIBRAW LIBJXL`).
- `versions.properties`, `build.sh`, `build/`, `platforms/`: upstream overlay, gitignored. Never edit — refresh with `./fetch-upstream.sh`.

## Workflow

1. Read `versions.camera.properties`. Fetch upstream latest:
   `https://raw.githubusercontent.com/kleisauke/libvips-packaging/main/versions.properties`
   and tags from `https://github.com/kleisauke/libvips-packaging/releases`.
2. Upstream bump = change `UPSTREAM_TAG` only (e.g. `v8.18.5` → `v8.18.7`). Upstream minor/patch bumps are pre-tested by their CI — take whole tag, never cherry-pick.
3. Delta deps: patch-only within same `major.minor`. Known safe examples: `brotli x.y.z → x.y.z+1`, `libde265 1.0.x`, `openexr 3.2.x`. Skip `x265 4.x`, `imath 3.1 → 3.2`, `openexr 3.2 → 3.5`, `libde265 1.0 → 1.1` (API/ABI or new-dep changes).
4. Verify each candidate before editing:
   - `curl -sIL <tarball-url>` must 302 to `codeload.github.com` (exists).
   - CMake option names used in `build-camera-extras.sh` (`cmake_dep` args, `-DENABLE_*`, `-DOPENEXR_*`, `-DBROTLI_*`) still exist in the new tarball.
5. Apply: edit `versions.camera.properties`, run `./fetch-upstream.sh`, then `bash -n fetch-upstream.sh build-deps-only.sh build-camera-extras.sh`.
6. Update `README.md` "Deltas vs upstream" header + dep list to match. Check `build/posix.sh` at the new tag still has `# Cleanup`, `meson install -C _build --tag runtime,devel`, `tar chzf` markers (else `build-deps-only.sh` cut logic breaks). Do not claim verified without a CI/local build.
