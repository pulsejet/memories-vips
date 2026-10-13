// preview.cc — vips-preview entry point (single translation unit).
//
// Layout:
//   usage.h    — help text (raw string, one source of protocol docs).
//   util.h     — shared string helpers.
//   protocol.h — stdin JSON parsing/validation (Request).
//   image.h    — libvips ops (save by extension, stream to file/stdout).
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

using nlohmann::json;

/// Slurp all of stdin into a string (the single JSON request).
static std::string read_all_stdin() {
  return std::string((std::istreambuf_iterator<char>(std::cin)),
                     std::istreambuf_iterator<char>());
}

/// Print a JSON {"error":...} line to stderr.
static void print_error(const std::string &msg) {
  json err;
  err["error"] = msg;
  fprintf(stderr, "%s\n", err.dump().c_str());
}

int main(int argc, char **argv) {
  // libvips global init; aborts to vips' own error path on failure.
  if (VIPS_INIT(argv[0])) {
    vips_error_exit(nullptr);
    return 1;
  }

  // No argv API: the only accepted argument is a help flag. Anything else
  // is a usage error (avoids silently ignoring a stale argv-style call).
  if (argc > 1) {
    std::string a1 = lower(argv[1]);

    // Help goes to stdout with the linked libvips version appended.
    if (a1 == "--help" || a1 == "-h" || a1 == "help") {
      print_usage(stdout);
      printf("vips=%s\n", vips_version_string());
      vips_shutdown();
      return 0;
    }

    // Stale argv-style invocation: JSON error + help, both on stderr.
    print_error(
        "no argv commands: send a single JSON object on stdin (see --help)");
    print_usage(stderr);
    vips_shutdown();
    return 1;
  }

  try {
    std::string req = read_all_stdin();

    // Piped-nothing is the common mistake; point at the protocol.
    if (req.empty()) {
      print_error("empty stdin: expected a JSON object with \"cmd\"");
      print_usage(stderr);
      vips_shutdown();
      return 1;
    }

    // Parse (throws json::exception on malformed input), then validate.
    Request r = parse_request(json::parse(req));

    // Dispatch on the validated command; convert is the fallthrough.
    int rc = (r.cmd == "info")          ? run_info(r)
             : (r.cmd == "thumbnail")   ? run_thumbnail(r)
                                        : run_convert(r);

    vips_shutdown();
    return rc;
  } catch (const VError &e) { // libvips failures (load/save/thumbnail)
    print_error(e.what());
    return 1;
  } catch (const json::exception &e) { // malformed stdin JSON
    print_error(std::string("invalid JSON: ") + e.what());
    return 1;
  } catch (const std::exception &e) { // validation + I/O failures
    print_error(e.what());
    return 1;
  }
}
