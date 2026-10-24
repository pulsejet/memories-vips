# tests/data — real file samples

No synthetic gradients. Every fixture is a real photo, graphic, HDR
capture, or vector — either a native upstream sample or (one case) a
real photo transcoded into a container we pin no small native for.

Regenerate with `python3 tests/gen_fixtures.py` (needs
`VIPS_PREVIEW_BIN` for the JXL derive + verify step).

| File | Source | What it is | Why it's here |
|---|---|---|---|
| `sample.jpg` | libvips `test/test-suite/images/sample.jpg` | Real photo, portrait 290×442 | Main driver: saver matrix, convert, defaults |
| `landscape.jpg` | Picsum `id/1016/800/600` (Unsplash photo) | Real photo, landscape 800×600 | Crop geometry (`none` → 16×12 fit) |
| `portrait.jpg` | Picsum `id/1015/600/800` (Unsplash photo) | Real photo, portrait 600×800 | Crop geometry (`none` → 12×16 fit) |
| `rgba.png` | libvips `rgba.png` | Real RGBA 128×128 | Alpha preserve path |
| `indexed.png` | libvips `indexed.png` | Real paletted photo 290×442 | Palette PNG input |
| `flower-gray.png` | libjxl/testdata `jxl/flower/flower_small.g.png` | Real grayscale photo 510×532 | 1-band input |
| `rgba-correct.ppm` | libvips `rgba-correct.ppm` | Real PPM 64×64 | PNM input |
| `cogs.gif` | libvips `cogs.gif` | Real GIF 85×77 | GIF input (4-band) |
| `photo.webp` | libvips `1.webp` | Real WebP 550×368 | WebP input |
| `orientation6.avif` | libvips `avif-orientation-6.avif` | Real AVIF, EXIF orientation 6, 3024×4032 | Orientation handling (`no_rotate=false`) |
| `example.heic` | libheif `examples/example.heic` | Real HEVC photo 1280×854 | HEIC input |
| `sample-photo.jxl` | **Derived**: `sample.jpg` → JXL via the pinned `vips-preview` | Real photo pixels, JXL container, 290×442 | JXL input (no small native pinned) |
| `world.jp2` | libvips `world.jp2` | Real JPEG 2000 800×400 | JP2 input |
| `sample.tif` | libvips `sample.tif` | Real TIFF photo 290×442 | TIFF input |
| `logo.svg` | libvips `logo.svg` | Real vector 736×552 | SVG (rsvg) input |
| `sample.exr` | libvips `sample.exr` | Real OpenEXR 610×406 (float) | EXR input (read-only in this build) |
| `sample.hdr` | libvips `sample.hdr` | Real Radiance 141×980 | HDR input |
| `ultra-hdr.jpg` | libvips `ultra-hdr.jpg` | Real UltraHDR gainmap photo 3840×2160 | `keep=icc,gainmap` thumbnail path |
| `gainmap-odd.jpg` | libvips `gainmap-odd-dimensions.jpg` | Tiny gainmap edge case 129×97 | Odd-dimension gainmap |

License note: fixtures remain the property of their upstreams — check
the source repos (libvips/LGPL, libheif/MIT, libjxl/testdata terms,
Unsplash/Picsum terms) before redistributing.
