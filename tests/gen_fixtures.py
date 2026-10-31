#!/usr/bin/env python3
"""Fetch real-photo fixtures into tests/data (no synthetic gradients).

Every input is a real file: a native upstream sample (photo, graphic, HDR).

Usage:
    python3 tests/gen_fixtures.py [--bin PATH] [--no-verify]

Only stdlib is used (urllib). Re-running is idempotent: files already present
are kept, unless their size differs from a pinned one.
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
    ("sample.tif", f"{LIBVIPS}/sample.tif", 769526),
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
    cands.append("/tmp/opencode/testbins/vips-preview")
    cands.append(shutil.which("vips-preview") or "")
    for c in cands:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    raise SystemExit(
        "vips-preview binary not found; set VIPS_PREVIEW_BIN or pass --bin "
        "(needed to verify fixtures)"
    )


def fetch(url: str, dest: str, expect: int | None) -> None:
    if os.path.isfile(dest):
        if expect is None or os.path.getsize(dest) == expect:
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


def verify(binpath: str) -> None:
    bad = []
    for fn in sorted(os.listdir(DATA)):
        if fn.endswith(".md"):
            continue
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
            # fd 3 is closed here, so the info line lands on stderr.
            print(f"ok   {fn}: {p.stderr.decode().strip()[:110]}")
    if bad:
        raise SystemExit(f"{len(bad)} fixtures unreadable")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", default=None)
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args()
    binpath = None if args.no_verify else find_binary(args.bin)
    os.makedirs(DATA, exist_ok=True)
    for name, url, expect in FIXTURES:
        fetch(url, os.path.join(DATA, name), expect)
    if binpath:
        print(f"binary: {binpath}")
        verify(binpath)


if __name__ == "__main__":
    main()
