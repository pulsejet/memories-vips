# vips-static — portable static-contained libvips C++ CLI

Ship `libvips` + camera preview CLI as **2 fully-static musl binaries**
(`linux-x64`, `linux-arm64`) that run on both `glibc≥2.28` and `musl≥1.2.5`
hosts. No system imaging libs required.

## Status

Releases ship `vips-cli-linux-x64-static` and `vips-cli-linux-arm64-static`
(built as `linux-musl-*`, renamed by CI), both `NEEDED=0`. AVIF encodes
(SVT-AV1) and decodes (dav1d); HEIC is decode-only (libde265, no x265) — `.heic`
output errors.

## Releases

Tags are named `v{upstream}-{build}`, e.g. `v8.18.5-1`: the upstream libvips
version plus our build number. Bump the trailing number for rebuilds (script
or pin changes); change the upstream part when rebasing `UPSTREAM_TAG`.
Keep `src/version.h` (`kPreviewBuild`) on the same trailing number —
`--version` prints `{upstream}-{build}` (e.g. `8.18.7-10`).

## Layout (own files; upstream never forked)

| File | Purpose |
|---|---|
| `versions.camera.properties` | Pins for delta deps + `UPSTREAM_TAG` + heif codec toggles |
| `fetch-upstream.sh` | Overlay upstream `build.sh`/`build`/`platforms` at pin (CI + local) |
| `build-deps-only.sh` | Upstream `posix.sh` minus Cleanup tail (copy, unmodified) |
| `build-camera-extras.sh` | Delta static deps + `libheif`/`libvips` rebuild + `-static` CLI link |
| `src/preview.cc` + `src/{protocol,image,usage,util,transforms/*}.h` + `src/json.hpp` | JSON-stdin CLI (`info \| thumbnail \| convert` via `{"cmd":...}` on stdin; saver from output ext, `"stdout":true` streams; `"edits"` ordered pixel + geometric edits) + vendored nlohmann/json 3.11.3 |
| `.github/workflows/build.yml` | 2-job matrix (musl x64/arm64), `v*` tag → release |

`build-deps-only.sh` stops before upstream's
`rm -rf $TARGET/lib/{pkgconfig,cmake,...}` so `.pc` + CMake metadata survive
for the static rebuilds. Upstream files are only ever read.

## Editor (`editor/`)

Headless WebGL preview library (`@radialapps/memories-vips-editor`, pure TS,
zero deps): takes a caller canvas, renders an ordered edit list, and
serializes the same list as JSON. The CLI applies it via `"edits"` on
`convert`/`thumbnail` — same pixels the canvas showed (ICC + gainmap
preserved). See `editor/README.md`; demo via
`cd editor && npm install && npm run dev`.

## Build

```bash
./fetch-upstream.sh
docker build --pull -t vips-dev-linux-musl-x64 platforms/linux-musl-x64
docker run --rm -v "$PWD:/packaging" vips-dev-linux-musl-x64 \
  sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"
```

ARM64: same with `linux-musl-arm64` (native runner, or `--platform linux/arm64` under QEMU — works, ~3h).

## Deltas vs upstream (`kleisauke/libvips-packaging@v8.18.7`)

- New static deps: `dav1d 1.5.4`, `libde265 1.0.19`, `SVT-AV1 4.2.0`,
  `Imath 3.1.12`, `OpenEXR 3.2.12`, `libraw 0.22.2`.
- Dropped: the text/SVG stack (`cairo`, `pango`, `rsvg`, ...).
- `libheif`: `WITH_LIBDE265/DAV1D/SvtEnc=1`, `WITH_X265/AOM=0`,
  `ENABLE_PLUGIN_LOADING=0`.
- `libvips`: `--default-library=static -Dmodules=disabled`,
  `raw/heif/spng/openexr/cgif` enabled, plus built-in `ppm/radiance` (upstream
  leaves them off), plus the HEIC gainmap patches in `patches/`.
- CLI: `c++ preview.cc $(pkg-config --libs --static vips-cpp)` closed in
  `--start-group/--end-group -lz`, linked `-static`; build gates on
  `readelf -d` showing no `NEEDED`.
