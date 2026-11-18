import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Annotation, CalloutAnnotation, EditorDoc, Point, Rect, RedactLook, TextAnnotation, Tool, ToolStyles } from '../types';
import { HANDLE_HIT_RADIUS, renderScene, usedFonts } from '../render';
import { annotationId, rectFromPoints } from '../tools/common';
import { appendPoint } from '../tools/pen';
import { defaultBends, snap45 } from '../tools/shapes';
import { SelectionBar, type SelectionActions } from './SelectionBar';
import {
  angleFrom, describeAnnotation, findAt, getBounds, handlesFor, isRoundHandle, isTextHandle, pivotOf, resizeBy, rotateBy, rotationOf, translate, type Handle, selectionPolygon,
} from '../tools/annotations';
import { constrainAspect } from '../tools/crop';
import { frameLayout, onFrameImageLoaded } from '../tools/decorations';
import { fontString, LINE_HEIGHT, textBlock } from '../tools/text';
import { calloutTextRects, fitCallout } from '../tools/callouts';
import { ensureFonts } from '../fonts';
import styles from './editor.module.css';

const PAD = 48;

/** Eraser cursor (an eraser glyph with a white halo so it shows on any background). */
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<g stroke="#fff" stroke-width="4"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/></g>' +
    '<g stroke="#202938" stroke-width="2"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></g>' +
    '<path d="m5 11 9 9-2 1H7l-4.3-4.3c-1-1-1-2.5 0-3.4z" fill="#E05252"/></svg>',
)}") 4 22, cell`;

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<g stroke="#fff" stroke-width="4"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></g>' +
    '<g stroke="#202938" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></g></svg>',
)}") 12 12, grab`;

/** The look fields of a blur / pixelate / mask style (unset ones are left out). */
function lookOf(s: RedactLook): RedactLook {
  return Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && k !== 'intensity' && k !== 'color')) as RedactLook;
}

export interface TextEditState {
  /** Text or callout being edited. */
  annotation: TextAnnotation | CalloutAnnotation;
  isNew: boolean;
}

export interface WorkspaceHandle {
  fit: () => void;
  setZoomAt: (zoom: number) => void;
  /** Document point at the centre of the viewport (for placing inserted images). */
  viewportCenter: () => Point;
}

