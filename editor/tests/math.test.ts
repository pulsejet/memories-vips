import { describe, expect, it } from 'vitest';
import {
  applyHighlightsGray,
  applyShadowsGray,
  clampf,
  exposureMult,
  gaussianKernel,
  highlightsWeight,
  shadowsWeight,
  warmthGains,
} from '../src/math.js';

describe('exposure', () => {
  it('stops map to powers of two', () => {
    expect(exposureMult(0)).toBe(1);
    expect(exposureMult(1)).toBe(2);
    expect(exposureMult(-1)).toBe(0.5);
  });
});

describe('gaussianKernel', () => {
  it('is a normalized delta at 0', () => {
    expect(gaussianKernel(0)).toEqual([1]);
  });
  it('is symmetric and normalized', () => {
    const k = gaussianKernel(4);
    expect(k.length % 2).toBe(1);
    const sum = k.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
    for (let i = 0; i < k.length; i++) expect(k[i]).toBeCloseTo(k[k.length - 1 - i]!, 12);
  });
});

describe('shadows/highlights weights', () => {
  it('shadows weight is 1 in black, 0 in white', () => {
    expect(shadowsWeight(0)).toBe(1);
    expect(shadowsWeight(1)).toBe(0);
    expect(shadowsWeight(0.5)).toBeCloseTo(0.25, 12);
  });
  it('highlights weight is 0 in black, 1 in white', () => {
    expect(highlightsWeight(0)).toBe(0);
    expect(highlightsWeight(1)).toBe(1);
    expect(highlightsWeight(0.5)).toBeCloseTo(0.25, 12);
  });
  it('weights clamp out-of-range luma', () => {
    expect(shadowsWeight(-0.5)).toBe(1);
    expect(shadowsWeight(1.5)).toBe(0);
    expect(highlightsWeight(-0.5)).toBe(0);
    expect(highlightsWeight(1.5)).toBe(1);
  });
  it('gray curves stay monotonic over the whole slider range (no tone reversal)', () => {
    for (const amount of [-1, -0.6, -0.2, 0, 0.2, 0.6, 1]) {
      let prevS = -Infinity;
      let prevH = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const v = i / 100;
        const s = applyShadowsGray(v, amount);
        const h = applyHighlightsGray(v, amount);
        expect(s).toBeGreaterThanOrEqual(prevS);
        expect(h).toBeGreaterThanOrEqual(prevH);
        prevS = s;
        prevH = h;
      }
    }
  });
  it('endpoints lift/recover without crossing: black->0.5, white->0.5', () => {
    expect(applyShadowsGray(0, 1)).toBeCloseTo(0.5, 12);
    expect(applyHighlightsGray(1, -1)).toBeCloseTo(0.5, 12);
    // deep shadows stay below mid-gray; white stays above near-white
    expect(applyShadowsGray(0, 0.6)).toBeLessThan(applyShadowsGray(1 / 6, 0.6));
    expect(applyHighlightsGray(1, -0.6)).toBeGreaterThan(applyHighlightsGray(5 / 6, -0.6));
  });
});

describe('warmthGains', () => {
  it('is identity at 0 and mirrors R/B at extremes', () => {
    expect(warmthGains(0)).toEqual({ r: 1, b: 1 });
    expect(warmthGains(1)).toEqual({ r: 1.3, b: 0.7 });
    expect(warmthGains(-1)).toEqual({ r: 0.7, b: 1.3 });
  });
  it('clamps out-of-range amounts', () => {
    expect(warmthGains(2)).toEqual(warmthGains(1));
    expect(warmthGains(-2)).toEqual(warmthGains(-1));
  });
});
