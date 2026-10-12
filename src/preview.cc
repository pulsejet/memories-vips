// preview.cc — minimal static-contained camera CLI on top of libvips.
// Subcommands: info | thumbnail | convert
// Uses vips_thumbnail() so shrink-on-load + embedded heif thumbnails are used.
#include <vips/vips8>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <string>

using namespace vips;

static void usage() {
  printf("usage:\n"
         "  vips-preview info INPUT\n"
         "  vips-preview thumbnail INPUT OUTPUT [-w 512] [-h 512] [--crop attention|none] [-Q 80]\n"
         "  vips-preview convert INPUT OUTPUT [-Q 90]\n");
}

static std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  return s;
}

static bool ends_with(const std::string &s, const char *suf) {
  size_t n = strlen(suf);
  return s.size() >= n && s.compare(s.size() - n, n, suf) == 0;
}

// Save with per-format options; other suffixes use vips suffix dispatch.
static void save_image(VImage im, const char *out, int quality) {
  std::string o = lower(out);
  if (ends_with(o, ".jpg") || ends_with(o, ".jpeg"))
    im.jpegsave((char *)out, VImage::option()->set("Q", quality)->set("strip", true));
  else if (ends_with(o, ".webp"))
    im.webpsave((char *)out, VImage::option()->set("Q", quality)->set("strip", true));
  else if (ends_with(o, ".avif"))
    im.heifsave((char *)out, VImage::option()->set("Q", quality)->set("compression", "av1"));
  else if (ends_with(o, ".heic"))
    im.heifsave((char *)out, VImage::option()->set("Q", quality)->set("compression", "hevc"));
  else if (ends_with(o, ".jxl"))
    im.jxlsave((char *)out);
  else if (ends_with(o, ".jp2"))
    im.jp2ksave((char *)out);
  else
    im.write_to_file((char *)out); // exr/png/tiff/ppm/…: no dedicated binding needed
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
  VipsInteresting interesting = VIPS_INTERESTING_ATTENTION;
  if (crop == "low") interesting = VIPS_INTERESTING_LOW;
  else if (crop == "high") interesting = VIPS_INTERESTING_HIGH;
  VImage im = (crop == "none")
      ? VImage::thumbnail(in, w, VImage::option()->set("height", h)->set("no_rotate", false))
      : VImage::thumbnail(in, w, VImage::option()
                                        ->set("height", h)
                                        ->set("crop", (int)interesting)
                                        ->set("no_rotate", false));
  save_image(im, out, quality);
  return 0;
}

static int cmd_convert(const char *in, const char *out, int quality) {
  save_image(VImage::new_from_file(in), out, quality);
  return 0;
}

// Flags are lowercased first, so -Q/-q (etc.) need only one spelling.
static bool take_int(int argc, char **argv, int &i, const char *name, int &dst) {
  if (lower(argv[i]) == name && i + 1 < argc) {
    dst = atoi(argv[++i]);
    return true;
  }
  return false;
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
  if (cmd == "--help" || cmd == "-h" || cmd == "help") {
    usage();
    printf("vips=%s\n", vips_version_string());
    vips_shutdown();
    return 0;
  }
  if (cmd == "info" && argc == 2) { // bare `info`: help, not a crash
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
        if (take_int(argc, argv, i, "-w", w) || take_int(argc, argv, i, "--width", w)) continue;
        if (take_int(argc, argv, i, "-h", h) || take_int(argc, argv, i, "--height", h)) continue;
        if (take_int(argc, argv, i, "-q", q) || take_int(argc, argv, i, "--quality", q)) continue;
        if (lower(argv[i]) == "--crop" && i + 1 < argc) crop = lower(argv[++i]);
      }
      return cmd_thumbnail(argv[2], argv[3], w, h, crop, q);
    }
    if (cmd == "convert" && argc >= 4) {
      int q = 90;
      for (int i = 4; i < argc; i++)
        take_int(argc, argv, i, "-q", q) || take_int(argc, argv, i, "--quality", q);
      return cmd_convert(argv[2], argv[3], q);
    }
  } catch (VError &e) {
    fprintf(stderr, "error: %s\n", e.what());
    return 1;
  }
  usage();
  return 1;
}
