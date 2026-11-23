import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorDoc, Rect, Tool, ToolStyles } from '../types';
import type { RetouchInput } from './CanvasWorkspace';
import { RemoveBgPanel, RemoveObjectPanel, type BgBrush } from './RetouchPanels';
import { detectSubject, selectObjectAt } from '../services/segment';
import { addMask, applyFill, composeBackground, decontaminate, maskIsEmpty, maskToCanvas, newMaskCanvas, paintStroke, refineSubject, hatchMask, type FillOptions, type Point } from '../tools/retouch';

type Geometry = (op: () => Promise<EditorDoc>, label: string, opts?: { keepView?: boolean }) => Promise<void>;
type Preview = CanvasImageSource & { width: number; height: number };

interface Args {
  doc: EditorDoc;
  tool: Tool;
  styles: ToolStyles;
  setStyle: <K extends 'removeObject' | 'removeBg'>(kind: K, patch: Partial<ToolStyles[K]>) => void;
  geometry: Geometry;
  /** Shows a "working…" message while a long job runs (null hides it). */
  setWorking: (text: string | null) => void;
  onError: (message: string) => void;
  /** Leave the tool (back to Select). */
  done: () => void;
  busy: boolean;
  /** The document as it is now (it can change while a fill runs). */
  latest: () => EditorDoc;
}

/** Fills what `mask` covers with matching background, with a progress message. */
export function useFill(geometry: Geometry, setWorking: (t: string | null) => void, latest: () => EditorDoc) {
  return useCallback(
    (doc: EditorDoc, mask: OffscreenCanvas, opts: FillOptions, label: string) => {
      setWorking('Rebuilding the background…');
      return geometry(async () => {
        const filled = await applyFill(doc, mask, opts);
        // Changes made while it worked (a filter, a new arrow…) are kept.
        const now = latest();
        return now.base === doc.base ? { ...now, base: filled.base } : filled;
      }, label, { keepView: true }).finally(() => setWorking(null));
    },
    [geometry, setWorking, latest],
  );
}

/** What Remove background has found and been told so far (one step of its own undo history). */
interface BgState {
  raw: Uint8ClampedArray;
  kind: 'person' | 'object' | 'graphic' | 'none';
  /** Graphics: the picture with the old background colour taken out of the edge pixels. */
  clean: Uint8ClampedArray | null;
  strokes: Array<{ pts: Point[]; size: number; hardness: number; mode: 'add' | 'remove' }>;
}

const OBJ_PAINT = 'rgba(224, 82, 82, 0.5)';
const UNMARK_PAINT = 'rgba(79, 141, 247, 0.5)';

/**
 * Remove object and Remove background: their selection on the picture, the preview shown instead
 * of the picture while they are open, their side panels, their keys (Enter, Esc) and their own
 * undo / redo (Ctrl+Z / Ctrl+Y step back through the selection before touching the picture).
 */
