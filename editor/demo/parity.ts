// parity.ts — WebGL side of the parity page + runtime card builder.
//
// demo/parity-cases.json (committed) is the single source of truth: both this
// module (cards + live WebGL renders) and demo/generate-parity.py (VIPS-side
// JPEGs) read it. The import is checked with `satisfies` against the wire
// shape below. JSON-module imports widen (edit: string), so the strong `Edit`
// union is asserted with a cast — the pipeline normalizes each edit anyway.
import casesFile from './parity-cases.json';
import { EditPipeline } from '../src/pipeline.js';
import type { Edit } from '../src/types.js';

/** Wire shape of parity-cases.json (see `satisfies` below). */
interface ParityCaseJson {
  id: string;
  title: string;
  edits: Array<{ edit: string } & Record<string, string | number>>;
}

interface ParityCasesFileJson {
  version: number;
  cases: ParityCaseJson[];
}

const file = casesFile satisfies ParityCasesFileJson;

export interface ParityCase {
  id: string;
  title: string;
  edits: Edit[];
}

const SRC = './parity/src.jpg';

/** JSON entries with the pipeline's edit type. */
function loadCases(): ParityCase[] {
  return file.cases.map((c) => ({ id: c.id, title: c.title, edits: c.edits as Edit[] }));
}

/** Build one side-by-side card; returns the section and its WebGL canvas. */
function buildCard(c: ParityCase): { section: HTMLElement; canvas: HTMLCanvasElement } {
  const section = document.createElement('section');
  section.className = 'case';
  section.id = `case-${c.id}`;
  const title = document.createElement('h2');
  title.textContent = c.title;
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(c.edits);
  const pair = document.createElement('div');
  pair.className = 'pair';
  const glWrap = document.createElement('figure');
  glWrap.id = `glwrap-${c.id}`;
  const glCap = document.createElement('figcaption');
  glCap.id = `glmeta-${c.id}`;
  glCap.textContent = 'WebGL (live)';
  const canvas = document.createElement('canvas');
  canvas.id = `gl-${c.id}`;
  glWrap.append(glCap, canvas);
  const vipsFig = document.createElement('figure');
  const vipsCap = document.createElement('figcaption');
  vipsCap.textContent = 'VIPS (vips-preview convert)';
  const img = document.createElement('img');
  img.src = `./parity/vips-${c.id}.jpg`;
  img.alt = `VIPS render: ${c.title}`;
  img.loading = 'lazy';
  img.onerror = () => {
    vipsCap.textContent = 'VIPS (not generated — run npm run parity)';
    img.remove();
  };
  vipsFig.append(vipsCap, img);
  pair.append(glWrap, vipsFig);
  section.append(title, pre, pair);
  return { section, canvas };
}

function main(): void {
  const status = document.getElementById('status');
  const root = document.getElementById('cases');
  if (!status || !root) return;
  const cases = loadCases();
  const canvases = new Map<string, HTMLCanvasElement>();
  for (const c of cases) {
    const { section, canvas } = buildCard(c);
    root.append(section);
    canvases.set(c.id, canvas);
  }
  const img = new Image();
  img.onload = () => {
    let pipe: EditPipeline;
    let hidden: HTMLCanvasElement;
    try {
      hidden = document.createElement('canvas');
      pipe = new EditPipeline(hidden);
      pipe.setImage(img);
    } catch (e) {
      status.textContent = `WebGL unavailable: ${(e as Error).message}`;
      return;
    }
    status.textContent =
      `Source ${img.naturalWidth}x${img.naturalHeight}, ` + `${cases.length} case(s), WebGL live`;
    for (const c of cases) {
      try {
        pipe.setEdits(c.edits);
        const view = canvases.get(c.id);
        if (!view) throw new Error(`missing canvas gl-${c.id}`);
        view.width = pipe.width;
        view.height = pipe.height;
        const g = view.getContext('2d');
        if (!g) throw new Error('2d context unavailable');
        g.drawImage(hidden, 0, 0);
        const meta = document.getElementById(`glmeta-${c.id}`);
        if (meta) meta.textContent = `${pipe.width}x${pipe.height} WebGL (live)`;
      } catch (e) {
        const wrap = document.getElementById(`glwrap-${c.id}`);
        if (wrap) {
          const p = document.createElement('p');
          p.className = 'error';
          p.textContent = `WebGL render failed: ${(e as Error).message}`;
          wrap.append(p);
        }
      }
    }
  };
  img.onerror = () => {
    status.textContent = `Could not load ${SRC} — run npm run parity to generate it.`;
  };
  img.src = SRC;
}

main();
