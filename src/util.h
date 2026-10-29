// util.h — tiny shared helpers for vips-preview.
//
// Single translation unit (preview.cc) includes this; kept separate so
// string handling lives in one documented place.
#pragma once

#include <cctype>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <unistd.h>

/// Lowercase an ASCII string (used for cmd/crop/extension normalization).
inline std::string lower(std::string s) {
  for (auto &c : s) c = (char)std::tolower((unsigned char)c);
  return s;
}

/// True when @p s ends with @p suf (used for saver dispatch on extensions).
inline bool ends_with(const std::string &s, const char *suf) {
  size_t n = strlen(suf);
  return s.size() >= n && s.compare(s.size() - n, n, suf) == 0;
}

/// Write a machine-readable JSON line: fd 3 when open, else stderr.
///
/// Anyone may write human logs to stderr (SVT-AV1 does), so callers MUST
/// open fd 3 (e.g. `vips-preview 3>info.json`) for reliable parsing.
/// The stderr fallback is legacy best-effort only.
inline void emit_json(const std::string &line) {
  if (fcntl(3, F_GETFD) != -1) {
    dprintf(3, "%s\n", line.c_str());
  } else {
    std::fprintf(stderr, "%s\n", line.c_str());
  }
}
