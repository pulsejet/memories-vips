// version.h — vips-preview build counter.
//
// Release tags are named v{upstream}-{build} (e.g. v8.18.7-10); this must
// match the tag suffix so --version reports the exact build. Bump together
// with the tag. CI (.github/workflows/build.yml) fails tag builds on mismatch.
#pragma once

/// Build number suffix for --version (tag v8.18.7-10 -> "8.18.7-10").
inline constexpr const char kPreviewBuild[] = "15";
