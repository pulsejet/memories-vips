// usage.h — help text for vips-preview.
//
// Kept in its own file as a raw string literal so the JSON protocol is
// documented in exactly one place. preview.cc prints it for --help/-h and
// alongside usage errors.
#pragma once

#include <cstdio>

/// Full CLI help: JSON request shapes, defaults, and the stdout flag.
inline constexpr const char kUsage[] =
    R"USAGE(usage: echo '<json>' | vips-preview [OPTION]
       vips-preview --help
       vips-preview --version

  JSON image CLI over stdin (static libvips, no argv commands).

Commands — send exactly one JSON object on stdin:
  {"cmd":"info","input":"INPUT"}
  {"cmd":"thumbnail","input":"INPUT","output":"OUTPUT","stdout":false,
   "width":512,"height":512,"crop":"attention|none|low|high","quality":80,
   "edits":[...]}
  {"cmd":"convert","input":"INPUT","output":"OUTPUT","stdout":false,
   "quality":90,"edits":[...]}

  info       print image metadata (width, height, bands, ...) as JSON on fd 3
  thumbnail  resize/crop to WIDTH x HEIGHT (default 512 x 512), then apply
    "edits" (below), save to OUTPUT
  convert    apply "edits" (below) to INPUT at full resolution, re-encode
    to OUTPUT

  Edits (thumbnail + convert): ordered array of pixel + geometric edits — the
  same list the editor canvas previews. Missing numerics default to no-change
  unless noted. Edits see the upright image (EXIF orientation is baked in
  first) and run after thumbnail resize (blur/sharpen radii are output pixels).
  They never drop ICC/gainmap: UHDR outputs stay UHDR, and crop/rotate apply
  to the gainmap too.

    {"edit":"brightnessContrast","brightness":0,"contrast":0}  -1..1 each
    {"edit":"exposure","stops":0}                              -5..5 stops, gain 2^stops
    {"edit":"hueSaturation","hue":0,"saturation":0}            -1..1 each
    {"edit":"sepia","amount":1}                                0..1 (default full)
    {"edit":"vibrance","amount":0}                             -1..1
    {"edit":"shadows","amount":0}                                -1..1 (dark-weighted lift)
    {"edit":"highlights","amount":0}                             -1..1 (bright-weighted lift)
    {"edit":"warmth","amount":0}                                 -1..1 (cool..warm R/B gains)
    {"edit":"grayscale"}                                       channel average
    {"edit":"invert"}                                          1 - pixel
    {"edit":"blur","radius":0}                                 gaussian px, 0..100, 0 skips
    {"edit":"sharpen","radius":2,"amount":0.5}                 radius 0..50, amount 0..5
    {"edit":"vignette","size":0.5,"amount":0.5}                0..1 each (edge darkening)
    {"edit":"crop","x":0,"y":0,"width":1,"height":1}           fractions 0..1 (default full frame)
    {"edit":"rotate","angle":0}                                clockwise degrees, -180..180
    {"edit":"flip","direction":"horizontal"}                   mirror "horizontal" (left-right) or "vertical"

  Example:
    echo '{"cmd":"convert","input":"in.jpg","output":"out.jpg",
           "edits":[{"edit":"sepia","amount":0.5}]}' | vips-preview 3>info.json

Options:
  -h, --help     show this help and exit
  -V, --version  print {libvips version}-{build} and exit

Streams:
  stdout carries file bytes only: empty when writing OUTPUT files,
    image bytes when "stdout" is true. Every successful command prints
    one JSON info line on fd 3 (stderr fallback if fd 3 is closed;
    open it with `vips-preview 3>info.json` — info reports INPUT;
    thumbnail/convert report the OUTPUT image: width, height, bands,
    format, interpretation, output) — no second info call needed.
    stderr is human logs only (encoder chatter may appear there).

Notes:
  Saver is picked from the OUTPUT filename extension
    (jpg/jpeg, webp, avif, heic/heif, png, tiff, gif, ppm, ...):
    thumbnail strips metadata except ICC + gainmap, convert preserves it.
  "stdout": true streams encoded bytes to stdout instead of writing OUTPUT
    (OUTPUT still selects the format, no file is written);
    thumbnails never upscale small inputs.
  Errors are JSON on fd 3: {"error":"..."}.

Examples:
  echo '{"cmd":"info","input":"photo.jpg"}' | vips-preview 3>info.json
  echo '{"cmd":"thumbnail","input":"photo.jpg","output":"thumb.webp","width":512,"height":512}' | vips-preview 3>info.json
  echo '{"cmd":"convert","input":"photo.jpg","output":"photo.png"}' | vips-preview 3>info.json
)USAGE";

/// Print the help text to @p f (stdout for --help, stderr otherwise).
inline void print_usage(FILE *f) { std::fputs(kUsage, f); }
