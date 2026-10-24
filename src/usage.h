// usage.h — help text for vips-preview.
//
// Kept in its own file as a raw string literal so the JSON protocol is
// documented in exactly one place. preview.cc prints it for --help and
// alongside usage errors.
#pragma once

#include <cstdio>

/// Full CLI help: JSON request shapes, defaults, and the stdout flag.
inline constexpr const char kUsage[] = R"USAGE(usage: echo '<json>' | vips-preview
  {"cmd":"info","input":"INPUT"}
  {"cmd":"thumbnail","input":"INPUT","output":"OUTPUT","stdout":false,
   "width":512,"height":512,"crop":"attention|none|low|high","quality":80}
  {"cmd":"convert","input":"INPUT","output":"OUTPUT","stdout":false,
   "quality":90}
info prints a JSON object on stdout. thumbnail/convert pick the saver from
the OUTPUT filename extension (jpg, webp, avif, heic, png, ...)
and stream there directly (no full-file buffering) — or to stdout when
"stdout" is true (OUTPUT still selects the format, no file is written).
Errors are JSON on stderr: {"error":"..."}.
)USAGE";

/// Print the help text to @p f (stdout for --help, stderr otherwise).
inline void print_usage(FILE *f) { std::fputs(kUsage, f); }
