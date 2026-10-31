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
import re
import struct
import tempfile
import unittest
import zlib

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
            [{"edit": "shadows", "amount": -2}],
            [{"edit": "highlights", "amount": 1.5}],
            [{"edit": "warmth", "amount": -1.5}],
            [{"edit": "blur", "radius": -1}],
            [{"edit": "sharpen", "radius": 100}],
            [{"edit": "sharpen", "amount": 6}],
            [{"edit": "vignette", "size": 3}],
            [{"edit": "crop", "width": 2}],
            [{"edit": "crop", "x": 2}],
            [{"edit": "rotate", "angle": 200}],
            [{"edit": "rotate", "angle": -181}],
        ]
        for edits in cases:
            with self.subTest(edits=edits):
                rc, _, err = run_json(self.req(edits))
                self.assertEqual(rc, 1, str(edits))
                assert_error_json(self, err, "out of range")

    def test_crop_rejects_empty_and_overflowing_region(self):
        for edits, msg in [
            ([{"edit": "crop", "width": 0}], "must be > 0"),
            ([{"edit": "crop", "height": 0}], "must be > 0"),
            ([{"edit": "crop", "x": 0.8, "width": 0.5}], "exceeds 1"),
            ([{"edit": "crop", "y": 0.8, "height": 0.5}], "exceeds 1"),
            ([{"edit": "crop", "x": "a"}], "must be a number"),
        ]:
            with self.subTest(edits=edits):
                rc, _, err = run_json(self.req(edits))
                self.assertEqual(rc, 1, str(edits))
                assert_error_json(self, err, msg)

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
            {"edit": "shadows", "amount": 0},
            {"edit": "highlights", "amount": 0},
            {"edit": "warmth", "amount": 0},
            {"edit": "blur", "radius": 0},
            {"edit": "sharpen", "radius": 0, "amount": 0},
            {"edit": "vignette", "size": 0.5, "amount": 0},
            {"edit": "crop"},
            {"edit": "crop", "x": 0, "y": 0, "width": 1, "height": 1},
            {"edit": "rotate"},
            {"edit": "rotate", "angle": 0},
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

    def test_shadows_highlights_stay_monotonic(self):
        """No tone reversal: a gray ramp must stay non-decreasing at full strength.

        Regression test: rgb += amount*w with w=(1-v)^2 / v^2 reverses tones
        past |amount|>0.5 (black lifts past mid-gray, white drops below
        near-white), so both edits scale the amount by 0.5.
        """
        with tempfile.TemporaryDirectory() as td:
            w, h = 64, 1
            ramp = bytearray()
            for x in range(w):
                v = round(x * 255 / (w - 1))
                ramp += bytes([v, v, v])
            src = os.path.join(td, "ramp.ppm")
            with open(src, "wb") as f:
                f.write(f"P6\n{w} {h}\n255\n".encode() + bytes(ramp))
            for edit in (
                {"edit": "shadows", "amount": 1},
                {"edit": "shadows", "amount": -1},
                {"edit": "highlights", "amount": 1},
                {"edit": "highlights", "amount": -1},
            ):
                with self.subTest(edit=edit):
                    dst = os.path.join(td, "o.ppm")
                    rc, _, err = run_json(
                        {"cmd": "convert", "input": src, "output": dst, "edits": [edit]}
                    )
                    self.assertEqual(rc, 0, err[:300])
                    _, _, px = parse_ppm(read_bytes(dst))
                    vals = [px[i * 3] for i in range(w)]
                    bad = sum(1 for a, b in zip(vals, vals[1:]) if b < a - 1)
                    self.assertEqual(bad, 0, f"{edit}: ramp reverses at {vals}")

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

    def test_blur_matches_preview_kernel(self):
        """Pin the C++ blur to a Python port of editor/src/math.ts gaussianKernel.

        Both sides must use the same discrete kernel (sigma=radius/2,
        half=min(15,max(1,ceil(2*sigma))), clamp edges); gaussblur's integer
        precision / min_ampl truncation / uncapped mask used to diverge
        (radius 30: maxdiff 32, mean 6).
        """
        import math as _math

        def kernel(radius):
            r = min(100.0, max(0.0, radius))
            if r <= 0:
                return [1.0]
            sigma = r / 2.0
            half = min(15, max(1, _math.ceil(sigma * 2.0)))
            w = [_math.exp(-0.5 * (i / sigma) ** 2) for i in range(-half, half + 1)]
            s = sum(w)
            return [v / s for v in w]

        def blur_roundtrip(src, w, h, k):
            n = len(k)
            c = n // 2
            tmp = [[(0.0, 0.0, 0.0)] * w for _ in range(h)]
            for y in range(h):
                for x in range(w):
                    acc = [0.0, 0.0, 0.0]
                    for i, wt in enumerate(k):
                        xx = min(w - 1, max(0, x + i - c))
                        p = src[(y * w + xx) * 3 : (y * w + xx) * 3 + 3]
                        for ch in range(3):
                            acc[ch] += p[ch] / 255.0 * wt
                    tmp[y][x] = tuple(acc)
            out = bytearray()
            for y in range(h):
                for x in range(w):
                    for ch in range(3):
                        acc = 0.0
                        for i, wt in enumerate(k):
                            yy = min(h - 1, max(0, y + i - c))
                            acc += tmp[yy][x][ch] * wt
                        out.append(min(255, max(0, round(acc * 255))))
            return bytes(out)

        with tempfile.TemporaryDirectory() as td:
            w, h = 24, 16
            px = bytearray()
            for y in range(h):
                for x in range(w):
                    px += bytes([(255 if x >= w // 2 else 0), (x * 11) % 256, (y * 17) % 256])
            src = os.path.join(td, "step.ppm")
            with open(src, "wb") as f:
                f.write(f"P6\n{w} {h}\n255\n".encode() + bytes(px))
            # small radius (full kernel) + large radius (31-tap cap region)
            for radius in (2, 6, 30):
                with self.subTest(radius=radius):
                    dst = os.path.join(td, f"b{radius}.ppm")
                    rc, out, err = run_json(
                        {
                            "cmd": "convert",
                            "input": src,
                            "output": dst,
                            "edits": [{"edit": "blur", "radius": radius}],
                        }
                    )
                    self.assertEqual(rc, 0, err[:300])
                    _, _, got = parse_ppm(read_bytes(dst))
                    exp = blur_roundtrip(bytes(px), w, h, kernel(radius))
                    bad = sum(1 for a, b in zip(got, exp) if abs(a - b) > 1)
                    self.assertEqual(bad, 0, f"radius={radius}: {bad} bytes off by >1")

    def test_sharpen_matches_preview_kernel(self):
        """Unsharp mix must match mix(blur, orig, 1+amount) with the shared kernel."""
        import math as _math

        def kernel(radius):
            sigma = radius / 2.0
            half = min(15, max(1, _math.ceil(sigma * 2.0)))
            w = [_math.exp(-0.5 * (i / sigma) ** 2) for i in range(-half, half + 1)]
            s = sum(w)
            return [v / s for v in w]

        with tempfile.TemporaryDirectory() as td:
            w, h = 24, 16
            px = bytearray()
            for y in range(h):
                for x in range(w):
                    px += bytes([(255 if x >= w // 2 else 0), (x * 11) % 256, (y * 17) % 256])
            src = os.path.join(td, "step.ppm")
            with open(src, "wb") as f:
                f.write(f"P6\n{w} {h}\n255\n".encode() + bytes(px))
            radius, amount = 5, 2.0
            k = kernel(radius)
            n, c = len(k), len(k) // 2
            # separable clamp blur in float, then unsharp mix
            fpx = [v / 255.0 for v in px]
            tmp = []
            for y in range(h):
                row = []
                for x in range(w):
                    acc = [0.0, 0.0, 0.0]
                    for i, wt in enumerate(k):
                        xx = min(w - 1, max(0, x + i - c))
                        for ch in range(3):
                            acc[ch] += fpx[(y * w + xx) * 3 + ch] * wt
                    row.append(acc)
                tmp.append(row)
            exp = bytearray()
            for y in range(h):
                for x in range(w):
                    for ch in range(3):
                        b = sum(tmp[min(h - 1, max(0, y + i - c))][x][ch] * wt for i, wt in enumerate(k))
                        v = fpx[(y * w + x) * 3 + ch] * (1 + amount) - b * amount
                        exp.append(min(255, max(0, round(v * 255))))
            dst = os.path.join(td, "s.ppm")
            rc, out, err = run_json(
                {
                    "cmd": "convert",
                    "input": src,
                    "output": dst,
                    "edits": [{"edit": "sharpen", "radius": radius, "amount": amount}],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            _, _, got = parse_ppm(read_bytes(dst))
            bad = sum(1 for a, b in zip(got, exp) if abs(a - b) > 1)
            self.assertEqual(bad, 0, f"{bad} bytes off by >1")

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


class TestEditsGeometry(unittest.TestCase):
    """Crop/rotate: dims, content mapping, alpha/band flow, metadata."""

    def setUp(self):
        need_edits(self)

    def test_crop_center_geometry_and_content(self):
        # sample.jpg is 290x442: center 50% -> 145x221, center pixel preserved.
        # Rect uses round-half-away (C++ lround / JS Math.round): 0.25*290 =
        # 72.5 -> 73, so compute the expectation the same way.
        import math as _math

        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm(DRIVER, None, td, "ref")
            rw, rh, rpx = parse_ppm(ref)
            out = convert_ppm(
                DRIVER,
                [{"edit": "crop", "x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}],
                td,
                "crop",
            )
            w, h, px = parse_ppm(out)
            self.assertEqual((w, h), (145, 221))
            left, top = _math.floor(0.25 * rw + 0.5), _math.floor(0.25 * rh + 0.5)
            self.assertEqual((left, top), (73, 111))
            for (x, y) in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, h // 2)):
                a = px[(y * w + x) * 3 : (y * w + x) * 3 + 3]
                b = rpx[((y + top) * rw + (x + left)) * 3 : ((y + top) * rw + (x + left)) * 3 + 3]
                self.assertEqual(bytes(a), bytes(b), f"pixel {(x, y)}")

    def test_rotate_quarter_turns_geometry_and_content(self):
        # 290x442: 90 -> 442x290 with out(x,y) == in(y,H-1-x) (clockwise).
        with tempfile.TemporaryDirectory() as td:
            ref = convert_ppm(DRIVER, None, td, "ref")
            rw, rh, rpx = parse_ppm(ref)
            for angle, ew, eh in ((90, 442, 290), (-90, 442, 290), (180, 290, 442)):
                out = convert_ppm(DRIVER, [{"edit": "rotate", "angle": angle}], td, f"r{angle}")
                w, h, px = parse_ppm(out)
                self.assertEqual((w, h), (ew, eh), f"angle={angle}")
                spots = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 3, h // 3)]
                for (x, y) in spots:
                    if angle == 90:
                        ix, iy = y, rh - 1 - x
                    elif angle == -90:
                        ix, iy = rw - 1 - y, x
                    else:
                        ix, iy = rw - 1 - x, rh - 1 - y
                    a = px[(y * w + x) * 3 : (y * w + x) * 3 + 3]
                    b = rpx[(iy * rw + ix) * 3 : (iy * rw + ix) * 3 + 3]
                    self.assertEqual(bytes(a), bytes(b), f"angle={angle} pixel={(x, y)}")

    def test_rotate_arbitrary_expands_and_adds_alpha(self):
        import math as _math

        with tempfile.TemporaryDirectory() as td:
            for angle in (30, 45, -15):
                out = convert_ppm(DRIVER, [{"edit": "rotate", "angle": angle}], td, f"ra{angle}")
                w, h, _ = parse_ppm(out)
                r = _math.radians(angle)
                ew = round(290 * abs(_math.cos(r)) + 442 * abs(_math.sin(r)))
                eh = round(290 * abs(_math.sin(r)) + 442 * abs(_math.cos(r)))
                self.assertEqual((w, h), (ew, eh), f"angle={angle}")
            # 3-band input gains a transparent band; 4-band input keeps 4.
            dst = os.path.join(td, "rot.png")
            rc, bout, berr = run_json(
                {
                    "cmd": "convert",
                    "input": data_path(DRIVER),
                    "output": dst,
                    "edits": [{"edit": "rotate", "angle": 30}],
                }
            )
            self.assertEqual(rc, 0, berr[:300])
            self.assertEqual(assert_info_json(self, bout, berr)["bands"], 4)
            dst2 = os.path.join(td, "rot_rgba.png")
            rc, bout2, berr2 = run_json(
                {
                    "cmd": "convert",
                    "input": data_path("rgba.png"),
                    "output": dst2,
                    "edits": [{"edit": "rotate", "angle": 30}],
                }
            )
            self.assertEqual(rc, 0, berr2[:300])
            self.assertEqual(assert_info_json(self, bout2, berr2)["bands"], 4)

    def test_crop_then_rotate_chain(self):
        # Order matters for geometry too: crop shrinks, rotate expands.
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "chain.ppm")
            rc, out, err = run_json(
                {
                    "cmd": "convert",
                    "input": data_path(DRIVER),
                    "output": dst,
                    "edits": [
                        {"edit": "crop", "x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
                        {"edit": "rotate", "angle": 30},
                        {"edit": "sepia", "amount": 0.5},
                    ],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            w, h, _ = parse_ppm(read_bytes(dst))
            import math as _math

            r = _math.radians(30)
            cw, chh = round(0.8 * 290), round(0.8 * 442)
            ew = round(cw * abs(_math.cos(r)) + chh * abs(_math.sin(r)))
            eh = round(cw * abs(_math.sin(r)) + chh * abs(_math.cos(r)))
            self.assertEqual((w, h), (ew, eh))
            obj = assert_info_json(self, out, err)
            self.assertEqual(obj["bands"], 4)  # rotate added alpha, sepia kept it

    def test_crop_preserves_alpha_and_gainmap(self):
        with tempfile.TemporaryDirectory() as td:
            dst = os.path.join(td, "c.png")
            rc, out, err = run_json(
                {
                    "cmd": "convert",
                    "input": data_path("rgba.png"),
                    "output": dst,
                    "edits": [{"edit": "crop", "x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}],
                }
            )
            self.assertEqual(rc, 0, err[:300])
            obj = assert_info_json(self, out, err, width=64, height=64)
            self.assertEqual(obj["bands"], 4)
            check_magic(read_bytes(dst), ".png")

    def test_gainmap_survives_geometric_edits(self):
        src = data_path("ultra-hdr.jpg")
        if not os.path.isfile(src):
            self.skipTest("missing ultra-hdr.jpg fixture")
        with tempfile.TemporaryDirectory() as td:
            for edit in (
                {"edit": "crop", "x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
                {"edit": "rotate", "angle": 30},
            ):
                with self.subTest(edit=edit):
                    dst = os.path.join(td, "graded.jpg")
                    rc, _, err = run_json({"cmd": "convert", "input": src, "output": dst, "edits": [edit]})
                    self.assertEqual(rc, 0, err[:300])
                    blob = read_bytes(dst)
                    self.assertIn(b"MPF\x00", blob, f"UHDR gainmap lost for {edit}")


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

    def test_thumbnail_geometric_edits_geometry(self):
        # Geometric edits compose after the thumbnail resize: a 64x64 thumb
        # cropped to center 50% -> 32x32; a 64x32 thumb rotated 90 -> 32x64.
        with tempfile.TemporaryDirectory() as td:
            for width, height, edits, ew, eh in [
                (64, 64, [{"edit": "crop", "x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}], 32, 32),
                (64, 32, [{"edit": "rotate", "angle": 90}], 32, 64),
            ]:
                with self.subTest(edits=edits):
                    dst = os.path.join(td, "t.jpg")
                    rc, out, err = run_json(
                        {
                            "cmd": "thumbnail",
                            "input": data_path("landscape.jpg"),
                            "output": dst,
                            "width": width,
                            "height": height,
                            "edits": edits,
                        }
                    )
                    self.assertEqual(rc, 0, err[:300])
                    obj = assert_info_json(self, out, err, width=ew, height=eh)
                    self.assertEqual(obj.get("output"), dst)
                    check_magic(read_bytes(dst), ".jpg")


def jpeg_sizes(blob: bytes) -> list[tuple[int, int]]:
    """(width, height) of every baseline/progressive frame: base, then gainmap."""
    frames = re.finditer(rb"\xff[\xc0\xc2]\x00[\x0b\x11]\x08", blob)
    sizes = [struct.unpack(">HH", blob[m.end() : m.end() + 4]) for m in frames]
    return [(w, h) for h, w in sizes]


def write_png16(path: str, rgba: tuple[int, int, int, int]) -> None:
    """Write a 2x2 16-bit RGBA PNG, every pixel `rgba`."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data)
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    row = b"\0" + struct.pack(">4H", *rgba) * 2
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 16, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(row * 2)))
        f.write(chunk(b"IEND", b""))


def png_first_pixel(path: str) -> bytes:
    """First RGBA pixel of a non-interlaced, unfiltered-first-row 8-bit PNG."""
    blob = read_bytes(path)
    pos, idat = 8, b""
    while pos < len(blob):
        n = struct.unpack(">I", blob[pos : pos + 4])[0]
        if blob[pos + 4 : pos + 8] == b"IDAT":
            idat += blob[pos + 8 : pos + 8 + n]
        pos += 12 + n
    return zlib.decompress(idat)[1:5]


def write_oriented_jpeg(src: str, dst: str, orientation: int) -> None:
    """Copy a JPEG, inserting a minimal EXIF block with the given orientation."""
    tiff = b"MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01"
    tiff += struct.pack(">HH", orientation, 0) + b"\0\0\0\0"
    app1 = b"Exif\0\0" + tiff
    blob = read_bytes(src)
    with open(dst, "wb") as f:
        f.write(blob[:2] + b"\xff\xe1" + struct.pack(">H", len(app1) + 2) + app1 + blob[2:])


class TestEditsGainmap(unittest.TestCase):
    """The gainmap must stay registered with the base image through geometry."""

    def setUp(self):
        need_edits(self)

    def convert(self, td: str, input_name: str, edits: list) -> bytes:
        dst = os.path.join(td, "o.jpg")
        req = {"cmd": "convert", "input": data_path(input_name), "output": dst, "edits": edits}
        rc, _, err = run_json(req)
        self.assertEqual(rc, 0, err[:300])
        # The output must read back as a valid UltraHDR file too.
        rc, _, err = run_json({"cmd": "thumbnail", "input": dst, "output": dst + ".jpg"})
        self.assertEqual(rc, 0, err[:300])
        self.assertIn(b"MPF\x00", read_bytes(dst + ".jpg"))
        return read_bytes(dst)

    def test_geometric_edits_reach_gainmap(self):
        # ultra-hdr.jpg: 3840x2160 base, 960x540 gainmap (scale 4).
        for edit, base, gainmap in [
            ({"edit": "crop", "width": 0.5, "height": 0.25}, (1920, 540), (480, 135)),
            ({"edit": "rotate", "angle": 90}, (2160, 3840), (540, 960)),
            ({"edit": "rotate", "angle": 30}, (4406, 3791), (1101, 948)),
        ]:
            with self.subTest(edit=edit), tempfile.TemporaryDirectory() as td:
                self.assertEqual(jpeg_sizes(self.convert(td, "ultra-hdr.jpg", [edit])), [base, gainmap])

    def test_pixel_edits_leave_gainmap(self):
        with tempfile.TemporaryDirectory() as td:
            sizes = jpeg_sizes(self.convert(td, "ultra-hdr.jpg", [{"edit": "invert"}]))
            self.assertEqual(sizes, [(3840, 2160), (960, 540)])

    def test_heic_gainmap_crop(self):
        with tempfile.TemporaryDirectory() as td:
            edit = {"edit": "crop", "width": 0.5, "height": 0.5}
            base, gainmap = jpeg_sizes(self.convert(td, "samsung-heic-gainmap.heic", [edit]))[:2]
            self.assertEqual(base, (2000, 1500))
            self.assertAlmostEqual(gainmap[0] / gainmap[1], 4 / 3, places=1)

    def test_stdout_keeps_gainmap(self):
        rc, blob, err = run_json(
            {"cmd": "thumbnail", "input": data_path("ultra-hdr.jpg"), "output": "o.jpg", "stdout": True}
        )
        self.assertEqual(rc, 0, err[:300])
        self.assertIn(b"MPF\x00", blob)


class TestEditsOrientation(unittest.TestCase):
    """Edits address the upright image, like the canvas (and thumbnail) do."""

    def setUp(self):
        need_edits(self)

    def test_convert_crop_is_upright(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "o6.jpg")
            write_oriented_jpeg(data_path(DRIVER), src, 6)  # 290x442 stored, 442x290 shown
            req = {"cmd": "convert", "input": src, "output": os.path.join(td, "o.jpg")}
            rc, out, err = run_json({**req, "edits": [{"edit": "crop", "width": 0.5}]})
            self.assertEqual(rc, 0, err[:300])
            assert_info_json(self, out, err, width=221, height=290)

    def test_gainmap_follows_exif_rotation(self):
        with tempfile.TemporaryDirectory() as td:
            src, dst = os.path.join(td, "o6.jpg"), os.path.join(td, "o.jpg")
            write_oriented_jpeg(data_path("ultra-hdr.jpg"), src, 6)
            rc, _, err = run_json(
                {"cmd": "convert", "input": src, "output": dst, "edits": [{"edit": "invert"}]}
            )
            self.assertEqual(rc, 0, err[:300])
            self.assertEqual(jpeg_sizes(read_bytes(dst)), [(2160, 3840), (540, 960)])

    def test_no_edits_keeps_orientation_tag(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "o6.jpg")
            write_oriented_jpeg(data_path(DRIVER), src, 6)
            rc, out, err = run_json(
                {"cmd": "convert", "input": src, "output": os.path.join(td, "o.jpg")}
            )
            self.assertEqual(rc, 0, err[:300])
            assert_info_json(self, out, err, width=290, height=442)


class TestEditsAlphaDepth(unittest.TestCase):
    def test_16bit_alpha_keeps_transparency(self):
        need_edits(self)
        with tempfile.TemporaryDirectory() as td:
            src, dst = os.path.join(td, "a.png"), os.path.join(td, "o.png")
            write_png16(src, (0x8000, 0x4000, 0x2000, 0x4000))
            rc, _, err = run_json(
                {"cmd": "convert", "input": src, "output": dst, "edits": [{"edit": "exposure"}]}
            )
            self.assertEqual(rc, 0, err[:300])
            self.assertAlmostEqual(png_first_pixel(dst)[3], 0x40, delta=1)


if __name__ == "__main__":
    print(f"binary: {VIPS_PREVIEW} (edits support: {HAS_EDITS})")
    unittest.main(verbosity=2)
