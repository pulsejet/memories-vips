import { describe, expect, it } from 'vitest';
import { clampf, exposureMult, gaussianKernel } from '../src/math.js';

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
