# @radialapps/memories-vips-editor — headless WebGL preview + VIPS-mappable edit list

Pure-TypeScript, zero-dependency library. The caller provides a `<canvas>`
**and owns its size** (backing store `width`/`height` plus CSS); the
pipeline renders an **ordered list of image edits** with fullscreen
shader passes (ping-pong, like `glfx.js`), presenting contain-fit —
centered on opaque black, never resizing the canvas. A ResizeObserver
re-presents when the host resizes the canvas box. The same list serializes
to JSON that `vips-preview` (`convert`/`thumbnail` `"edits"`) applies
before saving.

```
editor/
  src/
    types.ts      edit list model + JSON wire format
    math.ts       shared pixel-math helpers
    shaders.ts    shared GLSL (quad, copy, blit, gaussian)
    pipeline.ts   EditPipeline — headless, canvas-taking preview
    transforms/   one Transform class per edit + registry (index.ts)
                  + state serialization (state.ts); mirrors src/transforms/*.h
    index.ts      public surface (per-transform types import from their file)
  demo/ tests/   playground (schema-driven) · vitest
  demo/parity.html + demo/parity.ts + demo/parity-cases.json
                  committed WebGL↔VIPS side-by-side page: static shell, runtime
                  cards + live WebGL, cases as typed JSON (`satisfies` import)
  demo/parity/    git-ignored VIPS JPEGs rendered by generate-parity.py
  demo/generate-parity.py  dumb renderer: reads parity-cases.json, runs a
                  built vips-preview (`npm run parity`)
              UltraHDR source; VIPS side pre-rendered, WebGL side live.
```

Adding a transform: write its file, add one line to the registry — pipeline,
validation, serialization, and demo pick it up.

```bash
cd editor
npm install
npm run dev        # demo playground
npm run parity     # render VIPS-side parity JPEGs via a built vips-preview
npm run typecheck && npm test   # tsc + vitest
npm run format     # prettier --write
npm run build      # typecheck + demo bundle (index.html + parity.html)
```

## Wire format

```json
{
  "cmd": "convert",
  "input": "in.jpg",
  "output": "out.jpg",
  "edits": [{ "edit": "brightnessContrast", "brightness": 0.1, "contrast": 0.1 }]
}
```

Numerics are optional (missing = no-change, except `sepia.amount` default 1);
the CLI rejects out-of-range values, so normalize client-side.

## VIPS mapping

sRGB 0..1 floats, array order, single uchar clip at the end; alpha is split
off, normalized to 0..1 float alongside, reattached. `blur`/`sharpen` are
visually matched, not bit-exact; everything else agrees to float precision
(±1 LSB after quantize). Thumbnail edits run **after** resize (radii are
output pixels); UHDR ICC+gainmap pass through untouched (gainmap is not
re-derived). `rotate` by a non-90 angle appends a transparent alpha band
(corners + fringes); 90° multiples stay exact with no band change.

| edit                    | params                                 | VIPS                           |
| ----------------------- | -------------------------------------- | ------------------------------ |
| `brightnessContrast`    | `brightness`, `contrast` −1..1         | `linear(mult, bias)`           |
| `exposure`              | `stops` −5..5                          | `linear(2^stops)`              |
| `hueSaturation`         | `hue`, `saturation` −1..1              | fused 3×3 (≡ `recomb`)         |
| `sepia`                 | `amount` 0..1                          | same matrix, clipped at cast   |
| `vibrance` / `vignette` | `amount` −1..1 / `size`, `amount` 0..1 | identical CPU loop             |
| `grayscale` / `invert`  | —                                      | `(r+g+b)/3` / `linear(-1, +1)` |
| `blur` / `sharpen`      | `radius` 0..100 / +`amount` 0..5       | `gaussblur(σ)` (+ unsharp mix) |
| `crop`                  | `x`,`y`,`width`,`height` 0..1 fractions| `extract_area` (rounded+clamped)|
| `rotate`                | `angle` −180..180 (clockwise °)        | `rot()` @90s, else `rotate()` |

Excluded (no clean VIPS mapping): `denoise`, `noise`, `curves`,
`lensBlur`/`tiltShift`/`zoomBlur`, halftones, warps.

Caveats: no-float GPUs fall back to 8-bit targets (more rounding drift);
preview caps at 2048px longest side (VIPS renders full-res); WebGL failures
throw instead of rendering black. Shaders adapted from
[evanw/glfx.js](https://github.com/evanw/glfx.js) (BSD).