interface Props {
  doc: EditorDoc;
  tool: Tool;
  toolStyles: ToolStyles;
  zoom: number;
  onZoom: (zoom: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (doc: EditorDoc, label: string) => void;
  crop: Rect | null;
  cropAspect: number | null;
  onCropChange: (rect: Rect) => void;
  /** Cut out & join band while the cut tool is active. */
  cut?: { axis: 'rows' | 'columns'; from: number; to: number } | null;
  onCutChange?: (band: { from: number; to: number }) => void;
  textEdit: TextEditState | null;
  onTextEdit: (state: TextEditState | null) => void;
  onTextCommit: (state: TextEditState, text: string) => void;
  panning: boolean;
  /** Quick actions for the floating bar over the selected object. */
  selectionActions?: SelectionActions | null;
  /** Several objects selected together (Ctrl+Shift+click), and what can be done with them. */
  multiIds?: readonly string[];
  onMultiChange?: (ids: string[]) => void;
  multiActions?: SelectionActions | null;
  /** Space around the picture (0: the picture fills the view exactly, e.g. over a video). */
  padding?: number;
  /** Right click on the canvas: the object under the pointer (selected first), or null. */
  onCanvasMenu?: (e: React.MouseEvent, hit: Annotation | null) => void;
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; scrollX: number; scrollY: number }
  | { kind: 'move'; start: Point; original: Annotation; editOnClick: boolean }
  | { kind: 'move-many'; start: Point; originals: Annotation[] }
  | { kind: 'resize'; start: Point; original: Annotation; handle: Handle }
  | { kind: 'rotate'; startAngle: number; original: Annotation }
  | { kind: 'draw'; start: Point; clickHit: Annotation | null }
  | { kind: 'erase' }
  | { kind: 'crop-new'; start: Point }
  | { kind: 'crop-move'; start: Point; original: Rect }
  | { kind: 'crop-resize'; start: Point; original: Rect; handle: Handle }
  | { kind: 'cut-new'; start: number }
  | { kind: 'cut-edge'; edge: 'from' | 'to' }
  | { kind: 'cut-move'; start: number; from: number; to: number };

const SELECT_LIKE = new Set<Tool>(['select', 'watermark', 'frame']);
const NO_IDS: readonly string[] = [];

export const CanvasWorkspace = forwardRef<WorkspaceHandle, Props>(function CanvasWorkspace(props, ref) {
  const {
    doc, tool, toolStyles, zoom, onZoom, selectedId, onSelect, onCommit, crop, cropAspect, onCropChange, cut = null, onCutChange,
    textEdit, onTextEdit, onTextCommit, panning, selectionActions, multiIds = NO_IDS, onMultiChange, multiActions, onCanvasMenu, padding = PAD,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ width: 800, height: 600, scrollX: 0, scrollY: 0 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  /** Several selected objects while they are being dragged. */
  const [manyDraft, setManyDraft] = useState<Annotation[] | null>(null);
  const [eraserTrail, setEraserTrail] = useState<Point[] | null>(null);
  const [eraserAt, setEraserAt] = useState<Point | null>(null);
  const [cursor, setCursor] = useState('default');
  /** Ctrl (⌘) is held, with or without Shift: a click won't add anything, so the cursor says so. */
  const [held, setHeld] = useState<'none' | 'ctrl' | 'ctrl-shift'>('none');
  const noteKeys = useCallback((e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setHeld(e.ctrlKey || e.metaKey ? (e.shiftKey ? 'ctrl-shift' : 'ctrl') : 'none');
  }, []);
  useEffect(() => {
    const clear = () => setHeld('none');
    window.addEventListener('keydown', noteKeys, true);
    window.addEventListener('keyup', noteKeys, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', noteKeys, true);
      window.removeEventListener('keyup', noteKeys, true);
      window.removeEventListener('blur', clear);
    };
  }, [noteKeys]);
  const [fontsTick, setFontsTick] = useState(0);
  const drag = useRef<Drag | null>(null);
  const erased = useRef<Set<string>>(new Set());
  /** Arrow started with a click (no drag): the next click sets its end. */
  const arrowStart = useRef<Point | null>(null);
  const zoomAnchor = useRef<{ doc: Point; screen: Point } | null>(null);
  const dpr = window.devicePixelRatio || 1;

  // The scrollable content is the whole output (frame included).
  const layout = frameLayout(doc);
  const outer = layout.outer;
  const tilt = layout.tilt ?? null;
  const contentW = outer.w * zoom + padding * 2;
  const contentH = outer.h * zoom + padding * 2;
  const outerX = contentW <= view.width + 0.5 ? (view.width - outer.w * zoom) / 2 : padding - view.scrollX;
  const outerY = contentH <= view.height + 0.5 ? (view.height - outer.h * zoom) / 2 : padding - view.scrollY;
  const originX = outerX - outer.x * zoom;
  const originY = outerY - outer.y * zoom;

  const toDoc = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = canvasRef.current!.getBoundingClientRect();
      const p = { x: (clientX - r.left - originX) / zoom, y: (clientY - r.top - originY) / zoom };
      // Mockup perspective: map the pointer back into the untilted image.
      if (tilt && !crop) {
        const q = tilt.inverse().transformPoint(p);
        return { x: q.x, y: q.y };
      }
      return p;
    },
    [originX, originY, zoom, tilt, crop],
  );

  // A background image finished decoding: draw again.
  const [, setAssetTick] = useState(0);
  useEffect(() => onFrameImageLoaded(() => setAssetTick((n) => n + 1)), []);

  /* ------------------------------ viewport size ------------------------------ */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight })));
    ro.observe(el);
    setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight }));
    return () => ro.disconnect();
  }, []);

  const fitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 1;
    const z = Math.min((el.clientWidth - padding * 2) / outer.w, (el.clientHeight - padding * 2) / outer.h, padding ? 1 : Infinity);
    return Math.max(0.02, z);
  }, [outer.w, outer.h, padding]);

  /** The zoom last set by "fit": while it is unchanged, the picture re-fits when the view resizes. */
  const fittedZoom = useRef<number | null>(null);
  /** View size when the picture was last fitted. */
  const fittedView = useRef({ w: 0, h: 0 });
  useEffect(() => {
    if (fittedZoom.current === null || Math.abs(fittedZoom.current - zoom) > 1e-6) return;
    // Only a real resize (not a scrollbar appearing / disappearing, ~17 px) re-fits, and only once
    // the size has settled: re-fitting on every small change made the picture flicker.
    if (Math.abs(view.width - fittedView.current.w) < 24 && Math.abs(view.height - fittedView.current.h) < 24) return;
    const t = setTimeout(() => {
      const z = Math.round(fitZoom() * 1e4) / 1e4;
      fittedView.current = { w: view.width, h: view.height };
      if (Math.abs(z - zoom) > 1e-3) {
        fittedZoom.current = z;
        onZoom(z);
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.width, view.height]);

  useImperativeHandle(ref, () => ({
    fit: () => { const z = Math.round(fitZoom() * 1e4) / 1e4; fittedZoom.current = z; fittedView.current = { w: view.width, h: view.height }; onZoom(z); },
    setZoomAt: (z: number) => {
      const el = scrollRef.current;
      if (el) {
        const centre = { x: el.clientWidth / 2, y: el.clientHeight / 2 };
        zoomAnchor.current = { screen: centre, doc: { x: (centre.x - originX) / zoom, y: (centre.y - originY) / zoom } };
      }
      onZoom(z);
    },
    viewportCenter: () => ({ x: (view.width / 2 - originX) / zoom, y: (view.height / 2 - originY) / zoom }),
  }), [fitZoom, onZoom, originX, originY, zoom, view.width, view.height]);

  // Keep the anchored document point under the cursor / centre after a zoom change.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!el || !anchor) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, (anchor.doc.x - outer.x) * zoom + PAD - anchor.screen.x);
    el.scrollTop = Math.max(0, (anchor.doc.y - outer.y) * zoom + PAD - anchor.screen.y);
    setView((v) => ({ ...v, scrollX: el.scrollLeft, scrollY: el.scrollTop }));
  }, [zoom, outer.x, outer.y]);

  /* ---------------------------------- fonts ---------------------------------- */
  useEffect(() => {
    let alive = true;
    void ensureFonts(usedFonts(doc, draft)).then((changed) => alive && changed && setFontsTick((t) => t + 1));
    return () => {
      alive = false;
    };
  }, [doc, draft]);

  /* --------------------------------- render --------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.round(view.width * dpr));
    const h = Math.max(1, Math.round(view.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Resizing the canvas clears it: done in the same frame as the drawing, so the browser never
    // shows the cleared canvas in between (the picture flickered while the window was resized,
    // focused or restored).
    const raf = requestAnimationFrame(() => {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const moving = manyDraft ? new Map(manyDraft.map((a) => [a.id, a])) : null;
      const shown = moving ? { ...doc, annotations: doc.annotations.map((a) => moving.get(a.id) ?? a) } : doc;
      renderScene(
        ctx,
        shown,
        { zoom, originX, originY, dpr },
        {
          selectedId, multi: shown.annotations.filter((a) => multiIds.includes(a.id)), hiddenId: textEdit?.annotation.id ?? null, draft, crop, cut, eraserTrail,
          eraserCursor: tool === 'eraser' && eraserAt ? { ...eraserAt, r: toolStyles.eraser.size / 2 } : null,
        },
        { width: view.width, height: view.height },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, zoom, originX, originY, dpr, selectedId, multiIds, manyDraft, draft, crop, cut, eraserTrail, eraserAt, tool, toolStyles.eraser.size, view.width, view.height, textEdit, fontsTick]);

  /* --------------------------------- wheel ---------------------------------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      zoomAnchor.current = { screen, doc: { x: (screen.x - originX) / zoom, y: (screen.y - originY) / zoom } };
      const factor = Math.exp(-e.deltaY * 0.0025);
      onZoom(Math.min(8, Math.max(0.02, zoom * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, originX, originY, onZoom]);

  /* ------------------------------ pointer logic ----------------------------- */
  const tolerance = 6 / zoom;
  const eraseReach = Math.max(tolerance, toolStyles.eraser.size / 2);
  const selected = selectedId ? doc.annotations.find((a) => a.id === selectedId) ?? null : null;

  const onImage = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= doc.width && p.y <= doc.height;

  const handleAt = (p: Point, a: Annotation | null): Handle | null => {
    if (!a) return null;
    for (const h of handlesFor(a, zoom)) if (Math.hypot(h.x - p.x, h.y - p.y) <= HANDLE_HIT_RADIUS / zoom) return h.handle;
    return null;
  };

  /** Cut tool: position along the cut axis, clamped to the image. */
  const cutPos = (p: Point) => {
    const len = cut?.axis === 'columns' ? doc.width : doc.height;
    return Math.max(0, Math.min(len, Math.round(cut?.axis === 'columns' ? p.x : p.y)));
  };
  /** Which part of the band is under the pointer: an edge (to drag it), inside (to move it), or neither. */
  const cutHitAt = (p: Point): 'from' | 'to' | 'inside' | null => {
    if (!cut) return null;
    const v = cut.axis === 'columns' ? p.x : p.y;
    const reach = 8 / zoom;
    const lo = Math.min(cut.from, cut.to);
    const hi = Math.max(cut.from, cut.to);
    if (Math.abs(v - lo) <= reach) return cut.from <= cut.to ? 'from' : 'to';
    if (Math.abs(v - hi) <= reach) return cut.from <= cut.to ? 'to' : 'from';
    return v > lo && v < hi ? 'inside' : null;
  };

  const cropHandleAt = (p: Point): Handle | null => {
    if (!crop) return null;
    const pts: Array<[Handle, number, number]> = [
      ['nw', crop.x, crop.y], ['n', crop.x + crop.w / 2, crop.y], ['ne', crop.x + crop.w, crop.y], ['e', crop.x + crop.w, crop.y + crop.h / 2],
      ['se', crop.x + crop.w, crop.y + crop.h], ['s', crop.x + crop.w / 2, crop.y + crop.h], ['sw', crop.x, crop.y + crop.h], ['w', crop.x, crop.y + crop.h / 2],
    ];
    for (const [h, x, y] of pts) if (Math.hypot(x - p.x, y - p.y) <= (HANDLE_HIT_RADIUS + 2) / zoom) return h;
    return null;
  };

  const newShape = (start: Point, end: Point): Annotation | null => {
    const r = rectFromPoints(start, end);
    const id = draft?.id ?? annotationId();
    switch (tool) {
      case 'rect':
      case 'ellipse': {
        const s = toolStyles.shape;
        // The ellipse tool keeps drawing ellipses unless a library shape was picked for it.
        const shape = tool === 'ellipse' && (!s.shape || s.shape === 'rect' || s.shape === 'rounded') ? undefined : s.shape;
        return { id, type: tool, ...r, stroke: s.stroke, fill: s.fill, width: s.width, opacity: s.opacity, radius: s.radius, dash: s.dash,
          ...(shape ? { shape } : {}), ...(s.look && s.look !== 'flat' ? { look: s.look } : {}) };
      }
      case 'blur':
        return { ...lookOf(toolStyles.blur), id, type: 'blur', ...r, intensity: toolStyles.blur.intensity, opacity: 1 };
      case 'pixelate':
        return { ...lookOf(toolStyles.pixelate), id, type: 'pixelate', ...r, intensity: toolStyles.pixelate.intensity, opacity: 1 };
      case 'mask':
        return { ...lookOf(toolStyles.mask), id, type: 'mask', ...r, intensity: 0, color: toolStyles.mask.color, opacity: 1 };
      case 'arrow': {
        const s = toolStyles.line;
        const base = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        return {
          id, type: 'arrow', ...base, color: s.color, width: s.width, opacity: s.opacity, dash: s.dash,
          headStart: s.headStart, headEnd: s.headEnd, bends: s.route === 'elbow' ? [] : defaultBends(base, s.bends ?? 0, s.curve ?? false), body: s.body ?? 'line',
          ...(s.route ? { route: s.route } : {}), ...(s.outline ? { outline: s.outline } : {}),
        };
      }
      case 'callout': {
        const s = toolStyles.callout;
        const { placeholderText, ...style } = s as typeof s & { placeholderText?: string };
        return { ...style, id, type: 'callout', ...r, text: placeholderText ?? '', tailX: r.x - Math.max(30, r.h * 0.4), tailY: r.y + r.h + Math.max(40, r.h * 0.7) };
      }
      default:
        return null;
    }
  };

  const replace = (a: Annotation) => ({ ...doc, annotations: doc.annotations.map((x) => (x.id === a.id ? a : x)) });

  // A click-to-click arrow is dropped when the tool changes or Escape is pressed.
  useEffect(() => {
    if (tool !== 'arrow' && arrowStart.current) {
      arrowStart.current = null;
      setDraft(null);
    }
  }, [tool]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !arrowStart.current) return;
      e.preventDefault();
      e.stopPropagation();
      arrowStart.current = null;
      setDraft(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (textEdit) return; // the textarea blur commits first
    if (e.button !== 0 && e.button !== 1) return;
    // Keep focus where it is (otherwise the mouse-down would immediately blur a new text box).
    e.preventDefault();
    const el = scrollRef.current!;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toDoc(e.clientX, e.clientY);

    if (panning || tool === 'hand' || e.button === 1) {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop };
      setCursor('grabbing');
      return;
    }

    if ((e.ctrlKey || e.metaKey) && tool !== 'crop' && tool !== 'cut') {
      arrowStart.current = null;
      setDraft(null);
      if (e.shiftKey) {
        // Ctrl+Shift+click: add the object to the selection, or take it out again.
        const picked = findAt(doc.annotations, p, tolerance);
        if (!picked) return;
        const current = multiIds.length ? [...multiIds] : selectedId ? [selectedId] : [];
        const next = current.includes(picked.id) ? current.filter((id) => id !== picked.id) : [...current, picked.id];
        onSelect(next.length === 1 ? next[0]! : null);
        onMultiChange?.(next.length > 1 ? next : []);
        return;
      }
      // Ctrl+click: only clears the selection (adds nothing, selects nothing).
      onSelect(null);
      onMultiChange?.([]);
      return;
    }

    if (multiIds.length && tool !== 'eraser' && tool !== 'crop' && tool !== 'cut') {
      const picked = findAt(doc.annotations, p, tolerance);
      if (picked && multiIds.includes(picked.id)) {
        drag.current = { kind: 'move-many', start: p, originals: doc.annotations.filter((a) => multiIds.includes(a.id)) };
        return;
      }
      onMultiChange?.([]);
    }

    // Second click of a click-to-click arrow: this is its end point.
    if (arrowStart.current && tool === 'arrow') {
      const start = arrowStart.current;
      const end = e.shiftKey ? snap45(start, p) : p;
      arrowStart.current = null;
      const arrow = newShape(start, end);
      setDraft(null);
      if (arrow && Math.hypot(end.x - start.x, end.y - start.y) > 3) {
        onCommit({ ...doc, annotations: [...doc.annotations, arrow] }, `Add ${describeAnnotation(arrow).toLowerCase()}`);
        onSelect(arrow.id);
      }
      return;
    }

    // Any tool can adjust the selected object via its handles or by dragging it.
    // (Pen and highlighter too: a selected object keeps its resize and rotate handles.)
    if (selected && tool !== 'eraser' && tool !== 'crop' && tool !== 'cut') {
      const h = handleAt(p, selected);
      if (h === 'rot') {
        drag.current = { kind: 'rotate', startAngle: angleFrom(selected, p), original: selected };
        return;
      }
      if (h) {
        drag.current = { kind: 'resize', start: p, original: selected, handle: h };
        return;
      }
    }

    const hit = findAt(doc.annotations, p, tolerance);
    const textLike = (a: Annotation | null) => a?.type === 'text' || a?.type === 'callout';
    // Clicking an already-selected text or callout edits it (with any tool).
    const editOnClick = !!hit && hit.id === selectedId && textLike(hit);

    if (SELECT_LIKE.has(tool)) {
      onSelect(hit?.id ?? null);
      if (hit) drag.current = { kind: 'move', start: p, original: hit, editOnClick };
      else {
        // Select tool on an empty spot: drag to move around the image (like the hand tool).
        drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop };
        setCursor('grabbing');
      }
      return;
    }

    // Every drawing tool can pick up earlier annotations: press on one to select (and drag to move)
    // it. The pen and highlighter still draw over things; a plain click with them selects instead.
    const drawsOver = tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'crop' || tool === 'cut';
    // ...except the object that is already selected: pressing on it moves it with any tool.
    if (hit && (!drawsOver || ((tool === 'pen' || tool === 'highlighter') && hit.id === selectedId))) {
      if (tool === 'text' && textLike(hit)) {
        onSelect(hit.id);
        onTextEdit({ annotation: hit as TextAnnotation | CalloutAnnotation, isNew: false });
        return;
      }
      onSelect(hit.id);
      drag.current = { kind: 'move', start: p, original: hit, editOnClick };
      return;
    }

    // New annotations start on the image only.
    if (!onImage(p) && tool !== 'eraser' && tool !== 'crop' && tool !== 'cut') {
      onSelect(null);
      return;
    }

    switch (tool) {
      case 'pen':
      case 'highlighter': {
        const s = toolStyles[tool];
        setDraft({ id: annotationId(), type: tool, points: [p], color: s.color, width: s.width, opacity: s.opacity,
          ...(s.design ? { design: s.design } : {}), ...(s.accent ? { accent: s.accent } : {}) });
        drag.current = { kind: 'draw', start: p, clickHit: hit };
        return;
      }
      case 'rect':
      case 'ellipse':
      case 'arrow':
      case 'blur':
      case 'pixelate':
      case 'mask':
      case 'callout': {
        onSelect(null);
        drag.current = { kind: 'draw', start: p, clickHit: null };
        setDraft(newShape(p, p));
        return;
      }
      case 'marker': {
        const n = doc.annotations.reduce((max, a) => (a.type === 'marker' ? Math.max(max, a.n) : max), 0) + 1;
        const m = toolStyles.marker;
        const marker: Annotation = { id: annotationId(), type: 'marker', x: p.x, y: p.y, n, color: m.color, size: m.size, shape: m.shape, style: m.style, counter: m.counter, opacity: 1,
          ...(m.label?.trim() ? { label: m.label, labelStyle: m.labelStyle ?? 'pill' } : {}),
          ...(m.fillColor !== undefined ? { fillColor: m.fillColor } : {}), ...(m.textColor !== undefined ? { textColor: m.textColor } : {}), ...(m.borderColor !== undefined ? { borderColor: m.borderColor } : {}) };
        onCommit({ ...doc, annotations: [...doc.annotations, marker] }, `Add marker ${n}`);
        onSelect(marker.id);
        return;
      }
      case 'cursor': {
        const c = toolStyles.cursor;
        const cursor: Annotation = { id: annotationId(), type: 'cursor', x: p.x, y: p.y, ...c };
        onCommit({ ...doc, annotations: [...doc.annotations, cursor] }, 'Add cursor');
        onSelect(cursor.id);
        return;
      }
      case 'sticker': {
        const s = toolStyles.sticker;
        const sticker: Annotation = { id: annotationId(), type: 'sticker', x: p.x, y: p.y, size: s.size, glyph: s.glyph, variant: s.variant, color: s.color, opacity: 1,
          ...(s.badgeStyle ? { badgeStyle: s.badgeStyle } : {}), ...(s.badgeIcon ? { badgeIcon: s.badgeIcon } : {}), ...(s.cutout ? { cutout: true } : {}) };
        onCommit({ ...doc, annotations: [...doc.annotations, sticker] }, `Add sticker ${s.glyph}`);
        onSelect(sticker.id);
        return;
      }
      case 'text': {
        const s = toolStyles.text;
        onSelect(null);
        onTextEdit({ annotation: { ...s, id: annotationId(), type: 'text', x: p.x, y: p.y - s.fontSize * 0.6, text: '' }, isNew: true });
        return;
      }
      case 'eraser': {
        erased.current = new Set();
        const first = findAt(doc.annotations, p, eraseReach);
        if (first) erased.current.add(first.id);
        setEraserTrail([p]);
        drag.current = { kind: 'erase' };
        return;
      }
      case 'cut': {
        if (!cut) return;
        const hit = cutHitAt(p);
        const v = cutPos(p);
        if (hit === 'from' || hit === 'to') drag.current = { kind: 'cut-edge', edge: hit };
        else if (hit === 'inside') drag.current = { kind: 'cut-move', start: v, from: cut.from, to: cut.to };
        else {
          drag.current = { kind: 'cut-new', start: v };
          onCutChange?.({ from: v, to: v });
        }
        return;
      }
      case 'crop': {
        const h = cropHandleAt(p);
        if (crop && h) drag.current = { kind: 'crop-resize', start: p, original: crop, handle: h };
        else if (crop && p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) drag.current = { kind: 'crop-move', start: p, original: crop };
        else drag.current = { kind: 'crop-new', start: p };
        return;
      }
      default:
        return;
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    noteKeys(e);
    const p = toDoc(e.clientX, e.clientY);
    const d = drag.current;
    if (!d) {
      if (arrowStart.current && tool === 'arrow') {
        // Rubber band from the first click to the pointer.
        const start = arrowStart.current;
        setDraft(newShape(start, e.shiftKey ? snap45(start, p) : p));
        if (cursor !== 'crosshair') setCursor('crosshair');
        return;
      }
      updateHoverCursor(p);
      return;
    }
    switch (d.kind) {
      case 'pan': {
        const el = scrollRef.current!;
        el.scrollLeft = d.scrollX - (e.clientX - d.startX);
        el.scrollTop = d.scrollY - (e.clientY - d.startY);
        return;
      }
      case 'move':
        setDraft(translate(d.original, p.x - d.start.x, p.y - d.start.y));
        return;
      case 'move-many':
        setManyDraft(d.originals.map((a) => translate(a, p.x - d.start.x, p.y - d.start.y)));
        return;
      case 'resize':
        // Shift keeps shapes and callouts square (or round).
        setDraft(resizeBy(d.original, d.handle, p.x - d.start.x, p.y - d.start.y, e.shiftKey));
        return;
      case 'rotate': {
        let delta = angleFrom(d.original, p) - d.startAngle;
        if (e.shiftKey) {
          // Snap the resulting angle to 15 degree steps.
          const base = rotationOf(d.original);
          delta = Math.round((base + delta) / 15) * 15 - base;
        }
        setDraft(rotateBy(d.original, delta));
        return;
      }
      case 'draw':
        if (tool === 'pen' || tool === 'highlighter') {
          setDraft((prev) => {
            if (!prev || (prev.type !== 'pen' && prev.type !== 'highlighter')) return prev;
            // Shift: a perfectly straight stroke (snapped to 45 degrees), like the line tool.
            if (e.shiftKey) return { ...prev, points: [d.start, snap45(d.start, p)] };
            return { ...prev, points: appendPoint(prev.points, p, 1 / zoom) };
          });
        } else {
          let end = p;
          if (e.shiftKey && (tool === 'rect' || tool === 'ellipse' || tool === 'blur' || tool === 'pixelate' || tool === 'mask' || tool === 'callout')) {
            const size = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y));
            end = { x: d.start.x + Math.sign(p.x - d.start.x || 1) * size, y: d.start.y + Math.sign(p.y - d.start.y || 1) * size };
          } else if (e.shiftKey && tool === 'arrow') {
            end = snap45(d.start, p);
          }
          setDraft(newShape(d.start, end));
        }
        return;
      case 'erase': {
        // Everything the eraser circle touches along the way.
        const prev = eraserTrail?.[eraserTrail.length - 1] ?? p;
        const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / Math.max(2, eraseReach)));
        for (let i = 1; i <= steps; i++) {
          const q = { x: prev.x + ((p.x - prev.x) * i) / steps, y: prev.y + ((p.y - prev.y) * i) / steps };
          for (const a of doc.annotations) if (!erased.current.has(a.id) && findAt([a], q, eraseReach)) erased.current.add(a.id);
        }
        setEraserAt(p);
        setEraserTrail((t) => (t ? [...t.slice(-40), p] : [p]));
        return;
      }
      case 'cut-new':
        onCutChange?.({ from: Math.min(d.start, cutPos(p)), to: Math.max(d.start, cutPos(p)) });
        return;
      case 'cut-edge':
        if (cut) onCutChange?.({ from: d.edge === 'from' ? cutPos(p) : cut.from, to: d.edge === 'to' ? cutPos(p) : cut.to });
        return;
      case 'cut-move': {
        const len = cut?.axis === 'columns' ? doc.width : doc.height;
        const lo = Math.min(d.from, d.to);
        const size = Math.abs(d.to - d.from);
        const start = Math.max(0, Math.min(len - size, lo + cutPos(p) - d.start));
        onCutChange?.({ from: start, to: start + size });
        return;
      }
      case 'crop-new':
        onCropChange(constrainAspect(rectFromPoints(d.start, p), cropAspect, doc.width, doc.height));
        return;
      case 'crop-move': {
        const o = d.original;
        onCropChange({
          ...o,
          x: Math.max(0, Math.min(doc.width - o.w, o.x + p.x - d.start.x)),
          y: Math.max(0, Math.min(doc.height - o.h, o.y + p.y - d.start.y)),
        });
        return;
      }
      case 'crop-resize': {
        const o = d.original;
        let { x, y, w, h } = o;
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (d.handle.includes('w')) { x += dx; w -= dx; }
        if (d.handle.includes('e')) w += dx;
        if (d.handle.includes('n')) { y += dy; h -= dy; }
        if (d.handle.includes('s')) h += dy;
        onCropChange(constrainAspect({ x, y, w, h }, cropAspect, doc.width, doc.height));
        return;
      }
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') {
      setCursor(tool === 'hand' || panning || SELECT_LIKE.has(tool) ? 'grab' : 'default');
      return;
    }
    if (d.kind === 'move-many') {
      if (manyDraft) {
        const moved = new Map(manyDraft.map((a) => [a.id, a]));
        onCommit({ ...doc, annotations: doc.annotations.map((a) => moved.get(a.id) ?? a) }, `Move ${moved.size} objects`);
      }
      setManyDraft(null);
      return;
    }
    if (d.kind === 'move' && !draft) {
      // A click without dragging.
      if (d.editOnClick && (d.original.type === 'text' || d.original.type === 'callout')) onTextEdit({ annotation: d.original, isNew: false });
    } else if ((d.kind === 'move' || d.kind === 'resize' || d.kind === 'rotate') && draft) {
      const verb = d.kind === 'move' ? 'Move' : d.kind === 'resize' ? (isTextHandle(d.handle) ? 'Move text of' : 'Resize') : 'Rotate';
      if (draft !== d.original) onCommit(replace(draft), `${verb} ${describeAnnotation(draft).toLowerCase()}`);
    } else if (d.kind === 'draw' && draft) {
      const b = getBounds(draft);
      const isStroke = draft.type === 'pen' || draft.type === 'highlighter';
      const moved = isStroke ? draft.points.length > 1 : true;
      if (isStroke && !moved && d.clickHit) {
        // Pen / highlighter click on an existing annotation: select it instead of drawing a dot.
        onSelect(d.clickHit.id);
        setDraft(null);
        return;
      }
      if (draft.type === 'callout' && (draft.w < 20 || draft.h < 14)) {
        // Single click with the callout tool: a ready-to-type bubble.
        const bubble = fitCallout({ ...draft, x: d.start.x, y: d.start.y, w: 280, h: 100, tailX: d.start.x - 50, tailY: d.start.y + 170 });
        onCommit({ ...doc, annotations: [...doc.annotations, bubble] }, 'Add callout');
        onSelect(bubble.id);
        onTextEdit({ annotation: bubble, isNew: false });
        setDraft(null);
        return;
      }
      if (draft.type === 'arrow' && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) <= 3) {
        // A click without dragging starts a click-to-click arrow: the next click sets the end.
        arrowStart.current = d.start;
        return;
      }
      const big = isStroke
        ? true
        : draft.type === 'line' || draft.type === 'arrow'
          ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 3
          : b.w > 3 && b.h > 3;
      if (big) {
        const added = draft.type === 'callout' ? fitCallout(draft) : draft;
        const next = { ...doc, annotations: [...doc.annotations, added] };
        onCommit(next, `Add ${describeAnnotation(draft).toLowerCase()}`);
        if (!isStroke) onSelect(draft.id);
        // New callouts go straight into text editing.
        if (added.type === 'callout') onTextEdit({ annotation: added, isNew: false });
      }
    } else if (d.kind === 'erase') {
      if (erased.current.size) {
        onCommit({ ...doc, annotations: doc.annotations.filter((a) => !erased.current.has(a.id)) }, `Erase ${erased.current.size} annotation${erased.current.size > 1 ? 's' : ''}`);
      }
      setEraserTrail(null);
    }
    setDraft(null);
  }

  function updateHoverCursor(p: Point) {
    let next = 'default';
    if (panning || tool === 'hand') next = 'grab';
    else if (tool === 'eraser') {
      next = ERASER_CURSOR;
      setEraserAt(p);
    }
    else if (tool === 'cut') {
      const hit = cutHitAt(p);
      next = hit === 'from' || hit === 'to' ? (cut?.axis === 'columns' ? 'col-resize' : 'row-resize') : hit === 'inside' ? 'move' : 'crosshair';
    }
    else if (tool === 'crop') next = cropHandleAt(p) ? resizeCursor(cropHandleAt(p)!, 0) : crop && p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h ? 'move' : 'crosshair';
    else if (multiIds.length && multiIds.includes(findAt(doc.annotations, p, tolerance)?.id ?? '')) next = 'move';
    else if (selected && handleAt(p, selected)) {
      const h = handleAt(p, selected)!;
      next = h === 'rot' ? ROTATE_CURSOR : isTextHandle(h) ? 'move' : isRoundHandle(h) ? 'grab' : resizeCursor(h, rotationOf(selected));
    }
    // The selected object can be dragged with any tool: four-way move cursor over it.
    else if (selected && tool !== 'text' && findAt(doc.annotations, p, tolerance)?.id === selected.id) next = 'move';
    else if (SELECT_LIKE.has(tool)) next = findAt(doc.annotations, p, tolerance) ? 'move' : 'grab';
    else if (tool !== 'pen' && tool !== 'highlighter' && findAt(doc.annotations, p, tolerance)) next = 'pointer';
    else if (!onImage(p)) next = 'default';
    else if (tool === 'text') next = 'text';
    else next = 'crosshair';
    if (next !== cursor) setCursor(next);
  }

  /** Ctrl + click only clears the selection; Ctrl + Shift + click picks the object under the pointer. */
  const shownCursor = (() => {
    if (panning) return 'grab';
    if (held === 'none' || tool === 'crop' || tool === 'cut' || cursor === 'grabbing') return cursor;
    if (held === 'ctrl') return 'default';
    return cursor === 'move' || cursor === 'pointer' ? 'pointer' : 'default';
  })();

  function onDoubleClick(e: React.MouseEvent) {
    const hit = findAt(doc.annotations, toDoc(e.clientX, e.clientY), tolerance);
    if (hit?.type === 'text' || hit?.type === 'callout') {
      onSelect(hit.id);
      onTextEdit({ annotation: hit, isNew: false });
    }
  }

  return (
    <div
      ref={scrollRef}
      className={styles.workspace}
      onScroll={(e) => {
        const el = e.currentTarget;
        setView((v) => ({ ...v, scrollX: el.scrollLeft, scrollY: el.scrollTop }));
      }}
    >
      <div
        className={styles.stickyLayer}
        style={{ width: view.width, height: view.height, cursor: shownCursor }}
        onPointerDown={(e) => {
          // The right button opens Pixora's menu (contextmenu event), it never draws.
          if (e.button === 2) return;
          onPointerDown(e);
        }}
        onContextMenu={(e) => {
          if (!onCanvasMenu || textEdit) return;
          arrowStart.current = null;
          const hit = findAt(doc.annotations, toDoc(e.clientX, e.clientY), tolerance);
          if (hit) onSelect(hit.id);
          onCanvasMenu(e, hit);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => {
          if (tool === 'eraser') {
            setEraserTrail(null);
            setEraserAt(null);
          }
        }}
      >
        <canvas ref={canvasRef} className={styles.canvas} style={{ width: view.width, height: view.height }} aria-label="Screenshot canvas" role="img" />
        {selected && selectionActions && !draft && !textEdit && !crop && !cut && !selected.hidden && (() => {
          const pts = selectionPolygon(selected);
          const xs = pts.map((p) => originX + p.x * zoom);
          const ys = pts.map((p) => originY + p.y * zoom);
          const anchor = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          // Room for the rotation handle above rotatable boxes.
          const lift = handlesFor(selected, zoom).some((h) => h.handle === 'rot') ? 30 : 0;
          return <SelectionBar key={selected.id} anchor={{ ...anchor, y: anchor.y - lift, h: anchor.h + lift }} view={view} actions={selectionActions} />;
        })()}
        {multiIds.length > 1 && multiActions && !manyDraft && !textEdit && !crop && !cut && (() => {
          const pts = doc.annotations.filter((a) => multiIds.includes(a.id)).flatMap((a) => selectionPolygon(a));
          if (!pts.length) return null;
          const xs = pts.map((p) => originX + p.x * zoom);
          const ys = pts.map((p) => originY + p.y * zoom);
          const anchor = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          return <SelectionBar key="several" anchor={anchor} view={view} actions={multiActions} />;
        })()}
        {textEdit && (
          <TextEditor
            key={textEdit.annotation.id}
            state={textEdit}
            zoom={zoom}
            originX={originX}
            originY={originY}
            onDone={(text) => onTextCommit(textEdit, text)}
            onCancel={() => onTextEdit(null)}
          />
        )}
      </div>
      <div style={{ width: Math.max(contentW, view.width), height: Math.max(contentH, view.height), marginTop: -view.height }} aria-hidden />
    </div>
  );
});

