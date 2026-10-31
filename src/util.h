// util.h — tiny shared helpers for vips-preview (strings + fd-3 JSON output).
#pragma once

#include <cctype>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <unistd.h>

#include "json.hpp"

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

/// Where emit_json() writes: fd 3 when open, else stderr. Anyone may write
/// human logs to stderr (SVT-AV1 does), so callers MUST open fd 3 (e.g.
/// `vips-preview 3>info.json`) for reliable parsing; the stderr fallback is
/// legacy best-effort only.
///
/// main() calls this before libvips starts: with fd 3 closed, the lowest free
/// descriptor can go to a loader's input file, which would then look open.
inline int &json_fd() {
  static int fd = fcntl(3, F_GETFD) != -1 ? 3 : 2;
  return fd;
}

/// Write a machine-readable JSON line to json_fd().
///
/// Invalid UTF-8 is replaced rather than thrown on: error text can quote raw
/// stdin bytes, and this runs inside main's catch handlers.
inline void emit_json(const nlohmann::json &j) {
  const std::string line =
      j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
  dprintf(json_fd(), "%s\n", line.c_str());
}
