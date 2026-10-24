#!/usr/bin/env python3
"""Test suite for src/ (vips-preview JSON-stdin CLI).

Covers first-party code:
  preview.cc  --help/-h/help, argv rejection, empty stdin, JSON parse,
               dispatch to info/thumbnail/convert, VError mapping.
  protocol.h  cmd/input/output/stdout/width/height/crop/quality parsing,
               defaults, lowercasing, "thumb" alias, type + value errors.
  image.h     run_info fields, run_thumbnail crop modes + geometry,
               run_convert, save_image saver dispatch per extension,
               strip (thumbnail) vs preserve (convert), file vs stdout.
  util.h      lower/ends_with via case-insensitive cmd/crop/extension.
  usage.h     help text content.

Fixtures: tests/data/* are REAL files (photos, graphics, HDR, vector —
see data/SOURCES.md and gen_fixtures.py). Nothing is a generated
gradient. Binary: $VIPS_PREVIEW_BIN, else well-known paths, else PATH.

Stdlib only (unittest). Run:
    VIPS_PREVIEW_BIN=/path/to/vips-preview python3 -m unittest discover -s tests -v
    # or
    python3 tests/test_preview.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "data"))
BIN = os.environ.get("VIPS_PREVIEW_BIN", "")


def find_binary() -> str:
    cands = [
        BIN,
        "/tmp/opencode/testbins/v8.18.5-2/vips-preview",
        "/tmp/opencode/testbins/vips-preview",
        os.path.join(HERE, "..", "vips-preview"),
        shutil.which("vips-preview") or "",
    ]
    for c in cands:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    raise unittest.SkipTest(
        "vips-preview binary not found; set VIPS_PREVIEW_BIN "
        "(e.g. /tmp/opencode/testbins/v8.18.5-2/vips-preview)"
    )


VIPS_PREVIEW = find_binary()

# Real fixtures and their verified dimensions (vips-preview info).
EXPECTED_DIMS = {
    "sample.jpg": (290, 442),
    "landscape.jpg": (800, 600),
    "portrait.jpg": (600, 800),
    "rgba.png": (128, 128),
    "indexed.png": (290, 442),
    "flower-gray.png": (510, 532),
    "rgba-correct.ppm": (64, 64),
    "cogs.gif": (85, 77),
    "photo.webp": (550, 368),
    "orientation6.avif": (3024, 4032),
    "example.heic": (1280, 854),
    "sample.tif": (290, 442),
    "logo.svg": (736, 552),
    "sample.exr": (610, 406),
    "sample.hdr": (141, 980),
    "ultra-hdr.jpg": (3840, 2160),
    "gainmap-odd.jpg": (129, 97),
}

# Saver-matrix + convert driver: a real photo (not a gradient).
DRIVER = "sample.jpg"

ALL_INPUTS = sorted(EXPECTED_DIMS.keys())


def data_path(name: str) -> str:
    return os.path.join(DATA, name)


def read_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def run_raw(stdin: bytes, argv: list[str] | None = None):
    """Run binary with raw stdin bytes; return (rc, stdout_bytes, stderr_text)."""
    p = subprocess.run(
        [VIPS_PREVIEW] + (argv or []),
        input=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return p.returncode, p.stdout, p.stderr.decode("utf-8", "replace")


def run_json(req: dict, argv: list[str] | None = None):
    rc, out, err = run_raw(json.dumps(req).encode(), argv)
    return rc, out, err


def assert_error_json(test: unittest.TestCase, stderr: str, needle: str = ""):
    test.assertTrue(stderr.strip(), "expected JSON error on stderr")
    try:
        obj = json.loads(stderr.strip().splitlines()[0])
    except json.JSONDecodeError:
        test.fail(f"stderr is not JSON: {stderr[:300]!r}")
    test.assertIn("error", obj, f"stderr JSON lacks 'error': {stderr[:300]!r}")
    if needle:
        test.assertIn(needle, obj["error"], f"error {obj['error']!r} lacks {needle!r}")


def check_magic(blob: bytes, ext: str):
    ext = ext.lower()
    if ext in (".jpg", ".jpeg"):
        assert blob[:3] == b"\xff\xd8\xff", f"bad jpeg magic {blob[:8]!r}"
    elif ext == ".png":
        assert blob[:8] == b"\x89PNG\r\n\x1a\n", f"bad png magic {blob[:8]!r}"
    elif ext == ".webp":
        assert blob[:4] == b"RIFF" and blob[8:12] == b"WEBP", f"bad webp {blob[:12]!r}"
    elif ext in (".avif",):
        assert b"ftypavif" in blob[:32], f"bad avif {blob[:32]!r}"
    elif ext in (".heic", ".heif"):
        assert b"ftyp" in blob[:32], f"bad heic {blob[:32]!r}"
    elif ext in (".tiff", ".tif"):
        assert blob[:4] in (b"II*\x00", b"MM\x00*"), f"bad tiff {blob[:8]!r}"
    elif ext == ".gif":
        assert blob[:6] in (b"GIF89a", b"GIF87a"), f"bad gif {blob[:8]!r}"
    elif ext in (".ppm", ".pgm"):
        assert blob[:2] in (b"P6", b"P5"), f"bad ppm/pgm {blob[:8]!r}"
    else:
        assert len(blob) > 0, "empty output"


class TestHelpAndArgv(unittest.TestCase):
    """preview.cc argv + usage.h."""

    def test_help_flags(self):
        for argv in (["--help"], ["-h"], ["help"], ["--HELP"], ["-H"]):
            with self.subTest(argv=argv):
                rc, out, err = run_raw(b"", argv=argv)
                self.assertEqual(rc, 0, f"{argv} rc={rc} err={err[:200]}")
                text = out.decode()
                self.assertIn("usage:", text)
                self.assertIn('"cmd":"info"', text)
                self.assertIn('"cmd":"thumbnail"', text)
                self.assertIn('"cmd":"convert"', text)
                self.assertIn("vips=", text)

    def test_stale_argv_rejected(self):
        rc, out, err = run_raw(b"", argv=["foo"])
        self.assertEqual(rc, 1)
        self.assertEqual(out, b"")
        assert_error_json(self, err, "no argv commands")
        self.assertIn("usage:", err)

    def test_empty_stdin(self):
        rc, out, err = run_raw(b"")
        self.assertEqual(rc, 1)
        self.assertEqual(out, b"")
        assert_error_json(self, err, "empty stdin")

    def test_invalid_json(self):
        rc, out, err = run_raw(b"not json")
        self.assertEqual(rc, 1)
        self.assertEqual(out, b"")
        assert_error_json(self, err, "invalid JSON")

    def test_non_object_json(self):
        for payload in (b"[1,2]", b'"hi"', b"42", b"null"):
            with self.subTest(payload=payload):
                rc, out, err = run_raw(payload)
                self.assertEqual(rc, 1)
                assert_error_json(self, err, "must be an object")


class TestProtocolValidation(unittest.TestCase):
    """protocol.h parse_request."""

    def test_cmd_required_and_enum(self):
        rc, _, err = run_json({"input": data_path(DRIVER)})
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"cmd"')
        rc, _, err = run_json({"cmd": "bogus", "input": "x"})
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"cmd" must be')

    def test_cmd_case_insensitive_and_thumb_alias(self):
        with tempfile.TemporaryDirectory() as td:
            for cmd in ("INFO", "Info", "info"):
                rc, out, err = run_json({"cmd": cmd, "input": data_path(DRIVER)})
                self.assertEqual(rc, 0, f"{cmd}: {err[:200]}")
                self.assertEqual(json.loads(out.decode())["width"], 290)
            for cmd in ("thumb", "THUMB", "Thumbnail", "THUMBNAIL"):
                dst = os.path.join(td, f"alias_{cmd}.jpg")
                rc, _, err = run_json(
                    {
                        "cmd": cmd,
                        "input": data_path(DRIVER),
                        "output": dst,
                        "width": 16,
                        "height": 16,
                    }
                )
                self.assertEqual(rc, 0, f"{cmd}: {err[:200]}")
                self.assertTrue(os.path.isfile(dst))

    def test_input_required(self):
        rc, _, err = run_json({"cmd": "info"})
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"input"')
        rc, _, err = run_json({"cmd": "info", "input": 42})
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"input"')

    def test_output_required_for_thumbnail_convert(self):
        rc, _, err = run_json({"cmd": "thumbnail", "input": data_path(DRIVER)})
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"output"')
        rc, _, err = run_json({"cmd": "convert", "input": data_path(DRIVER)})
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"output"')

    def test_info_ignores_output(self):
        # info returns before output validation (protocol.h early return)
        rc, out, err = run_json({"cmd": "info", "input": data_path(DRIVER)})
        self.assertEqual(rc, 0, err[:200])
        obj = json.loads(out.decode())
        self.assertEqual((obj["width"], obj["height"]), (290, 442))

    def test_stdout_must_be_boolean(self):
        with tempfile.TemporaryDirectory() as td:
            rc, _, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path(DRIVER),
                    "output": os.path.join(td, "x.jpg"),
                    "stdout": "yes",
                }
            )
            self.assertEqual(rc, 1)
            assert_error_json(self, err, '"stdout" must be a boolean')

    def test_width_height_validation(self):
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "x.jpg")
            base = {"cmd": "thumbnail", "input": data_path(DRIVER), "output": dst}
            for bad in (0, -1, -100):
                for key in ("width", "height"):
                    req = dict(base, **{key: bad})
                    rc, _, err = run_json(req)
                    self.assertEqual(rc, 1, f"{key}={bad}")
                    assert_error_json(self, err, "positive")
            for bad in ("big", True, [], {}):
                req = dict(base, width=bad)
                rc, _, err = run_json(req)
                self.assertEqual(rc, 1, f"width={bad!r}")
                assert_error_json(self, err, '"width" must be a number')

    def test_crop_validation_and_normalization(self):
        with tempfile.TemporaryDirectory() as td:
            rc, _, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path(DRIVER),
                    "output": os.path.join(td, "x.jpg"),
                    "crop": "bogus",
                }
            )
            self.assertEqual(rc, 1)
            assert_error_json(self, err, '"crop" must be')
            for crop in ("Attention", "NONE", "Low", "HIGH"):
                dst = os.path.join(td, f"crop_{crop}.jpg")
                rc, _, err = run_json(
                    {
                        "cmd": "thumbnail",
                        "input": data_path(DRIVER),
                        "output": dst,
                        "width": 16,
                        "height": 16,
                        "crop": crop,
                    }
                )
                self.assertEqual(rc, 0, f"crop={crop}: {err[:200]}")

    def test_quality_must_be_number(self):
        with tempfile.TemporaryDirectory() as td:
            rc, _, err = run_json(
                {
                    "cmd": "convert",
                    "input": data_path(DRIVER),
                    "output": os.path.join(td, "x.jpg"),
                    "quality": "high",
                }
            )
            self.assertEqual(rc, 1)
            assert_error_json(self, err, '"quality" must be a number')

    def test_missing_file_is_verror(self):
        rc, out, err = run_json({"cmd": "info", "input": "/nonexistent-xyz.ppm"})
        self.assertEqual(rc, 1)
        self.assertEqual(out, b"")
        assert_error_json(self, err, "")


class TestInfo(unittest.TestCase):
    """image.h run_info on every real fixture."""

    def test_info_all_inputs(self):
        for name in ALL_INPUTS:
            with self.subTest(input=name):
                fp = data_path(name)
                if not os.path.isfile(fp):
                    self.skipTest(f"missing fixture {name}")
                rc, out, err = run_json({"cmd": "info", "input": fp})
                self.assertEqual(rc, 0, f"{name}: {err[:300]}")
                self.assertEqual(err, "")
                obj = json.loads(out.decode())
                for key in ("width", "height", "bands", "format", "interpretation", "filename"):
                    self.assertIn(key, obj, f"{name} missing {key}")
                ew, eh = EXPECTED_DIMS[name]
                self.assertEqual((obj["width"], obj["height"]), (ew, eh))
                self.assertGreaterEqual(obj["bands"], 1)

    def test_info_bands_spot_checks(self):
        cases = {
            "flower-gray.png": 1,
            "sample.jpg": 3,
            "rgba.png": 4,
            "cogs.gif": 4,
            "sample.exr": 4,
        }
        for name, bands in cases.items():
            with self.subTest(input=name):
                rc, out, err = run_json({"cmd": "info", "input": data_path(name)})
                self.assertEqual(rc, 0, err[:200])
                self.assertEqual(json.loads(out.decode())["bands"], bands)

    def test_info_stdout_clean_stderr_empty(self):
        rc, out, err = run_json({"cmd": "info", "input": data_path("rgba.png")})
        self.assertEqual(rc, 0)
        self.assertEqual(err, "")
        self.assertTrue(out.strip().startswith(b"{"))


class TestThumbnail(unittest.TestCase):
    """image.h run_thumbnail: geometry, crop, quality, strip path."""

    def test_thumbnail_smoke_all_inputs(self):
        # Every real input thumbnails to jpg (jpegsave strip path with
        # keep=icc,gainmap). Shrink-on-load keeps even 12MP AVIF / 8MP UHDR fast.
        with tempfile.TemporaryDirectory() as td:
            for name in ALL_INPUTS:
                with self.subTest(input=name):
                    fp = data_path(name)
                    if not os.path.isfile(fp):
                        self.skipTest(f"missing {name}")
                    dst = os.path.join(td, name.replace(".", "_") + ".jpg")
                    rc, out, err = run_json(
                        {
                            "cmd": "thumbnail",
                            "input": fp,
                            "output": dst,
                            "width": 16,
                            "height": 16,
                        }
                    )
                    self.assertEqual(rc, 0, f"{name}: {err[:300]}")
                    self.assertEqual(out, b"")
                    self.assertEqual(err, "")
                    self.assertTrue(os.path.isfile(dst))
                    self.assertGreater(os.path.getsize(dst), 0)
                    check_magic(read_bytes(dst), ".jpg")

    def test_crop_geometry_real_photos(self):
        # landscape 800x600 and portrait 600x800 (real photos):
        # attention/low/high crop to exact 16x16, none fits aspect.
        with tempfile.TemporaryDirectory() as td:
            cases = [
                ("landscape.jpg", "attention", (16, 16)),
                ("landscape.jpg", "low", (16, 16)),
                ("landscape.jpg", "high", (16, 16)),
                ("landscape.jpg", "none", (16, 12)),
                ("portrait.jpg", "attention", (16, 16)),
                ("portrait.jpg", "none", (12, 16)),
            ]
            for name, crop, expected in cases:
                with self.subTest(input=name, crop=crop):
                    dst = os.path.join(td, f"{name}_{crop}.jpg")
                    rc, _, err = run_json(
                        {
                            "cmd": "thumbnail",
                            "input": data_path(name),
                            "output": dst,
                            "width": 16,
                            "height": 16,
                            "crop": crop,
                        }
                    )
                    self.assertEqual(rc, 0, err[:200])
                    rc2, out2, _ = run_json({"cmd": "info", "input": dst})
                    self.assertEqual(rc2, 0)
                    obj = json.loads(out2.decode())
                    self.assertEqual(
                        (obj["width"], obj["height"]), expected, f"{name}/{crop}"
                    )

    def test_gainmap_thumbnails_stay_uhdr_capable(self):
        # UltraHDR inputs exercise the keep=icc,gainmap saver option: the
        # thumbnail must succeed and re-read as an image.
        with tempfile.TemporaryDirectory() as td:
            for name in ("ultra-hdr.jpg", "gainmap-odd.jpg"):
                with self.subTest(input=name):
                    dst = os.path.join(td, f"{name}.jpg")
                    rc, _, err = run_json(
                        {
                            "cmd": "thumbnail",
                            "input": data_path(name),
                            "output": dst,
                            "width": 32,
                            "height": 32,
                        }
                    )
                    self.assertEqual(rc, 0, f"{name}: {err[:300]}")
                    rc2, out2, _ = run_json({"cmd": "info", "input": dst})
                    self.assertEqual(rc2, 0)
                    self.assertEqual(json.loads(out2.decode())["width"], 32)

    def test_default_geometry_is_512(self):
        with tempfile.TemporaryDirectory() as td:
            # Large photo downscales to exact 512x512 with default crop.
            dst = os.path.join(td, "default.jpg")
            rc, _, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path("landscape.jpg"),
                    "output": dst,
                }
            )
            self.assertEqual(rc, 0, err[:300])
            obj = json.loads(run_json({"cmd": "info", "input": dst})[1].decode())
            self.assertEqual((obj["width"], obj["height"]), (512, 512))
            # Small images are never upscaled (VIPS_SIZE_DOWN).
            small = os.path.join(td, "small.jpg")
            rc, _, err = run_json(
                {"cmd": "thumbnail", "input": data_path(DRIVER), "output": small}
            )
            self.assertEqual(rc, 0, err[:300])
            obj = json.loads(run_json({"cmd": "info", "input": small})[1].decode())
            self.assertEqual((obj["width"], obj["height"]), (290, 442))

    def test_quality_options(self):
        with tempfile.TemporaryDirectory() as td:
            for q in (10, 80, 100):
                with self.subTest(quality=q):
                    dst = os.path.join(td, f"q{q}.jpg")
                    rc, _, err = run_json(
                        {
                            "cmd": "thumbnail",
                            "input": data_path(DRIVER),
                            "output": dst,
                            "width": 32,
                            "height": 32,
                            "quality": q,
                        }
                    )
                    self.assertEqual(rc, 0, err[:200])
                    self.assertGreater(os.path.getsize(dst), 0)

    def test_uppercase_extension(self):
        # util.h lower() on the output extension
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "upper.JPG")
            rc, _, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path(DRIVER),
                    "output": dst,
                    "width": 32,
                    "height": 32,
                }
            )
            self.assertEqual(rc, 0, err[:200])
            check_magic(read_bytes(dst), ".jpg")


class TestConvert(unittest.TestCase):
    """image.h run_convert: full decode + saver dispatch, preserve path."""

    def test_convert_preserves_dimensions(self):
        with tempfile.TemporaryDirectory() as td:
            rc, _, err = run_json(
                {
                    "cmd": "convert",
                    "input": data_path("landscape.jpg"),
                    "output": os.path.join(td, "wide.png"),
                }
            )
            self.assertEqual(rc, 0, err[:200])
            obj = json.loads(
                run_json({"cmd": "info", "input": os.path.join(td, "wide.png")})[1].decode()
            )
            self.assertEqual((obj["width"], obj["height"]), (800, 600))

    def test_convert_quality(self):
        with tempfile.TemporaryDirectory() as td:
            for q in (10, 90):
                dst = os.path.join(td, f"c{q}.jpg")
                rc, _, err = run_json(
                    {
                        "cmd": "convert",
                        "input": data_path(DRIVER),
                        "output": dst,
                        "quality": q,
                    }
                )
                self.assertEqual(rc, 0, err[:200])
                self.assertGreater(os.path.getsize(dst), 0)

    def test_convert_alpha_preserved(self):
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "alpha.png")
            rc, _, err = run_json(
                {"cmd": "convert", "input": data_path("rgba.png"), "output": dst}
            )
            self.assertEqual(rc, 0, err[:200])
            obj = json.loads(run_json({"cmd": "info", "input": dst})[1].decode())
            self.assertEqual(obj["bands"], 4)


class TestSaverDispatch(unittest.TestCase):
    """image.h save_image: one test per saver branch + generic fallback."""

    # ext -> saver branch in save_image
    SAVERS = [
        ".jpg",
        ".jpeg",
        ".webp",
        ".avif",
        ".heic",
        ".heif",
        ".png",
        ".tiff",
        ".gif",
        ".ppm",
    ]

    def test_convert_saver_matrix(self):
        # Real photo pixels through every saver (strip=false path).
        with tempfile.TemporaryDirectory() as td:
            for ext in self.SAVERS:
                with self.subTest(cmd="convert", ext=ext):
                    dst = os.path.join(td, f"out{ext}")
                    rc, out, err = run_json(
                        {
                            "cmd": "convert",
                            "input": data_path(DRIVER),
                            "output": dst,
                        }
                    )
                    self.assertEqual(rc, 0, f"{ext}: {err[:300]}")
                    self.assertEqual(out, b"")
                    blob = read_bytes(dst)
                    self.assertGreater(len(blob), 0)
                    check_magic(blob, ext)
                    rc2, out2, err2 = run_json({"cmd": "info", "input": dst})
                    self.assertEqual(rc2, 0, err2[:200])
                    self.assertEqual(json.loads(out2.decode())["width"], 290)

    def test_thumbnail_saver_matrix(self):
        # Strip=true path (keep=icc,gainmap); thumbnail of a real photo.
        with tempfile.TemporaryDirectory() as td:
            for ext in (".jpg", ".webp", ".avif", ".heic", ".png"):
                with self.subTest(cmd="thumbnail", ext=ext):
                    dst = os.path.join(td, f"thumb{ext}")
                    rc, _, err = run_json(
                        {
                            "cmd": "thumbnail",
                            "input": data_path(DRIVER),
                            "output": dst,
                            "width": 32,
                            "height": 32,
                        }
                    )
                    self.assertEqual(rc, 0, f"{ext}: {err[:300]}")
                    check_magic(read_bytes(dst), ext)

    def test_unsupported_extensions_error(self):
        with tempfile.TemporaryDirectory() as td:
            for ext in (".bmp", ".xyz", ".svg", ".pdf", ".exr", ".jxl", ".jp2"):
                with self.subTest(ext=ext):
                    rc, out, err = run_json(
                        {
                            "cmd": "convert",
                            "input": data_path(DRIVER),
                            "output": os.path.join(td, f"x{ext}"),
                        }
                    )
                    self.assertEqual(rc, 1, ext)
                    self.assertEqual(out, b"")
                    assert_error_json(self, err, "")


class TestStdoutStreaming(unittest.TestCase):
    """image.h to_stdout: bytes on stdout, no file, stderr clean."""

    def test_stdout_matches_file_bytes(self):
        with tempfile.TemporaryDirectory() as td:
            cwd = os.getcwd()
            try:
                os.chdir(td)  # stdout mode must not create ./t.jpg
                for ext in (".jpg", ".png", ".webp"):
                    with self.subTest(ext=ext):
                        rc, blob, err = run_json(
                            {
                                "cmd": "thumbnail",
                                "input": data_path(DRIVER),
                                "output": f"t{ext}",
                                "stdout": True,
                                "width": 32,
                                "height": 32,
                            }
                        )
                        self.assertEqual(rc, 0, err[:200])
                        self.assertEqual(err, "")
                        self.assertGreater(len(blob), 0)
                        check_magic(blob, ext)
                        self.assertFalse(
                            os.path.exists(os.path.join(td, f"t{ext}")),
                            "stdout mode must not write a file",
                        )
                        probe = os.path.join(td, f"probe{ext}")
                        with open(probe, "wb") as f:
                            f.write(blob)
                        rc2, out2, _ = run_json({"cmd": "info", "input": probe})
                        self.assertEqual(rc2, 0)
                        self.assertEqual(json.loads(out2.decode())["width"], 32)
            finally:
                os.chdir(cwd)

    def test_convert_stdout(self):
        rc, blob, err = run_json(
            {
                "cmd": "convert",
                "input": data_path(DRIVER),
                "output": "o.avif",
                "stdout": True,
            }
        )
        self.assertEqual(rc, 0, err[:200])
        check_magic(blob, ".avif")

    def test_file_mode_stdout_empty(self):
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "f.jpg")
            rc, out, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path(DRIVER),
                    "output": dst,
                    "width": 32,
                    "height": 32,
                }
            )
            self.assertEqual(rc, 0)
            self.assertEqual(out, b"")
            self.assertEqual(err, "")

    def test_stdout_errors_stay_on_stderr(self):
        rc, out, err = run_json(
            {
                "cmd": "convert",
                "input": "/nonexistent.ppm",
                "output": "o.jpg",
                "stdout": True,
            }
        )
        self.assertEqual(rc, 1)
        self.assertEqual(out, b"")
        assert_error_json(self, err, "")


if __name__ == "__main__":
    print(f"binary: {VIPS_PREVIEW}")
    unittest.main(verbosity=2)
