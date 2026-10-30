// main.ts — demo page wiring: file input, edit cards, JSON output.
//
// Cards and sliders are generated from each transform's `controls` schema;
// adding a transform to the registry is enough to appear here.
import { EditPipeline } from '../src/pipeline.js';
import { TRANSFORMS, normalizeEdit } from '../src/transforms/index.js';
import { stateToJSON } from '../src/transforms/state.js';
import { emptyState, type EditState, type Edit, type EditName } from '../src/types.js';

const state: EditState = emptyState();
const canvas = document.getElementById('view') as HTMLCanvasElement;
const editsEl = document.getElementById('edits') as HTMLElement;
const outEl = document.getElementById('out') as HTMLElement;
const metaEl = document.getElementById('meta') as HTMLElement;

let pipeline: EditPipeline | null = null;
try {
  pipeline = new EditPipeline(canvas);
} catch (e) {
  metaEl.textContent = `WebGL unavailable: ${(e as Error).message}`;
}

function showImage(source: TexImageSource, label: string): void {
  if (!pipeline) return;
  try {
    pipeline.setImage(source);
    refresh();
  } catch (e) {
    metaEl.textContent = `${label}: ${(e as Error).message}`;
  }
}

function refresh() {
  if (!pipeline) return;
  pipeline.setEdits(state.edits);
  // External owner sizes the backing store; re-present when it changed
  // (setting width/height clears, so render again after resizing).
  if (canvas.width !== pipeline.width || canvas.height !== pipeline.height) {
    canvas.width = pipeline.width;
    canvas.height = pipeline.height;
    pipeline.render();
  }
  const normalized = state.edits.map(normalizeEdit);
  outEl.textContent = JSON.stringify({ version: 1, edits: normalized }, null, 2);
  metaEl.textContent = `${pipeline.width}x${pipeline.height}, ${state.edits.length} edit(s)`;
  renderCards();
}

function renderCards() {
  editsEl.innerHTML = '';
  state.edits.forEach((edit, i) => {
    const t = TRANSFORMS[edit.edit];
    if (!t) return;
    const card = document.createElement('div');
    card.className = 'edit';
    const head = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `${i + 1}. ${edit.edit}`;
    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = 'move up';
    up.onclick = () => {
      if (i > 0) {
        const [o] = state.edits.splice(i, 1);
        state.edits.splice(i - 1, 0, o as Edit);
        refresh();
      }
    };
    const down = document.createElement('button');
    down.textContent = '↓';
    down.title = 'move down';
    down.onclick = () => {
      if (i < state.edits.length - 1) {
        const [o] = state.edits.splice(i, 1);
        state.edits.splice(i + 1, 0, o as Edit);
        refresh();
      }
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'remove';
    del.onclick = () => {
      state.edits.splice(i, 1);
      refresh();
    };
    head.append(title, up, down, del);
    card.append(head);
    for (const p of t.controls) {
      const row = document.createElement('label');
      row.className = 'param';
      const name = document.createElement('span');
      name.textContent = p.label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(p.min);
      slider.max = String(p.max);
      slider.step = String(p.step);
      const cur = (edit as unknown as Record<string, number>)[p.key] ?? p.def;
      slider.value = String(cur);
      const val = document.createElement('span');
      val.textContent = Number(cur).toFixed(2);
      slider.oninput = () => {
        (edit as unknown as Record<string, number>)[p.key] = Number(slider.value);
        val.textContent = Number(slider.value).toFixed(2);
        pipeline?.setEdits(state.edits);
        outEl.textContent = JSON.stringify(
          { version: 1, edits: state.edits.map(normalizeEdit) },
          null,
          2,
        );
      };
      row.append(name, slider, val);
      card.append(row);
    }
    editsEl.append(card);
  });
}

(document.getElementById('add') as HTMLButtonElement).onclick = () => {
  const sel = document.getElementById('addedit') as HTMLSelectElement;
  const name = sel.value as EditName;
  state.edits.push(normalizeEdit({ edit: name } as Edit));
  refresh();
};

(document.getElementById('clear') as HTMLButtonElement).onclick = () => {
  state.edits.length = 0;
  refresh();
};

(document.getElementById('copy') as HTMLButtonElement).onclick = async () => {
  await navigator.clipboard.writeText(stateToJSON(state));
};

(document.getElementById('file') as HTMLInputElement).onchange = (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    showImage(img, file.name);
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    metaEl.textContent = `${file.name}: could not decode image`;
  };
  img.src = URL.createObjectURL(file);
};

(document.getElementById('gradient') as HTMLButtonElement).onclick = () => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 400;
  const g = c.getContext('2d');
  if (!g) return;
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, '#ff4444');
  grad.addColorStop(0.33, '#44ff44');
  grad.addColorStop(0.66, '#4444ff');
  grad.addColorStop(1, '#ffff44');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 400);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(320, 200, 90, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#000';
  g.font = '28px sans-serif';
  g.fillText('vips-static demo', 200, 210);
  showImage(c, 'gradient');
};

// Boot with a gradient so the sliders do something before an upload.
(document.getElementById('gradient') as HTMLButtonElement).click();
state.edits.push(normalizeEdit({ edit: 'brightnessContrast', brightness: 0.1, contrast: 0.1 }));
refresh();
