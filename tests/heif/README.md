# HEIC gainmap test suite (heifload / jpegsave patches)

Ad-hoc suite used to develop `patches/heifload-iso21496-gainmap.patch` and
`patches/jpegsave-gainmap-forward.patch` (Apple `HDRGainMap:` → ISO 21496-1
mapping, Samsung `hdrgm:` path, SDR fallback). Complements the unit tests in
`tests/test_preview.py`.

## Setup

Needs the warm `vipsedit` container from `.agents/skills/build`.

```sh
./fetch_samples.sh          # public samples -> samples/
python3 -I make_synth.py    # length-preserving metadata edits -> samples/synth/
./rebuild.sh                # incremental patched build -> out/vips-preview (~1 min)
./build_gminfo.sh           # static gainmap inspector -> ./gminfo
```

## Run

```sh
# matrix: thumbnail jpg/webp + convert, checks the JPEG thumb's gainmap boost
OLD=/path/to/release/vips-preview ./matrix.sh [extra.heic ...]

# metadata fuzz (no crash/timeout, no uhdr/gainmap failure)
python3 -I fuzz.py out/vips-preview samples/apple-v1-iphone13pro.heic
python3 -I fuzz.py out/vips-preview samples/apple-v1-iphone13pro.heic --lo 300 --hi 3300  # EXIF/maker note

python3 -I lut_error.py     # Apple->ISO LUT worst-case error (< 0.01 stops)
python3 -I mnote.py FILE    # maker note headroom cross-check
./gminfo FILE...            # gainmap + gainmap-* fields as libvips sees them

# repo unit tests against the new binary
VIPS_PREVIEW_BIN=$PWD/out/vips-preview python3 -m unittest discover -s ..
```

## Cases (`matrix.sh`)

| File | Expect (JPEG thumb max boost) | Covers |
|---|---|---|
| `apple-v1-iphone13pro.heic` | 7.3717 | Apple v1, headroom from maker note |
| `apple-v2-ios18-iphone15pro.heic` | 2.7692 | Apple v2, XMP `HDRGainMapHeadroom` (+ tmap item) |
| `libheif-example.{heic,avif}` | none | plain HEIC/AVIF unaffected |
| `chan-iso-0{1,2,3}.avif` | none | ISO tmap AVIF (not an aux gainmap) |
| `synth_iso_hdrgm_minimal.heic` | 4 | `hdrgm:` spec defaults, `use_base_cg` |
| `synth_apple_attr_headroom3.heic` | 3 | Apple headroom as XMP attribute |
| `synth_apple_noheadroom.heic` | none | no headroom → SDR fallback, no failure |
| `synth_badxml.heic` | none | malformed XMP → SDR fallback |
| `../data/samsung-heic-gainmap.heic` | 4.9246 | Samsung `hdrgm:` regression |
| `../data/apple-heic-gainmap.heic` | 7.3717 | unit-test fixture |

The release before v8.18.7-17 fails (rc 1) on every Apple and synthetic case.
