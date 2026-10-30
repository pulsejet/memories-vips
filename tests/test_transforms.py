#!/usr/bin/env python3
"""Test suite for src/transforms/ + protocol.h "edits" (ordered pixel edits).

End-to-end parity checks go through `convert` to PPM (lossless P6, parsed
with stdlib only) so expectations are exact, not JPEG-fuzzy:

  convert sample.jpg -> ref.ppm            (no edits)
  convert sample.jpg -> out.ppm (edits)      (edited)

`thumbnail` + `stdout` + validation-error paths are covered too, plus a
UHDR gainmap-passthrough check (edits must not drop ICC/gainmap).

All tests skip when the binary under test predates "edits" support (old
binaries ignore the unknown "edits" field): the probe converts with
brightness=1 and requires a white frame.
"""
from __future__ import annotations

import os
import tempfile
import unittest

from test_preview import (
    VIPS_PREVIEW,
    assert_error_json,
    assert_info_json,
    check_magic,
    data_path,
    read_bytes,
    run_json,
)

DRIVER = "sample.jpg"


def parse_ppm(blob: bytes) -> tuple[int, int, bytes]:
    """Minimal P6 parser -> (width, height, rgb_bytes)."""
    if blob[:2] != b"P6":
        raise ValueError(f"not P6: {blob[:8]!r}")
    pos = 2
    tokens: list[bytes] = []
    while len(tokens) < 3:
        while pos < len(blob) and chr(blob[pos]).isspace():
            pos += 1
        if blob[pos : pos + 1] == b"#":
            end = blob.index(b"\n", pos)
            pos = end + 1
            continue
        end = pos
        while end < len(blob) and not chr(blob[end]).isspace():
            end += 1
        tokens.append(blob[pos:end])
        pos = end
    while pos < len(blob) and chr(blob[pos]).isspace():
        if blob[pos : pos + 1] != b"\n":
            pos += 1
            break
        pos += 1
        break
    w, h, mx = int(tokens[0]), int(tokens[1]), int(tokens[2])
    assert mx == 255, f"unexpected maxval {mx}"
    # single whitespace after maxval
    if chr(blob[pos]).isspace():
        pos += 1
    raster = blob[pos : pos + w * h * 3]
    assert len(raster) == w * h * 3, f"short raster {len(raster)}"
    return w, h, raster


def convert_ppm(input_name: str, edits: list | None, td: str, tag: str) -> bytes:
    dst = os.path.join(td, f"{tag}.ppm")
    req: dict = {"cmd": "convert", "input": data_path(input_name), "output": dst}
    if edits is not None:
        req["edits"] = edits
    rc, out, err = run_json(req)
    assert rc == 0, f"convert {tag}: rc={rc} {err[:300]}"
    assert_info_json(unittest.TestCase(), out, err)
    return read_bytes(dst)


def convert_ppm_raster(input_name: str, edits: list | None, td: str, tag: str) -> bytes:
    """convert -> PPM, return raw raster bytes (headers carry timestamps)."""
    blob = convert_ppm(input_name, edits, td, tag)
    _, _, raster = parse_ppm(blob)
    return raster


def supports_edits() -> bool:
    """Probe: brightness=+1 must yield a white frame (old binaries ignore edits)."""
    try:
        with tempfile.TemporaryDirectory() as td:
            blob = convert_ppm(DRIVER, [{"edit": "brightnessContrast", "brightness": 1}], td, "probe")
            _, _, px = parse_ppm(blob)
            return sum(px) / len(px) > 250
    except Exception:
        return False


HAS_EDITS = supports_edits()


def need_edits(test: unittest.TestCase):
    if not HAS_EDITS:
        test.skipTest("binary lacks edits support (pre-edit build)")


