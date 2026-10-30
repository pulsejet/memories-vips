import { describe, expect, it } from 'vitest';
import { cropRect } from '../src/transforms/crop.js';
import {
  cosSin,
  normAngle,
  rotateDims,
  rotateOrigin,
  snapQuarters,
} from '../src/transforms/rotate.js';
import { normalizeEdit } from '../src/transforms/index.js';
import type { CropEdit } from '../src/transforms/crop.js';
import type { RotateEdit } from '../src/transforms/rotate.js';

const crop = (p: CropEdit) => normalizeEdit(p) as Required<CropEdit>;
const rot = (p: RotateEdit) => normalizeEdit(p) as Required<RotateEdit>;

describe('cropRect (mirrors src/transforms/crop.h)', () => {
  it('full frame is identity', () => {
    expect(cropRect(290, 442, crop({ edit: 'crop' }))).toEqual({
      left: 0,
      top: 0,
      w: 290,
      h: 442,
    });
  });
  it('center 60% rounds like lround', () => {
    // 0.2*640=128, 0.6*640=384 exact
    expect(
      cropRect(640, 400, crop({ edit: 'crop', x: 0.2, y: 0.2, width: 0.6, height: 0.6 })),
    ).toEqual({ left: 128, top: 80, w: 384, h: 240 });
  });
  it('clamps to [1px, remainder]', () => {
    const r = cropRect(4, 2, crop({ edit: 'crop', x: 0.9, y: 0.9, width: 0.5, height: 0.5 }));
    expect(r.w).toBeLessThanOrEqual(4 - r.left);
    expect(r.h).toBeLessThanOrEqual(2 - r.top);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
  it('normalize keeps region in-bounds and valid', () => {
    // x+width overflows -> width shrinks; zero width -> epsilon
    const n = crop({ edit: 'crop', x: 0.8, width: 0.5 });
    expect(n.x).toBeCloseTo(0.8, 12);
    expect(n.width).toBeCloseTo(0.2, 12);
    const z = crop({ edit: 'crop', width: 0, height: 0 });
    expect(z.width).toBeGreaterThan(0);
    expect(z.height).toBeGreaterThan(0);
  });
});

describe('rotate math (mirrors src/transforms/rotate.h)', () => {
  it('snaps multiples of 90', () => {
    expect(snapQuarters(90)).toBe(1);
    expect(snapQuarters(-90)).toBe(-1);
    expect(snapQuarters(180)).toBe(2);
    expect(snapQuarters(0)).toBe(0);
    expect(snapQuarters(45)).toBeNull();
    expect(snapQuarters(89.999)).toBeNull();
  });
  it('normalizes wrap-around', () => {
    expect(normAngle(270)).toBe(-90);
    expect(normAngle(-270)).toBe(90);
  });
  it('snapped cos/sin are exact', () => {
    expect(cosSin(90)).toEqual({ c: 0, s: 1 });
    expect(cosSin(-90)).toEqual({ c: 0, s: -1 });
    expect(cosSin(180)).toEqual({ c: -1, s: 0 });
    expect(cosSin(0)).toEqual({ c: 1, s: 0 });
  });
  it('dims match VIPS rotate outputs (probed)', () => {
    // Values probed from the static binary (round(W|c|+H|s|) etc.).
    const cases: Array<[number, number, number, number, number]> = [
      // inW, inH, angle, outW, outH
      [4, 2, 10, 4, 3],
      [4, 2, 30, 4, 4],
      [4, 2, 45, 4, 4],
      [4, 2, 89, 2, 4],
      [4, 2, 179, 4, 2],
      [7, 5, 10, 8, 6],
      [7, 5, 45, 8, 8],
      [100, 60, 10, 109, 76],
      [100, 60, 30, 117, 102],
      [100, 60, 45, 113, 113],
      [100, 60, 89, 62, 101],
      [100, 60, 179, 101, 62],
      [128, 128, 45, 181, 181],
    ];
    for (const [iw, ih, a, w, h] of cases) {
      expect(rotateDims(iw, ih, rot({ edit: 'rotate', angle: a }))).toEqual({ w, h });
    }
  });
  it('90s swap, 180 keeps', () => {
    expect(rotateDims(4, 2, rot({ edit: 'rotate', angle: 90 }))).toEqual({ w: 2, h: 4 });
    expect(rotateDims(4, 2, rot({ edit: 'rotate', angle: -90 }))).toEqual({ w: 2, h: 4 });
    expect(rotateDims(4, 2, rot({ edit: 'rotate', angle: 180 }))).toEqual({ w: 4, h: 2 });
    expect(rotateDims(4, 2, rot({ edit: 'rotate' }))).toEqual({ w: 4, h: 2 });
  });
  it('origin matches the VIPS oarea (single-dot probe)', () => {
    // 9x9, white texel (6,2), angle 30: VIPS footprint pins the mapped
    // origin at (-4,0); 16x12@30 pins (-6,0).
    expect(rotateOrigin(9, 9, rot({ edit: 'rotate', angle: 30 }))).toEqual({ ox: -4, oy: 0 });
    expect(rotateOrigin(16, 12, rot({ edit: 'rotate', angle: 30 }))).toEqual({ ox: -6, oy: 0 });
  });
});
