// util.h — tiny shared helpers for vips-preview.
//
// Single translation unit (preview.cc) includes this; kept separate so
// string handling lives in one documented place.
#pragma once

#include <cctype>
#include <string>

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
