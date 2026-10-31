import { describe, expect, it, vi } from 'vitest';
import { gaussianKernel } from '../src/math.js';
import { EditPipeline } from '../src/pipeline.js';
import type { Edit } from '../src/types.js';

/** Minimal stateful WebGL mock: tracks target sizes, rejects use-after-delete. */
function makeMockGL() {
  let nextId = 1;
  const texSize = new Map<number, { w: number; h: number }>();
  const fbTex = new Map<number, number>();
  const deletedTex = new Set<number>();
  const deletedFb = new Set<number>();
  const calls = {
    viewports: [] as Array<[number, number, number, number]>,
    draws: 0,
    clears: 0,
    /** kernel lengths passed to the separable-gaussian shader, in order. */
    gaussCounts: [] as number[],
  };
  let boundTex = 0;
  let boundFb = 0;
  const C = {
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    FLOAT: 0x1406,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    NO_ERROR: 0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    COLOR_BUFFER_BIT: 0x4000,
  } as const;
  const gl = {
    ...C,
    getExtension: () => null,
    getShaderPrecisionFormat: () => ({ precision: 1 }),
    getError: () => C.NO_ERROR,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    createTexture: () => {
      const id = nextId++;
      texSize.set(id, { w: 0, h: 0 });
      return { __tex: id };
    },
    bindTexture: (_t: number, tex: { __tex: number } | null) => {
      boundTex = tex ? tex.__tex : 0;
    },
    texParameteri: () => {},
    texImage2D: (...args: unknown[]) => {
      // (target, level, ifmt, w, h, 0, fmt, type, null) or (..., ..., upload)
      if (typeof args[3] === 'number' && typeof args[4] === 'number') {
        texSize.set(boundTex, { w: args[3] as number, h: args[4] as number });
      }
    },
    pixelStorei: () => {},
    createFramebuffer: () => {
      const id = nextId++;
      fbTex.set(id, 0);
      return { __fb: id };
    },
    bindFramebuffer: (_t: number, fb: { __fb: number } | null) => {
      const id = fb ? fb.__fb : 0;
      if (id !== 0 && deletedFb.has(id)) throw new Error('bind of deleted framebuffer');
      boundFb = id;
    },
    framebufferTexture2D: (_t: number, _a: number, _tt: number, tex: { __tex: number }) => {
      fbTex.set(boundFb, tex.__tex);
    },
    checkFramebufferStatus: () => C.FRAMEBUFFER_COMPLETE,
    deleteTexture: (tex: { __tex: number }) => {
      deletedTex.add(tex.__tex);
    },
    deleteFramebuffer: (fb: { __fb: number }) => {
      deletedFb.add(fb.__fb);
    },
    viewport: (x: number, y: number, w: number, h: number) => {
      calls.viewports.push([x, y, w, h]);
    },
    clearColor: () => {},
    clear: () => {
      calls.clears++;
    },
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    disableVertexAttribArray: () => {},
    activeTexture: () => {},
    getUniformLocation: (_prog: unknown, name: string) => ({ __uniform: name }),
    uniform1i: (loc: { __uniform?: string } | null, v: number) => {
      if (loc?.__uniform === 'count') calls.gaussCounts.push(v);
    },
    uniform1f: () => {},
    uniform2f: () => {},
    uniform1fv: () => {},
    drawArrays: () => {
      if (boundFb !== 0) {
        if (deletedFb.has(boundFb)) throw new Error('draw to deleted framebuffer');
        const tex = fbTex.get(boundFb) ?? 0;
        if (deletedTex.has(tex)) throw new Error('draw to deleted texture');
      }
      calls.draws++;
    },
  };
  return { gl: gl as unknown as WebGLRenderingContext, calls };
}

function makePipeline() {
  const { gl, calls } = makeMockGL();
  // The pipeline owns the backing store size: whatever it starts at, the
  // first render resizes it to the rendered area.
  const canvas = {
    width: 100,
    height: 80,
    getContext: (kind: string) => (kind === 'webgl' ? gl : null),
  } as unknown as HTMLCanvasElement;
  const pipe = new EditPipeline(canvas);
  pipe.setImage({ width: 64, height: 48 } as unknown as TexImageSource);
  return { pipe, canvas, calls };
}

