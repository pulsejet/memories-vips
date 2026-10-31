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
    expect(validateEdit({ edit: 'shadows', amount: 2 })).not.toEqual([]);
    expect(validateEdit({ edit: 'highlights', amount: -1.5 })).not.toEqual([]);
    expect(validateEdit({ edit: 'warmth', amount: 1.1 })).not.toEqual([]);
    expect(validateEdit({ edit: 'sharpen', amount: 9 })).not.toEqual([]);
    expect(validateEdit({ edit: 'crop', x: 2 })).not.toEqual([]);
    expect(validateEdit({ edit: 'crop', width: 0 })).not.toEqual([]);
    expect(validateEdit({ edit: 'crop', x: 0.8, width: 0.5 })).not.toEqual([]);
    expect(validateEdit({ edit: 'rotate', angle: 200 })).not.toEqual([]);
    expect(validateEdit({ edit: 'crop', x: 0.1, y: 0.1, width: 0.5, height: 0.5 })).toEqual([]);
    expect(validateEdit({ edit: 'rotate', angle: 45 })).toEqual([]);
    expect(validateEdit({ edit: 'rotate' })).toEqual([]);
    expect(validateEdit({ edit: 'crop' })).toEqual([]);
    expect(validateEdit({ edit: 'invert' })).toEqual([]);
    expect(validateEdit({ edit: 'nope' } as never)).not.toEqual([]);
    expect(validateState({ version: 1, edits: [{ edit: 'blur', radius: 3 }] })).toEqual([]);
    expect(validateState({ version: 2, edits: [] } as never)).not.toEqual([]);
  });
  it('rejects Object.prototype keys as edit names', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(validateEdit({ edit: name } as never)).toEqual([`unknown edit ${name}`]);
      expect(() => normalizeEdit({ edit: name } as never)).toThrow(`unknown edit ${name}`);
    }
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
  it('covers all fifteen edits with a full Transform signature', () => {
    expect(Object.keys(TRANSFORMS).sort()).toEqual(
      [
        'brightnessContrast',
        'crop',
        'exposure',
        'hueSaturation',
        'sepia',
        'vibrance',
        'blur',
        'sharpen',
        'vignette',
        'shadows',
        'highlights',
        'warmth',
        'invert',
        'grayscale',
        'rotate',
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
