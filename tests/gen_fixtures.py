#!/usr/bin/env python3
"""Fetch real-photo fixtures into tests/data (no synthetic gradients).

Every input is a real file: either a native upstream sample (photo,
graphic, HDR, vector) or a transcode of a real photo into a container
we have no small native sample for (JXL). Nothing here is a generated
gradient/pattern.

Usage:
    VIPS_PREVIEW_BIN=/tmp/.../vips-preview python3 tests/gen_fixtures.py
    python3 tests/gen_fixtures.py --bin /path/to/vips-preview

Only stdlib is used (urllib). Re-running is idempotent: files are
skipped when already present with the expected size.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

LIBVIPS = (
    "https://raw.githubusercontent.com/libvips/libvips/master/test/test-suite/images"
)

# (target name, source URL, expected bytes or None to skip check)
FIXTURES: list[tuple[str, str, int | None]] = [
    ("sample.jpg", f"{LIBVIPS}/sample.jpg", 22951),
    ("rgba.png", f"{LIBVIPS}/rgba.png", 21300),
    ("indexed.png", f"{LIBVIPS}/indexed.png", 90869),
    ("rgba-correct.ppm", f"{LIBVIPS}/rgba-correct.ppm", 12341),
    ("cogs.gif", f"{LIBVIPS}/cogs.gif", 2759),
    ("photo.webp", f"{LIBVIPS}/1.webp", 30320),
    ("orientation6.avif", f"{LIBVIPS}/avif-orientation-6.avif", 162011),
    ("world.jp2", f"{LIBVIPS}/world.jp2", 63958),
    ("sample.tif", f"{LIBVIPS}/sample.tif", 769526),
    ("logo.svg", f"{LIBVIPS}/logo.svg", 4700),
    ("sample.exr", f"{LIBVIPS}/sample.exr", 378570),
    ("sample.hdr", f"{LIBVIPS}/sample.hdr", 432160),
    ("ultra-hdr.jpg", f"{LIBVIPS}/ultra-hdr.jpg", 1190669),
    ("gainmap-odd.jpg", f"{LIBVIPS}/gainmap-odd-dimensions.jpg", 2041),
    (
        "example.heic",
        "https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic",
        718114,
    ),
    (
        "flower-gray.png",
        "https://raw.githubusercontent.com/libjxl/testdata/main/jxl/flower/flower_small.g.png",
        131801,
    ),
    # Picsum serves real Unsplash photos; IDs are stable. Sizes vary
    # slightly with upstream recompresses, so no byte check.
    ("landscape.jpg", "https://picsum.photos/id/1016/800/600", None),
    ("portrait.jpg", "https://picsum.photos/id/1015/600/800", None),
]


def find_binary(explicit: str | None) -> str:
    cands: list[str] = []
    if explicit:
        cands.append(explicit)
    cands.append(os.environ.get("VIPS_PREVIEW_BIN", ""))
    cands.append("/tmp/opencode/testbins/v8.18.5-2/vips-preview")
    cands.append("/tmp/opencode/testbins/vips-preview")
    cands.append(shutil.which("vips-preview") or "")
    for c in cands:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    raise SystemExit(
        "vips-preview binary not found; set VIPS_PREVIEW_BIN or pass --bin "
        "(needed to derive sample-photo.jxl and verify fixtures)"
    )


def fetch(url: str, dest: str, expect: int | None) -> None:
    if os.path.isfile(dest) and expect is not None:
        if os.path.getsize(dest) == expect:
            print(f"keep {os.path.basename(dest)}")
            return
        print(f"size mismatch for {os.path.basename(dest)}, re-fetching")
    req = urllib.request.Request(url, headers={"User-Agent": "vips-static-tests"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    got = os.path.getsize(dest)
    print(f"got {os.path.basename(dest)} {got} bytes")
    if expect is not None and got != expect:
        print(
            f"WARNING: {dest} is {got} bytes, expected {expect} "
            "(upstream changed; update the table)",
            file=sys.stderr,
        )


def derive_jxl(binpath: str) -> None:
    """Encode sample-photo.jxl from the real photo sample.jpg.

    No small native real-world JXL photo sample is pinned; the pixels
    are still a real photograph, just carried in a locally-encoded
    JXL container.
    """
    src = os.path.join(DATA, "sample.jpg")
    dst = os.path.join(DATA, "sample-photo.jxl")
    p = subprocess.run(
        [binpath],
        input=json.dumps({"cmd": "convert", "input": src, "output": dst}).encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if p.returncode != 0:
        raise SystemExit(f"JXL derive failed: {p.stderr.decode()[:300]}")
    print(f"derived sample-photo.jxl {os.path.getsize(dst)} bytes from sample.jpg")


def verify(binpath: str) -> None:
    bad = []
    for fn in sorted(os.listdir(DATA)):
        fp = os.path.join(DATA, fn)
        p = subprocess.run(
            [binpath],
            input=json.dumps({"cmd": "info", "input": fp}).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if p.returncode != 0:
            bad.append((fn, p.stderr.decode()[:150]))
            print(f"FAIL {fn}: {p.stderr.decode()[:150]}")
        else:
            print(f"ok   {fn}: {p.stdout.decode().strip()[:110]}")
    if bad:
        raise SystemExit(f"{len(bad)} fixtures unreadable")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", default=None)
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args()
    binpath = find_binary(args.bin)
    os.makedirs(DATA, exist_ok=True)
    print(f"binary: {binpath}")
    for name, url, expect in FIXTURES:
        fetch(url, os.path.join(DATA, name), expect)
    derive_jxl(binpath)
    if not args.no_verify:
        verify(binpath)


if __name__ == "__main__":
    main()
