import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPipeline } from '../src/pipeline.js';
import { SmallPreview } from '../src/smallPreview.js';
import type { Edit } from '../src/types.js';

/** WebGL mock (same contract as the pipeline tests: never renders black). */
function makeMockGL() {
  let nextId = 1;
  const calls = { draws: 0, drawImage2D: [] as unknown[][] };
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
  } as const;
  const gl = {
    ...C,
    getExtension: () => null,
    getShaderPrecisionFormat: () => ({ precision: 1 }),
    getError: () => C.NO_ERROR,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    createTexture: () => ({ __tex: nextId++ }),
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    pixelStorei: () => {},
    createFramebuffer: () => ({ __fb: nextId++ }),
    bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    checkFramebufferStatus: () => C.FRAMEBUFFER_COMPLETE,
    deleteTexture: () => {},
    deleteFramebuffer: () => {},
    viewport: () => {},
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
    uniform1i: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform1fv: () => {},
    drawArrays: () => {
      calls.draws++;
    },
  };
  return { gl: gl as unknown as WebGLRenderingContext, calls };
}

function stubDocument(gl: WebGLRenderingContext, on2D: (ctx: unknown) => void) {
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      return {
        width: 0,
        height: 0,
        getContext: (kind: string) => {
          if (kind === 'webgl') return gl;
          if (kind === '2d') {
            const ctx = {
              imageSmoothingQuality: 'high',
              drawImage: vi.fn(),
              putImageData: vi.fn(),
            };
            on2D(ctx);
            return ctx;
          }
          return null;
        },
      } as unknown as HTMLCanvasElement;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SmallPreview', () => {
  it('downscales large sources to maxDim (aspect-fit, never upscaled)', () => {
    const { gl } = makeMockGL();
    stubDocument(gl, () => {});
    const small = new SmallPreview();
    small.setSource({ width: 4096, height: 2048 } as unknown as TexImageSource);
    expect(small.width).toBe(512);
    expect(small.height).toBe(256);
    small.dispose();
    const tiny = new SmallPreview(128);
    tiny.setSource({ width: 4096, height: 2048 } as unknown as TexImageSource);
    expect(tiny.width).toBe(128);
    expect(tiny.height).toBe(64);
    tiny.dispose();
    const kept = new SmallPreview();
    kept.setSource({ width: 100, height: 80 } as unknown as TexImageSource);
    expect(kept.width).toBe(100);
    expect(kept.height).toBe(80);
    kept.dispose();
  });

  it('renders into a fresh caller-owned canvas sized to the output', () => {
    const { gl } = makeMockGL();
    const snaps: Array<{ drawImage: (...a: unknown[]) => void }> = [];
    stubDocument(gl, (ctx) => snaps.push(ctx as never));
    const small = new SmallPreview();
    small.setSource({ width: 512, height: 256 } as unknown as TexImageSource);
    const a = small.render([{ edit: 'sepia', amount: 0.5 }]);
    expect(a.width).toBe(512);
    expect(a.height).toBe(256);
    const b = small.render([{ edit: 'crop', x: 0, y: 0, width: 0.5, height: 0.5 } as Edit]);
    expect(b.width).toBe(256);
    expect(b.height).toBe(128);
    expect(b).not.toBe(a);
    small.dispose();
  });

  it('uploads once and reuses programs across renders', () => {
    const { gl, calls } = makeMockGL();
    stubDocument(gl, () => {});
    const spy = vi.spyOn(EditPipeline.prototype, 'setImage');
    const small = new SmallPreview();
    small.setSource({ width: 1024, height: 512 } as unknown as TexImageSource);
    expect(spy).toHaveBeenCalledTimes(1);
    const before = calls.draws;
    small.render([{ edit: 'brightnessContrast', brightness: 0.2 }]);
    small.render([{ edit: 'brightnessContrast', brightness: 0.4 }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls.draws).toBeGreaterThan(before);
    small.dispose();
  });

  it('rejects bad maxDim, missing/empty sources, and render-before-source', () => {
    const { gl } = makeMockGL();
    stubDocument(gl, () => {});
    expect(() => new SmallPreview(0)).toThrow();
    expect(() => new SmallPreview(NaN)).toThrow();
    const small = new SmallPreview();
    expect(() => small.render([])).toThrow('setSource');
    expect(() => small.setSource({ width: 0, height: 10 } as unknown as TexImageSource)).toThrow(
      'width/height',
    );
    // dispose() is safe empty, and render() throws again after dispose.
    expect(() => small.dispose()).not.toThrow();
    small.setSource({ width: 64, height: 48 } as unknown as TexImageSource);
    small.dispose();
    expect(() => small.render([])).toThrow('setSource');
  });

  it('accepts ImageData via a putImageData staging canvas', () => {
    const { gl } = makeMockGL();
    const contexts: Array<{ putImageData: { mock: { calls: unknown[][] } } }> = [];
    stubDocument(gl, (ctx) => contexts.push(ctx as never));
    const src = {
      width: 640,
      height: 400,
      data: new Uint8ClampedArray(640 * 400 * 4),
    } as unknown as TexImageSource;
    const small = new SmallPreview();
    expect(() => small.setSource(src)).not.toThrow();
    expect(small.width).toBe(512);
    expect(small.height).toBe(320);
    const staged = contexts.filter((c) => c.putImageData.mock.calls.length > 0);
    expect(staged.length).toBe(1);
    expect(staged[0]!.putImageData.mock.calls[0]![0]).toBe(src);
    const out = small.render([{ edit: 'sepia', amount: 0.5 }]);
    expect(out.width).toBe(512);
    expect(out.height).toBe(320);
    small.dispose();
  });
});
