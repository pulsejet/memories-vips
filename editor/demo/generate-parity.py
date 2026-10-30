#!/usr/bin/env python3
"""Render the VIPS-side JPEGs for editor/demo/parity.html (visual parity only).

Reads the committed case list (editor/demo/parity-cases.json, shared with
demo/parity.ts) and runs a host vips-preview binary over the UltraHDR
fixture. Writes parity/src.jpg plus one parity/vips-<id>.jpg per case.
No checks of any kind — eyeball the page.

The source is thumbnailed to the preview's working resolution (longest
side 2048, aspect-fit) so both sides start from identical pixels: the
browser pipeline downscales larger uploads to MAX_DIM before editing,
while `convert` edits at native resolution — comparing full-res VIPS
output against a downscaled preview would make radius-in-pixels edits
(blur/sharpen) mismatch by the scale factor.

Usage: python3 editor/demo/generate-parity.py [--bin PATH] [--quality 90]

Binary: --bin, $VIPS_PREVIEW_BIN, else /tmp/opencode/vips-preview (copy it
out with: docker cp vipsedit:/target/bin/vips-preview /tmp/opencode/vips-preview).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))  # editor/demo
REPO = os.path.dirname(os.path.dirname(HERE))  # repo root
DATA = os.path.join(REPO, "tests", "data")
CASES_FILE = os.path.join(HERE, "parity-cases.json")
ASSETS = os.path.join(HERE, "parity")
DEFAULT_BIN = "/tmp/opencode/vips-preview"


def run(bin: str, req: dict) -> None:
    subprocess.run([bin], input=json.dumps(req).encode(), check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="render VIPS-side JPEGs for parity.html")
    ap.add_argument("--bin", default=None)
    ap.add_argument("--quality", type=int, default=90)
    args = ap.parse_args()
    bin = args.bin or os.environ.get("VIPS_PREVIEW_BIN", DEFAULT_BIN)

    with open(CASES_FILE) as f:
        cases = [(c["id"], c["edits"]) for c in json.load(f)["cases"]]

    os.makedirs(ASSETS, exist_ok=True)
    src = os.path.join(ASSETS, "src.jpg")
    run(
        bin,
        {
            "cmd": "thumbnail",
            "input": os.path.join(DATA, "ultra-hdr.jpg"),
            "output": src,
            "width": 2048,
            "height": 2048,
            "crop": "none",
            "quality": args.quality,
        },
    )
    for slug, edits in cases:
        out = os.path.join(ASSETS, f"vips-{slug}.jpg")
        run(
            bin,
            {
                "cmd": "convert",
                "input": src,
                "output": out,
                "quality": args.quality,
                "edits": edits,
            },
        )
        print(out)

    wanted = {f"vips-{s}.jpg" for s, _ in cases} | {"src.jpg"}
    for name in sorted(os.listdir(ASSETS)):
        if name.endswith(".jpg") and name not in wanted:
            os.unlink(os.path.join(ASSETS, name))
            print(f"removed {name}")


if __name__ == "__main__":
    main()
