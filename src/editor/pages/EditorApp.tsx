import { isStorageUnavailable } from '@/shared/utils/errors';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AutoFrame, CaptureRecord, ImageFormat, Settings } from '@/shared/types';
import { loadSettings } from '@/settings/settings-service';
import { usePageContextMenu } from '@/shared/components/PageContextMenu';
import type { MenuItem } from '@/shared/components/Dropdown';
import { AlignCenter, AlignCenterHorizontal, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDown, ArrowUp, BringToFront, ClipboardPaste, Copy, CopyPlus, Download, Keyboard, Lock, LockOpen, Maximize, Move, Pencil, Redo2, Scissors, SendToBack, Sparkles, Trash2, Undo2, X, Crop as CropIcon } from 'lucide-react';
import { useSettings } from '@/shared/hooks/useSettings';
import { useToast } from '@/shared/components/Toast';
import { Spinner } from '@/shared/components/Progress';
import { InlineNotice } from '@/shared/components/Settings';
import { Button } from '@/shared/components/Button';
import { broadcast, errorInfoOf } from '@/shared/messaging/client';
import { addCapture, getCapture, getCaptureBlob, updateCapture } from '@/history/history-service';
import { copyImageToClipboard, copyText, downloadBlob } from '@/shared/utils/download';
import { buildFilename, stripExtension } from '@/shared/utils/filename';
import { useTheme } from '@/shared/hooks/useTheme';
import { generateImageThumbnail } from '@/recording/services/thumbnail';
import type { Annotation, BoxAnnotation, EditorDoc, MarkerAnnotation, StrokeAnnotation, Frame, Rect, Tool, ToolStyles, Watermark } from '../types';
import { BACKGROUND_DEFAULTS, BORDER_DEFAULTS, DEFAULT_TOOL_STYLES, EMPTY_FRAME } from '../types';
import { canRedo, canUndo, createHistory, historyReducer, sameDoc, timeline, type HistoryState } from '../history/history';
import { renderArea, exportDocument } from '../render';
import { applyClearArea, applyCrop, applyEraseImage, applyCutOut, applyFlip, applyResize, applyRotate, aspectValue, constrainAspect, cutBand, defaultCutBand, type AspectRatio, type CutBand } from '../tools/crop';
import { annotationId } from '../tools/common';
import { describeAnnotation, getBounds, rotateBy, translate } from '../tools/annotations';
import type { AlignTo, AreaActions, LayerMove, SelectionActions } from '../components/SelectionBar';
import { defaultBends } from '../tools/shapes';
import { fitCallout } from '../tools/callouts';
import { clipFromShape, isCutShape, isStroke } from '../tools/stroke-clip';
import { clearRedactCache } from '../tools/blur';
import { EditorToolbar, nextZoom } from '../components/EditorToolbar';
import { CanvasWorkspace, type TextEditState, type WorkspaceHandle } from '../components/CanvasWorkspace';
import { PropertiesPanel, styleKindFor, type FrameApply, type StyleKind } from '../components/PropertiesPanel';
import { HistoryPanel, LayersPanel } from '../components/LayersPanel';
import { ExportPanel } from '../components/ExportPanel';
import { Modal } from '@/shared/components/Modal';
import { ImportScreen } from '../components/ImportScreen';
import { OcrDialog, ResizeDialog, ShortcutsDialog } from '../components/Dialogs';
import { PdfDialog, QrDialog } from '../components/ShareDialogs';
import { imageToPdf } from '@/shared/utils/pdf';
import { buildDocx, DOCX_MIME } from '@/shared/utils/docx';
import { SensitiveDialog } from '@/shared/components/SensitiveDialog';
import type { SensitiveMatch } from '@/screenshot/services/sensitive-detect';
import { CollageWorkspace, MAX_IMAGES } from '@/collage/CollageWorkspace';
import { CompareDialog } from '@/shared/components/CompareDialog';
import type { AddedImage } from '@/shared/components/AddImageMenu';
import { getOriginalImage, keepOriginal, restoreOriginalImage } from '@/flow/flow-store';
import { ImageRail } from '../components/ImageRail';
import { EraseSwitch, FiltersPanel, isEraseTool } from '../components/RetouchPanels';
import { FilmStrip } from '../components/FilmStrip';
import { BusyPill } from '@/shared/components/BusyPill';
import { ImageInfo } from '../components/ImageInfo';
import { groupIntoFlow } from '@/flow/flow-store';
import { COMPARE_DEFAULT, CompareBar, type CompareState } from '../components/CompareBar';
import type { ComparePane } from '../render';
import { isActive } from '../tools/filters';
import { useFill, useRetouch } from '../components/useRetouch';
import { newMaskCanvas, paintStroke } from '../tools/retouch';
import styles from '../components/editor.module.css';

// v2: new defaults (thicker pen / lines, highlighter opacity in its colour, callout designs).
const STYLES_KEY = 'glint.editor.toolStyles.v2';
/** Last-used frame, watermark and export choices, so they are kept between sessions. */
const PREFS_KEY = 'glint.editor.prefs';

export interface EditorPrefs {
  frame?: Frame | null;
  watermark?: Watermark | null;
  format?: ImageFormat | 'original';
  quality?: number;
  /** The bar under the picture (compare, zoom, fit, full screen); off: a small card in the corner. */
  compareBar?: boolean;
  /** Full screen: image details float over the picture (true, default) or sit in a panel beside it. */
  detailsPopup?: boolean;
}

type LoadState = { status: 'loading' } | { status: 'import' } | { status: 'error'; message: string } | { status: 'ready'; record: CaptureRecord; doc: EditorDoc };