export function useRetouch({ doc, tool, styles, setStyle, geometry, setWorking, onError, done, busy, latest }: Args) {
  const W = doc.width;
  const H = doc.height;
  const fill = useFill(geometry, setWorking, latest);
  const [status, setStatus] = useState<string | null>(null);

  /* ------------------------------ Remove object ------------------------------ */
  const objMask = useRef<OffscreenCanvas | null>(null);
  const objUndo = useRef<ImageData[]>([]);
  const objRedo = useRef<ImageData[]>([]);
  const [objVersion, setObjVersion] = useState(0);
  const objEmpty = useMemo(() => !objMask.current || maskIsEmpty(objMask.current), [objVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const objCanvas = () => {
    const m = objMask.current;
    if (m && m.width === W && m.height === H) return m;
    objMask.current = newMaskCanvas(W, H);
    objUndo.current = [];
    objRedo.current = [];
    return objMask.current;
  };
  const read = (m: OffscreenCanvas) => m.getContext('2d')!.getImageData(0, 0, m.width, m.height);
  /** Before each change to the selection: remember it (undo), forget what was undone (redo). */
  const snapshot = (m: OffscreenCanvas) => {
    objUndo.current.push(read(m));
    if (objUndo.current.length > 40) objUndo.current.shift();
    objRedo.current = [];
  };
  const clearObj = useCallback(() => {
    objMask.current = null;
    objUndo.current = [];
    objRedo.current = [];
    setObjVersion((v) => v + 1);
  }, []);
  // A new picture (removed, undone, cropped…): start a fresh selection.
  useEffect(() => { clearObj(); }, [doc.base, clearObj]);

  const stepObj = (back: boolean): boolean => {
    const m = objMask.current;
    const from = back ? objUndo.current : objRedo.current;
    const to = back ? objRedo.current : objUndo.current;
    const state = from.pop();
    if (!m || !state) return false;
    to.push(read(m));
    m.getContext('2d')!.putImageData(state, 0, 0);
    setObjVersion((v) => v + 1);
    return true;
  };

  const removeObjects = useCallback(() => {
    const m = objMask.current;
    if (!m || maskIsEmpty(m) || busy) return;
    void fill(doc, m, { strength: 100, feather: 3, preserve: false }, 'Remove object');
  }, [doc, fill, busy]);

  const objStyle = styles.removeObject;
  const unmark = objStyle.mode === 'erase';
  /** A brush stroke (Brush / Unmark, or Ctrl+drag in any mode) added to / taken off the selection. */
  const paintObj = (pts: Point[], size: number) => {
    const m = objCanvas();
    snapshot(m);
    paintStroke(m, pts, size + (unmark ? 0 : objStyle.grow * 2), 100, unmark ? 'remove' : 'add');
    setObjVersion((v) => v + 1);
  };
  const objInput: RetouchInput | null = tool !== 'removeObject' || busy ? null : objStyle.mode === 'ai'
    ? {
        kind: 'click', size: objStyle.size, paint: OBJ_PAINT, onStroke: paintObj,
        onClick: (p: Point) => {
          if (status) return;
          setStatus('Finding the object…');
          setWorking('Finding the object…');
          void selectObjectAt(doc.base, W, H, p)
            .then((mask) => {
              if (!mask) { onError('Couldn’t find an object there. Try the Brush or Box instead.'); return; }
              const m = objCanvas();
              snapshot(m);
              addMask(m, mask, objStyle.grow);
              setObjVersion((v) => v + 1);
            })
            .catch((err: unknown) => onError(String(err)))
            .finally(() => { setStatus(null); setWorking(null); });
        },
      }
    : objStyle.mode === 'brush' || unmark
      ? { kind: 'brush', size: objStyle.size, paint: unmark ? UNMARK_PAINT : OBJ_PAINT, onStroke: paintObj }
      : {
          kind: 'box', size: objStyle.size, paint: OBJ_PAINT, onStroke: paintObj,
          onBox: (r: Rect) => {
            const m = objCanvas();
            snapshot(m);
            const g = objStyle.grow;
            const ctx = m.getContext('2d')!;
            ctx.fillStyle = '#fff';
            ctx.fillRect(r.x - g, r.y - g, r.w + g * 2, r.h + g * 2);
            setObjVersion((v) => v + 1);
          },
        };

  const objPreview = useMemo<Preview | null>(() => {
    if (tool !== 'removeObject' || objEmpty || !objMask.current) return null;
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(doc.base, 0, 0);
    // Red and white hatching: visible on any colour (a plain red tint vanished on red things).
    ctx.globalAlpha = 0.6;
    ctx.drawImage(hatchMask(objMask.current), 0, 0);
    return c;
  }, [tool, objEmpty, objVersion, doc.base, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------- Remove background ---------------------------- */
  const [bgState, setBgStateRaw] = useState<BgState | null>(null);
  const bgUndo = useRef<BgState[]>([]);
  const bgRedo = useRef<BgState[]>([]);
  /** A new state from the user (a pick, a stroke…): the old one can be undone. */
  const pushBg = useCallback((next: BgState) => {
    setBgStateRaw((cur) => {
      if (cur) { bgUndo.current.push(cur); if (bgUndo.current.length > 40) bgUndo.current.shift(); }
      bgRedo.current = [];
      return next;
    });
  }, []);
  const [bgBrush, setBgBrush] = useState<BgBrush>('pick');
  const [bgImage, setBgImage] = useState<ImageBitmap | null>(null);
  const [bgPreview, setBgPreview] = useState<Preview | null>(null);
  const subject = useRef<OffscreenCanvas | null>(null);
  const bg = styles.removeBg;
  const detectRun = useRef(0);

  const resetBg = useCallback(() => {
    detectRun.current++;
    setBgStateRaw(null);
    bgUndo.current = [];
    bgRedo.current = [];
    setBgPreview(null);
    setStatus(null);
    subject.current = null;
  }, []);

  const detect = useCallback((asStep = false) => {
    const run = ++detectRun.current;
    setStatus('Finding the subject…');
    setWorking('Finding the subject…');
    void detectSubject(doc.base, W, H)
      .then((r) => {
        if (run !== detectRun.current) return;
        const next: BgState = r ? { raw: r.mask, kind: r.kind, clean: r.clean ?? null, strokes: [] } : { raw: new Uint8ClampedArray(W * H), kind: 'none', clean: null, strokes: [] };
        if (asStep) pushBg(next);
        else setBgStateRaw(next);
      })
      .catch((err: unknown) => {
        if (run !== detectRun.current) return;
        onError(String(err));
        setBgStateRaw({ raw: new Uint8ClampedArray(W * H), kind: 'none', clean: null, strokes: [] });
      })
      .finally(() => { if (run === detectRun.current) { setStatus(null); setWorking(null); } });
  }, [doc.base, W, H, onError, pushBg, setWorking]);

  // Opening the tool finds the subject; leaving it (or a new picture) drops the work.
  useEffect(() => {
    if (tool === 'removeBg') { bgUndo.current = []; bgRedo.current = []; detect(); }
    else resetBg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, doc.base]);

  const stepBg = (back: boolean): boolean => {
    const from = back ? bgUndo.current : bgRedo.current;
    const to = back ? bgRedo.current : bgUndo.current;
    const state = from.pop();
    if (!state || !bgState) return false;
    to.push(bgState);
    setBgStateRaw(state);
    return true;
  };

  const graphic = bgState?.kind === 'graphic';
  // Graphics (screenshots, logos) have exact edges: no edge refinement or feather (they only blur).
  const look = useMemo(() => (graphic ? { ...bg, edge: 0, feather: 0 } : bg), [graphic, bg]);
  const graphicClean = useMemo(() => {
    const c = bgState?.clean;
    if (!c || c.length !== W * H * 4) return null;
    const canvas = new OffscreenCanvas(W, H);
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(c), W, H), 0, 0);
    return canvas;
  }, [bgState?.clean, W, H]);
  // The subject's mask: fitted to the edges (photos), grown / shrunk, then the restore / remove strokes.
  const refined = useMemo(() => {
    const raw = bgState?.raw;
    if (!raw || raw.length !== W * H) return null;
    return refineSubject(raw, doc.base, W, H, look.edge, look.shift, graphic);
  }, [bgState?.raw, doc.base, W, H, look.edge, look.shift, graphic]);
  // Photos: the old background's colour taken out of the soft edges (no coloured glow).
  const photoClean = useMemo(() => (tool === 'removeBg' && !graphic && refined ? decontaminate(doc.base, refined, W, H) : null), [tool, graphic, refined, doc.base, W, H]);
  const cleanSource = graphic ? graphicClean : photoClean;
  const strokes = bgState?.strokes;
  useEffect(() => {
    if (tool !== 'removeBg' || !refined || !strokes) { setBgPreview(null); return; }
    const t = setTimeout(() => {
      const s = maskToCanvas(refined, W, H);
      for (const k of strokes) paintStroke(s, k.pts, k.size, k.hardness, k.mode);
      subject.current = s;
      setBgPreview(composeBackground(doc.base, W, H, s, look, bgImage, true, cleanSource));
    }, 30);
    return () => clearTimeout(t);
  }, [tool, refined, strokes, look, bgImage, doc.base, W, H, cleanSource]);

  const applyBg = useCallback(() => {
    const s = subject.current;
    if (!s || busy) return;
    const opts = { ...look };
    const image = bgImage;
    const source = cleanSource;
    const label = opts.fill === 'transparent' ? 'Remove background' : opts.fill === 'blur' ? 'Blur background' : 'Replace background';
    // Leave the tool first (no new search on the new picture).
    done();
    void geometry(async () => ({ ...doc, base: await createImageBitmap(composeBackground(doc.base, W, H, s, opts, image, false, source)) }), label, { keepView: true });
  }, [look, bgImage, busy, doc, geometry, W, H, done, cleanSource]);

  const bgInput: RetouchInput | null = tool !== 'removeBg' || busy || !bgState ? null : bgBrush === 'pick'
    ? {
        kind: 'click', size: 0, paint: '',
        onClick: (p: Point, shift: boolean) => {
          if (status) return;
          setStatus('Finding the subject…');
          setWorking('Finding the subject…');
          const before = bgState;
          void selectObjectAt(doc.base, W, H, p)
            .then((mask) => {
              if (!mask) { onError('Couldn’t find anything there.'); return; }
              if (shift) {
                const u = new Uint8ClampedArray(before.raw.length);
                for (let i = 0; i < u.length; i++) u[i] = Math.max(before.raw[i]!, mask[i]!);
                pushBg({ ...before, raw: u, kind: before.kind === 'none' ? 'object' : before.kind });
              } else {
                pushBg({ raw: mask, kind: 'object', clean: null, strokes: [] });
              }
            })
            .catch((err: unknown) => onError(String(err)))
            .finally(() => { setStatus(null); setWorking(null); });
        },
      }
    : {
        kind: 'brush', size: bg.size, paint: bgBrush === 'restore' ? 'rgba(36, 163, 106, 0.5)' : 'rgba(224, 82, 82, 0.5)',
        onStroke: (pts, size) => pushBg({ ...bgState, strokes: [...bgState.strokes, { pts, size, hardness: bg.hardness, mode: bgBrush === 'restore' ? 'add' : 'remove' }] }),
      };

  /* --------------------------------- output ---------------------------------- */
  const panel: ReactNode = tool === 'removeObject' ? (
    <RemoveObjectPanel
      style={objStyle}
      onStyle={(patch) => setStyle('removeObject', patch)}
      hasMask={!objEmpty}
      canUndoMask={objUndo.current.length > 0}
      onUndoMask={() => stepObj(true)}
      onClear={() => { const m = objMask.current; if (m) { snapshot(m); m.getContext('2d')!.clearRect(0, 0, m.width, m.height); setObjVersion((v) => v + 1); } }}
      onRemove={removeObjects}
      busy={busy}
      status={status}
    />
  ) : tool === 'removeBg' ? (
    <RemoveBgPanel
      style={bg}
      onStyle={(patch) => setStyle('removeBg', patch)}
      brush={bgBrush}
      onBrush={setBgBrush}
      status={status}
      found={bgState ? (bgState.kind === 'graphic' ? 'object' : bgState.kind) : null}
      graphic={graphic}
      onDetect={() => detect(true)}
      onApply={applyBg}
      onCancel={() => { resetBg(); done(); }}
      image={bgImage}
      onImage={(file) => void createImageBitmap(file).then((b) => { setBgImage(b); setStyle('removeBg', { fill: 'image' }); }, () => onError('That picture could not be opened.'))}
      busy={busy}
    />
  ) : null;

  /** Enter / Esc for these tools; true when handled. */
  const onKey = (e: KeyboardEvent): boolean => {
    if (tool === 'removeObject') {
      if (e.key === 'Enter') { e.preventDefault(); removeObjects(); return true; }
      if (e.key === 'Escape' && !objEmpty) { clearObj(); return true; }
    }
    if (tool === 'removeBg') {
      if (e.key === 'Enter') { e.preventDefault(); applyBg(); return true; }
      if (e.key === 'Escape') { resetBg(); done(); return true; }
    }
    return false;
  };

  /**
   * Ctrl+Z / Ctrl+Y inside these tools: first through the selection's own steps (a click, a
   * stroke, a box…); true when one was undone / redone (the picture's history is left alone).
   */
  const undo = (back: boolean): boolean => {
    if (busy) return true;
    if (tool === 'removeObject') return stepObj(back);
    if (tool === 'removeBg') return stepBg(back);
    return false;
  };

  return {
    input: objInput ?? bgInput,
    preview: tool === 'removeObject' ? objPreview : tool === 'removeBg' ? bgPreview : null,
    panel,
    onKey,
    undo,
    /** Selection steps that can be undone / redone (the toolbar's Undo / Redo use them first). */
    canUndo: tool === 'removeObject' ? objUndo.current.length > 0 : tool === 'removeBg' ? bgUndo.current.length > 0 : false,
    canRedo: tool === 'removeObject' ? objRedo.current.length > 0 : tool === 'removeBg' ? bgRedo.current.length > 0 : false,
    /** Selection steps so far (shown in the History tab until applied). */
    steps: tool === 'removeObject' ? objUndo.current.length : tool === 'removeBg' ? bgUndo.current.length : 0,
  };
}