describe('pipeline geometry plumbing (mock GL)', () => {
  it('resizes the canvas to the rendered area', () => {
    const { pipe, canvas } = makePipeline();
    expect(pipe.width).toBe(64);
    expect(pipe.height).toBe(48);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
    pipe.setEdits([{ edit: 'rotate', angle: 90 }]);
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(64);
  });

  it('presents fullscreen 1:1 with no letterbox', () => {
    const { pipe, canvas, calls } = makePipeline();
    pipe.setEdits([{ edit: 'crop', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }]);
    expect(pipe.width).toBe(32);
    expect(pipe.height).toBe(24);
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(24);
    const last = calls.viewports[calls.viewports.length - 1];
    expect(last).toEqual([0, 0, 32, 24]);
  });

  it('rotate 90 swaps, chained geometry composes in order', () => {
    const { pipe, canvas } = makePipeline();
    pipe.setEdits([{ edit: 'rotate', angle: 90 }]);
    expect([pipe.width, pipe.height]).toEqual([48, 64]);
    expect([canvas.width, canvas.height]).toEqual([48, 64]);
    // crop to center half, then rotate 30: dims follow each step
    pipe.setEdits([
      { edit: 'crop', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      { edit: 'rotate', angle: 30 },
    ]);
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(pipe.width).toBe(Math.round(32 * c + 24 * s));
    expect(pipe.height).toBe(Math.round(32 * s + 24 * c));
    expect([canvas.width, canvas.height]).toEqual([pipe.width, pipe.height]);
  });

  it('pixel edits after geometry see the new size (no stale targets)', () => {
    const { pipe, canvas, calls } = makePipeline();
    const edits: Edit[] = [
      { edit: 'rotate', angle: 30 },
      { edit: 'sharpen', radius: 3, amount: 1 },
      { edit: 'blur', radius: 4 },
      { edit: 'sepia', amount: 0.5 },
      { edit: 'crop', x: 0, y: 0, width: 0.5, height: 0.5 },
      { edit: 'vignette', size: 0.5, amount: 0.5 },
    ];
    expect(() => pipe.setEdits(edits)).not.toThrow();
    expect(calls.draws).toBeGreaterThan(0);
    // final pass presents the cropped output fullscreen into the resized canvas
    const last = calls.viewports[calls.viewports.length - 1];
    expect(last).toEqual([0, 0, pipe.width, pipe.height]);
    expect(canvas.width).toBe(pipe.width);
    expect(canvas.height).toBe(pipe.height);
  });

  it('addEdit/removeEdit/clearEdits keep dims consistent', () => {
    const { pipe, canvas } = makePipeline();
    pipe.addEdit({ edit: 'rotate', angle: 90 });
    expect([pipe.width, pipe.height]).toEqual([48, 64]);
    expect([canvas.width, canvas.height]).toEqual([48, 64]);
    pipe.addEdit({ edit: 'crop', x: 0, y: 0, width: 0.5, height: 1 });
    expect([pipe.width, pipe.height]).toEqual([24, 64]);
    expect([canvas.width, canvas.height]).toEqual([24, 64]);
    pipe.removeEdit(0);
    expect([pipe.width, pipe.height]).toEqual([32, 48]);
    expect([canvas.width, canvas.height]).toEqual([32, 48]);
    pipe.clearEdits();
    expect([pipe.width, pipe.height]).toEqual([64, 48]);
    expect([canvas.width, canvas.height]).toEqual([64, 48]);
  });

  it('canvas follows a new source size', () => {
    const { pipe, canvas } = makePipeline();
    expect([canvas.width, canvas.height]).toEqual([64, 48]);
    pipe.setImage({ width: 20, height: 10 } as unknown as TexImageSource);
    expect([pipe.width, pipe.height]).toEqual([20, 10]);
    expect([canvas.width, canvas.height]).toEqual([20, 10]);
  });

  it('scales pixel radii by the working/native ratio end to end', () => {
    // A 4096-wide source downscales to the 2048 working box (scale 0.5):
    // blur radius 6 must convolve the radius-3 kernel (7 taps, twice),
    // so the preview matches the full-res VIPS output relatively.
    const stubCanvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) };
    vi.stubGlobal('document', { createElement: () => stubCanvas });
    try {
      const { gl, calls } = makeMockGL();
      const canvas = {
        width: 100,
        height: 80,
        getContext: (kind: string) => (kind === 'webgl' ? gl : null),
      } as unknown as HTMLCanvasElement;
      const pipe = new EditPipeline(canvas);
      pipe.setImage({ width: 4096, height: 2048 } as unknown as TexImageSource);
      expect(pipe.width).toBe(2048);
      expect(pipe.height).toBe(1024);
      expect(gaussianKernel(6).length).toBe(13);
      pipe.setEdits([{ edit: 'blur', radius: 6 }]);
      expect(calls.gaussCounts).toEqual([7, 7]);
      // No downscale -> scale 1 -> full kernel.
      pipe.setImage({ width: 64, height: 48 } as unknown as TexImageSource);
      calls.gaussCounts.length = 0;
      pipe.setEdits([{ edit: 'blur', radius: 6 }]);
      expect(calls.gaussCounts).toEqual([13, 13]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('toJSON round-trips geometric edits for the VIPS side', () => {
    const { pipe } = makePipeline();
    const edits: Edit[] = [
      { edit: 'crop', x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
      { edit: 'rotate', angle: 45 },
    ];
    pipe.setEdits(edits);
    const back = JSON.parse(pipe.toJSON()) as { version: number; edits: Edit[] };
    expect(back.edits).toEqual([
      { edit: 'crop', x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
      { edit: 'rotate', angle: 45 },
    ]);
  });
});
