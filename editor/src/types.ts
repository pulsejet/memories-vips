// types.ts — edit list model shared by the WebGL preview and the VIPS applier.
//
// JSON wire format (what the client serializes / what vips-preview accepts as
// the "edits" field of convert/thumbnail):
//   { "version": 1, "edits": [ { "edit": "brightnessContrast", ... }, ... ] }
// Per-edit shapes live next to their Transform implementations
// (src/transforms/); this file only forms the union.
import type { BlurEdit } from './transforms/blur.js';
import type { BrightnessContrastEdit } from './transforms/brightnessContrast.js';
import type { ExposureEdit } from './transforms/exposure.js';
import type { GrayscaleEdit } from './transforms/grayscale.js';
import type { HueSaturationEdit } from './transforms/hueSaturation.js';
import type { InvertEdit } from './transforms/invert.js';
import type { SepiaEdit } from './transforms/sepia.js';
import type { SharpenEdit } from './transforms/sharpen.js';
import type { VibranceEdit } from './transforms/vibrance.js';
import type { VignetteEdit } from './transforms/vignette.js';

export type EditName =
  | 'brightnessContrast'
  | 'exposure'
  | 'hueSaturation'
  | 'sepia'
  | 'vibrance'
  | 'blur'
  | 'sharpen'
  | 'vignette'
  | 'invert'
  | 'grayscale';

export type Edit =
  | BrightnessContrastEdit
  | ExposureEdit
  | HueSaturationEdit
  | SepiaEdit
  | VibranceEdit
  | BlurEdit
  | SharpenEdit
  | VignetteEdit
  | InvertEdit
  | GrayscaleEdit;

export const EDIT_STATE_VERSION = 1 as const;

export interface EditState {
  version: typeof EDIT_STATE_VERSION;
  edits: Edit[];
}

export function emptyState(): EditState {
  return { version: EDIT_STATE_VERSION, edits: [] };
}
