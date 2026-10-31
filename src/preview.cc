// preview.cc — vips-preview entry point (single translation unit).
//
// Layout:
//   usage.h    — help text (raw string, one source of protocol docs).
//   util.h     — shared string helpers.
//   protocol.h — stdin JSON parsing/validation (Request).
//   transforms/protocol.h — parse "edits" into concrete Transforms.
//   transforms/ — Transform base class + one header per transform.
//   raw_fast.h — RAW embedded-JPEG fast path for thumbnails (LibRaw).
//   version.h  — build counter (matches release tag suffix).
//   image.h    — libvips edits (save by extension, stream to file/stdout).
//   json.hpp   — vendored nlohmann/json (header-only, no new link deps).
//
// The build links this file alone (-static); the headers above keep that
// one-TU shape while giving each concern its own documented home.
#include <vips/vips8>

#include <cstdio>
#include <iostream>
#include <iterator>
#include <string>

#include "image.h"
#include "protocol.h"
#include "usage.h"
#include "util.h"
#include "version.h"

using nlohmann::json;

/// Slurp all of stdin into a string (the single JSON request).
static std::string read_all_stdin() {
  return std::string((std::istreambuf_iterator<char>(std::cin)),
                     std::istreambuf_iterator<char>());
}

/// Print a JSON {"error":...} line to fd 3 (stderr fallback if closed).
static void print_error(const std::string &msg) { emit_json({{"error", msg}}); }

/// Handle argv + the stdin request; returns the exit code. Failures surface
/// as exceptions, rendered as {"error":...} by the caller.
static int run(int argc, char **argv) {
  // No argv API: the only accepted arguments are help/version flags.
  // Anything else is a usage error (avoids silently ignoring a stale
  // argv-style call).
  if (argc > 1) {
    std::string a1 = lower(argv[1]);

    // Version goes to stdout: upstream number plus build counter, matching
    // the release tag minus leading v (tag v8.18.7-10 -> "8.18.7-10").
    if (a1 == "--version" || a1 == "-v" || a1 == "version") {
      printf("%s-%s\n", vips_version_string(), kPreviewBuild);
      return 0;
    }

    // Help goes to stdout with the linked libvips version appended.
    if (a1 == "--help" || a1 == "-h" || a1 == "help") {
      print_usage(stdout);
      printf("vips=%s\n", vips_version_string());
      return 0;
    }

    print_error(
        "no argv commands: send a single JSON object on stdin (see --help)");
    print_usage(stderr);
    return 1;
  }

  std::string req = read_all_stdin();

  // Piped-nothing is the common mistake; point at the protocol.
  if (req.empty()) {
    print_error("empty stdin: expected a JSON object with \"cmd\"");
    print_usage(stderr);
    return 1;
  }

  // Parse (throws json::exception on malformed input), then validate.
  Request r = parse_request(json::parse(req));
  if (r.cmd == "info") return run_info(r);
  if (r.cmd == "thumbnail") return run_thumbnail(r);
  return run_convert(r);
}

int main(int argc, char **argv) {
  json_fd();  // latch before libvips can open anything

  // libvips global init; aborts to vips' own error path on failure.
  if (VIPS_INIT(argv[0])) vips_error_exit(nullptr);

  int rc = 1;
  try {
    rc = run(argc, argv);
  } catch (const json::exception &e) {  // malformed stdin JSON
    print_error(std::string("invalid JSON: ") + e.what());
  } catch (const std::exception &e) {  // libvips, validation + I/O failures
    print_error(e.what());
  }
  vips_shutdown();
  return rc;
}
