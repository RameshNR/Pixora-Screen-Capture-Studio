/**
 * Live screen annotation drawn over the page while recording. It lives in the overlay's shadow
 * root, so it shows in tab recordings (and on screen for desktop recordings) but never touches the
 * page's own DOM or styles. When "interact" is on, the layer lets every click through to the page.
 */
import type { AnnotateAction, AnnotateTool } from '@/shared/messaging/messages';
import { formatKeys } from '@/shared/utils/keys';

interface Style {
  color: string;
  width: number;
  opacity: number;
  fontSize: number;
}

type Shape =
  | { kind: 'pen'; pts: Array<[number, number]>; style: Style }
  | { kind: 'line' | 'arrow' | 'rect' | 'circle'; x1: number; y1: number; x2: number; y2: number; style: Style }
  | { kind: 'text'; x: number; y: number; text: string; style: Style };

export interface AnnotateCallbacks {
  /** The user left drawing mode from the page (Esc / shortcut). */
  onStateChange: (drawing: boolean) => void;
}

const SHORTCUT_TOOLS: Record<string, AnnotateTool> = { p: 'pen', a: 'arrow', l: 'line', r: 'rect', o: 'circle', t: 'text', e: 'eraser' };

export class AnnotateLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hint: HTMLDivElement;
  private shapes: Shape[] = [];
  private redoStack: Shape[][] = [];
  private undoStack: Shape[][] = [];
  private draft: Shape | null = null;
  private tool: AnnotateTool = 'pen';
  private style: Style = { color: '#E05252', width: 5, opacity: 1, fontSize: 28 };
  private drawing = false;
  private visible = true;
  private textInput: HTMLInputElement | null = null;

  constructor(private readonly root: ShadowRoot, private readonly host: HTMLElement, private readonly cb: AnnotateCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'annot';
    this.ctx = this.canvas.getContext('2d')!;
    this.hint = document.createElement('div');
    this.hint.className = 'annot-hint';
    root.append(this.canvas, this.hint);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey, true);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.setDrawing(true);
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  apply(action: AnnotateAction): void {
    switch (action.kind) {
      case 'start':
        this.setDrawing(true);
        break;
      case 'stop':
      case 'interact':
        this.setDrawing(action.kind === 'interact' ? !action.on : false);
        break;
      case 'tool':
        this.tool = action.tool;
        this.setDrawing(true);
        break;
      case 'style':
        this.style = {
          color: action.color ?? this.style.color,
          width: action.width ?? this.style.width,
          opacity: action.opacity ?? this.style.opacity,
          fontSize: action.fontSize ?? this.style.fontSize,
        };
        break;
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'clear':
        if (this.shapes.length) this.commit([]);
        break;
      case 'visible':
        this.visible = action.visible;
        this.canvas.style.display = action.visible ? 'block' : 'none';
        break;
    }
    this.updateHint();
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKey, true);
    this.textInput?.remove();
    this.canvas.remove();
    this.hint.remove();
  }

  private setDrawing(on: boolean): void {
    this.drawing = on;
    this.canvas.style.pointerEvents = on ? 'auto' : 'none';
    this.canvas.style.cursor = on ? (this.tool === 'text' ? 'text' : this.tool === 'eraser' ? 'cell' : 'crosshair') : 'default';
    // The host only takes pointer events while drawing, so the page stays usable otherwise.
    this.host.style.pointerEvents = 'none';
    this.updateHint();
  }

  private updateHint(): void {
    this.hint.textContent = this.drawing
      ? formatKeys(`Drawing · ${this.tool} — P A L R O T E tools · Ctrl+Z undo · Esc to use the page`)
      : '';
    this.hint.style.display = this.drawing && this.visible ? 'block' : 'none';
    this.canvas.style.cursor = this.drawing ? (this.tool === 'text' ? 'text' : this.tool === 'eraser' ? 'cell' : 'crosshair') : 'default';
  }

  private readonly resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.redraw();
  };

  private commit(next: Shape[]): void {
    this.undoStack.push(this.shapes);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.shapes = next;
    this.redraw();
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.shapes);
    this.shapes = prev;
    this.redraw();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.shapes);
    this.shapes = next;
    this.redraw();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.textInput && e.composedPath().includes(this.textInput)) return;
    // Alt+Shift+D toggles drawing from anywhere in the page.
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      this.setDrawing(!this.drawing);
      this.cb.onStateChange(this.drawing);
      return;
    }
    if (!this.drawing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let handled = true;
    if (mod && k === 'z' && !e.shiftKey) this.undo();
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) this.redo();
    else if (mod) handled = false;
    else if (e.key === 'Escape') {
      this.setDrawing(false);
      this.cb.onStateChange(false);
    } else if (e.key === 'Delete') this.apply({ kind: 'clear' });
    else if (k === 'h') this.apply({ kind: 'visible', visible: !this.visible });
    else if (SHORTCUT_TOOLS[k]) {
      this.tool = SHORTCUT_TOOLS[k]!;
      this.updateHint();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.drawing || e.button !== 0) return;
    e.preventDefault();
    const { clientX: x, clientY: y } = e;
    if (this.tool === 'text') {
      this.openText(x, y);
      return;
    }
    if (this.tool === 'eraser') {
      this.eraseAt(x, y);
      this.canvas.setPointerCapture(e.pointerId);
      this.draft = { kind: 'pen', pts: [], style: this.style };
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.draft = this.tool === 'pen'
      ? { kind: 'pen', pts: [[x, y]], style: { ...this.style } }
      : { kind: this.tool, x1: x, y1: y, x2: x, y2: y, style: { ...this.style } };
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.draft) return;
    const { clientX: x, clientY: y } = e;
    if (this.tool === 'eraser') {
      this.eraseAt(x, y);
      return;
    }
    if (this.draft.kind === 'pen') this.draft.pts.push([x, y]);
    else if (this.draft.kind !== 'text') {
      this.draft.x2 = x;
      this.draft.y2 = y;
    }
    this.redraw();
  };

  private readonly onUp = (): void => {
    const d = this.draft;
    this.draft = null;
    if (!d || this.tool === 'eraser') return;
    const big = d.kind === 'pen' ? d.pts.length > 1 : d.kind === 'text' ? true : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 3;
    if (big) this.commit([...this.shapes, d]);
    else this.redraw();
  };

  private eraseAt(x: number, y: number): void {
    const reach = 12;
    const hit = this.shapes.findIndex((s) => hits(s, x, y, reach));
    if (hit >= 0) this.commit(this.shapes.filter((_, i) => i !== hit));
  }

  private openText(x: number, y: number): void {
    this.textInput?.remove();
    const input = document.createElement('input');
    input.className = 'annot-text';
    input.placeholder = 'Type, then Enter';
    input.style.left = `${x}px`;
    input.style.top = `${y - this.style.fontSize * 0.7}px`;
    input.style.font = `600 ${this.style.fontSize}px Inter, "Segoe UI", system-ui, sans-serif`;
    input.style.color = this.style.color;
    const style = { ...this.style };
    const finish = (save: boolean) => {
      if (this.textInput !== input) return;
      this.textInput = null;
      const text = input.value.trim();
      input.remove();
      if (save && text) this.commit([...this.shapes, { kind: 'text', x, y: y - style.fontSize * 0.7, text, style }]);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    this.root.append(input);
    this.textInput = input;
    requestAnimationFrame(() => input.focus());
  }

  private redraw(): void {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of this.draft ? [...this.shapes, this.draft] : this.shapes) drawShape(ctx, s);
  }
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.save();
  ctx.globalAlpha = s.style.opacity;
  ctx.strokeStyle = s.style.color;
  ctx.fillStyle = s.style.color;
  ctx.lineWidth = s.style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (s.kind) {
    case 'pen':
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      break;
    case 'line':
    case 'arrow': {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      if (s.kind === 'arrow') {
        const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        const len = Math.max(12, s.style.width * 3.5);
        ctx.beginPath();
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - len * Math.cos(a - 0.45), s.y2 - len * Math.sin(a - 0.45));
        ctx.lineTo(s.x2 - len * Math.cos(a + 0.45), s.y2 - len * Math.sin(a + 0.45));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'rect':
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
      break;
    case 'circle':
      ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'text':
      ctx.font = `600 ${s.style.fontSize}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 3;
      ctx.fillText(s.text, s.x, s.y);
      break;
  }
  ctx.restore();
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether the point touches a shape (used by the eraser). Exported for tests. */
export function hits(s: Shape, x: number, y: number, reach: number): boolean {
  const r = reach + s.style.width / 2;
  switch (s.kind) {
    case 'pen':
      for (let i = 1; i < s.pts.length; i++) if (distToSegment(x, y, ...s.pts[i - 1]!, ...s.pts[i]!) <= r) return true;
      return false;
    case 'line':
    case 'arrow':
      return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= r;
    case 'rect': {
      const [l, t, rt, b] = [Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)];
      return [distToSegment(x, y, l, t, rt, t), distToSegment(x, y, rt, t, rt, b), distToSegment(x, y, rt, b, l, b), distToSegment(x, y, l, b, l, t)].some((d) => d <= r);
    }
    case 'circle': {
      const cx = (s.x1 + s.x2) / 2;
      const cy = (s.y1 + s.y2) / 2;
      const rx = Math.max(1, Math.abs(s.x2 - s.x1) / 2);
      const ry = Math.max(1, Math.abs(s.y2 - s.y1) / 2);
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= r;
    }
    case 'text':
      return x >= s.x - reach && x <= s.x + s.text.length * s.style.fontSize * 0.6 + reach && y >= s.y - reach && y <= s.y + s.style.fontSize * 1.3 + reach;
  }
}
