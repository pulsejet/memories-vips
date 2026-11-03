#!/usr/bin/env python3
"""Mutation fuzz of HEIC metadata bytes against vips-preview thumbnail.

  python3 -I fuzz.py BIN FILE [--n 400] [--lo 0] [--hi 8192] [--jobs 8]

Flips 1-12 random bytes in [lo, hi) per iteration (seeded, reproducible).
Pass = no signal/timeout, and no failure mentioning uhdr/gainmap (corrupt
containers rejected by libheif are fine). Crashers saved to out/fuzz/.
"""
import argparse, os, random, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument("bin"); ap.add_argument("file")
ap.add_argument("--n", type=int, default=400)
ap.add_argument("--lo", type=int, default=0)
ap.add_argument("--hi", type=int, default=8192)
ap.add_argument("--jobs", type=int, default=8)
a = ap.parse_args()
HERE = os.path.dirname(os.path.abspath(__file__))
crashdir = os.path.join(HERE, "out", "fuzz"); os.makedirs(crashdir, exist_ok=True)
src = open(a.file, "rb").read()
hi = min(a.hi, len(src))

def one(it):
    rnd = random.Random(it); m = bytearray(src)
    for _ in range(rnd.randint(1, 12)):
        m[rnd.randrange(a.lo, hi)] = rnd.randrange(256)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "f.heic"); open(p, "wb").write(m)
        req = '{"cmd":"thumbnail","input":"%s","output":"%s/o.jpg"}' % (p, td)
        try:
            r = subprocess.run(["sh", "-c", f'"$0" 3>&1 2>/dev/null', a.bin],
                               input=req.encode(), capture_output=True, timeout=60)
            rc, out = r.returncode, r.stdout.decode(errors="replace")
        except subprocess.TimeoutExpired:
            rc, out = "timeout", ""
    bad = rc not in (0, 1) or (rc == 1 and re.search(r"uhdr|gainmap", out))
    if bad:
        open(os.path.join(crashdir, f"crash_{it}.heic"), "wb").write(m)
    return rc, bool(bad)

with ThreadPoolExecutor(a.jobs) as ex:
    res = list(ex.map(one, range(a.n)))
fails = sum(1 for rc, _ in res if rc == 1)
bad = sum(1 for _, b in res if b)
print(f"{a.n} runs: ok={a.n - fails - bad} rejected={fails} BAD={bad}")
sys.exit(1 if bad else 0)
