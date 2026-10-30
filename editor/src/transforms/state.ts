// transforms/state.ts — {version, edits} state validation/serialization.
import type { EditState } from '../types.js';
import { normalizeEdit, validateEdit } from './index.js';

export function validateState(state: EditState): string[] {
  const errs: string[] = [];
  if (typeof state !== 'object' || state === null) return ['state must be an object'];
  if ((state as EditState).version !== 1) errs.push('version must be 1');
  if (!Array.isArray((state as EditState).edits)) {
    errs.push('edits must be an array');
    return errs;
  }
  (state as EditState).edits.forEach((edit, i) => {
    for (const e of validateEdit(edit)) errs.push(`edits[${i}]: ${e}`);
  });
  return errs;
}

export function stateToJSON(state: EditState): string {
  return JSON.stringify({ version: 1, edits: state.edits.map(normalizeEdit) });
}

/** Parse + normalize; throws on invalid shape. */
export function stateFromJSON(json: string): EditState {
  const raw = JSON.parse(json) as EditState;
  const errs = validateState(raw);
  if (errs.length > 0) throw new Error(`invalid edit state: ${errs.join('; ')}`);
  return { version: 1, edits: raw.edits.map(normalizeEdit) };
}
