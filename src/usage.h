// usage.h — help text for vips-preview.
//
// Kept in its own file as a raw string literal so the JSON protocol is
// documented in exactly one place. preview.cc prints it for --help/-h and
// alongside usage errors.
#pragma once

#include <cstdio>

/// Full CLI help: JSON request shapes, defaults, and the stdout flag.
inline constexpr const char kUsage[] = R"USAGE(usage: echo '<json>' | vips-preview [OPTION]
       vips-preview --help
       vips-preview --version

  JSON image CLI over stdin (static libvips, no argv commands).

Commands — send exactly one JSON object on stdin:
  {"cmd":"info","input":"INPUT"}
  {"cmd":"thumbnail","input":"INPUT","output":"OUTPUT","stdout":false,
   "width":512,"height":512,"crop":"attention|none|low|high","quality":80}
  {"cmd":"convert","input":"INPUT","output":"OUTPUT","stdout":false,
   "quality":90}

  info       print image metadata (width, height, bands, ...) as JSON on stderr
  thumbnail  resize/crop to WIDTH x HEIGHT (default 512 x 512), save to OUTPUT
  convert    re-encode INPUT to OUTPUT without resizing

Options:
  -h, --help     show this help and exit
  -V, --version  print the libvips version and exit

Streams:
  stdout carries file bytes only: empty when writing OUTPUT files,
    image bytes when "stdout" is true. Every successful command prints
    one JSON info line on stderr (info reports INPUT; thumbnail/convert
    report the OUTPUT image: width, height, bands, format,
    interpretation, output) — no second info call needed.

Notes:
  Saver is picked from the OUTPUT filename extension
    (jpg/jpeg, webp, avif, heic/heif, png, tiff, gif, ppm, ...):
    thumbnail strips metadata except ICC + gainmap, convert preserves it.
  "stdout": true streams encoded bytes to stdout instead of writing OUTPUT
    (OUTPUT still selects the format, no file is written);
    thumbnails never upscale small inputs.
  Errors are JSON on stderr: {"error":"..."}.

Examples:
  echo '{"cmd":"info","input":"photo.jpg"}' | vips-preview
  echo '{"cmd":"thumbnail","input":"photo.jpg","output":"thumb.webp","width":512,"height":512}' | vips-preview
  echo '{"cmd":"convert","input":"photo.jpg","output":"photo.png"}' | vips-preview
)USAGE";

/// Print the help text to @p f (stdout for --help, stderr otherwise).
inline void print_usage(FILE *f) { std::fputs(kUsage, f); }