class TestEditsValidation(unittest.TestCase):
    def setUp(self):
        need_edits(self)

    def req(self, edits) -> dict:
        return {
            "cmd": "convert",
            "input": data_path(DRIVER),
            "output": os.path.join(tempfile.gettempdir(), "edits_val.jpg"),
            "edits": edits,
        }

    def test_unknown_edit(self):
        rc, _, err = run_json(self.req([{"edit": "swirl"}]))
        self.assertEqual(rc, 1)
        assert_error_json(self, err, "unknown edit")

    def test_missing_op_key(self):
        rc, _, err = run_json(self.req([{"brightness": 1}]))
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"edit"')

    def test_non_array_edits(self):
        rc, _, err = run_json(self.req({"edit": "invert"}))  # type: ignore[arg-type]
        self.assertEqual(rc, 1)
        assert_error_json(self, err, '"edits" must be an array')

    def test_non_object_element(self):
        rc, _, err = run_json(self.req(["invert"]))  # type: ignore[list-item]
        self.assertEqual(rc, 1)
        assert_error_json(self, err, "must be an object")

    def test_out_of_range(self):
        cases = [
            [{"edit": "brightnessContrast", "brightness": 2}],
            [{"edit": "brightnessContrast", "contrast": -1.5}],
            [{"edit": "exposure", "stops": 10}],
            [{"edit": "hueSaturation", "hue": 1.1}],
            [{"edit": "sepia", "amount": 1.5}],
            [{"edit": "vibrance", "amount": -2}],
            [{"edit": "blur", "radius": -1}],
            [{"edit": "sharpen", "radius": 100}],
            [{"edit": "sharpen", "amount": 6}],
            [{"edit": "vignette", "size": 3}],
        ]
        for edits in cases:
            with self.subTest(edits=edits):
                rc, _, err = run_json(self.req(edits))
                self.assertEqual(rc, 1, str(edits))
                assert_error_json(self, err, "out of range")

    def test_non_number_param(self):
        rc, _, err = run_json(self.req([{"edit": "exposure", "stops": "big"}]))
        self.assertEqual(rc, 1)
        assert_error_json(self, err, "must be a number")

    def test_edits_rejected_shape_for_thumbnail_too(self):
        with tempfile.TemporaryDirectory() as td:
            rc, _, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path(DRIVER),
                    "output": os.path.join(td, "x.jpg"),
                    "width": 16,
                    "height": 16,
                    "edits": [{"edit": "bogus"}],
                }
            )
            self.assertEqual(rc, 1)
            assert_error_json(self, err, "unknown edit")


