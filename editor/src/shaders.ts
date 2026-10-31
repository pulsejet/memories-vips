// shaders.ts — shared GLSL for the preview pipeline (quad, copy, blit, gaussian).
//
// Per-edit shaders live next to their Transform in transforms/. Most are ports
// of evanw/glfx.js src/filters/adjust/*.js; the VIPS side (src/transforms/)
// implements the same formulas, so the canvas preview is WYSIWYG.

export const VERT = `
attribute vec2 aPos;
varying vec2 texCoord;
void main() {
  texCoord = vec2(aPos.x * 0.5 + 0.5, aPos.y * 0.5 + 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const PRELUDE = `
precision mediump float;
uniform sampler2D texture;
varying vec2 texCoord;
`;

export const COPY_FRAG =
  PRELUDE +
  `
void main() {
  gl_FragColor = texture2D(texture, texCoord);
}
`;

/** Final blit to the canvas: flips Y once, compensating the unflipped upload. */
export const BLIT_FRAG =
  PRELUDE +
  `
void main() {
  gl_FragColor = texture2D(texture, vec2(texCoord.x, 1.0 - texCoord.y));
}
`;

/** Separable gaussian, one axis per draw (dir = (1/w,0) or (0,1/h)). RGB only: alpha stays. */
export const GAUSS_FRAG =
  PRELUDE +
  `
uniform vec2 dir;
uniform float kernel[31];
uniform int count;
void main() {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 31; i++) {
    if (i >= count) break;
    vec2 off = dir * float(i - (count - 1) / 2);
    sum += texture2D(texture, texCoord + off).rgb * kernel[i];
  }
  gl_FragColor = vec4(sum, texture2D(texture, texCoord).a);
}
`;
