#include <vips/vips.h>
#include <stdio.h>
static void arr(VipsImage *im, const char *n){
  double *a; int k;
  if (vips_image_get_typeof(im,n) && !vips_image_get_array_double(im,n,&a,&k)) {
    printf("  %s:", n); for(int i=0;i<k;i++) printf(" %.5g", a[i]); printf("\n");
  } else printf("  %s: (none)\n", n);
}
int main(int argc, char **argv){
  if (VIPS_INIT(argv[0])) vips_error_exit(NULL);
  for (int i=1;i<argc;i++){
    VipsImage *im = vips_image_new_from_file(argv[i], NULL);
    printf("%s\n", argv[i]);
    if(!im){ printf("  LOAD ERROR: %s\n", vips_error_buffer()); vips_error_clear(); continue; }
    printf("  loader=%s %dx%d bands=%d\n", vips_foreign_find_load(argv[i]), im->Xsize, im->Ysize, im->Bands);
    VipsImage *gm = vips_image_get_gainmap(im);
    if (gm){ double mn,mx,av; vips_min(gm,&mn,NULL); vips_max(gm,&mx,NULL); vips_avg(gm,&av,NULL);
      printf("  gainmap %dx%d bands=%d min=%g max=%g avg=%.2f\n", gm->Xsize, gm->Ysize, gm->Bands, mn, mx, av); g_object_unref(gm);}
    else printf("  gainmap: (none)\n");
    arr(im,"gainmap-max-content-boost"); arr(im,"gainmap-min-content-boost"); arr(im,"gainmap-gamma");
    arr(im,"gainmap-offset-sdr"); arr(im,"gainmap-offset-hdr");
    double d; if(!vips_image_get_double(im,"gainmap-hdr-capacity-max",&d)) printf("  hdr-capacity-max: %.5g\n", d); else vips_error_clear();
    vips_error_clear(); g_object_unref(im);
  }
  return 0;
}