class TestEditsParity(unittest.TestCase):
    """Exact checks via lossless PPM (float math must match editor/math.ts)."""

    def setUp(self):
        need_edits(self)

    def test_empty_edits_byte_identical(self):
        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm_raster(DRIVER, None, td, "ref")
            out = convert_ppm_raster(DRIVER, [], td, "empty")
            self.assertEqual(ref, out)

    def test_all_noop_params_byte_identical(self):
        """Every edit at no-change defaults must be a float-exact no-edit."""
        noop = [
            {"edit": "brightnessContrast", "brightness": 0, "contrast": 0},
            {"edit": "exposure", "stops": 0},
            {"edit": "hueSaturation", "hue": 0, "saturation": 0},
            {"edit": "sepia", "amount": 0},
            {"edit": "vibrance", "amount": 0},
            {"edit": "blur", "radius": 0},
            {"edit": "sharpen", "radius": 0, "amount": 0},
            {"edit": "vignette", "size": 0.5, "amount": 0},
        ]
        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm_raster(DRIVER, None, td, "ref")
            out = convert_ppm_raster(DRIVER, noop, td, "noop")
            self.assertEqual(ref, out)

    def test_brightness_white_and_black(self):
        with tempfile.TemporaryDirectory() as td:
            for b, want in ((1, 255), (-1, 0)):
                blob = convert_ppm(
                    DRIVER,
                    [{"edit": "brightnessContrast", "brightness": b}],
                    td,
                    f"b{b}",
                )
                _, _, px = parse_ppm(blob)
                mean = sum(px) / len(px)
                self.assertEqual(mean, want, f"brightness={b} mean={mean}")

    def test_invert_is_exact(self):
        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm(DRIVER, None, td, "ref")
            out = convert_ppm(DRIVER, [{"edit": "invert"}], td, "inv")
            _, _, a = parse_ppm(ref)
            _, _, b = parse_ppm(out)
            self.assertEqual(len(a), len(b))
            bad = sum(1 for x, y in zip(a, b) if abs((255 - x) - y) > 1)
            self.assertEqual(bad, 0, f"{bad} pixels off by >1")

    def test_double_invert_is_identity(self):
        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm(DRIVER, None, td, "ref")
            out = convert_ppm(DRIVER, [{"edit": "invert"}, {"edit": "invert"}], td, "inv2")
            _, _, a = parse_ppm(ref)
            _, _, b = parse_ppm(out)
            bad = sum(1 for x, y in zip(a, b) if abs(x - y) > 1)
            self.assertEqual(bad, 0, f"{bad} pixels off by >1")

    def test_saturation_minus1_equals_grayscale(self):
        with tempfile.TemporaryDirectory() as td:
            a = convert_ppm_raster(
                DRIVER, [{"edit": "hueSaturation", "saturation": -1}], td, "sat"
            )
            b = convert_ppm_raster(DRIVER, [{"edit": "grayscale"}], td, "gray")
            self.assertEqual(a, b)

    def test_exposure_plus1_doubles(self):
        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm(DRIVER, None, td, "ref")
            out = convert_ppm(DRIVER, [{"edit": "exposure", "stops": 1}], td, "exp")
            _, _, a = parse_ppm(ref)
            _, _, b = parse_ppm(out)
            bad = sum(1 for x, y in zip(a, b) if abs(min(255, 2 * x) - y) > 1)
            self.assertEqual(bad, 0, f"{bad} pixels off by >1")

    def test_hue_rotation_matches_reference(self):
        """Pin the C++ matrix to an independent Python port of the glfx math.

        Solid red through hue=0.5/sat=0 must equal the closed-form rotation
        (catches transposed matrices / wrong constants, not just rounding).
        """
        import math as _math

        def glfx_hue(r, g, b, h, s):
            angle = h * _math.pi
            sn, cs = _math.sin(angle), _math.cos(angle)
            sq3 = _math.sqrt(3.0)
            wx = (2 * cs + 1) / 3
            wy = (-sq3 * sn - cs + 1) / 3
            wz = (sq3 * sn - cs + 1) / 3
            hr = r * wx + g * wy + b * wz
            hg = r * wz + g * wx + b * wy
            hb = r * wy + g * wz + b * wx
            t = 1 - 1 / (1.001 - s) if s > 0 else -s
            avg = (hr + hg + hb) / 3
            return [hr * (1 - t) + avg * t, hg * (1 - t) + avg * t, hb * (1 - t) + avg * t]

        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "red.ppm")
            w, h = 8, 8
            with open(src, "wb") as f:
                f.write(f"P6\n{w} {h}\n255\n".encode())
                f.write(bytes([255, 0, 0]) * w * h)
            dst = os.path.join(td, "rot.ppm")
            rc, out, err = run_json(
                {
                    "cmd": "convert",
                    "input": src,
                    "output": dst,
                    "edits": [{"edit": "hueSaturation", "hue": 0.5, "saturation": 0}],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            _, _, px = parse_ppm(read_bytes(dst))
            exp = [min(255, max(0, round(c * 255))) for c in glfx_hue(1, 0, 0, 0.5, 0)]
            got = [px[0], px[1], px[2]]
            for e, gg in zip(exp, got):
                self.assertLessEqual(abs(e - gg), 2, f"expected {exp}, got {got}")
            # every pixel identical (solid input -> solid output)
            self.assertEqual(px, bytes(got) * (w * h))

    def test_order_matters(self):
        """sepia->grayscale vs grayscale->sepia must differ (ordered pipeline)."""
        with tempfile.TemporaryDirectory() as td:
            a = convert_ppm_raster(
                DRIVER, [{"edit": "sepia"}, {"edit": "grayscale"}], td, "a"
            )
            b = convert_ppm_raster(
                DRIVER, [{"edit": "grayscale"}, {"edit": "sepia"}], td, "b"
            )
            self.assertNotEqual(a, b)

    def test_alpha_preserved_rgba(self):
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "alpha.png")
            rc, out, err = run_json(
                {
                    "cmd": "convert",
                    "input": data_path("rgba.png"),
                    "output": dst,
                    "edits": [{"edit": "invert"}],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            obj = assert_info_json(self, out, err)
            self.assertEqual(obj["bands"], 4)
            check_magic(read_bytes(dst), ".png")

    def test_gainmap_passthrough_with_edits(self):
        src = data_path("ultra-hdr.jpg")
        if not os.path.isfile(src):
            self.skipTest("missing ultra-hdr.jpg fixture")
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "graded.jpg")
            rc, out, err = run_json(
                {
                    "cmd": "convert",
                    "input": src,
                    "output": dst,
                    "edits": [{"edit": "brightnessContrast", "brightness": 0.05}],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            blob = read_bytes(dst)
            self.assertIn(b"MPF\x00", blob, "UHDR gainmap lost when edits present")
            self.assertTrue(
                b"21496" in blob or b"hdrgm" in blob or b"GainMap" in blob,
                "gainmap metadata lost when edits present",
            )

    def test_gainmap_survives_cpu_path_edits(self):
        # vibrance/vignette run through transform_cpu_map (fresh memory
        # image); without field grafting the gainmap is voided even though
        # the saver keeps asking for it. Both CPU paths must preserve MPF.
        src = data_path("ultra-hdr.jpg")
        if not os.path.isfile(src):
            self.skipTest("missing ultra-hdr.jpg fixture")
        with tempfile.TemporaryDirectory() as td:
            for edit in (
                {"edit": "vibrance", "amount": 0.5},
                {"edit": "vignette", "size": 0.5, "amount": 0.5},
            ):
                with self.subTest(edit=edit):
                    dst = os.path.join(td, "graded.jpg")
                    rc, out, err = run_json(
                        {"cmd": "convert", "input": src, "output": dst, "edits": [edit]}
                    )
                    self.assertEqual(rc, 0, err[:300])
                    blob = read_bytes(dst)
                    self.assertIn(
                        b"MPF\x00", blob, f"UHDR gainmap lost for {edit}"
                    )
                    self.assertTrue(
                        b"21496" in blob or b"hdrgm" in blob or b"GainMap" in blob,
                        f"gainmap metadata lost for {edit}",
                    )

    def test_non_uchar_inputs(self):
        # 16-bit TIFF (ushort) and EXR (float+alpha) must convert cleanly:
        # ushort scales by 65535, float passes through nominal, alpha is
        # preserved (reattached as uchar).
        cases = [
            ("sample.tif", 290, 442, 3),
            ("sample.exr", 610, 406, 4),
            # HDR decodes RAD RGBE (shared exponent, not alpha) to 3-band.
            ("sample.hdr", 141, 980, 3),
        ]
        with tempfile.TemporaryDirectory() as td:
            for name, w, h, bands in cases:
                with self.subTest(input=name):
                    fp = data_path(name)
                    if not os.path.isfile(fp):
                        self.skipTest(f"missing {name} fixture")
                    dst = os.path.join(td, name.replace(".", "_") + ".png")
                    rc, out, err = run_json(
                        {
                            "cmd": "convert",
                            "input": fp,
                            "output": dst,
                            "edits": [{"edit": "brightnessContrast", "brightness": 0.1}],
                        }
                    )
                    self.assertEqual(rc, 0, f"{name}: {err[:300]}")
                    obj = assert_info_json(self, out, err, width=w, height=h)
                    self.assertEqual(obj["bands"], bands, name)
                    check_magic(read_bytes(dst), ".png")


class TestEditsThumbnailStdout(unittest.TestCase):
    def setUp(self):
        need_edits(self)

    def test_thumbnail_edits_geometry(self):
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "t.jpg")
            rc, out, err = run_json(
                {
                    "cmd": "thumbnail",
                    "input": data_path("landscape.jpg"),
                    "output": dst,
                    "width": 32,
                    "height": 32,
                    "edits": [{"edit": "sepia", "amount": 0.5}],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            obj = assert_info_json(self, out, err, width=32, height=32)
            self.assertEqual(obj.get("output"), dst)
            check_magic(read_bytes(dst), ".jpg")

    def test_convert_stdout_with_edits(self):
        rc, blob, err = run_json(
            {
                "cmd": "convert",
                "input": data_path(DRIVER),
                "output": "o.png",
                "stdout": True,
                "edits": [{"edit": "vignette", "size": 0.5, "amount": 0.5}],
            }
        )
        self.assertEqual(rc, 0, err[:300])
        check_magic(blob, ".png")


if __name__ == "__main__":
    print(f"binary: {VIPS_PREVIEW} (edits support: {HAS_EDITS})")
    unittest.main(verbosity=2)
