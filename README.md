# vips-static — portable static-contained libvips C++ CLI

Implements `PLAN.md`: ship `libvips` + C++ preview CLI as **2 fully-static
musl binaries** (`linux-x64`, `linux-arm64`) that run on both `glibc≥2.28`
and `musl≥1.2.5` hosts. No system imaging libs required.

## Layout (own files only, upstream never forked)

| File | Purpose |
|---|---|
| `versions.camera.properties` | Pins for delta deps + `UPSTREAM_TAG` |
| `build-deps-only.sh` | Upstream `posix.sh` minus Cleanup tail (copy, unmodified) |
| `build-camera-extras.sh` | Delta static deps + `libheif`/`libvips` static rebuild + `-static` CLI link |
| `src/preview.cc` | `info \| thumbnail \| convert` CLI (`vips_thumbnail`, shrink-on-load) |
| `.github/workflows/build.yml` | 2-job matrix (musl x64/arm64), `v*` tag → release |

Upstream (`kleisauke/libvips-packaging` `build.sh`, `build/`, `platforms/`,
`versions.properties`) is fetched as a **tarball at pin** in CI, never vendored.

## Local build (matches CI)

```bash
source versions.camera.properties
curl -sL "https://github.com/$UPSTREAM_REPO/archive/refs/tags/$UPSTREAM_TAG.tar.gz" -o /tmp/up.tar.gz
mkdir -p /tmp/up && tar xzC /tmp/up --strip-components=1 -f /tmp/up.tar.gz
cp /tmp/up/build.sh . && rm -rf build platforms && cp -r /tmp/up/build . && cp -r /tmp/up/platforms . && cp /tmp/up/versions.properties .
docker build --pull -t vips-dev-linux-musl-x64 platforms/linux-musl-x64
docker run --rm -v "$PWD:/packaging" vips-dev-linux-musl-x64 \
  sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"
```

`build-deps-only.sh` runs upstream `posix.sh` without its final
`rm -rf $TARGET/lib/{pkgconfig,cmake,...}` cleanup, so `.pc` + CMake
metadata survive for the static rebuilds.

Primary artifact: `vips-cli-{linux-x64,linux-arm64}-static.tar.gz`
(built by the `linux-musl-*` images; musl-static runs on glibc too).
glibc `linux-{x64,arm64}` image builds are dropped — they only produced
fallback shared tarballs, which we don't ship unless static hits a data-file issue.

## Deltas vs upstream

- New static deps: `brotli 1.2.0`, `dav1d 1.5.4`, `libde265 1.0.16`,
  `x265 4.1`, `openjpeg 2.5.4`, `Imath 3.1.12`, `OpenEXR 3.2.4`,
  `libraw 0.22.2`, `libjxl 0.12.0`.
- `libheif`: `-DWITH_X265=1 -DWITH_LIBDE265=1 -DWITH_AOM=1 -DWITH_DAV1D=1 -DENABLE_PLUGIN_LOADING=0`.
- `libvips`: `--default-library=static -Dmodules=disabled`
  `-Draw=enabled -Dheif=enabled -Djpeg-xl=enabled -Dopenjpeg=enabled -Dspng=enabled -Dopenexr=enabled -Dcgif=enabled`,
  plus `-Dppm=true -Dradiance=true` (built-in, no deps; upstream leaves them off).
- `svt-av1`/`rav1e` deliberately OFF (`aom` already covers AV1 encode).
- CLI link: `c++ preview.cc $(pkg-config --libs --static vips-cpp) -static -static-libstdc++ -static-libgcc`; build gates on `readelf -d` showing no `NEEDED`.

## License note

Per PLAN: ignored — consumers are AGPL3. Static archive pulls in
GPL (`x265`), LGPL, BSD, MIT, Apache-2.0 code. `versions.json` in each
tarball records exact versions.
