---
name: build
description: Build the fully-static vips-preview musl binaries locally with Docker
---

Build both static CLIs. Full guide: `BUILD.md`. Only Docker is needed on the host.

## Steps

1. `./fetch-upstream.sh` (re-run after any `UPSTREAM_TAG` change; drops gitignored `build.sh`, `build/`, `platforms/`, `versions.properties`).
2. x86_64 (native, ~50 min):
   `docker build --pull -t vips-dev-linux-musl-x64 platforms/linux-musl-x64`
   `docker run --rm -v "$PWD:/packaging" vips-dev-linux-musl-x64 sh -c "/packaging/build-deps-only.sh && /packaging/build-camera-extras.sh"`
   → `vips-cli-linux-musl-x64-static.tar.gz`.
3. aarch64: same with `linux-musl-arm64` on ARM64 host (~1 h). On x86_64, one-time `docker run --privileged --rm tonistiigi/binfmt --install arm64`, then add `--platform linux/arm64` to build and run (~3–4 h).

## Rules

- Both scripts must run in one `docker run` lifetime (`/deps`, `/target` are ephemeral). Never run `build/posix.sh` directly — `build-deps-only.sh` truncates before its `rm -rf $TARGET/lib/{pkgconfig,cmake,...}` cleanup so `.pc`/CMake metadata survive.
- Never modify upstream `build/` or `platforms/`; our logic lives in `build-deps-only.sh` / `build-camera-extras.sh` / `src/preview.cc`.

## Verify

`tar xzC /tmp/cli -f vips-cli-linux-musl-x64-static.tar.gz`, then `readelf -d /tmp/cli/vips-preview | grep -c NEEDED` must print `0`. Smoke-test per `BUILD.md §3`: `info` on a PPM, `convert` to `.avif` (aom) and `.heic` (x265) — both must succeed — plus `thumbnail` with `"stdout":true`. Emulated aarch64 binary runs transparently under QEMU once binfmt is installed. On `tar: invalid magic` mid-build, just re-run (transient GitHub rate-limit).

## Fast C++ iteration (the important part)

**Keep a container `vipsedit` alive** with a warm `/target` - full rebuilds (~40+ min) are unnecessary.

If it's not found then start it up:
```bash
docker run -d --name vipsedit -v "$PWD:/packaging" vips-dev-linux-musl-x64 sleep infinity
# then one-time warm-up (~40 min, background it):
docker exec vipsedit sh -c '/packaging/build-deps-only.sh > /packaging/build-full2.log 2>&1 && /packaging/build-camera-extras.sh >> /packaging/build-full2.log 2>&1'
```
