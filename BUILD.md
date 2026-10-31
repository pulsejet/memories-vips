# Local build guide

Builds the two fully-static `vips-preview` binaries with Docker. No system
imaging libraries are needed on the host — only Docker.

## Prerequisites

- Docker with BuildKit (`docker buildx version` should work).
- ~10 GB free disk, 8+ GB RAM. A full run downloads ~2 GB of sources.
- For `linux/arm64` on an x86_64 host: QEMU user-mode emulation via binfmt.

## 1. Fetch upstream

Upstream (`kleisauke/libvips-packaging` at our pin) is never vendored —
fetch it as a tarball overlay:

```bash
./fetch-upstream.sh
```

This drops `build.sh`, `build/`, `platforms/` and `versions.properties`
into the worktree (all git-ignored). Re-run it after changing
`UPSTREAM_TAG` in `versions.camera.properties`.

## 2a. Build x86_64 (native)

```bash
docker build --pull -t vips-dev-linux-musl-x64 platforms/linux-musl-x64
docker run --rm -v "$PWD:/packaging" vips-dev-linux-musl-x64 \
  sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"
# → vips-cli-linux-musl-x64-static.tar.gz (~11 MB)
```

Takes ~50 min on a fast machine. CI renames the tarball to
`vips-cli-linux-x64-static`.

## 2b. Build aarch64

On an ARM64 host (or the `ubuntu-26.04-arm` CI runner), same as above with
`linux-musl-arm64` (takes ~1 h natively).

On x86_64, enable emulation first (one-time, needs privileges), then build
with `--platform` (takes ~3–4 h):

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
docker build --platform linux/arm64 --pull -t vips-dev-linux-musl-arm64 \
  platforms/linux-musl-arm64
docker run --rm --platform linux/arm64 \
  -v "$PWD:/packaging" vips-dev-linux-musl-arm64 \
  sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"
# → vips-cli-linux-musl-arm64-static.tar.gz (~14 MB)
```

## 3. Verify the result

```bash
mkdir -p /tmp/cli && tar xzC /tmp/cli -f vips-cli-linux-musl-x64-static.tar.gz
readelf -d /tmp/cli/vips-preview | grep -c NEEDED   # must print 0 (fully static)
python3 -c "open('/tmp/in.ppm','wb').write(b'P6\n64 64\n255\n'+bytes([200,30,30])*64*64)"
echo '{"cmd":"info","input":"/tmp/in.ppm"}' | /tmp/cli/vips-preview 3>&1 1>/dev/null
# {"bands":3,"filename":"/tmp/in.ppm","format":...,"height":64,"interpretation":...,"width":64}
# (info JSON goes to fd 3; stdout carries file bytes only, so it stays empty here)
echo '{"cmd":"convert","input":"/tmp/in.ppm","output":"/tmp/a.avif"}' \
  | /tmp/cli/vips-preview 3>&1 1>/dev/null             # AV1 encode (SVT-AV1)
# HEVC encode removed (no x265): .heic output now errors; HEIC *decode* still works via libde265
echo '{"cmd":"thumbnail","input":"/tmp/in.ppm","output":"t.jpg","stdout":true}' \
  | /tmp/cli/vips-preview 3>/tmp/info.json > /tmp/t.jpg; cat /tmp/info.json
                                                       # saver from OUTPUT ext,
                                                       # bytes on stdout, JSON on fd 3
```

AVIF encode must succeed; HEIC encode must fail cleanly (no x265). The aarch64
binary can be smoke-tested the same way on x86_64 once binfmt is installed
(it executes transparently under QEMU).

## What the two scripts do

- `build-deps-only.sh` runs a truncated copy of upstream `build/posix.sh`,
  stopping before its `rm -rf $TARGET/lib/{pkgconfig,cmake,...}` cleanup,
  so `.pc` + CMake metadata survive for the static rebuilds. It also strips
  the text/SVG stack (`fontconfig/harfbuzz/freetype/pixman/cairo/fribidi/
  pango/rsvg` — `text` + `svgload`, unused by the CLI) and forces
  `-Dpangocairo=disabled -Drsvg=disabled -Dfontconfig=disabled` on the
  vips setup. Upstream files are only ever read, never modified.
- `build-camera-extras.sh` builds the delta static deps (dav1d,
  libde265, SVT-AV1, Imath, OpenEXR, libraw), rebuilds
  `libheif` (AV1 + HEVC-decode built in, no plugins) and `libvips` (static, no
  modules), links `src/preview.cc` with `-static`, gates on `readelf`
  showing no `NEEDED`, and packs the tarball with `versions.json`.

Both run in a single `docker run` lifetime because `/deps` and `/target`
are ephemeral container storage.

## Troubleshooting

- `tar: invalid magic` / `patch: Only garbage` mid-build: a source download
  failed transiently (usually GitHub rate-limiting). Just re-run — the
  scripts harden curl with `--fail` + retries, but a bad fetch still aborts.
- Emulated ARM build dies silently (frozen log, no container): usually the
  OOM killer — check `docker logs` on the container (daemon-side logs stay
  complete even if a piped log file stalls).
- `ld: cannot find -lgcc_s`: stale `x265.pc` from older builds — removed
  with x265; if it recurs, another dep's `.pc` is injecting it
  (`grep -r lgcc_s /target/lib/pkgconfig` inside the container).
