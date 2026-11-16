/**
 * Collage layout engine (pure, unit-tested). A layout is a split tree: leaves hold an image slot,
 * splits divide their rectangle horizontally ('row') or vertically ('col') by relative sizes.
 */
export type CollageNode =
  | { kind: 'leaf'; slot: number }
  | { kind: 'split'; dir: 'row' | 'col'; children: CollageNode[]; sizes: number[] };

export type TemplateId = 'row' | 'col' | 'grid' | 'feature-left' | 'feature-right' | 'feature-top' | 'feature-bottom';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const leaf = (slot: number): CollageNode => ({ kind: 'leaf', slot });
const split = (dir: 'row' | 'col', children: CollageNode[]): CollageNode =>
  children.length === 1 ? children[0]! : { kind: 'split', dir, children, sizes: children.map(() => 1 / children.length) };

export const TEMPLATES: Array<{ id: TemplateId; label: string; min: number }> = [
  { id: 'row', label: 'Side by side', min: 1 },
  { id: 'col', label: 'Stacked', min: 1 },
  { id: 'grid', label: 'Grid', min: 3 },
  { id: 'feature-left', label: 'Feature left', min: 3 },
  { id: 'feature-right', label: 'Feature right', min: 3 },
  { id: 'feature-top', label: 'Feature top', min: 3 },
  { id: 'feature-bottom', label: 'Feature bottom', min: 3 },
];

export function buildTemplate(id: TemplateId, n: number, columns?: number): CollageNode {
  const count = Math.max(1, n);
  const slots = Array.from({ length: count }, (_, i) => leaf(i));
  if (count === 1) return slots[0]!;
  switch (id) {
    case 'row':
      return split('row', slots);
    case 'col':
      return split('col', slots);
    case 'grid': {
      const cols = Math.max(1, Math.min(count, columns ?? Math.ceil(Math.sqrt(count))));
      const rows: CollageNode[] = [];
      for (let i = 0; i < count; i += cols) rows.push(split('row', slots.slice(i, i + cols)));
      return split('col', rows);
    }
    case 'feature-left':
      return split('row', [slots[0]!, split('col', slots.slice(1))]);
    case 'feature-right':
      return split('row', [split('col', slots.slice(1)), slots[0]!]);
    case 'feature-top':
      return split('col', [slots[0]!, split('row', slots.slice(1))]);
    case 'feature-bottom':
      return split('col', [split('row', slots.slice(1)), slots[0]!]);
  }
}

/** Natural aspect ratio (width / height) of a subtree when no image is cropped. */
export function aspectOf(node: CollageNode, aspects: number[]): number {
  if (node.kind === 'leaf') return aspects[node.slot] ?? 1;
  const a = node.children.map((c) => aspectOf(c, aspects));
  return node.dir === 'row' ? a.reduce((s, x) => s + x, 0) : 1 / a.reduce((s, x) => s + 1 / x, 0);
}

/** Sets split sizes so every image fits its cell without cropping (before gaps). */
export function autoSize(node: CollageNode, aspects: number[]): CollageNode {
  if (node.kind === 'leaf') return node;
  const children = node.children.map((c) => autoSize(c, aspects));
  const weights = children.map((c) => (node.dir === 'row' ? aspectOf(c, aspects) : 1 / aspectOf(c, aspects)));
  const total = weights.reduce((s, x) => s + x, 0) || 1;
  return { ...node, children, sizes: weights.map((w) => w / total) };
}

function splitBox(node: Extract<CollageNode, { kind: 'split' }>, box: Box, gap: number): Box[] {
  const along = node.dir === 'row' ? box.w : box.h;
  const usable = Math.max(0, along - gap * (node.children.length - 1));
  let offset = 0;
  return node.sizes.map((s) => {
    const len = usable * s;
    const b = node.dir === 'row' ? { x: box.x + offset, y: box.y, w: len, h: box.h } : { x: box.x, y: box.y + offset, w: box.w, h: len };
    offset += len + gap;
    return b;
  });
}

export function computeRects(node: CollageNode, box: Box, gap: number): Array<{ slot: number; box: Box }> {
  if (node.kind === 'leaf') return [{ slot: node.slot, box }];
  const boxes = splitBox(node, box, gap);
  return node.children.flatMap((c, i) => computeRects(c, boxes[i]!, gap));
}

export interface Divider {
  /** Child indices from the root to the split node. */
  path: number[];
  /** The divider sits between child `index` and `index + 1`. */
  index: number;
  dir: 'row' | 'col';
  /** Centre line of the gap (a thin box). */
  box: Box;
  /** Length of the split along its direction (to convert pixels to size fractions). */
  span: number;
}

export function dividers(node: CollageNode, box: Box, gap: number, path: number[] = []): Divider[] {
  if (node.kind === 'leaf') return [];
  const boxes = splitBox(node, box, gap);
  const out: Divider[] = [];
  const span = Math.max(1, (node.dir === 'row' ? box.w : box.h) - gap * (node.children.length - 1));
  for (let i = 0; i < boxes.length - 1; i++) {
    const b = boxes[i]!;
    out.push({
      path,
      index: i,
      dir: node.dir,
      span,
      box: node.dir === 'row' ? { x: b.x + b.w + gap / 2, y: box.y, w: 0, h: box.h } : { x: box.x, y: b.y + b.h + gap / 2, w: box.w, h: 0 },
    });
  }
  node.children.forEach((c, i) => out.push(...dividers(c, boxes[i]!, gap, [...path, i])));
  return out;
}

/** Moves the divider by `delta` (fraction of the split's span). Cells never shrink below `min`. */
export function resizeAt(node: CollageNode, path: number[], index: number, delta: number, min = 0.06): CollageNode {
  if (node.kind === 'leaf') return node;
  if (path.length > 0) {
    const [head, ...rest] = path;
    return { ...node, children: node.children.map((c, i) => (i === head ? resizeAt(c, rest, index, delta, min) : c)) };
  }
  const sizes = [...node.sizes];
  const a = sizes[index]!;
  const b = sizes[index + 1]!;
  const d = Math.max(min - a, Math.min(b - min, delta));
  sizes[index] = a + d;
  sizes[index + 1] = b - d;
  return { ...node, sizes };
}

export type CellFit = 'cover' | 'contain';

export interface CellView {
  zoom: number;
  /** Pan within the overflow, -1 … 1 on each axis. */
  ox: number;
  oy: number;
  fit: CellFit;
}

/** Source image placement inside a cell (in output pixels). */
export function placeImage(imgW: number, imgH: number, cell: Box, view: CellView): Box {
  const base = view.fit === 'cover' ? Math.max(cell.w / imgW, cell.h / imgH) : Math.min(cell.w / imgW, cell.h / imgH);
  const s = base * Math.max(1, view.zoom);
  const w = imgW * s;
  const h = imgH * s;
  const overX = Math.max(0, w - cell.w);
  const overY = Math.max(0, h - cell.h);
  return {
    x: cell.x + (cell.w - w) / 2 + (view.ox * overX) / 2,
    y: cell.y + (cell.h - h) / 2 + (view.oy * overY) / 2,
    w,
    h,
  };
}
