import { describe, expect, it } from 'vitest';
import { TRANSFORMS, normalizeEdit, validateEdit } from '../src/transforms/index.js';
import { stateFromJSON, stateToJSON, validateState } from '../src/transforms/state.js';

describe('validation', () => {
  it('accepts defaults and rejects out-of-range / unknown', () => {
    expect(validateEdit({ edit: 'brightnessContrast' })).toEqual([]);
    expect(validateEdit({ edit: 'brightnessContrast', brightness: 2 })).not.toEqual([]);
    expect(validateEdit({ edit: 'exposure', stops: 6 })).not.toEqual([]);
    expect(validateEdit({ edit: 'sepia', amount: -0.1 })).not.toEqual([]);
    expect(validateEdit({ edit: 'vignette', size: 2 })).not.toEqual([]);
    expect(validateEdit({ edit: 'sharpen', amount: 9 })).not.toEqual([]);
    expect(validateEdit({ edit: 'invert' })).toEqual([]);
    expect(validateEdit({ edit: 'nope' } as never)).not.toEqual([]);
    expect(validateState({ version: 1, edits: [{ edit: 'blur', radius: 3 }] })).toEqual([]);
    expect(validateState({ version: 2, edits: [] } as never)).not.toEqual([]);
  });
  it('normalizes then round-trips through JSON', () => {
    const back = stateFromJSON(stateToJSON({ version: 1, edits: [{ edit: 'sepia' }] }));
    expect(back).toEqual({ version: 1, edits: [{ edit: 'sepia', amount: 1 }] });
    expect(() =>
      stateFromJSON(JSON.stringify({ version: 1, edits: [{ edit: 'blur', radius: -1 }] })),
    ).toThrow();
  });
  it('normalizeEdit fills sharpen/vignette defaults', () => {
    expect(normalizeEdit({ edit: 'sharpen' })).toEqual({
      edit: 'sharpen',
      radius: 2,
      amount: 0.5,
    });
    expect(normalizeEdit({ edit: 'vignette' })).toEqual({
      edit: 'vignette',
      size: 0.5,
      amount: 0.5,
    });
  });
});

describe('registry', () => {
  it('covers all ten edits with a full Transform signature', () => {
    expect(Object.keys(TRANSFORMS).sort()).toEqual(
      [
        'brightnessContrast',
        'exposure',
        'hueSaturation',
        'sepia',
        'vibrance',
        'blur',
        'sharpen',
        'vignette',
        'invert',
        'grayscale',
      ].sort(),
    );
    for (const t of Object.values(TRANSFORMS)) {
      expect(typeof t.apply).toBe('function');
      expect(typeof t.validate).toBe('function');
      expect(typeof t.normalize).toBe('function');
      expect(typeof t.defaults).toBe('function');
      expect(Array.isArray(t.controls)).toBe(true);
      expect(t.validate(t.defaults())).toEqual([]);
    }
  });
});