export function EditorApp() {
  const { settings } = useSettings();
  /** Something slow is going on (opening an image, adding images): the busy pill. */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  /** The editor area is full screen (shows the strip of open images). */
  const [pageFull, setPageFull] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const on = () => setPageFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const preparing = params.get('preparing') === '1';
  const [load, setLoad] = useState<LoadState>(() => (params.get('id') || preparing ? { status: 'loading' } : { status: 'import' }));
  // Collage workspace (opened from the popup with ?collage=1, the import screen or the editor toolbar).
  const [collage, setCollage] = useState<Array<{ blob: Blob; name: string }> | null>(() => (params.get('collage') === '1' ? [] : null));
  const toast = useToast();
  // The images of this editing session (left panel): the screenshot plus images added to it.
  const [setIds, setSetIds] = useState<string[]>(() => {
    const id = params.get('id');
    const list = (params.get('set') ?? '').split(',').filter(Boolean);
    if (id && !list.includes(id)) list.unshift(id);
    return list;
  });
  const [records, setRecords] = useState<Record<string, CaptureRecord>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [railHidden, setRailHidden] = useState(() => { try { return localStorage.getItem('pixora.editor.railHidden') === '1'; } catch { return false; } });
  const [compare, setCompare] = useState<{ id: string; original: string; edited?: string } | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  /** Images with unsaved edits in this session (the panel shows them as edited straight away). */
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  /** Undo history per image (kept while switching images) and the doc last saved for each. */
  const histories = useRef(new Map<string, HistoryState>());
  const savedDocs = useRef(new Map<string, EditorDoc>());
  /** Whether each image already had saved edits when it was opened. */
  const editedAtOpen = useRef(new Map<string, boolean>());
  const currentId = load.status === 'ready' ? load.record.id : null;

  // Follows Settings › General › Theme (light, dark or the computer's setting).
  useTheme(settings?.general.theme);

  const openCapture = useCallback(async (id: string, ready?: { record: CaptureRecord; blob: Blob }) => {
    // An image already showing stays until the next one is ready (no Loading screen in between: switching flickered).
    if (!ready) setLoad((l) => (l.status === 'ready' ? l : { status: 'loading' }));
    try {
      const [record, blob] = ready ? [ready.record, ready.blob] : await Promise.all([getCapture(id), getCaptureBlob(id)]);
      if (!record || !blob) throw new Error('This capture no longer exists. It may have been deleted.');
      const base = await createImageBitmap(blob);
      document.title = `${record.name} · Pixora Editor`;
      // A new screenshot gets the frames chosen in Settings → "Add to every screenshot" (once:
      // the flag is removed from the address, so reopening the capture shows it as saved).
      let frame: Frame | null = null;
      if (params.get('fresh') === '1') {
        const [settingsNow, stored] = await Promise.all([loadSettings().catch(() => null), chrome.storage.local.get(PREFS_KEY).catch(() => ({}))]);
        const auto = settingsNow?.screenshot.autoFrame;
        if (auto) frame = autoFrameFor(auto, ((stored as Record<string, EditorPrefs | undefined>)[PREFS_KEY])?.frame ?? null, record);
        const clean = new URLSearchParams(location.search);
        clean.delete('fresh');
        history.replaceState(null, '', `?${clean.toString()}`);
      }
      if (!editedAtOpen.current.has(record.id)) editedAtOpen.current.set(record.id, Boolean(record.edited));
      setLoad({ status: 'ready', record, doc: { base, width: base.width, height: base.height, annotations: [], watermark: null, frame } });
    } catch (err) {
      setLoad({ status: 'error', message: err instanceof Error ? err.message : 'The image could not be opened.' });
    }
  }, []);

  useEffect(() => {
    const id = params.get('id');
    if (id) void openCapture(id);
  }, [params, openCapture]);

  // Records (thumbnails, sizes) of the session's images; images deleted elsewhere drop out.
  useEffect(() => {
    let alive = true;
    void Promise.all(setIds.map((id) => (records[id] ? Promise.resolve(records[id]) : getCapture(id).catch(() => undefined)))).then((list) => {
      if (!alive) return;
      const found = list.filter((r): r is CaptureRecord => !!r);
      setRecords((prev) => ({ ...prev, ...Object.fromEntries(found.map((r) => [r.id, r])) }));
      if (found.length !== setIds.length && found.length > 0) setSetIds(found.map((r) => r.id));
    });
    return () => { alive = false; };
  }, [setIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncUrl = (ids: string[], cur: string) => {
    const q = new URLSearchParams();
    q.set('id', cur);
    if (ids.length > 1) q.set('set', ids.join(','));
    history.replaceState(null, '', `?${q.toString()}`);
  };

  /** Changed since it was opened or last saved. */
  const changedDoc = (id: string) => {
    const h = histories.current.get(id);
    return h && !sameDoc(h.present.doc, h.original) && h.present.doc !== savedDocs.current.get(id) ? h.present.doc : null;
  };
  /** Every edit of this session was taken back, and the image had none before. */
  const reverted = (id: string) => {
    const h = histories.current.get(id);
    return Boolean(h) && sameDoc(h!.present.doc, h!.original) && editedAtOpen.current.get(id) === false;
  };
  /** Saves the edits of an image (its original is kept) — before switching away, comparing, collage. */
  const flush = async (id: string | null) => {
    if (!id) return;
    // Edits saved earlier in this session were all removed again: back to the untouched picture.
    if (reverted(id) && records[id]?.edited) {
      const rec = await restoreOriginalImage(id);
      savedDocs.current.delete(id);
      if (rec) setRecords((r) => ({ ...r, [id]: rec }));
      return;
    }
    const doc = changedDoc(id);
    if (!doc) return;
    const png = await exportDocument(doc, 'png', 1);
    const bmp = await createImageBitmap(png);
    await keepOriginal(id);
    const rec = await updateCapture(id, { mimeType: 'image/png', width: bmp.width, height: bmp.height, edited: true, thumbnail: (await generateImageThumbnail(png)) ?? undefined }, png);
    bmp.close();
    savedDocs.current.set(id, doc);
    setRecords((r) => ({ ...r, [id]: rec }));
    broadcast({ target: 'broadcast', type: 'history/changed' });
  };
  const isEdited = (id: string) => !reverted(id) && (Boolean(records[id]?.edited) || (dirty.has(id) && Boolean(changedDoc(id))));

  /** Images whose edits are being saved in the background (waited for only when reopened). */
  const saving = useRef(new Map<string, Promise<void>>());
  const openImage = async (id: string) => {
    if (id === currentId) return;
    // The image left behind is saved in the background: switching does not wait for it.
    const prev = currentId;
    if (prev) {
      const job = flush(prev).catch((err: unknown) => toast.error(errorInfoOf(err))).finally(() => saving.current.delete(prev));
      saving.current.set(prev, job);
    }
    syncUrl(setIds, id);
    // Opened before in this session: shown at once from memory (no reading and decoding again).
    const h = histories.current.get(id);
    const rec = records[id];
    if (h && rec) {
      document.title = `${rec.name} · Pixora Editor`;
      setLoad({ status: 'ready', record: rec, doc: h.original });
      return;
    }
    setBusyLabel('Opening the image…');
    try {
      await saving.current.get(id);
      await openCapture(id);
    } finally {
      setBusyLabel(null);
    }
  };

  /** Stores pictures as captures and adds them to the session (the first one opens). */
  const addImages = async (images: AddedImage[]) => {
    setBusyLabel(images.length > 1 ? `Adding ${images.length} images…` : 'Adding the image…');
    try { await addImagesNow(images); } finally { setBusyLabel(null); }
  };
  const addImagesNow = async (images: AddedImage[]) => {
    // The image left behind is saved in the background; the new ones are stored side by side.
    const prev = currentId;
    if (prev) {
      const job = flush(prev).catch(() => undefined).finally(() => saving.current.delete(prev));
      saving.current.set(prev, job);
    }
    const made = await Promise.all(images.map((im) => createCapture(im.blob, im.name).then((record) => ({ record, blob: im.blob })).catch((err: unknown) => { toast.error(errorInfoOf(err)); return null; })));
    const done = made.filter((m): m is { record: CaptureRecord; blob: Blob } => !!m);
    if (!done.length) return;
    const added = done.map((m) => m.record.id);
    // The images of an editor session are kept together as one flow capture (one entry in Recent
    // captures): new images join the flow of the images already open, or a new flow is made with them.
    try {
      const open = setIds.map((x) => (x === currentId && load.status === 'ready' ? load.record : records[x])).filter((r): r is CaptureRecord => !!r);
      const into = open.find((r) => r.flowId)?.flowId;
      const loose = open.filter((r) => r.kind === 'screenshot' && !r.flowId).map((r) => r.id);
      const fid = into ? await groupIntoFlow([...loose, ...added], { into }) : await groupIntoFlow([...loose, ...added]);
      const moved = new Set([...loose, ...added]);
      for (const m of done) m.record = { ...m.record, flowId: fid };
      setRecords((r) => {
        const next = { ...r, ...Object.fromEntries(done.map((m) => [m.record.id, m.record])) };
        for (const id of moved) if (next[id]) next[id] = { ...next[id]!, flowId: fid };
        return next;
      });
      if (load.status === 'ready' && moved.has(load.record.id)) setLoad((l) => (l.status === 'ready' ? { ...l, record: { ...l.record, flowId: fid } } : l));
      broadcast({ target: 'broadcast', type: 'history/changed' });
    } catch { /* they stay separate images */ }
    const ids = [...setIds, ...added];
    syncUrl(ids, added[0]!);
    // Opened from the picture already in memory; the list grows at the same moment (an image added
    // in between could otherwise land in the editor that is being replaced).
    await openCapture(added[0]!, done[0]);
    setSetIds(ids);
    toast.success(added.length > 1 ? `${added.length} images added` : 'Image added', 'They are in the image list on the left.');
  };

  /** Images from Recent captures: join the image list (nothing copied); the first one opens. */
  const addExisting = async (pick: string[]) => {
    setBusyLabel(pick.length > 1 ? `Adding ${pick.length} images…` : 'Adding the image…');
    try { await addExistingNow(pick); } finally { setBusyLabel(null); }
  };
  const addExistingNow = async (pick: string[]) => {
    const fresh = pick.filter((x) => !setIds.includes(x));
    if (!fresh.length) return;
    const prev = currentId;
    if (prev) {
      const job = flush(prev).catch(() => undefined).finally(() => saving.current.delete(prev));
      saving.current.set(prev, job);
    }
    const ids = [...setIds, ...fresh];
    syncUrl(ids, fresh[0]!);
    await openCapture(fresh[0]!);
    setSetIds(ids);
    toast.success(fresh.length > 1 ? `${fresh.length} images added` : 'Image added', 'They are in the image list on the left.');
  };

  const removeImage = async (id: string) => {
    if (setIds.length < 2) return;
    const ids = setIds.filter((x) => x !== id);
    setSetIds(ids);
    setChecked((c) => { const n = new Set(c); n.delete(id); return n; });
    if (id === currentId) {
      const i = setIds.indexOf(id);
      const next = ids[Math.min(i, ids.length - 1)]!;
      await flush(id).catch(() => undefined);
      syncUrl(ids, next);
      await openCapture(next);
    } else if (currentId) syncUrl(ids, currentId);
  };

  const moveImage = (id: string, to: number) => {
    const ids = setIds.filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
    setSetIds(ids);
    if (currentId) syncUrl(ids, currentId);
  };

  /** A copy (as it is now, edits included) right after the image; the copy opens. */
  const duplicateImage = async (id: string) => {
    try {
      const blob = await currentBlob(id);
      if (!blob) return;
      const rec = records[id];
      const copy = await createCapture(blob, `${stripExtension(rec?.name ?? 'image')} (copy).png`);
      const ids = [...setIds];
      ids.splice(ids.indexOf(id) + 1, 0, copy.id);
      setSetIds(ids);
      await flush(currentId).catch(() => undefined);
      syncUrl(ids, copy.id);
      await openCapture(copy.id);
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };

  const renameImage = async (id: string, name: string) => {
    try {
      const ext = (records[id]?.name.match(/\.[a-z0-9]+$/i) ?? ['.png'])[0];
      const next = await updateCapture(id, { name: /\.[a-z0-9]+$/i.test(name) ? name : `${name}${ext}` });
      setRecords((r) => ({ ...r, [id]: next }));
      if (id === currentId && load.status === 'ready') setLoad({ ...load, record: next });
      broadcast({ target: 'broadcast', type: 'history/changed' });
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };

  /** The picture as it is now (edits included). */
  const currentBlob = async (id: string): Promise<Blob | undefined> => {
    const doc = changedDoc(id);
    if (doc) return exportDocument(doc, 'png', 1);
    return getCaptureBlob(id);
  };

  const openCompare = async (id: string) => {
    try {
      const original = await getOriginalImage(id);
      if (!original) return;
      const edited = changedDoc(id) ? await currentBlob(id) : records[id]?.edited && !reverted(id) ? await getCaptureBlob(id) : undefined;
      setCompare({ id, original: URL.createObjectURL(original), ...(edited ? { edited: URL.createObjectURL(edited) } : {}) });
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };
  const closeCompare = () => {
    if (compare) {
      URL.revokeObjectURL(compare.original);
      if (compare.edited) URL.revokeObjectURL(compare.edited);
    }
    setCompare(null);
  };

  const restoreImage = async (id: string) => {
    try {
      const rec = await restoreOriginalImage(id);
      histories.current.delete(id);
      savedDocs.current.delete(id);
      if (rec) setRecords((r) => ({ ...r, [id]: rec }));
      if (id === currentId) {
        setEditorKey((k) => k + 1);
        await openCapture(id);
      }
      toast.success('Original restored', rec ? undefined : 'The changes made in this session were discarded.');
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };

  /** Collage of the ticked images (or all of them); `seed` is the open image, as edited. */
  const openCollage = async (seed?: { blob: Blob; name: string }) => {
    const ids = checked.size ? setIds.filter((x) => checked.has(x)) : setIds;
    const seeds: Array<{ blob: Blob; name: string }> = [];
    for (const id of ids.slice(0, MAX_IMAGES)) {
      const blob = id === currentId && seed ? seed.blob : await currentBlob(id).catch(() => undefined);
      if (blob) seeds.push({ blob, name: records[id]?.name ?? 'image' });
    }
    if (seed && !ids.includes(currentId ?? '')) seeds.unshift(seed);
    if (ids.length > MAX_IMAGES) toast.info(`A collage can hold up to ${MAX_IMAGES} images`, 'The first ones were added.');
    setCollage(seeds.slice(0, MAX_IMAGES));
  };

  async function createCapture(blob: Blob, name: string): Promise<CaptureRecord> {
    const [bitmap, thumbnail] = await Promise.all([createImageBitmap(blob), generateImageThumbnail(blob)]);
    const record = await addCapture(
      {
        kind: 'screenshot',
        name: stripExtension(name) ? name : buildFilename(settings?.general.filenamePattern ?? '{type} {date}', { type: 'Screenshot', extension: 'png' }),
        mimeType: blob.type || 'image/png',
        width: bitmap.width,
        height: bitmap.height,
        thumbnail,
        sourceTitle: name,
      },
      blob,
    );
    bitmap.close();
    broadcast({ target: 'broadcast', type: 'history/changed' });
    setRecords((r) => ({ ...r, [record.id]: record }));
    return record;
  }

  async function importImage(blob: Blob, name: string) {
    try {
      const record = await createCapture(blob, name);
      await flush(currentId).catch(() => undefined);
      const ids = currentId ? [...setIds, record.id] : [record.id];
      setSetIds(ids);
      syncUrl(ids, record.id);
      await openCapture(record.id);
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  }

  const collageView = collage && (
    <CollageWorkspace
      seeds={collage}
      onCancel={() => setCollage(null)}
      onDone={(blob) => {
        setCollage(null);
        void importImage(blob, buildFilename('Pixora Collage {date} at {time}', { type: 'Screenshot', extension: 'png' }));
      }}
    />
  );

  let content: JSX.Element;
  /** In full screen: the open images, to switch between them (each with its own Before / After). */
  let fsStrip: JSX.Element | null = null;
  if (load.status === 'import') {
    content = <ImportScreen onImage={(b, n) => void importImage(b, n)} onCollage={() => setCollage([])} />;
  } else if (load.status === 'loading' || !settings) {
    content = (
      <div className={styles.loading}>
        <Spinner size={26} />
        {preparing ? 'Preparing your screenshot… big pages take a few seconds.' : 'Opening image…'}
      </div>
    );
  } else if (load.status === 'error') {
    content = (
      <div className={styles.loading}>
        <div style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
          <InlineNotice tone="error">{load.message}</InlineNotice>
          <Button onClick={() => location.assign(chrome.runtime.getURL('options.html#history'))}>Open Recent captures</Button>
        </div>
      </div>
    );
  } else {
    const id = load.record.id;
    const items = setIds.map((x) => (x === id ? load.record : records[x])).filter((r): r is CaptureRecord => !!r);
    if (pageFull && items.length > 1) {
      fsStrip = <FilmStrip items={items} currentId={id} onOpen={(x) => void openImage(x)} />;
    }
    content = (
      <Editor
        key={`${id}:${editorKey}`}
        record={load.record}
        initialDoc={load.doc}
        settings={settings}
        params={params}
        onCollage={(seed) => void openCollage(seed)}
        initialHistory={histories.current.get(id)}
        onHistory={(h) => {
          histories.current.set(id, h);
          const changed = !sameDoc(h.present.doc, h.original);
          setDirty((d) => (d.has(id) === changed ? d : changed ? new Set(d).add(id) : new Set([...d].filter((x) => x !== id))));
        }}
        onSaved={(rec) => { savedDocs.current.set(id, histories.current.get(id)?.present.doc ?? load.doc); setRecords((r) => ({ ...r, [id]: rec })); }}
        onCompare={() => void openCompare(id)}
        strip={fsStrip}
        onStep={(dir) => { const next = setIds[setIds.indexOf(id) + dir]; if (next) void openImage(next); }}
        rail={
          <ImageRail
            items={items}
            currentId={id}
            liveThumbs={{}}
            checked={checked}
            hidden={railHidden}
            onHidden={(h) => { setRailHidden(h); try { localStorage.setItem('pixora.editor.railHidden', h ? '1' : '0'); } catch { /* private window */ } }}
            onCheck={(x, on) => setChecked((c) => { const n = new Set(c); if (on) n.add(x); else n.delete(x); return n; })}
            onCheckAll={(on) => setChecked(on ? new Set(items.map((r) => r.id)) : new Set())}
            onOpen={(x) => void openImage(x)}
            onCompare={(x) => void openCompare(x)}
            onRestore={(x) => void restoreImage(x)}
            onRemove={(x) => void removeImage(x)}
            onAdd={(imgs) => void addImages(imgs)}
            onAddExisting={(ids) => void addExisting(ids)}
            onCollage={() => void openCollage()}
            onMove={moveImage}
            onDuplicate={(x) => void duplicateImage(x)}
            onRename={(x, n) => void renameImage(x, n)}
            isEdited={isEdited}
          />
        }
      />
    );
  }
  return (
    <>
      <div id="pixora-fs-root" className={styles.fsRoot}>
        {content}
        <BusyPill label={busyLabel} />
      </div>
      {collageView}
      <CompareDialog
        open={compare !== null}
        original={compare?.original ?? ''}
        edited={compare?.edited}
        onClose={closeCompare}
        onRestore={compare ? () => { const id = compare.id; closeCompare(); void restoreImage(id); } : undefined}
      />
    </>
  );
}

/**
 * The frame added automatically to a new screenshot: browser window, background and / or border,
 * each from the user's last choices in the editor when there are any, else the defaults.
 */
export function autoFrameFor(auto: AutoFrame, last: Frame | null, record: Pick<CaptureRecord, 'sourceUrl' | 'sourceTitle'>): Frame | null {
  if (!auto.browser && !auto.background && !auto.border) return null;
  const lastBg = last && last.padding > 0 ? { padding: last.padding, background: last.background, radius: last.radius, shadow: last.shadow } : BACKGROUND_DEFAULTS;
  const lastBorder = last && last.borderWidth > 0 ? { borderWidth: last.borderWidth, borderColor: last.borderColor, borderStyle: last.borderStyle ?? 'solid' } : BORDER_DEFAULTS;
  const mac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
  return {
    ...EMPTY_FRAME,
    // The border goes around the padded frame (as in the editor), so it brings the background along.
    ...(auto.background || auto.border ? lastBg : {}),
    ...(auto.border ? lastBorder : {}),
    browser: auto.browser
      ? { ...(last?.browser ?? { style: mac ? 'mac' : 'windows', position: 'top', theme: 'light' }), url: record.sourceUrl || last?.browser?.url || 'https://example.com', title: record.sourceTitle || last?.browser?.title || 'New Tab' }
      : null,
  };
}

/** Merges stored tool styles over the defaults (new style keys get their defaults). */
function mergeStyles(stored: Partial<ToolStyles> | undefined): ToolStyles {
  const out = { ...DEFAULT_TOOL_STYLES } as Record<string, unknown>;
  if (stored) for (const k of Object.keys(DEFAULT_TOOL_STYLES) as Array<keyof ToolStyles>) out[k] = { ...DEFAULT_TOOL_STYLES[k], ...(stored[k] ?? {}) };
  // 32px was the old default marker size: it moves to the new 50px default (a size the user chose is kept).
  const m = out.marker as ToolStyles['marker'];
  if (m.size === 32) out.marker = { ...m, size: DEFAULT_TOOL_STYLES.marker.size };
  return out as unknown as ToolStyles;
}

/** 'info': the image details (the toolbar's Details button), in place of the tabs' content. */
type PanelTab = 'props' | 'layers' | 'history' | 'info';

export interface EditorProps {
  record: CaptureRecord;
  initialDoc: EditorDoc;
  settings: Settings;
  params: URLSearchParams;
  onCollage?: (seed: { blob: Blob; name: string }) => void;
  /** Restores an earlier undo history (Flow Editor keeps one per image). */
  initialHistory?: HistoryState;
  onHistory?: (history: HistoryState) => void;
  /** Called after the image was saved (download / copy). */
  onSaved?: (record: CaptureRecord) => void;
  /** Shown inside another page that already has the logo (Flow Editor): no second logo. */
  embedded?: boolean;
  /** Flow Editor: "Apply" / "Apply to all" buttons of the Border & frame panel. */
  frameApply?: FrameApply;
  /** Flow Editor: its header buttons call the editor's Copy and Download. */
  actionsRef?: { current: EditorActions | null };
  /** Left image panel (screenshot editor). */
  rail?: ReactNode;
  /** Full screen with several images: the open images, left of the controls under the picture. */
  strip?: ReactNode;
  /** Full screen: ← / → show the previous / next image. */
  onStep?: (dir: 1 | -1) => void;
  /** Opens the Compare window for the image in the editor. */
  onCompare?: () => void;
  /** Drawing on a video frame (Advanced Video Editor): tools that change the size are hidden. */
  videoMode?: boolean;
  /**
   * Inline on the video page: only the canvas is shown (over the paused video), the tool comes from
   * the page's Annotate rail and the settings panel is drawn into `panelSlot`.
   */
  inline?: { panelSlot: HTMLElement | null; requestedTool: { tool: Tool; n: number } | null; requestedSelect?: { id: string; n: number } | null; onToolChange: (t: Tool) => void; onSelectionChange: (annotationId: string | null) => void };
}

export interface EditorActions {
  copy: () => void;
  download: () => void;
  busy: boolean;
  /** An annotation is selected (Delete removes it, not the image). */
  hasSelection: boolean;
}

/** The page's one-time URL requests (?ocr, ?autosave, ?copy) were handled (by the first image opened). */
let urlActionsUsed = false;
/** Captures whose "extract text" request was handled in this page. */
const ocrDone = new Set<string>();

export function Editor({ record: initialRecord, initialDoc, settings, params, onCollage, initialHistory, onHistory, onSaved, embedded, frameApply, actionsRef, rail, strip, onStep, videoMode, inline }: EditorProps) {
  const toast = useToast();
  const [hist, dispatch] = useReducer(historyReducer, initialDoc, (d: EditorDoc) => initialHistory ?? createHistory(d));
  // Report the history only when it really changes: re-sending an old history on a parent
  // re-render would bring back edits the host just discarded (Restore / Restore all).
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;
  useEffect(() => {
    onHistoryRef.current?.(hist);
  }, [hist]);
  const doc = hist.present.doc;
  const [record, setRecord] = useState(initialRecord);
  const [tool, setToolState] = useState<Tool>('select');
  const [toolStyles, setToolStyles] = useState<ToolStyles>(DEFAULT_TOOL_STYLES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Several objects selected together (Ctrl+Shift+click): move, copy, paste, duplicate, delete. */
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState<{ rect: Rect; aspect: AspectRatio } | null>(null);
  /** Select tool: an area of the picture marked by dragging (copy, cut, delete or crop to it). */
  const [area, setArea] = useState<Rect | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [panning, setPanning] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('props');
  const [filename, setFilename] = useState(stripExtension(initialRecord.name));
  /** Export format; 'original': the format the picture came in (default). */
  const [format, setFormat] = useState<ImageFormat | 'original'>('original');
  const outFormat: ImageFormat = format !== 'original' ? format : /^image\/(png|jpeg|webp)$/.test(record.mimeType) ? (record.mimeType.slice(6) as ImageFormat) : 'png';
  const [quality, setQuality] = useState(settings.screenshot.quality);
  const [busy, setBusy] = useState(false);
  /** Which export is running (its button shows the spinner, others are only disabled). */
  const [action, setAction] = useState<'download' | 'saveas' | 'copy' | 'word' | 'pdf' | null>(null);
  /** What a long export is doing, shown in a "working…" toast while it runs. */
  const [working, setWorking] = useState<string | null>(null);
  useEffect(() => {
    if (!working) return;
    return toast.progress(working, 'Large images can take a few seconds.');
  }, [working, toast]);
  const [resizeOpen, setResizeOpen] = useState(false);
  /** Filters: showing the picture without them (Before). */
  /** The editor fills the screen (browser full screen). */
  const [fullScreen, setFullScreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    // Full screen changes the picture area's size: show the whole picture again.
    const on = () => { setFullScreen(Boolean(document.fullscreenElement)); requestAnimationFrame(() => requestAnimationFrame(() => workspace.current?.fit())); };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  /** Full screen: the details panel (↓ shows it, ↑ hides it). */
  const [fsInfo, setFsInfo] = useState(false);
  /** The details are on their way out (they slide / fade away before they are removed). */
  const [fsInfoOut, setFsInfoOut] = useState(false);
  const outTimer = useRef(0);
  const hideFsInfo = useCallback(() => {
    setFsInfoOut(true);
    window.clearTimeout(outTimer.current);
    outTimer.current = window.setTimeout(() => { setFsInfo(false); setFsInfoOut(false); }, 170);
  }, []);
  const toggleFsInfo = useCallback(() => {
    if (fsInfo && !fsInfoOut) hideFsInfo();
    else { window.clearTimeout(outTimer.current); setFsInfoOut(false); setFsInfo(true); }
  }, [fsInfo, fsInfoOut, hideFsInfo]);
  useEffect(() => {
    if (!fullScreen) { setFsInfo(false); return; }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onStep?.(e.key === 'ArrowRight' ? 1 : -1); }
      // ↓ shows the details, and hides them again; ↑ hides them.
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); toggleFsInfo(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); hideFsInfo(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fullScreen, onStep, toggleFsInfo, hideFsInfo]);

  /**
   * Full screen: the picture and its bar fill the screen (toolbar, side panel and image list hidden;
   * the other open images in a strip on top). It is the area that stays while switching images.
   */
  const toggleFullScreen = useCallback(() => {
    const root = document.getElementById('pixora-fs-root');
    if (!root) { workspace.current?.toggleFullScreen(); return; }
    void (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(() => undefined);
  }, []);
  /** Filters: Before / After split on the picture (share of its width), or off. */
  const [cmp, setCmp] = useState<CompareState>(COMPARE_DEFAULT);
  // Picking a drawing / editing tool while comparing: Before / After (or the original) goes away, so
  // the tool works (comparing is view only).
  useEffect(() => {
    if (tool === 'select' || tool === 'hand' || tool === 'filters') return;
    setCmp((c) => (c.on || c.original ? { ...c, on: false, original: false } : c));
  }, [tool]);
  const patchCmp = useCallback((p: Partial<CompareState>) => setCmp((c) => ({ ...c, ...p })), []);
  /** Side by side: zoom / move a pane (and the other one too when Sync zoom / Sync scroll is on). */
  const movePane = useCallback((i: 0 | 1, ch: { dx?: number; dy?: number; zoom?: number }) => setCmp((c) => {
    const step = (p: ComparePane, z: number | undefined, dx: number, dy: number): ComparePane => {
      const k = Math.min(8, Math.max(1, p.k * (z ?? 1)));
      const m = 0.5 / k;
      return { k, x: Math.min(1 - m, Math.max(m, p.x + dx)), y: Math.min(1 - m, Math.max(m, p.y + dy)) };
    };
    const panes = [...c.panes] as [ComparePane, ComparePane];
    panes[i] = step(panes[i], ch.zoom, ch.dx ?? 0, ch.dy ?? 0);
    const o = (1 - i) as 0 | 1;
    const z = c.syncZoom ? ch.zoom : undefined;
    const moved = c.syncScroll && (ch.dx || ch.dy);
    if (z || moved) panes[o] = c.syncZoom && c.syncScroll ? panes[i] : step(panes[o], z, moved ? ch.dx ?? 0 : 0, moved ? ch.dy ?? 0 : 0);
    return { ...c, panes };
  }), []);
  /**
   * Before / After compares with the picture as first opened: offered once anything changed
   * (filters, removed objects or background, erasing, drawings…) while the size is the same (after
   * a crop or resize the two can't be lined up), and always in the Filters tool.
   */
  // An image edited and saved before: Before / After and Original show the kept original picture
  // (not just the picture as it was opened).
  // Only when the picture was already edited when it was opened: an edit saved in this session (a
  // download) and then undone leaves the picture equal to the original — nothing to compare.
  const editedWhenOpened = useRef(Boolean(record.edited)).current;
  const [keptOriginal, setKeptOriginal] = useState<EditorDoc | null>(null);
  useEffect(() => {
    setKeptOriginal(null);
    if (!editedWhenOpened) return;
    let alive = true;
    void getOriginalImage(record.id).then(async (blob) => {
      if (!blob || !alive) return;
      const base = await createImageBitmap(blob);
      if (alive) setKeptOriginal({ base, width: base.width, height: base.height, annotations: [], watermark: null, frame: null });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [record.id, editedWhenOpened]);
  const opened = hist.original;
  const original = keptOriginal && keptOriginal.width === doc.width && keptOriginal.height === doc.height ? keptOriginal : opened;
  const sameSize = original.width === doc.width && original.height === doc.height;
  const canCompare = isActive(doc.filters) || original !== opened || (sameSize && !sameDoc(doc, original));
  const [cut, setCut] = useState<CutBand | null>(null);
  const [ocr, setOcr] = useState<{ open: boolean; text: string | null; progress: number; status: string; error: string | null }>({ open: false, text: null, progress: 0, status: '', error: null });
  const [savedDoc, setSavedDoc] = useState<EditorDoc>(initialDoc);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [scan, setScan] = useState<{ open: boolean; matches: SensitiveMatch[] | null; progress: number; error: string | null; hidden?: number }>({ open: false, matches: null, progress: 0, error: null });
  const [prefs, setPrefs] = useState<EditorPrefs>({});
  /** The bar under the picture is on unless switched off in its settings. */
  const showCompareBar = prefs.compareBar !== false;
  const detailsPopup = prefs.detailsPopup !== false;
  // The picture re-fits when the docked details open or close.
  useEffect(() => { if (fullScreen) requestAnimationFrame(() => workspace.current?.fit()); }, [fsInfo, detailsPopup]); // eslint-disable-line react-hooks/exhaustive-deps
  const stylesLoaded = useRef(false);
  const clipboard = useRef<Annotation | null>(null);
  /** Several copied objects (used when no single object was copied after them). */
  const manyClipboard = useRef<Annotation[]>([]);
  const workspace = useRef<WorkspaceHandle>(null);
  /** The object menus as they are now (the selection bar opens them later). */
  const menusRef = useRef<{ one: () => MenuItem[]; many: () => MenuItem[] }>({ one: () => [], many: () => [] });
  const selectedRef = useRef<Annotation | null>(null);
  /** The properties of a locked annotation can't be used. */
  const lockedPanel = useRef<HTMLDivElement>(null);
  const initialActions = useRef(false);

  /** "Move only": the selected annotation can be dragged (and nudged) but not changed, until a click elsewhere. */
  const [moveOnlyId, setMoveOnlyId] = useState<string | null>(null);
  const moveOnlyRef = useRef(moveOnlyId);
  moveOnlyRef.current = moveOnlyId;
  const found = selectedId ? doc.annotations.find((a) => a.id === selectedId) ?? null : null;
  // While moving only, it behaves like a "move only" lock (the lock isn't saved with it).
  const selected = useMemo(() => (found && found.id === moveOnlyId && !found.lock ? ({ ...found, lock: 'move' } as Annotation) : found), [found, moveOnlyId]);
  useEffect(() => {
    if (moveOnlyId && moveOnlyId !== selectedId) setMoveOnlyId(null);
  }, [selectedId, moveOnlyId]);
  selectedRef.current = selected;

  // Persisted tool styles and editor choices: loaded once, then saved whenever they change.
  useEffect(() => {
    void chrome.storage.local.get([STYLES_KEY, PREFS_KEY]).then((r) => {
      setToolStyles(mergeStyles(r[STYLES_KEY] as Partial<ToolStyles> | undefined));
      const p = (r[PREFS_KEY] as EditorPrefs | undefined) ?? {};
      setPrefs(p);
      if (p.format) setFormat(p.format);
      if (typeof p.quality === 'number') setQuality(p.quality);
      stylesLoaded.current = true;
    });
  }, []);

  useEffect(() => {
    if (!stylesLoaded.current) return;
    const t = setTimeout(() => void chrome.storage.local.set({ [STYLES_KEY]: toolStyles }), 300);
    return () => clearTimeout(t);
  }, [toolStyles]);

  const savePrefs = useCallback((patch: EditorPrefs) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      void chrome.storage.local.set({ [PREFS_KEY]: next });
      return next;
    });
  }, []);

  // Fit on first load, before the first paint (no flash of the image at 100%).
  useLayoutEffect(() => {
    workspace.current?.fit();
  }, []);
  // A new picture size — crop, rotate, resize, and undoing / redoing / resetting them — shows the
  // whole picture again (undoing a crop used to leave the full picture at the cropped zoom).
  // Cut out & join and erasing keep the zoom you work at.
  const keepViewNext = useRef(false);
  const shownSize = useRef({ w: doc.width, h: doc.height });
  useEffect(() => {
    const s = shownSize.current;
    if (s.w === doc.width && s.h === doc.height) return;
    shownSize.current = { w: doc.width, h: doc.height };
    if (keepViewNext.current) keepViewNext.current = false;
    else requestAnimationFrame(() => workspace.current?.fit());
  }, [doc.width, doc.height]);

  const selectedLock = selected?.lock;
  useEffect(() => {
    const el = lockedPanel.current;
    if (!el) return;
    if (selectedLock) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  });

  // Drop the selection if the object disappeared (undo, eraser…).
  useEffect(() => {
    if (selectedId && !doc.annotations.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [doc, selectedId]);
  useEffect(() => {
    setMultiIds((ids) => {
      const left = ids.filter((id) => doc.annotations.some((a) => a.id === id));
      if (left.length === ids.length) return ids;
      return left.length > 1 ? left : [];
    });
  }, [doc]);
  // Selecting one object (canvas, Layers panel…) ends a multiple selection.
  useEffect(() => {
    if (selectedId) setMultiIds([]);
  }, [selectedId]);

  const commit = useCallback((next: EditorDoc, label: string, coalesceKey?: string) => dispatch({ type: 'commit', doc: next, label, coalesceKey }), []);

  const setTool = useCallback(
    (next: Tool) => {
      let t = next;
      // Rectangles and circles are one Shapes tool: "O" opens it with the ellipse picked.
      if (t === 'ellipse') {
        setToolStyles((s) => ({ ...s, shape: { ...s.shape, shape: 'ellipse' } }));
        t = 'rect';
      }
      setTextEdit(null);
      if (t !== 'select') setArea(null);
      if (t === 'crop') {
        setCrop({ rect: { x: 0, y: 0, w: doc.width, h: doc.height }, aspect: 'free' });
        setSelectedId(null);
      } else {
        setCrop(null);
      }
      if (t === 'cut') {
        setCut((c) => c ?? defaultCutBand('rows', doc.width, doc.height));
        setSelectedId(null);
      } else {
        setCut(null);
      }
      if (t === 'watermark' || t === 'frame' || t === 'filters' || t === 'removeObject' || t === 'removeBg') setSelectedId(null);
      else if (t !== 'select' && t !== tool) setSelectedId((id) => (id && styleKindFor(t) && doc.annotations.find((a) => a.id === id && styleKindFor(a.type) === styleKindFor(t)) ? id : null));
      setToolState(t);
      setPanelTab('props');
    },
    [doc.width, doc.height, doc.annotations, tool],
  );

  /* ------------------------------- geometry ops ------------------------------ */
  const geometry = useCallback(
    async (op: () => Promise<EditorDoc>, label: string, opts: { keepView?: boolean } = {}) => {
      setBusy(true);
      try {
        const next = await op();
        clearRedactCache();
        // Crop / rotate / resize show the new image whole (the size effect fits it); Cut out & join
        // keeps the zoom you work at.
        keepViewNext.current = Boolean(opts.keepView) && (next.width !== doc.width || next.height !== doc.height);
        commit(next, label);
        setSelectedId(null);
        if (!opts.keepView && next.width === doc.width && next.height === doc.height) requestAnimationFrame(() => workspace.current?.fit());
      } catch (err) {
        toast.error(errorInfoOf(err));
      } finally {
        setBusy(false);
      }
    },
    [commit, toast, doc.width, doc.height],
  );

  const docRef = useRef(doc);
  docRef.current = doc;
  const latestDoc = useCallback(() => docRef.current, []);
  const fillWithBackground = useFill(geometry, setWorking, latestDoc);
  const retouch = useRetouch({
    doc, tool, styles: toolStyles, busy, geometry, setWorking, latest: latestDoc,
    setStyle: (kind, patch) => setToolStyles((st) => ({ ...st, [kind]: { ...st[kind], ...patch } })),
    onError: (message) => toast.error(message),
    done: () => setToolState('select'),
  });
  const retouchKey = useRef(retouch.onKey);
  retouchKey.current = retouch.onKey;
  const retouchUndo = useRef(retouch.undo);
  retouchUndo.current = retouch.undo;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const applyCurrentCrop = useCallback(() => {
    if (!crop) return;
    const rect = crop.rect;
    setCrop(null);
    setToolState('select');
    void geometry(() => applyCrop(doc, rect), `Crop to ${Math.round(rect.w)} × ${Math.round(rect.h)}`);
  }, [crop, doc, geometry]);

  const applyCurrentCut = useCallback(() => {
    if (!cut || busy) return;
    const len = cut.axis === 'rows' ? doc.height : doc.width;
    const band = cutBand(len, cut.from, cut.to);
    if (!band) return;
    const opts = { ...cut, from: band.start, to: band.end };
    // The tool stays on (its settings stay open) so the user can cut again; the band is reset
    // for the new image size by the effect below.
    void geometry(() => applyCutOut(doc, opts), `Cut out ${band.end - band.start} px and join`, { keepView: true });
  }, [cut, busy, doc, geometry]);

  // The image size changed (a cut applied, undo, redo…) while cutting: start a fresh band in the
  // middle of the new image, keeping the chosen direction and join style.
  useEffect(() => {
    setCut((c) => (c ? defaultCutBand(c.axis, doc.width, doc.height, c.seam) : c));
  }, [doc.width, doc.height]);

  // Inline (video page): the Annotate rail asks for tools; the page hears the tool and the selection.
  useEffect(() => {
    if (inline?.requestedTool) setTool(inline.requestedTool.tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline?.requestedTool?.n]);
  useEffect(() => {
    const id = inline?.requestedSelect?.id;
    if (id && doc.annotations.some((a) => a.id === id)) { setToolState('select'); setSelectedId(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline?.requestedSelect?.n]);
  useEffect(() => { inline?.onToolChange(tool); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { inline?.onSelectionChange(selectedId); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ style changes ------------------------------ */
  const replaceAnnotation = useCallback(
    (a: Annotation, label: string, key?: string) => {
      // "Move only" is not kept on the annotation.
      const kept = a.lock === 'move' && a.id === moveOnlyRef.current && !doc.annotations.find((x) => x.id === a.id)?.lock ? ({ ...a, lock: undefined } as Annotation) : a;
      commit({ ...doc, annotations: doc.annotations.map((x) => (x.id === a.id ? kept : x)) }, label, key);
    },
    [doc, commit],
  );

  const onStyleChange = useCallback(
    (kind: StyleKind, patch: Record<string, unknown>, key: string) => {
      // Text content belongs to an annotation, never to the tool defaults.
      // …and so do positions (one-click mask placements).
      const { text, x: _x, y: _y, w: _w, h: _h, ...stylePatch } = patch as { text?: string; x?: number; y?: number; w?: number; h?: number } & Record<string, unknown>;
      if (Object.keys(stylePatch).length) setToolStyles((s) => ({ ...s, [kind]: { ...s[kind], ...stylePatch } }));
      // "Apply to all text": every text on the image takes this style (its words stay).
      if (kind === 'text' && key === 'text:apply-all') {
        if (doc.annotations.some((x) => x.type === 'text')) {
          commit({ ...doc, annotations: doc.annotations.map((x) => (x.type === 'text' ? ({ ...x, ...stylePatch } as Annotation) : x)) }, 'Apply text style to all', 'text:apply-all');
        }
        return;
      }
      // Markers are one numbered series: the counting style (1 2 3 / A B C …) changes on all of them.
      if (kind === 'marker' && key === 'markers:apply-all') {
        const look = patch as Pick<MarkerAnnotation, 'shape' | 'style' | 'size' | 'color' | 'fillColor' | 'textColor' | 'borderColor'>;
        const keys = ['shape', 'style', 'size', 'color', 'fillColor', 'textColor', 'borderColor'] as const;
        if (doc.annotations.some((x) => x.type === 'marker' && keys.some((k) => x[k] !== look[k]))) {
          const apply = (x: MarkerAnnotation): MarkerAnnotation => {
            const { fillColor: _f, textColor: _t, borderColor: _b, ...rest } = x;
            return {
              ...rest, shape: look.shape, style: look.style, size: look.size, color: look.color,
              ...(look.fillColor !== undefined ? { fillColor: look.fillColor } : {}),
              ...(look.textColor !== undefined ? { textColor: look.textColor } : {}),
              ...(look.borderColor !== undefined ? { borderColor: look.borderColor } : {}),
            };
          };
          commit({ ...doc, annotations: doc.annotations.map((x) => (x.type === 'marker' ? apply(x) : x)) }, 'Apply marker shape to all', 'markers:apply-all');
        }
        return;
      }
      const counter = (patch as { counter?: MarkerAnnotation['counter'] }).counter;
      if (kind === 'marker' && counter) {
        if (doc.annotations.some((x) => x.type === 'marker' && (x.counter ?? 'number') !== counter)) {
          commit({ ...doc, annotations: doc.annotations.map((x) => (x.type === 'marker' ? { ...x, counter } : x)) }, 'Change marker counting', 'markers:counter');
        }
        return;
      }
      if (!selected || styleKindFor(selected.type) !== kind || selected.lock) return;
      const { bends, curve, ...rest } = patch as { bends?: number; curve?: boolean } & Record<string, unknown>;
      let updated = { ...selected, ...rest } as Annotation;
      if ((updated.type === 'line' || updated.type === 'arrow') && typeof bends === 'number' && (bends !== (updated.bends?.length ?? 0) || curve)) {
        // Curve points sit on the line until dragged; only the curved presets bend it.
        updated = { ...updated, bends: defaultBends(updated, bends, curve === true) };
      }
      // Callouts grow to fit whatever changed (text, title, fonts, design).
      if (updated.type === 'callout') updated = fitCallout(updated, 'design' in patch);
      replaceAnnotation(updated, `Edit ${describeAnnotation(selected).toLowerCase()}`, `${selected.id}:${key}`);
    },
    [selected, replaceAnnotation, doc, commit],
  );

  const setLock = useCallback(
    (a: Annotation, lock: 'all' | 'move' | null) => {
      const name = describeAnnotation(a).toLowerCase();
      replaceAnnotation({ ...a, lock: lock ?? undefined } as Annotation, lock === 'all' ? `Lock ${name}` : lock === 'move' ? `Move only ${name}` : `Unlock ${name}`);
    },
    [replaceAnnotation],
  );

  const removeAnnotation = useCallback(
    (a: Annotation) => {
      if (a.lock) {
        toast.info('This annotation is locked', 'Unlock it first: right-click it, or use the lock in the Layers panel.');
        return;
      }
      commit({ ...doc, annotations: doc.annotations.filter((x) => x.id !== a.id) }, `Remove ${describeAnnotation(a).toLowerCase()}`);
      if (selectedId === a.id) setSelectedId(null);
    },
    [doc, commit, selectedId, toast],
  );

  const deleteSelected = useCallback(() => {
    if (selected) removeAnnotation(selected);
  }, [selected, removeAnnotation]);

  const moveLayer = useCallback(
    (a: Annotation, dir: 1 | -1) => {
      const i = doc.annotations.findIndex((x) => x.id === a.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= doc.annotations.length) return;
      const list = [...doc.annotations];
      [list[i], list[j]] = [list[j]!, list[i]!];
      commit({ ...doc, annotations: list }, `${dir > 0 ? 'Bring forward' : 'Send backward'} ${describeAnnotation(a).toLowerCase()}`);
    },
    [doc, commit],
  );

  const setWatermark = useCallback((w: Watermark | null, key: string) => {
    commit({ ...doc, watermark: w }, w ? (doc.watermark ? 'Edit watermark' : 'Add watermark') : 'Remove watermark', w && doc.watermark ? key : undefined);
    if (w) savePrefs({ watermark: w });
  }, [doc, commit, savePrefs]);
  const setFrame = useCallback((f: Frame | null, key: string) => {
    commit({ ...doc, frame: f }, f ? (doc.frame ? 'Edit frame' : 'Add frame') : 'Remove frame', f && doc.frame ? key : undefined);
    if (f) savePrefs({ frame: f });
    if (!f || !doc.frame || key.startsWith('frame:toggle') || key === 'frame:browser' || key === 'frame:padding') requestAnimationFrame(() => workspace.current?.fit());
  }, [doc, commit, savePrefs]);

  const onTextCommit = useCallback(
    (state: TextEditState, text: string) => {
      setTextEdit(null);
      const a = state.annotation;
      if (a.type === 'callout') {
        if (text !== a.text) replaceAnnotation(fitCallout({ ...a, text }), 'Edit callout text');
        setSelectedId(a.id);
        return;
      }
      const trimmed = text.replace(/\s+$/, '');
      if (!trimmed && !a.header?.text && !a.footer?.text) {
        if (!state.isNew) commit({ ...doc, annotations: doc.annotations.filter((x) => x.id !== a.id) }, 'Remove text');
        return;
      }
      const next = { ...a, text: trimmed };
      if (state.isNew) commit({ ...doc, annotations: [...doc.annotations, next] }, 'Add text');
      else if (trimmed !== a.text) replaceAnnotation(next, 'Edit text');
      setSelectedId(next.id);
    },
    [doc, commit, replaceAnnotation],
  );

  async function insertImage(file: Blob | undefined) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, (doc.width * 0.5) / bitmap.width, (doc.height * 0.5) / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      const c = workspace.current?.viewportCenter() ?? { x: doc.width / 2, y: doc.height / 2 };
      const a: Annotation = { id: annotationId(), type: 'image', bitmap, x: Math.max(0, c.x - w / 2), y: Math.max(0, c.y - h / 2), w, h, opacity: 1 };
      commit({ ...doc, annotations: [...doc.annotations, a] }, 'Insert image');
      setToolState('select');
      setSelectedId(a.id);
    } catch {
      toast.error('Could not open that image');
    }
  }

  /* --------------------------------- export --------------------------------- */
  const render = useCallback(async (fmt: ImageFormat = outFormat) => exportDocument(doc, fmt, format === 'original' ? Math.max(quality, 0.95) : quality), [doc, outFormat, format, quality]);

  const persistEdits = useCallback(
    async (blob: Blob, patch: Partial<CaptureRecord> = {}) => {
      if (sameDoc(doc, savedDoc) && !patch.downloadId && !patch.name) return;
      const png = blob.type === 'image/png' ? blob : await exportDocument(doc, 'png', 1);
      const changed = !sameDoc(doc, savedDoc);
      const bitmap = changed ? await createImageBitmap(png) : null;
      // Every image keeps its original (Compare / Restore original in both editors).
      if (changed) await keepOriginal(record.id);
      const next = await updateCapture(
        record.id,
        {
          ...patch,
          ...(bitmap ? { mimeType: 'image/png', width: bitmap.width, height: bitmap.height, thumbnail: (await generateImageThumbnail(png)) ?? record.thumbnail } : {}),
          edited: changed || record.edited,
        },
        changed ? png : undefined,
      );
      bitmap?.close();
      setRecord(next);
      setSavedDoc(doc);
      onSaved?.(next);
      broadcast({ target: 'broadcast', type: 'history/changed' });
    },
    [doc, savedDoc, record],
  );

  const download = useCallback(
    async (saveAs: boolean): Promise<boolean> => {
      setTextEdit(null);
      setBusy(true);
      setAction(saveAs ? 'saveas' : 'download');
      const ext = outFormat === 'jpeg' ? 'jpg' : outFormat;
      setWorking(`Preparing ${filename || 'screenshot'}.${ext}…`);
      try {
        // Nothing drawn, framed or changed: the stored PNG is the result (no re-encoding, instant).
        // Nothing changed and already in the wanted format: the stored file itself (no re-encoding: a
        // 6 MB JPEG stays 6 MB instead of growing to 18 MB, or 40 MB as PNG).
        const untouched = sameDoc(doc, savedDoc) && doc.annotations.length === 0 && !doc.frame && !doc.watermark && !doc.filters
          && doc.width === record.width && doc.height === record.height && record.mimeType === `image/${outFormat}`
          && (format === 'original' || outFormat === 'png' || quality >= 0.95);
        const blob = (untouched ? await getCaptureBlob(record.id).catch(() => undefined) : undefined) ?? (await render());
        setWorking(null);
        const id = await downloadBlob(blob, `${filename || 'screenshot'}.${ext}`, {
          saveAs: saveAs || settings.storage.askWhereToSave,
          subfolder: settings.storage.subfolder,
        });
        // The file is already saved: storage trouble only means Recent captures is not updated.
        // The stored picture keeps its own ending (a JPEG download does not rename it).
        const own = /\.[a-z0-9]+$/i.exec(record.name)?.[0] ?? '.png';
        const kept = await persistEdits(blob, { downloadId: id, name: `${filename || 'screenshot'}${own}` }).then(() => true, (err: unknown) => {
          if (!isStorageUnavailable(err)) throw err;
          return false;
        });
        if (kept) toast.success(saveAs || settings.storage.askWhereToSave ? 'Saved' : 'Downloaded', `${filename}.${ext}`);
        else toast.info('Downloaded', `${filename}.${ext} is saved. Pixora’s storage could not be opened, so Recent captures was not updated — restart Chrome.`);
        return true;
      } catch (err) {
        const info = errorInfoOf(err);
        if (info.code !== 'cancelled') toast.error(info);
        return false;
      } finally {
        setWorking(null);
        setAction(null);
        setBusy(false);
      }
    },
    [render, format, outFormat, quality, filename, settings, persistEdits, toast, doc, savedDoc, record],
  );

  const copy = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setAction('copy');
    setWorking('Copying the image…');
    try {
      const blob = await render('png');
      await copyImageToClipboard(blob);
      setWorking(null);
      toast.success('Copied to clipboard');
      // Saving the edits to Recent captures happens afterwards, without holding up the copy.
      void persistEdits(blob).catch((err: unknown) => {
        if (!isStorageUnavailable(err)) toast.error(errorInfoOf(err));
      });
      return true;
    } catch (err) {
      toast.error(errorInfoOf(err));
      return false;
    } finally {
      setWorking(null);
      setAction(null);
      setBusy(false);
    }
  }, [render, persistEdits, toast]);

  const openCollage = useCallback(async () => {
    setBusy(true);
    try {
      // The collage starts with the current image, including its annotations.
      onCollage?.({ blob: await exportDocument(doc, 'png', 1), name: record.name });
    } catch (err) {
      toast.error(errorInfoOf(err));
    } finally {
      setBusy(false);
    }
  }, [doc, onCollage, record.name, toast]);

  /** Word document with the finished image (page orientation follows the image). */
  const exportWord = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setAction('word');
    setWorking('Preparing the Word document…');
    try {
      const png = await exportDocument(doc, 'png', 1);
      const bmp = await createImageBitmap(png);
      const blocks = [
        ...(record.sourceTitle || record.sourceUrl ? [{ kind: 'text' as const, text: [record.sourceTitle, record.sourceUrl].filter(Boolean).join(' · '), small: true, muted: true }] : []),
        { kind: 'image' as const, data: new Uint8Array(await png.arrayBuffer()), type: 'png' as const, width: bmp.width, height: bmp.height, alt: filename || 'Screenshot' },
      ];
      const orientation = bmp.width > bmp.height ? 'landscape' : 'portrait';
      bmp.close();
      const bytes = buildDocx(blocks, { paper: 'a4', orientation, margin: 36, title: filename || 'Screenshot' });
      const name = `${filename || 'screenshot'}.docx`;
      await downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: DOCX_MIME }), name, { saveAs: settings.storage.askWhereToSave, subfolder: settings.storage.subfolder });
      setWorking(null);
      toast.success('Word document saved', name);
      return true;
    } catch (err) {
      const info = errorInfoOf(err);
      if (info.code !== 'cancelled') toast.error(info);
      return false;
    } finally {
      setWorking(null);
      setAction(null);
      setBusy(false);
    }
  }, [doc, filename, record.sourceTitle, record.sourceUrl, settings.storage, toast]);

  /** OCR on the image itself (not the frame), so match boxes are in document coordinates. */
  const findSensitive = useCallback(async () => {
    setScan({ open: true, matches: null, progress: 0, error: null });
    try {
      const canvas = new OffscreenCanvas(doc.width, doc.height);
      canvas.getContext('2d')!.drawImage(doc.base, 0, 0);
      const { detectSensitive, excludeHidden } = await import('@/screenshot/services/sensitive-detect');
      const found = await detectSensitive(await canvas.convertToBlob({ type: 'image/png' }), (p) => setScan((s) => ({ ...s, progress: p })));
      // Text already under a blur / pixelate / mask is not listed again.
      const covers = doc.annotations.filter((a) => (a.type === 'blur' || a.type === 'pixelate' || a.type === 'mask') && !a.hidden) as Array<{ x: number; y: number; w: number; h: number }>;
      const { visible, hidden } = excludeHidden(found, covers.map((r) => ({ x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) })));
      setScan((s) => ({ ...s, matches: visible, hidden }));
    } catch (err) {
      const info = errorInfoOf(err);
      setScan((s) => ({ ...s, error: `${info.title}. ${info.recovery ?? ''}` }));
    }
  }, [doc]);

  const runOcr = useCallback(async () => {
    setOcr({ open: true, text: null, progress: 0, status: '', error: null });
    try {
      const { recognizeText } = await import('@/screenshot/services/ocr-service');
      const blob = await exportDocument(doc, 'png', 1);
      const res = await recognizeText(blob, (progress, status) => setOcr((o) => ({ ...o, progress, status: status.replace(/^\w/, (c) => c.toUpperCase()) })));
      setOcr((o) => ({ ...o, text: res.text }));
    } catch (err) {
      const info = errorInfoOf(err);
      setOcr((o) => ({ ...o, error: `${info.title}. ${info.recovery ?? ''}` }));
    }
  }, [doc]);

  // URL-driven actions: ?ocr=1 (Take Screenshot & Extract Text), ?autosave=1, ?copy=1
  useEffect(() => {
    if (initialActions.current) return;
    initialActions.current = true;
    // One-time requests (Take screenshot & extract text, autosave, copy) are used up on the first
    // image opened: opening a capture again later (Recent captures, another image of the set, a
    // reload) doesn't run them again.
    const fromUrl = !urlActionsUsed;
    urlActionsUsed = true;
    const wantOcr = (fromUrl && params.get('ocr') === '1') || (record.ocrRequested && !ocrDone.has(record.id));
    if (record.ocrRequested) {
      ocrDone.add(record.id);
      void updateCapture(record.id, { ocrRequested: false }).catch(() => undefined);
    }
    if (wantOcr) void runOcr();
    if (fromUrl && ['ocr', 'autosave', 'copy'].some((k) => params.has(k))) {
      const q = new URLSearchParams(location.search);
      ['ocr', 'autosave', 'copy'].forEach((k) => q.delete(k));
      history.replaceState(null, '', `?${q.toString()}`);
    }
    if (!fromUrl) return;
    if (params.get('autosave') === '1') void download(false);
    if (params.get('copy') === '1') {
      void render('png')
        .then(copyImageToClipboard)
        .then(() => toast.success('Copied to clipboard'))
        .catch(() => toast.info('Click “Copy” to copy the screenshot', 'Chrome only allows clipboard access from a focused page.'));
    }
  }, [params, record.ocrRequested, runOcr, download, render, toast]);

  // Warn about unsaved annotations when closing the tab.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!sameDoc(doc, savedDoc)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [doc, savedDoc]);

  /* ----------------------------- object operations ----------------------------- */
  const addAnnotations = useCallback(
    (items: Annotation[], label: string) => {
      if (!items.length) return;
      commit({ ...doc, annotations: [...doc.annotations, ...items] }, label);
      setSelectedId(items[items.length - 1]!.id);
      // Only the new object is highlighted: a marked area (copied from) lets go.
      setArea(null);
    },
    [doc, commit],
  );

  const duplicate = useCallback(
    (a: Annotation, offset = 16) => {
      const copy = { ...translate(a, offset, offset), id: annotationId(), lock: undefined } as Annotation;
      if (copy.type === 'marker') copy.n = doc.annotations.reduce((m, x) => (x.type === 'marker' ? Math.max(m, x.n) : m), 0) + 1;
      addAnnotations([copy], `Duplicate ${describeAnnotation(a).toLowerCase()}`);
    },
    [doc.annotations, addAnnotations],
  );

  /* ------------------------- floating selection bar ------------------------- */
  const moveLayerTo = useCallback(
    (a: Annotation, to: LayerMove) => {
      if (to === 'forward' || to === 'backward') return moveLayer(a, to === 'forward' ? 1 : -1);
      const rest = doc.annotations.filter((x) => x.id !== a.id);
      const list = to === 'front' ? [...rest, a] : [a, ...rest];
      if (list.every((x, i) => x === doc.annotations[i])) return;
      commit({ ...doc, annotations: list }, `${to === 'front' ? 'Bring to front' : 'Send to back'} ${describeAnnotation(a).toLowerCase()}`);
    },
    [doc, commit, moveLayer],
  );
  const alignTo = useCallback(
    (a: Annotation, to: AlignTo) => {
      const b = getBounds(a);
      const dx = to === 'left' ? -b.x : to === 'center' ? doc.width / 2 - (b.x + b.w / 2) : to === 'right' ? doc.width - (b.x + b.w) : 0;
      const dy = to === 'top' ? -b.y : to === 'middle' ? doc.height / 2 - (b.y + b.h / 2) : to === 'bottom' ? doc.height - (b.y + b.h) : 0;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      replaceAnnotation(translate(a, dx, dy), `Align ${describeAnnotation(a).toLowerCase()} ${to}`);
    },
    [doc.width, doc.height, replaceAnnotation],
  );
  const [hasClipboard, setHasClipboard] = useState(false);

  /* ------------------------------ marked area ------------------------------ */
  // A new picture size (crop, rotate, undo…) makes the marked area meaningless.
  useEffect(() => setArea(null), [doc.width, doc.height]);
  /** The marked part as a picture annotation where it is now (annotations included). */
  // Drawn straight to a bitmap (no PNG encoding), so Duplicate is instant even on big pictures.
  const areaPiece = useCallback(async (r: Rect): Promise<{ canvas: OffscreenCanvas; piece: Annotation }> => {
    const canvas = await renderArea(doc, r);
    const bitmap = await createImageBitmap(canvas);
    return { canvas, piece: { id: annotationId(), type: 'image', bitmap, x: r.x, y: r.y, w: r.w, h: r.h, opacity: 1 } };
  }, [doc]);
  const copyArea = useCallback(async (r: Rect): Promise<boolean> => {
    try {
      const { canvas, piece } = await areaPiece(r);
      // Paste (Ctrl+V or the right-click menu) puts the part back as a picture you can move; it
      // is on the computer's clipboard too, for other apps.
      clipboard.current = piece;
      setHasClipboard(true);
      await canvas.convertToBlob({ type: 'image/png' }).then(copyImageToClipboard).catch(() => undefined);
      return true;
    } catch (err) {
      toast.error(errorInfoOf(err));
      return false;
    }
  }, [areaPiece, toast]);
  const areaActions = useMemo<AreaActions | null>(() => {
    if (!area || area.w < 3 || area.h < 3) return null;
    const r = area;
    /**
     * In the video editor the frame itself can't change: Delete / Cut / Crop become annotations
     * (covering the area, or everything outside it), so they appear on the timeline with a start
     * and an end like any other annotation.
     */
    const asAnnotation = (role: 'delete' | 'cut' | 'crop') => {
      setArea(null);
      addAnnotations([{
        id: annotationId(), type: 'mask', role, x: r.x, y: r.y, w: r.w, h: r.h, intensity: 0, opacity: 1,
        color: role === 'crop' ? '#000000' : '#ffffff', ...(role === 'crop' ? { invert: true } : {}),
      } as Annotation], role === 'crop' ? `Crop to ${r.w} × ${r.h}` : `${role === 'cut' ? 'Cut' : 'Delete'} ${r.w} × ${r.h} area`);
    };
    const remove = (label: 'Delete' | 'Cut') => {
      if (videoMode) { asAnnotation(label === 'Cut' ? 'cut' : 'delete'); return; }
      setArea(null);
      void geometry(() => applyClearArea(doc, r), `${label} ${r.w} × ${r.h} area`, { keepView: true });
    };
    return {
      copy: () => void copyArea(r).then((ok) => ok && toast.success('Area copied', 'Press Ctrl+V or right-click › Paste to place it as a picture.')),
      duplicate: () => {
        setArea(null);
        void areaPiece(r)
          .then(({ piece }) => addAnnotations([translate(piece, 24, 24)], 'Duplicate area'))
          .catch((err: unknown) => toast.error(errorInfoOf(err)));
      },
      cut: () => void copyArea(r).then((ok) => { if (ok) { remove('Cut'); toast.success('Area cut', 'Press Ctrl+V or right-click › Paste to place it as a picture.'); } }),
      remove: () => remove('Delete'),
      ...(videoMode ? {} : {
        fill: () => {
          setArea(null);
          const mask = newMaskCanvas(doc.width, doc.height);
          const m = mask.getContext('2d')!;
          m.fillStyle = '#fff';
          m.fillRect(r.x, r.y, r.w, r.h);
          // The area shows that it is being worked on until the new picture is in.
          setBusyArea({ rect: r, text: 'Removing content…' });
          void fillWithBackground(doc, mask, { strength: 100, feather: 2, preserve: false }, `Remove content from ${r.w} × ${r.h} area`).finally(() => setBusyArea(null));
        },
      }),
      crop: () => {
        if (videoMode) { asAnnotation('crop'); return; }
        setArea(null);
        void geometry(() => applyCrop(doc, r), `Crop to ${r.w} × ${r.h}`);
      },
      clear: () => setArea(null),
    };
  }, [area, doc, geometry, copyArea, areaPiece, addAnnotations, toast, videoMode, fillWithBackground]);
  /** A part of the picture being worked on (shown over it with a spinner). */
  const [busyArea, setBusyArea] = useState<{ rect: Rect; text: string } | null>(null);
  const areaRef = useRef(areaActions);
  areaRef.current = areaActions;

  const selectionActions = useMemo<SelectionActions | null>(() => {
    if (!selected) return null;
    const kind = styleKindFor(selected.type);
    const textual = (selected.type === 'text' || selected.type === 'callout') && kind && !selected.lock;
    return {
      menu: () => menusRef.current.one(),
      ...(selected.lock ? { locked: selected.lock, unlock: () => (selected.id === moveOnlyId && !found?.lock ? setMoveOnlyId(null) : setLock(selected, null)) } : {}),
      copy: () => {
        clipboard.current = selected;
        setHasClipboard(true);
        toast.info('Object copied', 'Press Ctrl+V or use Paste to add a copy.');
      },
      paste: hasClipboard && clipboard.current
        ? () => {
            if (!clipboard.current) return;
            duplicate(clipboard.current, 24);
            clipboard.current = translate(clipboard.current, 24, 24);
          }
        : null,
      duplicate: () => duplicate(selected),
      remove: () => removeAnnotation(selected),
      layer: (to) => moveLayerTo(selected, to),
      ...(selected.lock === 'all' ? {} : { align: (to: AlignTo) => alignTo(selected, to) }),
      text: textual
        ? {
            size: selected.fontSize,
            bold: !!selected.bold,
            italic: !!selected.italic,
            setSize: (n) => onStyleChange(kind, { fontSize: n }, 'bar:fontSize'),
            toggleBold: () => onStyleChange(kind, { bold: !selected.bold }, 'bar:bold'),
            toggleItalic: () => onStyleChange(kind, { italic: !selected.italic }, 'bar:italic'),
          }
        : undefined,
    };
  }, [selected, found, moveOnlyId, hasClipboard, duplicate, removeAnnotation, moveLayerTo, alignTo, onStyleChange, toast, setLock]);

  /* ------------------------------ several objects ----------------------------- */
  const multiSelected = useMemo(() => doc.annotations.filter((a) => multiIds.includes(a.id)), [doc.annotations, multiIds]);
  const addCopies = useCallback((list: readonly Annotation[], offset: number, label: string) => {
    let lastMarker = doc.annotations.reduce((m, x) => (x.type === 'marker' ? Math.max(m, x.n) : m), 0);
    const copies = list.map((a) => {
      const copy = { ...translate(a, offset, offset), id: annotationId(), lock: undefined } as Annotation;
      if (copy.type === 'marker') copy.n = ++lastMarker;
      return copy;
    });
    commit({ ...doc, annotations: [...doc.annotations, ...copies] }, `${label} ${copies.length} objects`);
    setSelectedId(null);
    setArea(null);
    setMultiIds(copies.map((a) => a.id));
  }, [doc, commit]);
  const pasteMany = useCallback(() => {
    addCopies(manyClipboard.current, 24, 'Paste');
    manyClipboard.current = manyClipboard.current.map((a) => translate(a, 24, 24));
  }, [addCopies]);
  const many = {
    copy: () => {
      manyClipboard.current = multiSelected;
      clipboard.current = null;
      setHasClipboard(true);
      toast.info(`${multiSelected.length} objects copied`, 'Press Ctrl+V or use Paste to add copies.');
    },
    duplicate: () => addCopies(multiSelected, 16, 'Duplicate'),
    remove: () => {
      // Locked annotations stay.
      const gone = multiSelected.filter((a) => !a.lock);
      if (!gone.length) return;
      commit({ ...doc, annotations: doc.annotations.filter((a) => !gone.some((g) => g.id === a.id)) }, `Delete ${gone.length} objects`);
      setMultiIds([]);
    },
    nudge: (dx: number, dy: number) => commit({ ...doc, annotations: doc.annotations.map((a) => (multiIds.includes(a.id) && a.lock !== 'all' ? translate(a, dx, dy) : a)) }, `Move ${multiSelected.length} objects`, 'many:nudge'),
  };
  const manyRef = useRef(many);
  manyRef.current = many;
  const multiActions: SelectionActions | null = multiIds.length > 1 ? {
    count: multiIds.length,
    menu: () => menusRef.current.many(),
    copy: many.copy,
    paste: clipboard.current ? () => { if (clipboard.current) duplicate(clipboard.current, 24); } : manyClipboard.current.length ? pasteMany : null,
    duplicate: many.duplicate,
    remove: many.remove,
  } : null;

  /* --------------------------- right-click menus --------------------------- */
  /** Menu for an object on the canvas (it is selected first). */
  /**
   * Cutting pen / highlighter strokes with a shape: offered when several objects are selected — the
   * selected strokes are cut with the selected shape (the highest one when there are several).
   * "Undo cut" is also offered for a single cut stroke.
   */
  const cutItems = (picked: readonly Annotation[]): MenuItem[] => {
    const shape = [...picked].reverse().find((x) => isCutShape(x)) as BoxAnnotation | undefined;
    const strokes = picked.filter((x) => isStroke(x) && !x.lock) as StrokeAnnotation[];
    const cut = strokes.filter((x) => x.clip);
    const canCut = picked.length > 1 && Boolean(shape) && strokes.length > 0;
    const what = strokes.some((x) => x.type === 'highlighter') ? 'highlight' : 'drawing';
    const apply = (keep: 'inside' | 'outside' | null, list: StrokeAnnotation[], label: string) => {
      const ids = new Set(list.map((x) => x.id));
      // The shape has done its job: it goes (unless locked). Ctrl+Z brings both back.
      const used = keep && shape && !shape.lock ? shape.id : null;
      commit({
        ...doc,
        annotations: doc.annotations
          .filter((x) => x.id !== used)
          .map((x) => (ids.has(x.id) && isStroke(x) ? ({ ...x, clip: keep && shape ? clipFromShape(shape, keep) : undefined } as Annotation) : x)),
      }, label);
      if (used) setMultiIds([]);
    };
    return [
      ...(canCut ? [
        { id: 'cut-out', label: `Cut the ${what} away inside the shape`, icon: <Scissors size={14} />, separatorBefore: true, onSelect: () => apply('outside', strokes, `Cut ${what} with shape`) },
        { id: 'cut-in', label: `Keep the ${what} only inside the shape`, icon: <Scissors size={14} />, onSelect: () => apply('inside', strokes, `Cut ${what} to shape`) },
      ] : []),
      ...(cut.length ? [{ id: 'cut-undo', label: 'Undo cut', icon: <Undo2 size={14} />, separatorBefore: !canCut, onSelect: () => apply(null, cut, `Undo cut of ${what}`) }] : []),
    ];
  };

  /** Crops the picture to an object's box (kept inside the picture). */
  const cropToObject = (a: Annotation) => {
    const b = getBounds(a);
    const x = Math.max(0, Math.floor(b.x));
    const y = Math.max(0, Math.floor(b.y));
    const r = { x, y, w: Math.min(doc.width, Math.ceil(b.x + b.w)) - x, h: Math.min(doc.height, Math.ceil(b.y + b.h)) - y };
    if (r.w < 2 || r.h < 2) { toast.error('This object is outside the picture.'); return; }
    setSelectedId(null);
    void geometry(() => applyCrop(doc, r), `Crop to ${describeAnnotation(a).toLowerCase()}`);
  };

  /** Right-click on the canvas while an area is marked: what the area bar offers. */
  const areaMenu = (act: AreaActions): MenuItem[] => [
    { id: 'paste', label: 'Paste', description: 'Ctrl+V', icon: <ClipboardPaste size={14} />, disabled: !clipboard.current, onSelect: () => { if (clipboard.current) { duplicate(clipboard.current, 24); clipboard.current = translate(clipboard.current, 24, 24); } } },
    { id: 'area-cut', label: 'Cut area', description: 'Ctrl+X', icon: <Scissors size={14} />, separatorBefore: true, onSelect: act.cut },
    { id: 'area-copy', label: 'Copy area', description: 'Ctrl+C', icon: <Copy size={14} />, onSelect: act.copy },
    { id: 'area-dup', label: 'Duplicate area', description: 'Ctrl+D', icon: <CopyPlus size={14} />, onSelect: act.duplicate },
    { id: 'area-crop', label: 'Crop to area', description: 'Enter', icon: <CropIcon size={14} />, separatorBefore: true, onSelect: act.crop },
    ...(act.fill ? [{ id: 'area-fill', label: 'Remove content (fill with background)', icon: <Sparkles size={14} />, onSelect: act.fill }] : []),
    { id: 'area-del', label: 'Delete area', description: 'Del', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: act.remove },
    { id: 'area-clear', label: 'Clear selection', description: 'Esc', icon: <X size={14} />, onSelect: act.clear },
  ];

  const objectMenu = (a: Annotation): MenuItem[] => {
    const textual = a.type === 'text' || a.type === 'callout';
    return [
      ...(textual ? [{ id: 'edit', label: 'Edit text', icon: <Pencil size={14} />, disabled: Boolean(a.lock), onSelect: () => setTextEdit({ annotation: a as TextEditState['annotation'], isNew: false }) }] : []),
      { id: 'cut', label: 'Cut', description: 'Ctrl+X', icon: <Scissors size={14} />, separatorBefore: textual, disabled: Boolean(a.lock), onSelect: () => { clipboard.current = a; setHasClipboard(true); removeAnnotation(a); } },
      { id: 'copy', label: 'Copy', description: 'Ctrl+C', icon: <Copy size={14} />, onSelect: () => { clipboard.current = a; setHasClipboard(true); } },
      { id: 'paste', label: 'Paste', description: 'Ctrl+V', icon: <ClipboardPaste size={14} />, disabled: !clipboard.current, onSelect: () => { if (clipboard.current) { duplicate(clipboard.current, 24); clipboard.current = translate(clipboard.current, 24, 24); } } },
      { id: 'dup', label: 'Duplicate', description: 'Ctrl+D', icon: <CopyPlus size={14} />, onSelect: () => duplicate(a) },
      // The picture cropped to this object's box (the object stays, now filling the picture).
      ...(videoMode ? [] : [{ id: 'crop', label: 'Crop to this object', icon: <CropIcon size={14} />, onSelect: () => cropToObject(a) }]),
      ...cutItems([a]),
      ...(a.lock ? [{ id: 'unlock', label: 'Unlock', icon: <LockOpen size={14} />, separatorBefore: true, onSelect: () => setLock(a, null) }] : []),
      ...(!a.lock ? [{ id: 'move-only', label: 'Move only', icon: <Move size={14} />, separatorBefore: true, onSelect: () => { setSelectedId(a.id); setMoveOnlyId(a.id); } }] : []),
      ...(a.lock !== 'all' ? [{ id: 'lock', label: 'Lock', icon: <Lock size={14} />, onSelect: () => setLock(a, 'all') }] : []),
      { id: 'front', label: 'Bring to front', icon: <BringToFront size={14} />, separatorBefore: true, onSelect: () => moveLayerTo(a, 'front') },
      { id: 'fwd', label: 'Bring forward', icon: <ArrowUp size={14} />, onSelect: () => moveLayerTo(a, 'forward') },
      { id: 'back', label: 'Send backward', icon: <ArrowDown size={14} />, onSelect: () => moveLayerTo(a, 'backward') },
      { id: 'toback', label: 'Send to back', icon: <SendToBack size={14} />, onSelect: () => moveLayerTo(a, 'back') },
      { id: 'align-left', label: 'Align left', icon: <AlignStartVertical size={14} />, separatorBefore: true, disabled: a.lock === 'all', onSelect: () => alignTo(a, 'left') },
      { id: 'centre', label: 'Centre on image', icon: <AlignCenter size={14} />, disabled: a.lock === 'all', onSelect: () => { alignTo(a, 'center'); } },
      { id: 'align-right', label: 'Align right', icon: <AlignEndVertical size={14} />, disabled: a.lock === 'all', onSelect: () => alignTo(a, 'right') },
      { id: 'align-top', label: 'Align top', icon: <AlignStartHorizontal size={14} />, disabled: a.lock === 'all', onSelect: () => alignTo(a, 'top') },
      { id: 'align-middle', label: 'Align middle', icon: <AlignCenterHorizontal size={14} />, disabled: a.lock === 'all', onSelect: () => alignTo(a, 'middle') },
      { id: 'align-bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={14} />, disabled: a.lock === 'all', onSelect: () => alignTo(a, 'bottom') },
      { id: 'del', label: 'Delete', description: 'Del', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, disabled: Boolean(a.lock), onSelect: () => removeAnnotation(a) },
    ];
  };
  /** Menu for several selected objects (right-click on one of them, or the bar's ⋯). */
  const multiMenu = (): MenuItem[] => [
    { id: 'copy', label: 'Copy', description: 'Ctrl+C', icon: <Copy size={14} />, onSelect: () => manyRef.current.copy() },
    { id: 'paste', label: 'Paste', description: 'Ctrl+V', icon: <ClipboardPaste size={14} />, disabled: !clipboard.current && !manyClipboard.current.length, onSelect: () => (clipboard.current ? duplicate(clipboard.current, 24) : pasteMany()) },
    { id: 'dup', label: 'Duplicate', description: 'Ctrl+D', icon: <CopyPlus size={14} />, onSelect: () => manyRef.current.duplicate() },
    ...cutItems(multiSelected),
    { id: 'del', label: 'Delete', description: 'Del', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => manyRef.current.remove() },
  ];
  menusRef.current = { one: () => (selectedRef.current ? objectMenu(selectedRef.current) : []), many: multiMenu };

  /** Menu for the image / the rest of the editor. */
  const canvasMenu = (): MenuItem[] => [
    { id: 'paste', label: 'Paste', description: 'Ctrl+V', icon: <ClipboardPaste size={14} />, disabled: !clipboard.current, onSelect: () => { if (clipboard.current) { duplicate(clipboard.current, 24); clipboard.current = translate(clipboard.current, 24, 24); } } },
    ...(videoMode ? [] : [
      { id: 'undo', label: 'Undo', description: 'Ctrl+Z', icon: <Undo2 size={14} />, disabled: !canUndo(hist), separatorBefore: true, onSelect: () => dispatch({ type: 'undo' }) },
      { id: 'redo', label: 'Redo', description: 'Ctrl+Y', icon: <Redo2 size={14} />, disabled: !canRedo(hist), onSelect: () => dispatch({ type: 'redo' }) },
    ]),
    { id: 'copyimg', label: 'Copy image', icon: <Copy size={14} />, separatorBefore: true, onSelect: () => void copy() },
    { id: 'download', label: 'Download', description: 'Ctrl+S', icon: <Download size={14} />, onSelect: () => void download(false) },
    { id: 'fit', label: 'Fit to screen', description: 'Ctrl+0', icon: <Maximize size={14} />, separatorBefore: true, onSelect: () => workspace.current?.fit() },
    { id: 'keys', label: 'Keyboard shortcuts', description: '?', icon: <Keyboard size={14} />, onSelect: () => setShortcutsOpen(true) },
  ];
  // Menus only where they belong (the canvas); elsewhere a right click shows nothing.
  const pageMenu = usePageContextMenu(noMenu, { global: !embedded });

  /** Bigger / smaller: stroke width, font size or object size, depending on the type. */
  const stepSize = useCallback(
    (dir: 1 | -1) => {
      const grow = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v * (dir > 0 ? 1.15 : 1 / 1.15) + dir)));
      if (selected) {
        if (selected.lock) return;
        let next: Annotation | null = null;
        if ('width' in selected && typeof selected.width === 'number') {
          next = { ...selected, width: grow(selected.width, 1, 600) } as Annotation;
        } else if (selected.type === 'text' || selected.type === 'callout') {
          next = { ...selected, fontSize: grow(selected.fontSize, 6, 600) };
          if (next.type === 'callout') next = fitCallout(next);
        } else if (selected.type === 'marker' || selected.type === 'sticker' || selected.type === 'cursor') {
          next = { ...selected, size: grow(selected.size, 8, 1000) };
        } else if (selected.type === 'blur' || selected.type === 'pixelate') {
          next = { ...selected, intensity: grow(selected.intensity, 2, 200) };
        }
        if (next) replaceAnnotation(next, `Resize ${describeAnnotation(selected).toLowerCase()}`, `${selected.id}:size`);
        return;
      }
      const kind = styleKindFor(tool);
      if (!kind) return;
      setToolStyles((st) => {
        const cur = st[kind] as Record<string, unknown>;
        const key = typeof cur.width === 'number' ? 'width' : typeof cur.fontSize === 'number' ? 'fontSize' : typeof cur.size === 'number' ? 'size' : typeof cur.intensity === 'number' ? 'intensity' : null;
        if (!key) return st;
        return { ...st, [kind]: { ...cur, [key]: grow(cur[key] as number, 1, 400) } };
      });
    },
    [selected, tool, replaceAnnotation],
  );

  // Paste: images from the system clipboard become image objects; otherwise a copied annotation.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      const piece = clipboard.current;
      if (file && piece?.type === 'image') {
        // The computer's clipboard holds the area copied here (same size): paste that piece.
        e.preventDefault();
        void createImageBitmap(file).then((b) => {
          const same = b.width === Math.round(piece.w) && b.height === Math.round(piece.h);
          b.close();
          if (same) {
            duplicate(piece, 24);
            clipboard.current = translate(piece, 24, 24);
          } else void insertImage(file);
        }, () => void insertImage(file));
        return;
      }
      if (file) {
        e.preventDefault();
        void insertImage(file);
        return;
      }
      if (clipboard.current) {
        e.preventDefault();
        duplicate(clipboard.current, 24);
        clipboard.current = translate(clipboard.current, 24, 24);
      } else if (manyClipboard.current.length) {
        e.preventDefault();
        pasteMany();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  /* ---------------------------- keyboard shortcuts --------------------------- */
  const multiActive = useRef(false);
  multiActive.current = multiIds.length > 1;
  useEffect(() => {
    const keys: Record<string, Tool> = {
      v: 'select', p: 'pen', g: 'highlighter', r: 'rect', o: 'ellipse', a: 'arrow', l: 'arrow', t: 'text', k: 'callout', b: 'blur', m: 'mask',
      x: 'pixelate', n: 'marker', s: 'sticker', u: 'cursor', e: 'eraser', i: 'eraseImage', c: 'crop', h: 'hand', w: 'watermark', f: 'frame',
      q: 'removeObject', j: 'removeBg', y: 'filters',
    };
    if (videoMode) { delete keys.c; delete keys.f; delete keys.i; delete keys.q; delete keys.j; delete keys.y; }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Only block shortcuts while the user is typing (sliders, buttons and swatches keep them working).
      const typing = target.closest('textarea, select, [contenteditable="true"]') || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(target.type));
      if (typing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (target instanceof HTMLInputElement && target.type === 'range' && e.key.startsWith('Arrow')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // On the video page, undo covers the whole video (the page handles these keys).
      if (videoMode && mod && (k === 'z' || k === 'y')) return;
      // Remove object / background: their own selection steps come first; nothing while a removal runs.
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); if (retouchUndo.current(true) || busyRef.current) return; dispatch({ type: 'undo' }); return; }
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); if (retouchUndo.current(false) || busyRef.current) return; dispatch({ type: 'redo' }); return; }
      // A marked area (Select tool): Ctrl+C / Ctrl+X / Delete act on that part of the picture.
      const areaAct = areaRef.current;
      if (areaAct) {
        if (mod && k === 'c' && !e.shiftKey) { e.preventDefault(); areaAct.copy(); return; }
        if (mod && k === 'x') { e.preventDefault(); areaAct.cut(); return; }
        if ((!mod || (e.metaKey && e.key === 'Backspace')) && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); areaAct.remove(); return; }
        if (e.key === 'Escape') { areaAct.clear(); return; }
        if (e.key === 'Enter') { e.preventDefault(); areaAct.crop(); return; }
        if (mod && k === 'd') { e.preventDefault(); areaAct.duplicate(); return; }
      }
      if (multiActive.current) {
        const act = manyRef.current;
        const step = e.shiftKey ? 10 : 1;
        if (mod && k === 'c' && !e.shiftKey) { e.preventDefault(); act.copy(); return; }
        if (mod && k === 'x') { e.preventDefault(); act.copy(); act.remove(); return; }
        if (mod && k === 'd') { e.preventDefault(); act.duplicate(); return; }
        // ⌘⌫ deletes on a Mac too.
        if ((!mod || (e.metaKey && e.key === 'Backspace')) && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); act.remove(); return; }
        if (e.key === 'Escape') { setMultiIds([]); return; }
        if (!mod && e.key.startsWith('Arrow')) {
          e.preventDefault();
          act.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
          return;
        }
      }
      if (mod && k === 'c') {
        e.preventDefault();
        if (selected && !e.shiftKey) {
          clipboard.current = selected;
          setHasClipboard(true);
          toast.info('Object copied', 'Press Ctrl+V to paste it. Ctrl+Shift+C copies the whole image.');
        } else void copy();
        return;
      }
      if (mod && k === 'x' && selected) { e.preventDefault(); clipboard.current = selected; setHasClipboard(true); deleteSelected(); return; }
      if (mod && k === 'd') { e.preventDefault(); if (selected) duplicate(selected); return; }
      if (mod && k === 's') { e.preventDefault(); void download(e.shiftKey); return; }
      if (mod && (k === ']' || k === '[') && selected) { e.preventDefault(); moveLayer(selected, k === ']' ? 1 : -1); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); workspace.current?.setZoomAt(nextZoom(zoom, 1)); return; }
      if (mod && k === '-') { e.preventDefault(); workspace.current?.setZoomAt(nextZoom(zoom, -1)); return; }
      if (mod && k === '0') { e.preventDefault(); workspace.current?.fit(); return; }
      if (mod && k === '1') { e.preventDefault(); workspace.current?.setZoomAt(1); return; }
      if (e.metaKey && !e.ctrlKey && e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (mod || e.altKey) return;
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); setShortcutsOpen(true); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape' && moveOnlyRef.current) { setMoveOnlyId(null); return; }
      if (retouchKey.current(e)) return;
      if (e.key === 'Escape') {
        if (crop) { setCrop(null); setToolState('select'); }
        else if (cut) { setCut(null); setToolState('select'); }
        else if (selectedId) setSelectedId(null);
        else setToolState('select');
        return;
      }
      if (e.key === 'Enter' && crop) { e.preventDefault(); applyCurrentCrop(); return; }
      if (e.key === 'Enter' && cut) { e.preventDefault(); applyCurrentCut(); return; }
      if (e.key === 'Enter' && selected && !selected.lock && (selected.type === 'text' || selected.type === 'callout')) {
        e.preventDefault();
        setTextEdit({ annotation: selected, isNew: false });
        return;
      }
      if (e.key === 'Tab' && doc.annotations.length) {
        e.preventDefault();
        const visible = doc.annotations.filter((a) => !a.hidden);
        if (!visible.length) return;
        const i = visible.findIndex((a) => a.id === selectedId);
        const next = i < 0 ? (e.shiftKey ? visible.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + visible.length) % visible.length;
        setSelectedId(visible[next]!.id);
        return;
      }
      if (e.key === ' ' && !e.repeat) { e.preventDefault(); setPanning(true); return; }
      if (e.key === '[' || e.key === ']') { e.preventDefault(); stepSize(e.key === ']' ? 1 : -1); return; }
      if ((e.key === ',' || e.key === '.' || e.key === '<' || e.key === '>') && selected && !selected.lock) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 15;
        const deg = e.key === ',' || e.key === '<' ? -step : step;
        const next = rotateBy(selected, deg);
        if (next !== selected) replaceAnnotation(next, `Rotate ${describeAnnotation(selected).toLowerCase()}`, `${selected.id}:rotate`);
        return;
      }
      if (selected && selected.lock !== 'all' && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        replaceAnnotation(translate(selected, dx, dy), `Move ${describeAnnotation(selected).toLowerCase()}`, `${selected.id}:nudge`);
        return;
      }
      const t = keys[k];
      if (t) setTool(t);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setPanning(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [copy, download, deleteSelected, crop, cut, applyCurrentCut, selectedId, selected, applyCurrentCrop, setTool, zoom, replaceAnnotation, duplicate, moveLayer, stepSize, doc.annotations, toast]);

  const aspect = crop ? aspectValue(crop.aspect, doc) : null;
  const steps = timeline(hist).length;
  const layerCount = doc.annotations.length + (doc.watermark ? 1 : 0) + (doc.frame ? 1 : 0);

  if (actionsRef) actionsRef.current = { copy: () => void copy(), download: () => void download(false), busy, hasSelection: Boolean(selected) };

  /** Inline: the settings panel goes into the page's slot (the Draw tab); otherwise it is the side panel. */
  const panelPortal = (node: JSX.Element) => (inline ? (inline.panelSlot ? createPortal(node, inline.panelSlot) : null) : node);

  return (
    <div className={inline ? styles.appInline : `${styles.app} ${fullScreen ? styles.appFull : ''}`} onContextMenu={(e) => pageMenu.handle(e, null)}>
      {pageMenu.element}
      {!inline && !fullScreen && <EditorToolbar
        tool={tool}
        onTool={setTool}
        canUndo={(canUndo(hist) || retouch.canUndo) && !busy}
        canRedo={(canRedo(hist) || retouch.canRedo) && !busy}
        canReset={!sameDoc(hist.present.doc, hist.original)}
        onUndo={() => { if (!retouch.undo(true)) dispatch({ type: 'undo' }); }}
        onRedo={() => { if (!retouch.undo(false)) dispatch({ type: 'redo' }); }}
        onReset={() => { setCrop(null); setSelectedId(null); dispatch({ type: 'reset' }); requestAnimationFrame(() => workspace.current?.fit()); }}
        onRotate={(dir) => void geometry(() => applyRotate(doc, dir), dir === 'cw' ? 'Rotate right' : 'Rotate left')}
        onFlip={(axis) => void geometry(() => applyFlip(doc, axis), axis === 'horizontal' ? 'Flip horizontal' : 'Flip vertical')}
        onResize={() => setResizeOpen(true)}
        onCutOut={() => setTool('cut')}
        hideZoom={!videoMode && !inline}
        infoActive={panelTab === 'info'}
        onInfo={!videoMode ? () => setPanelTab((t) => (t === 'info' ? 'props' : 'info')) : undefined}
        onInsertImages={(imgs) => void (async () => { for (const im of imgs) await insertImage(im.blob); })()}
        onCollage={onCollage ? () => void openCollage() : undefined}
        zoom={zoom}
        onZoom={(z) => (z === 'fit' ? workspace.current?.fit() : workspace.current?.setZoomAt(z))}
        onOcr={() => void runOcr()}
        ocrBusy={ocr.open && ocr.text === null && !ocr.error}
        onCopy={() => void copy()}
        onDownload={() => void download(false)}
        onExport={embedded ? undefined : () => setExportOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onFindSensitive={() => void findSensitive()}
        busy={busy}
        downloading={action === 'download' || action === 'saveas'}
        hideBrand={embedded}
        videoMode={videoMode}
      />}
      <div className={inline ? styles.bodyInline : `${styles.body} ${rail && !fullScreen ? styles.bodyRail : ''} ${fullScreen ? styles.bodyFull : ''} ${fullScreen && fsInfo && !detailsPopup ? styles.bodyDock : ''}`}>
        {!fullScreen && rail}
        <CanvasWorkspace
          ref={workspace}
          doc={doc}
          tool={tool}
          toolStyles={toolStyles}
          zoom={zoom}
          onZoom={setZoom}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCommit={commit}
          crop={crop?.rect ?? null}
          cropAspect={aspect}
          onCropChange={(rect) => setCrop((c) => (c ? { ...c, rect } : c))}
          cut={tool === 'cut' ? cut : null}
          onCutChange={(b) => setCut((c) => (c ? { ...c, ...b } : c))}
          textEdit={textEdit}
          onTextEdit={setTextEdit}
          onTextCommit={onTextCommit}
          panning={panning}
          selectionActions={selectionActions}
          multiIds={multiIds}
          onMultiChange={setMultiIds}
          multiActions={multiActions}
          onWatermarkMove={(w) => setWatermark(w, 'watermark:move')}
          moveOnlyId={moveOnlyId}
          onMoveOnlyEnd={() => setMoveOnlyId(null)}
          area={tool === 'select' ? area : null}
          onAreaChange={setArea}
          areaActions={areaActions}
          onEraseImage={(pts, size) => {
            const st = toolStyles.eraseImage;
            if (st.fill === 'smart') {
              // Smart eraser: what was painted over is rebuilt from the picture around it.
              const mask = newMaskCanvas(doc.width, doc.height);
              paintStroke(mask, pts, size, st.hardness ?? 80, 'add');
              void fillWithBackground(doc, mask, { strength: st.strength ?? 100, feather: st.feather ?? 4, preserve: st.preserve ?? true }, 'Erase and fill with background');
              return;
            }
            void geometry(() => applyEraseImage(doc, pts, size, st.fill === 'transparent' ? 'transparent' : 'white'), 'Erase part of the image', { keepView: true });
          }}
          retouch={retouch.input}
          baseOverride={retouch.preview}
          busyArea={busyArea}
          compare={canCompare && (cmp.on || cmp.original || cmp.highlight)
            ? { mode: cmp.on ? cmp.mode : cmp.original ? 'before' : 'after', split: cmp.split, vertical: cmp.vertical, labels: cmp.labels, before: sameSize ? original : null, panes: cmp.panes, highlight: cmp.highlight }
            : null}
          onPane={movePane}
          loupe={!videoMode && !inline && cmp.loupe}
          viewOnly={fullScreen || (canCompare && (cmp.on || cmp.original))}
          onSplit={(split) => patchCmp({ split })}
          bottomInset={!videoMode && !inline && showCompareBar ? 64 : 0}
          controls={!videoMode && !inline ? (
            <>
            {fullScreen && strip}
            <CompareBar
              state={cmp}
              onState={patchCmp}
              canCompare={canCompare}
              showBar={showCompareBar}
              onShowBar={(show) => savePrefs({ compareBar: show })}
              zoom={zoom}
              onZoomStep={(dir) => workspace.current?.setZoomAt(nextZoom(zoom, dir))}
              onZoomTo={(z) => workspace.current?.setZoomAt(z)}
              onFit={() => workspace.current?.fit()}
              fullScreen={fullScreen}
              onFullScreen={toggleFullScreen}
              detailsPopup={detailsPopup}
              onDetailsPopup={(v) => savePrefs({ detailsPopup: v })}
              infoOpen={fullScreen ? fsInfo : panelTab === 'info'}
              onInfo={() => (fullScreen ? toggleFsInfo() : setPanelTab((t) => (t === 'info' ? 'props' : 'info')))}
            />
            </>
          ) : undefined}
          onCanvasMenu={(e, hit) => pageMenu.handle(e, hit ? (multiIds.length > 1 && multiIds.includes(hit.id) ? multiMenu() : objectMenu(hit)) : areaRef.current ? areaMenu(areaRef.current) : canvasMenu())}
          {...(inline ? { padding: 0 } : {})}
        />
        {fullScreen && fsInfo && !detailsPopup && (
          <aside className={`${styles.fsInfo} ${styles.fsDock} ${fsInfoOut ? styles.fsInfoOut : ''}`} role="dialog" aria-label="Image details">
            <ImageInfo record={record} width={doc.width} height={doc.height} source={doc.base} edited={!sameDoc(doc, savedDoc)} onClose={hideFsInfo} />
          </aside>
        )}
        {!fullScreen && panelPortal(<aside className={inline ? styles.panelInline : styles.panel} aria-label="Properties">
          <div className={styles.panelTabs} role="tablist" aria-label="Side panel">
            {([['props', 'Properties'], ['layers', 'Layers'], ['history', 'History']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={panelTab === id} className={`${styles.panelTab} ${panelTab === id ? styles.panelTabActive : ''}`} onClick={() => setPanelTab(id)}>
                {label}
                {id === 'layers' && layerCount > 0 && <span className={styles.count}>{layerCount}</span>}
                {id === 'history' && steps > 1 && <span className={styles.count}>{steps - 1}</span>}
              </button>
            ))}
          </div>
          <div className={styles.panelScroll}>
            {panelTab === 'props' && multiIds.length > 1 && (
              <section className={styles.section} aria-label="Several objects selected">
                <div className={styles.sectionTitle}>{multiIds.length} objects selected</div>
                <div className={styles.hint}>Move, copy, paste, duplicate or delete them together. Select one object to change its style.</div>
              </section>
            )}
            {panelTab === 'props' && multiIds.length <= 1 && selected?.lock && (
              <section className={styles.section} aria-label="Locked">
                <div className={styles.sectionTitle}>{selected.lock === 'all' ? 'Locked' : 'Move only'}</div>
                {selected.id === moveOnlyId && !found?.lock ? (
                  <>
                    <div className={styles.hint}>Drag it (or use the arrow keys) to move it; nothing else changes. Click anywhere else to finish.</div>
                    <Button size="sm" variant="secondary" onClick={() => setMoveOnlyId(null)}>Done</Button>
                  </>
                ) : (
                  <>
                    <div className={styles.hint}>{selected.lock === 'all' ? 'This annotation can’t be moved or changed.' : 'This annotation can be moved, but not changed.'} Unlock it to change it.</div>
                    <Button size="sm" variant="secondary" icon={<LockOpen size={14} />} onClick={() => setLock(selected, null)}>Unlock</Button>
                  </>
                )}
              </section>
            )}
            {panelTab === 'props' && tool === 'filters' && (
              <FiltersPanel
                filters={doc.filters ?? null}
                onChange={(f, label, key) => commit({ ...doc, filters: f }, label, key)}
                source={doc.base}
              />
            )}
            {panelTab === 'props' && !videoMode && isEraseTool(tool) && <EraseSwitch tool={tool} onTool={setTool} />}
            {panelTab === 'props' && retouch.panel}
            {panelTab === 'props' && multiIds.length <= 1 && tool !== 'filters' && !retouch.panel && (
              <div ref={lockedPanel} className={selected?.lock ? styles.lockedPanel : undefined}>
              <PropertiesPanel
                tool={tool}
                docSize={{ w: doc.width, h: doc.height }}
                media={videoMode ? 'video' : 'image'}
                onCoverAll={(kind) => {
                  const s = toolStyles[kind] as unknown as Record<string, unknown>;
                  const look = Object.fromEntries(Object.entries(s).filter(([k, x]) => x !== undefined && !['intensity', 'color', 'invert', 'opacity'].includes(k)));
                  addAnnotations([{
                    ...look, id: annotationId(), type: kind, x: 0, y: 0, w: doc.width, h: doc.height, opacity: 1,
                    intensity: kind === 'mask' ? 0 : (s.intensity as number), ...(kind === 'mask' ? { color: s.color as string } : {}),
                  } as Annotation], `${kind === 'blur' ? 'Blur' : kind === 'pixelate' ? 'Pixelate' : 'Mask'} the whole ${videoMode ? 'video' : 'image'}`);
                }}
                selected={selected}
                toolStyles={toolStyles}
                onChange={onStyleChange}
                onOpacity={(o) => selected && replaceAnnotation({ ...selected, opacity: o }, `Edit ${describeAnnotation(selected).toLowerCase()}`, `${selected.id}:opacity`)}
                onRotation={(deg) => selected && replaceAnnotation(rotateBy(selected, deg - (selected.rotation ?? 0)), `Rotate ${describeAnnotation(selected).toLowerCase()}`, `${selected.id}:rotation`)}
                onDelete={deleteSelected}
                watermark={doc.watermark}
                onWatermark={setWatermark}
                frame={doc.frame}
                onFrame={setFrame}
                lastFrame={prefs.frame ?? null}
                lastWatermark={prefs.watermark ?? null}
                sourceUrl={record.sourceUrl ?? ''}
                sourceTitle={record.sourceTitle ?? ''}
                frameApply={frameApply}
                cut={
                  tool === 'cut' && cut
                    ? { band: cut, width: doc.width, height: doc.height, onChange: setCut, onApply: applyCurrentCut, onCancel: () => { setCut(null); setToolState('select'); } }
                    : null
                }
                crop={
                  crop
                    ? {
                        rect: crop.rect,
                        aspect: crop.aspect,
                        maxW: doc.width,
                        maxH: doc.height,
                        onAspect: (a) => setCrop((c) => (c ? { aspect: a, rect: constrainAspect(c.rect, aspectValue(a, doc), doc.width, doc.height) } : c)),
                        onRect: (rect) => setCrop((c) => (c ? { ...c, rect: constrainAspect(rect, aspect, doc.width, doc.height) } : c)),
                        onApply: applyCurrentCrop,
                        onCancel: () => { setCrop(null); setToolState('select'); },
                      }
                    : null
                }
              />
              </div>
            )}
            {panelTab === 'layers' && (
              <LayersPanel
                doc={doc}
                selectedId={selectedId}
                onSelect={(id) => { setToolState('select'); setSelectedId(id); setPanelTab('props'); }}
                onToggleLock={(a) => setLock(a, a.lock ? null : 'all')}
                onToggleHidden={(a) => replaceAnnotation({ ...a, hidden: !a.hidden }, `${a.hidden ? 'Show' : 'Hide'} ${describeAnnotation(a).toLowerCase()}`)}
                onMove={moveLayer}
                onDelete={removeAnnotation}
                onOpenWatermark={() => setTool('watermark')}
                onRemoveWatermark={() => setWatermark(null, 'watermark:remove')}
                onOpenFrame={() => setTool('frame')}
                onRemoveFrame={() => setFrame(null, 'frame:remove')}
              />
            )}
            {panelTab === 'history' && retouch.steps > 0 && (
              <section className={styles.section} aria-label="Selection steps">
                <div className={styles.sectionTitle}>{tool === 'removeBg' ? 'Remove background' : 'Remove object'} · not applied yet</div>
                <div className={styles.hint}>{retouch.steps} selection step{retouch.steps === 1 ? '' : 's'}. Undo (Ctrl+Z) and Redo (Ctrl+Y) go through these first; {tool === 'removeBg' ? 'Apply' : 'Remove'} makes them one step below.</div>
              </section>
            )}
            {panelTab === 'history' && <HistoryPanel history={hist} onJump={(index) => { setSelectedId(null); dispatch({ type: 'jump', index }); }} />}
            {panelTab !== 'info' && (
              <section className={styles.section} aria-label="Image size">
                <div className={styles.sectionTitle}>Image</div>
                <div className={styles.imageLine}>
                  <span className={styles.hint}>{doc.width} × {doc.height} px</span>
                  <button type="button" className={styles.detailsLink} onClick={() => setPanelTab('info')}>Details</button>
                </div>
              </section>
            )}
            {panelTab === 'info' && (
              <section className={styles.infoPanel} aria-label="Image details">
                <ImageInfo record={record} width={doc.width} height={doc.height} source={doc.base} edited={!sameDoc(doc, savedDoc)} onClose={() => setPanelTab('props')} />
              </section>
            )}
          </div>
        </aside>)}
      </div>
      {fullScreen && fsInfo && detailsPopup && (
        <div className={`${styles.fsInfo} ${fsInfoOut ? styles.fsInfoOut : ''}`} role="dialog" aria-label="Image details">
          <ImageInfo record={record} width={doc.width} height={doc.height} source={doc.base} edited={!sameDoc(doc, savedDoc)} onClose={hideFsInfo} />
        </div>
      )}
      <ResizeDialog
        open={resizeOpen}
        width={doc.width}
        height={doc.height}
        onClose={() => setResizeOpen(false)}
        onApply={(w, h) => {
          setResizeOpen(false);
          void geometry(() => applyResize(doc, w, h), `Resize to ${w} × ${h}`);
        }}
      />
      {!embedded && (
        <Modal open={exportOpen} title="Export" tone="dark" width={420} onClose={() => !busy && setExportOpen(false)}>
          <ExportPanel
            width={doc.width}
            height={doc.height}
            filename={filename}
            onFilename={setFilename}
            format={format}
            originalType={outFormat}
            onFormat={(f) => { setFormat(f); savePrefs({ format: f }); }}
            quality={quality}
            onQuality={(q) => { setQuality(q); savePrefs({ quality: q }); }}
            onCopy={() => void copy().then((ok) => ok && setExportOpen(false))}
            onDownload={() => void download(false).then((ok) => ok && setExportOpen(false))}
            onSaveAs={() => void download(true).then((ok) => ok && setExportOpen(false))}
            onPdf={() => { setExportOpen(false); setPdfOpen(true); }}
            onWord={() => void exportWord().then((ok) => ok && setExportOpen(false))}
            onQr={() => { setExportOpen(false); setQrOpen(true); }}
            busy={busy}
            action={action}
          />
        </Modal>
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PdfDialog
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        onExport={(opts) => {
          setPdfOpen(false);
          void (async () => {
            setBusy(true);
            setAction('pdf');
            setWorking('Preparing the PDF…');
            try {
              const pdf = await imageToPdf(await exportDocument(doc, 'png', 1), { ...opts, title: filename });
              setWorking(null);
              await downloadBlob(pdf, `${filename || 'screenshot'}.pdf`, { saveAs: settings.storage.askWhereToSave, subfolder: settings.storage.subfolder });
              toast.success('PDF saved', `${filename}.pdf`);
            } catch (err) {
              const info = errorInfoOf(err);
              if (info.code !== 'cancelled') toast.error(info);
            } finally {
              setWorking(null);
              setAction(null);
              setBusy(false);
            }
          })();
        }}
      />
      <QrDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        sourceUrl={record.sourceUrl ?? ''}
        fileBase={filename || 'screenshot'}
        onDownload={(blob, name) => void downloadBlob(blob, name, { saveAs: false, subfolder: settings.storage.subfolder }).then(() => toast.success('QR code saved', name)).catch((err: unknown) => toast.error(errorInfoOf(err)))}
      />
      <SensitiveDialog
        open={scan.open}
        tone="dark"
        matches={scan.matches}
        progress={scan.progress}
        error={scan.error}
        alreadyHidden={scan.hidden}
        onClose={() => setScan((s) => ({ ...s, open: false }))}
        onApply={(selected, kind) => {
          const pad = 4;
          const added: Annotation[] = selected.map((m) => ({
            id: annotationId(),
            type: kind,
            x: Math.max(0, m.box.x - pad),
            y: Math.max(0, m.box.y - pad),
            w: m.box.w + pad * 2,
            h: m.box.h + pad * 2,
            intensity: kind === 'blur' ? toolStyles.blur.intensity : toolStyles.pixelate.intensity,
            ...(kind === 'mask' ? { color: toolStyles.mask.color } : {}),
            opacity: 1,
          }));
          commit({ ...doc, annotations: [...doc.annotations, ...added] }, `Hide ${added.length} sensitive item${added.length > 1 ? 's' : ''}`);
          setScan((s) => ({ ...s, open: false }));
        }}
      />
      <OcrDialog
        open={ocr.open}
        onClose={() => setOcr((o) => ({ ...o, open: false }))}
        text={ocr.text}
        progress={ocr.progress}
        status={ocr.status}
        error={ocr.error}
        onCopy={(t) => void copyText(t).then(() => toast.success('Text copied')).catch((err: unknown) => toast.error(errorInfoOf(err)))}
      />
    </div>
  );
}

const noMenu = () => null;
