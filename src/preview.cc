// preview.cc — minimal static-contained camera CLI on top of libvips.
// Subcommands: info | thumbnail | convert
// Uses vips_thumbnail() so shrink-on-load + embedded heif thumbnails are used.
#include <vips/vips8>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <string>
#include <vector>

using namespace vips;

static void usage() {
  printf("usage:\n"
         "  vips-preview info INPUT\n"
         "  vips-preview thumbnail INPUT OUTPUT [-w 512] [-h 512] [--crop attention|none]\n"
         "  vips-preview convert INPUT OUTPUT [-Q 90]\n");
}

static std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  return s;
}

static int cmd_info(const char *in) {
  VImage im = VImage::new_from_file(in, VImage::option()->set("access", "sequential"));
  printf("width=%d height=%d bands=%d format=%d interpretation=%d filename=%s\n",
         im.width(), im.height(), im.bands(), (int)im.format(),
         (int)im.interpretation(), im.filename() ? im.filename() : in);
  return 0;
}

static int cmd_thumbnail(const char *in, const char *out, int w, int h,
                         const std::string &crop, int quality) {
  VImage im;
  if (crop == "none") {
    im = VImage::thumbnail(in, w,
                           VImage::option()->set("height", h)->set("no_rotate", false));
  } else {
    VipsInteresting interesting = VIPS_INTERESTING_ATTENTION;
    if (crop == "low") interesting = VIPS_INTERESTING_LOW;
    else if (crop == "high") interesting = VIPS_INTERESTING_HIGH;
    im = VImage::thumbnail(in, w,
                           VImage::option()
                               ->set("height", h)
                               ->set("crop", (int)interesting)
                               ->set("no_rotate", false));
  }
  // Route save options by output suffix; keep it small and predictable.
  std::string o = lower(out);
  if (o.size() >= 4 && o.compare(o.size() - 4, 4, ".jpg") == 0)
    im.jpegsave((char *)out, VImage::option()->set("Q", quality)->set("strip", true));
  else if (o.size() >= 5 && o.compare(o.size() - 5, 5, ".jpeg") == 0)
    im.jpegsave((char *)out, VImage::option()->set("Q", quality)->set("strip", true));
  else if (o.size() >= 5 && o.compare(o.size() - 5, 5, ".webp") == 0)
    im.webpsave((char *)out, VImage::option()->set("Q", quality)->set("strip", true));
  else if (o.size() >= 5 && o.compare(o.size() - 5, 5, ".avif") == 0)
    im.heifsave((char *)out, VImage::option()->set("Q", quality)->set("compression", "av1"));
  else if (o.size() >= 5 && o.compare(o.size() - 5, 5, ".heic") == 0)
    im.heifsave((char *)out, VImage::option()->set("Q", quality)->set("compression", "hevc"));
  else if (o.size() >= 4 && o.compare(o.size() - 4, 4, ".jxl") == 0)
    im.jxlsave((char *)out);
  else if (o.size() >= 4 && o.compare(o.size() - 4, 4, ".jp2") == 0)
    im.jp2ksave((char *)out);
  else if (o.size() >= 4 && o.compare(o.size() - 4, 4, ".exr") == 0)
    im.write_to_file((char *)out); // no exrsave binding; suffix dispatch handles it
  else
    im.write_to_file((char *)out);
  return 0;
}

static int cmd_convert(const char *in, const char *out, int quality) {
  VImage im = VImage::new_from_file(in);
  std::string o = lower(out);
  if (o.size() >= 4 && (o.compare(o.size() - 4, 4, ".jpg") == 0 || o.compare(o.size() - 5, 5, ".jpeg") == 0))
    im.jpegsave((char *)out, VImage::option()->set("Q", quality)->set("strip", true));
  else if (o.size() >= 5 && o.compare(o.size() - 5, 5, ".avif") == 0)
    im.heifsave((char *)out, VImage::option()->set("Q", quality)->set("compression", "av1"));
  else if (o.size() >= 5 && o.compare(o.size() - 5, 5, ".heic") == 0)
    im.heifsave((char *)out, VImage::option()->set("Q", quality)->set("compression", "hevc"));
  else
    im.write_to_file((char *)out);
  return 0;
}

int main(int argc, char **argv) {
  if (VIPS_INIT(argv[0])) {
    vips_error_exit(nullptr);
    return 1;
  }
  if (argc < 2) {
    usage();
    return 1;
  }
  std::string cmd = lower(argv[1]);
  // --help / bare binary (used by build smoke test) must exit 0.
  if (cmd == "--help" || cmd == "-h" || cmd == "help") {
    usage();
    printf("vips=%s\n", vips_version_string());
    vips_shutdown();
    return 0;
  }
  if (cmd == "info" && argc == 2) { // `vips-preview info` with no file: help, not crash
    usage();
    vips_shutdown();
    return 0;
  }
  try {
    if (cmd == "info" && argc >= 3)
      return cmd_info(argv[2]);
    if ((cmd == "thumbnail" || cmd == "thumb") && argc >= 4) {
      int w = 512, h = 512, q = 80;
      std::string crop = "attention";
      for (int i = 4; i < argc; i++) {
        std::string a = argv[i];
        if ((a == "-w" || a == "--width") && i + 1 < argc) w = atoi(argv[++i]);
        else if ((a == "-h" || a == "--height") && i + 1 < argc) h = atoi(argv[++i]);
        else if ((a == "-q" || a == "-Q" || a == "--quality") && i + 1 < argc) q = atoi(argv[++i]);
        else if (a == "--crop" && i + 1 < argc) crop = lower(argv[++i]);
      }
      return cmd_thumbnail(argv[2], argv[3], w, h, crop, q);
    }
    if (cmd == "convert" && argc >= 4) {
      int q = 90;
      for (int i = 4; i < argc; i++) {
        std::string a = argv[i];
        if ((a == "-q" || a == "-Q" || a == "--quality") && i + 1 < argc) q = atoi(argv[++i]);
      }
      return cmd_convert(argv[2], argv[3], q);
    }
    usage();
    return 1;
  } catch (VError &e) {
    fprintf(stderr, "error: %s\n", e.what());
    return 1;
  }
}
