// transforms/index.ts — registry: name -> Transform instance.
//
// Adding a transform: write its file (params interface + Transform class),
// import it here, add one line to TRANSFORMS. The pipeline, validation,
// serialization, and demo pick it up with no other changes.
import type { Edit, EditName } from '../types.js';
import { lookup, type Transform } from './transform.js';
import { BlurTransform } from './blur.js';
import { BrightnessContrastTransform } from './brightnessContrast.js';
import { CropTransform } from './crop.js';
import { ExposureTransform } from './exposure.js';
import { FlipTransform } from './flip.js';
import { GrayscaleTransform } from './grayscale.js';
import { HighlightsTransform } from './highlights.js';
import { HueSaturationTransform } from './hueSaturation.js';
import { InvertTransform } from './invert.js';
import { RotateTransform } from './rotate.js';
import { SepiaTransform } from './sepia.js';
import { ShadowsTransform } from './shadows.js';
import { SharpenTransform } from './sharpen.js';
import { VibranceTransform } from './vibrance.js';
import { VignetteTransform } from './vignette.js';
import { WarmthTransform } from './warmth.js';

export const TRANSFORMS: Record<EditName, Transform<string, object>> = {
  brightnessContrast: new BrightnessContrastTransform(),
  exposure: new ExposureTransform(),
  hueSaturation: new HueSaturationTransform(),
  sepia: new SepiaTransform(),
  vibrance: new VibranceTransform(),
  blur: new BlurTransform(),
  sharpen: new SharpenTransform(),
  vignette: new VignetteTransform(),
  shadows: new ShadowsTransform(),
  highlights: new HighlightsTransform(),
  warmth: new WarmthTransform(),
  invert: new InvertTransform(),
  grayscale: new GrayscaleTransform(),
  crop: new CropTransform(),
  rotate: new RotateTransform(),
  flip: new FlipTransform(),
};

/** Human-readable problems; empty means the edit is VIPS-appliable. */
export function validateEdit(edit: Edit): string[] {
  if (typeof edit !== 'object' || edit === null) return ['edit must be an object'];
  const t = lookup(TRANSFORMS, edit.edit);
  if (!t) return [`unknown edit ${String(edit.edit)}`];
  return t.validate(edit);
}

/** Fill defaults + clamp, so serialized JSON always passes validateEdit. */
export function normalizeEdit(edit: Edit): Edit {
  const t = lookup(TRANSFORMS, edit.edit);
  if (!t) throw new Error(`unknown edit ${String(edit.edit)}`);
  return t.normalize(edit) as Edit;
}
