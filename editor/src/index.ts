// index.ts — minimal public surface: the pipeline, the registry, state
// helpers, and the types needed to consume them (including writing a
// custom Transform). Internal helpers (lookup, isNumInRange,
// setFloatUniform, math utils, per-transform types) live in their own
// modules — import those directly.
export { EditPipeline } from './pipeline.js';
export { TRANSFORMS, validateEdit, normalizeEdit } from './transforms/index.js';
export { validateState, stateToJSON, stateFromJSON } from './transforms/state.js';
export type { Transform, ParamControl, RenderContext, Target } from './transforms/transform.js';
export { emptyState, EDIT_STATE_VERSION } from './types.js';
export type { Edit, EditName, EditState } from './types.js';