function TextEditor({
  state, zoom, originX, originY, onDone, onCancel,
}: {
  state: TextEditState; zoom: number; originX: number; originY: number; onDone: (text: string) => void; onCancel: () => void;
}) {
  const a = state.annotation;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(a.text);
  const done = useRef(false);
  useEffect(() => {
    // Focus after the pointer sequence that created the box has finished.
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onDone(value);
    else onCancel();
  };
  const lines = value.split('\n');
  const longest = Math.max(4, ...lines.map((l) => l.length));
  const toScreen = (x: number, y: number) => ({ x: originX + x * zoom, y: originY + y * zoom });
  let style: React.CSSProperties;
  if (a.type === 'callout') {
    const { body } = calloutTextRects(a);
    const tl = toScreen(body.x, body.y);
    style = { left: tl.x, top: tl.y, width: Math.max(40, body.w * zoom), height: Math.max(30, body.h * zoom), whiteSpace: 'pre-wrap', background: 'transparent' };
  } else {
    const block = textBlock({ ...a, text: value || ' ' });
    const tl = toScreen(a.x, a.y + block.body.y);
    style = {
      left: tl.x,
      top: tl.y,
      width: `${Math.max(block.width, longest * 0.62 * a.fontSize) * zoom + 24}px`,
      height: `${lines.length * a.fontSize * LINE_HEIGHT * zoom + 8}px`,
      background: a.background === 'transparent' ? 'rgba(255,255,255,0.08)' : a.background,
    };
  }
  const rot = rotationOf(a);
  if (rot) {
    const c = pivotOf(a);
    const cs = toScreen(c.x, c.y);
    style.transform = `rotate(${rot}deg)`;
    style.transformOrigin = `${cs.x - Number(style.left)}px ${cs.y - Number(style.top)}px`;
  }
  return (
    <textarea
      ref={ref}
      className={styles.textEditor}
      value={value}
      spellCheck={false}
      aria-label="Annotation text"
      placeholder="Type…"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(!state.isNew || value.length > 0);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
      }}
      style={{
        ...style,
        font: fontString({ ...a, fontSize: a.fontSize * zoom }),
        lineHeight: LINE_HEIGHT,
        color: a.color,
        textAlign: a.align,
        letterSpacing: `${(a.letterSpacing ?? 0) * zoom}px`,
        textTransform: a.caps ? 'uppercase' : undefined,
        textDecoration: [a.underline && 'underline', a.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
      }}
    />
  );
}

/** Base direction of each side / corner handle (degrees, 0 = right, clockwise). */
const HANDLE_ANGLE: Partial<Record<Handle, number>> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };

/**
 * Resize cursor for a handle, turned with the object's rotation: ↔ for sides, ↕ for top / bottom,
 * ⤡ / ⤢ for the corners.
 */
export function resizeCursor(h: Handle, rotation: number): string {
  const base = HANDLE_ANGLE[h];
  if (base === undefined) return 'grab';
  const a = ((Math.round((base + rotation) / 45) * 45) % 180 + 180) % 180;
  return a === 0 ? 'ew-resize' : a === 45 ? 'nwse-resize' : a === 90 ? 'ns-resize' : 'nesw-resize';
}
