// transforms/state.ts — {version, edits} state validation/serialization.
import { EDIT_STATE_VERSION, type EditState } from '../types.js';
import { normalizeEdit, validateEdit } from './index.js';

export function validateState(state: EditState): string[] {
  if (typeof state !== 'object' || state === null) return ['state must be an object'];
  const errs: string[] = [];
  if (state.version !== EDIT_STATE_VERSION) errs.push(`version must be ${EDIT_STATE_VERSION}`);
  if (!Array.isArray(state.edits)) return [...errs, 'edits must be an array'];
  state.edits.forEach((edit, i) => {
    for (const e of validateEdit(edit)) errs.push(`edits[${i}]: ${e}`);
  });
  return errs;
}

export function stateToJSON(state: EditState): string {
  return JSON.stringify({ version: EDIT_STATE_VERSION, edits: state.edits.map(normalizeEdit) });
}

/** Parse + normalize; throws on invalid shape. */
export function stateFromJSON(json: string): EditState {
  const raw = JSON.parse(json) as EditState;
  const errs = validateState(raw);
  if (errs.length > 0) throw new Error(`invalid edit state: ${errs.join('; ')}`);
  return { version: EDIT_STATE_VERSION, edits: raw.edits.map(normalizeEdit) };
}
