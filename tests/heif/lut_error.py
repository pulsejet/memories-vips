#!/usr/bin/env python3
"""Worst-case boost error of the Apple -> ISO 21496-1 LUT mapping in heifload.

Apple: boost = 1 + (H-1)*sRGB_EOTF(g); ISO (min 1, max H, gamma 1, no
offsets): boost = H^(q/255) with q = round(255*log2(1+(H-1)*eotf)/log2 H).
"""
import math
def eotf(g): return g / 12.92 if g <= 0.04045 else ((g + 0.055) / 1.055) ** 2.4
worst_all = 0
for H in (1.5, 2.7692, 4.66034, 7.37172, 8.0, 16.0):
    worst = 0
    for i in range(256):
        apple = 1 + (H - 1) * eotf(i / 255)
        q = max(0, min(255, round(255 * math.log2(apple) / math.log2(H))))
        worst = max(worst, abs(math.log2(H ** (q / 255) / apple)))
    worst_all = max(worst_all, worst)
    print(f"H={H:<8} max error {worst:.4f} stops ({(2**worst - 1) * 100:.2f}%)")
assert worst_all < 0.01, "LUT error above 0.01 stops"
