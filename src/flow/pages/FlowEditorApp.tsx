import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Eye, FileDown, GripVertical, History as HistoryIcon, Images, ListOrdered, PanelLeftClose, PanelLeftOpen,
  LayoutGrid, Pencil, RotateCcw, Trash2, Undo2, Wand2,
} from 'lucide-react';
import { CollageWorkspace, MAX_IMAGES } from '@/collage/CollageWorkspace';
import type { CaptureRecord, FlowDoc, FlowItem, FlowStep, Settings } from '@/shared/types';
import { useSettings } from '@/shared/hooks/useSettings';
import { useToast } from '@/shared/components/Toast';
import { Button, IconButton } from '@/shared/components/Button';
import { Checkbox } from '@/shared/components/FormControls';
import { ConfirmationDialog } from '@/shared/components/Modal';
import { Spinner } from '@/shared/components/Progress';
import { useTheme } from '@/shared/hooks/useTheme';
import { broadcast, errorInfoOf, onBroadcast } from '@/shared/messaging/client';
import { getCapture, getCaptureBlob, updateCapture } from '@/history/history-service';
import { formatDateTime } from '@/shared/utils/format';
import { Editor, type EditorActions } from '@/editor/pages/EditorApp';
import { Dropdown, type MenuItem } from '@/shared/components/Dropdown';
import { usePageContextMenu } from '@/shared/components/PageContextMenu';
import { historyReducer, type HistoryState } from '@/editor/history/history';
import type { EditorDoc, Frame } from '@/editor/types';
import type { FrameApply } from '@/editor/components/PropertiesPanel';
import { exportDocument, renderDocumentThumbnail } from '@/editor/render';
import { updateSettings } from '@/settings/settings-service';
import { duplicateFlowImage, getFlow, storeFlowImage, updateFlow, getOriginalImage, purgeFlowImages, putFlow, restoreFlowImages, restoreOriginalImage, saveEditedImage, softDeleteFlowImages } from '../flow-store';
import { FlowExportDialog } from './FlowExportDialog';
import { ownFrame } from '../own-frame';
import { CompareDialog } from '@/shared/components/CompareDialog';
import { AddImageMenu, type AddedImage } from '@/shared/components/AddImageMenu';
import styles from './flow.module.css';

interface Loaded {
  record: CaptureRecord;
  doc: EditorDoc;
}

/**
 * Flow Editor: every image of a flow in a thumbnail rail (left), the full screenshot editor for the
 * selected image (centre + its properties panel), and the interaction steps. Each image keeps its
 * own undo / redo history while the editor is open; originals are preserved.
 */
export function FlowEditorApp() {
  const { settings } = useSettings();
  // Follows Settings › General › Theme, with the light editor colours (styles/theme.css).
  useTheme(settings?.general.theme);
  useEffect(() => { document.documentElement.dataset.chrome = 'themed'; }, []);
  const toast = useToast();
  const flowId = new URLSearchParams(location.search).get('id') ?? '';
  const [flow, setFlow] = useState<FlowDoc | null>(null);
  const [records, setRecords] = useState<Record<string, CaptureRecord>>({});
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rail, setRail] = useState<'images' | 'steps' | 'deleted'>('images');
  const [railHidden, setRailHidden] = useState(() => {
    try {
      return localStorage.getItem('glint.flow.railHidden') === '1';
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setRailHidden((h) => {
      try {
        localStorage.setItem('glint.flow.railHidden', h ? '0' : '1');
      } catch {
        /* per-viewer convenience only */
      }
      return !h;
    });
  const [exportOpen, setExportOpen] = useState(false);
  /** "View original": the original picture and, for edited images, the current one to compare. */
  const [original, setOriginal] = useState<{ id: string; url: string; current?: string } | null>(null);
  const [confirmRestoreAll, setConfirmRestoreAll] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDeleteState] = useState<string[] | null>(null);
  const [dontAskDelete, setDontAskDelete] = useState(false);
  /** Asks before deleting, unless the user chose "Don't ask me again" (Settings → Flow Capture turns it back on). */
  const setConfirmDelete = (ids: string[] | null) => {
    if (ids && settings && !settings.flow.confirmDelete) {
      void remove(ids);
      return;
    }
    setDontAskDelete(false);
    setConfirmDeleteState(ids);
  };
  const [confirmPurge, setConfirmPurge] = useState<string[] | null>(null);
  const [collageSeeds, setCollageSeeds] = useState<Array<{ blob: Blob; name: string }> | null>(null);
  const [renaming, setRenaming] = useState(false);
  const histories = useRef(new Map<string, HistoryState>());
  const savedDocs = useRef(new Map<string, EditorDoc>());
  const [editorKey, setEditorKey] = useState(0);
  const dragId = useRef<string | null>(null);
  /** Copy / Download of the image open in the editor (header buttons). */
  const editorActions = useRef<EditorActions | null>(null);
  /** Images with edits in the editor that are not saved yet (Restore reacts to them at once). */
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const markDirty = useCallback((id: string, on: boolean) => {
    setDirty((d) => {
      if (d.has(id) === on) return d;
      const n = new Set(d);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);
  /** Live previews of images with edits not saved yet (the image list follows every change). */
  const [liveThumbs, setLiveThumbs] = useState<Record<string, string>>({});
  const thumbTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const thumbSeq = useRef(new Map<string, number>());
  const setLiveThumb = useCallback((id: string, url: string | null) => {
    setLiveThumbs((t) => {
      if (t[id] === url || (!url && !(id in t))) return t;
      if (t[id]) URL.revokeObjectURL(t[id]!);
      const n = { ...t };
      if (url) n[id] = url;
      else delete n[id];
      return n;
    });
  }, []);
  /** Cancels a pending preview and shows the stored thumbnail again. */
  const clearLiveThumb = useCallback((id: string) => {
    clearTimeout(thumbTimers.current.get(id));
    thumbSeq.current.set(id, (thumbSeq.current.get(id) ?? 0) + 1);
    setLiveThumb(id, null);
  }, [setLiveThumb]);
  const scheduleLiveThumb = useCallback((id: string, doc: EditorDoc | null) => {
    clearTimeout(thumbTimers.current.get(id));
    const seq = (thumbSeq.current.get(id) ?? 0) + 1;
    thumbSeq.current.set(id, seq);
    if (!doc) return setLiveThumb(id, null);
    thumbTimers.current.set(id, setTimeout(() => {
      void renderDocumentThumbnail(doc).then((blob) => {
        if (thumbSeq.current.get(id) === seq) setLiveThumb(id, URL.createObjectURL(blob));
      }).catch(() => undefined);
    }, 250));
  }, [setLiveThumb]);
  /** Changed from the original: saved edits, or edits still open in the editor. */
  const changed = (id: string) => !!records[id]?.edited || dirty.has(id);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where the dragged image would land: before or after this image (shown as a line). */
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);

  const refreshRecords = useCallback(async (items: FlowItem[]) => {
    const recs: Record<string, CaptureRecord> = {};
    for (const it of items) {
      const r = await getCapture(it.id);
      if (r) recs[it.id] = r;
    }
    setRecords(recs);
  }, []);

  useEffect(() => {
    void (async () => {
      const doc = await getFlow(flowId);
      if (!doc) return setMissing(true);
      setFlow(doc);
      document.title = `${doc.name} · Pixora Flow`;
      await refreshRecords([...doc.items, ...(doc.deleted ?? [])]);
      setSelected(doc.items[0]?.id ?? null);
    })();
  }, [flowId, refreshRecords]);

  // The flow may change in another page (the video page's step list, another Flow Editor tab):
  // take the stored version, so a later save here never brings back images deleted there.
  useEffect(
    () =>
      onBroadcast((m) => {
        if (m.type !== 'history/changed') return;
        void getFlow(flowId).then((doc) => {
          if (!doc) return;
          setFlow(doc);
          void refreshRecords([...doc.items, ...(doc.deleted ?? [])]);
          setSelected((cur) => (cur && !doc.items.some((i) => i.id === cur) ? doc.items[0]?.id ?? null : cur));
        });
      }),
    [flowId, refreshRecords],
  );

  const saveFlow = useCallback(async (next: FlowDoc) => {
    setFlow(next);
    await putFlow(next);
    broadcast({ target: 'broadcast', type: 'history/changed' });
  }, []);

  /** Writes the selected image's edits (if any) before switching away or exporting. */
  const flush = useCallback(async () => {
    if (!selected) return;
    const h = histories.current.get(selected);
    if (!h) return;
    const doc = h.present.doc;
    const saved = savedDocs.current.get(selected);
    if (doc === saved || doc === h.original) return;
    const png = await exportDocument(doc, 'png', 1);
    const bmp = await createImageBitmap(png);
    const rec = await saveEditedImage(selected, png, bmp.width, bmp.height);
    bmp.close();
    savedDocs.current.set(selected, doc);
    setRecords((r) => ({ ...r, [selected]: rec }));
    // Edited by hand now: a later "Apply to all" frames this version instead of the original.
    const id = selected;
    void updateFlow(flowId, (d) => (d.items.some((i) => i.id === id && i.framedOnly) ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, framedOnly: false } : i)) } : d))
      .then((d) => setFlow(d))
      .catch(() => undefined);
  }, [selected, flowId]);

  /* -------------------------- Border & frame: apply ------------------------- */
  /**
   * Gives every image of the flow the frame of the image in the editor (null removes it).
   * Images open in this session keep their undo history (the frame is one more step); images
   * never edited by hand are framed from their original, so applying again never doubles a frame.
   */
  const applyFrameToAll = async (frameIn: Frame | null) => {
    if (!flow) return;
    const frame = frameIn;
    await flush();
    let done = 0;
    let skipped = 0;
    const framed = new Set<string>();
    const label = frame ? 'Apply frame to all images' : 'Remove frame from all images';
    for (const item of flow.items) {
      if (item.id === selected) continue;
      const frame = ownFrame(frameIn, item);
      try {
        const h = histories.current.get(item.id);
        let doc: EditorDoc;
        if (h) {
          const next = historyReducer(h, { type: 'commit', doc: { ...h.present.doc, frame }, label });
          histories.current.set(item.id, next);
          doc = next.present.doc;
        } else {
          const rec = records[item.id];
          const fromOriginal = !rec?.edited || item.framedOnly === true;
          if (!fromOriginal && !frame) {
            skipped++;
            continue;
          }
          if (fromOriginal && !frame) {
            if (rec?.edited) {
              const restored = await restoreOriginalImage(item.id);
              if (restored) setRecords((r) => ({ ...r, [item.id]: restored }));
            }
            decodedForget(item.id);
            done++;
            continue;
          }
          const blob = fromOriginal ? await getOriginalImage(item.id) : await getCaptureBlob(item.id);
          if (!blob) continue;
          const base = await createImageBitmap(blob);
          doc = { base, width: base.width, height: base.height, annotations: [], watermark: null, frame };
          if (fromOriginal) framed.add(item.id);
        }
        const png = await exportDocument(doc, 'png', 1);
        const bmp = await createImageBitmap(png);
        const rec = await saveEditedImage(item.id, png, bmp.width, bmp.height);
        bmp.close();
        if (h) savedDocs.current.set(item.id, doc);
        setRecords((r) => ({ ...r, [item.id]: rec }));
        clearLiveThumb(item.id);
        decodedForget(item.id);
        done++;
      } catch {
        skipped++;
      }
    }
    const next = await updateFlow(flow.id, (d) => ({ ...d, items: d.items.map((i) => (framed.has(i.id) ? { ...i, framedOnly: true } : i)) }));
    setFlow(next);
    broadcast({ target: 'broadcast', type: 'history/changed' });
    toast.success(
      frame ? `Frame applied to ${done + 1} images` : `Frame removed from ${done + 1} images`,
      skipped ? `${skipped} image${skipped === 1 ? '' : 's'} with their own edits kept as they are.` : 'Undo works per image in the editor.',
    );
  };
  const frameApply: FrameApply = {
    apply: async () => {
      await flush();
      toast.success('Frame applied to this image');
    },
    applyAll: (frame) => applyFrameToAll(frame),
    count: flow?.items.length ?? 0,
  };

  /**
   * The editor is keyed by the loaded image object: a restored or reloaded image always mounts a
   * fresh editor, and the old one stays on screen (untouched) until the new picture is ready.
   */
  const loadedKeys = useRef(new WeakMap<Loaded, number>());
  const loadedSeq = useRef(0);
  const loadedKey = (l: Loaded) => {
    let k = loadedKeys.current.get(l);
    if (k === undefined) {
      k = ++loadedSeq.current;
      loadedKeys.current.set(l, k);
    }
    return k;
  };

  /** Recently decoded images (small LRU), so switching between nearby images needs no decoding. */
  const decoded = useRef(new Map<string, Loaded>());
  const decodedForget = (id: string) => decoded.current.delete(id);
  const decode = useCallback(async (id: string): Promise<Loaded | null> => {
    const hit = decoded.current.get(id);
    if (hit) {
      decoded.current.delete(id);
      decoded.current.set(id, hit);
      return hit;
    }
    const [record, blob] = await Promise.all([getCapture(id), getCaptureBlob(id)]);
    if (!record || !blob) return null;
    const base = await createImageBitmap(blob);
    const value: Loaded = { record, doc: { base, width: base.width, height: base.height, annotations: [], watermark: null, frame: null } };
    decoded.current.set(id, value);
    while (decoded.current.size > 8) decoded.current.delete(decoded.current.keys().next().value!);
    return value;
  }, []);
  // A restored original or a new edit save changes the stored image: decode again.
  useEffect(() => {
    decoded.current.clear();
  }, [editorKey]);

  // Load the selected image into the editor (restoring its own history when it was opened before).
  // The previous image stays on screen until the next one is ready, so switching doesn't flash.
  useEffect(() => {
    if (!selected) return setLoaded(null);
    let alive = true;
    void (async () => {
      const prev = histories.current.get(selected);
      let next: Loaded | null;
      if (prev) {
        const record = (await getCapture(selected)) ?? null;
        next = record ? { record, doc: prev.original } : null;
      } else next = await decode(selected);
      if (!next || !alive) return;
      if (!savedDocs.current.has(selected)) savedDocs.current.set(selected, next.doc);
      setLoaded(next);
    })();
    return () => {
      alive = false;
    };
  }, [selected, editorKey, decode]);

  // Decode the neighbours in the background so Previous / Next are instant.
  useEffect(() => {
    if (!loaded || !flow) return;
    const i = flow.items.findIndex((x) => x.id === loaded.record.id);
    const ids = [flow.items[i + 1]?.id, flow.items[i - 1]?.id].filter((x): x is string => !!x && !histories.current.has(x));
    const t = setTimeout(() => ids.forEach((id) => void decode(id).catch(() => undefined)), 150);
    return () => clearTimeout(t);
  }, [loaded, flow, decode]);

  const select = async (id: string) => {
    if (id === selected) return;
    try {
      await flush();
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
    setSelected(id);
  };

  /* --------------------------------- items --------------------------------- */
  const items = flow?.items ?? [];
  const move = (id: string, to: number) => {
    if (!flow) return;
    const list = [...flow.items];
    const from = list.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= list.length) return;
    const [it] = list.splice(from, 1);
    list.splice(to, 0, it!);
    void saveFlow({ ...flow, items: list });
  };
  const setDescription = (id: string, description: string) => flow && void saveFlow({ ...flow, items: flow.items.map((i) => (i.id === id ? { ...i, description } : i)) });
  /** Deleting moves images to "Deleted", where they can be restored (or deleted for good). */
  const remove = async (ids: string[]) => {
    if (!flow) return;
    try {
      await flush();
    } catch {
      /* keep going: the image is only moved */
    }
    const index = selected ? flow.items.findIndex((i) => i.id === selected) : -1;
    const next = await softDeleteFlowImages(flow.id, ids);
    setFlow(next);
    broadcast({ target: 'broadcast', type: 'history/changed' });
    setChecked(new Set());
    if (selected && ids.includes(selected)) setSelected(next.items[Math.min(Math.max(0, index), next.items.length - 1)]?.id ?? null);
    toast.show({
      kind: 'success',
      title: `${ids.length} image${ids.length === 1 ? '' : 's'} moved to Deleted`,
      message: 'You can restore them from the Deleted list.',
      action: { label: 'Undo', onClick: () => void restoreDeleted(ids) },
    });
  };
  const restoreDeleted = async (ids: string[]) => {
    const next = await restoreFlowImages(flowId, ids);
    setFlow(next);
    broadcast({ target: 'broadcast', type: 'history/changed' });
    if (!selected && next.items[0]) setSelected(ids[0] ?? next.items[0].id);
    toast.success(`${ids.length} image${ids.length === 1 ? '' : 's'} restored`);
  };
  const purge = async (ids: string[]) => {
    const next = await purgeFlowImages(flowId, ids);
    for (const id of ids) {
      histories.current.delete(id);
      savedDocs.current.delete(id);
    }
    setFlow(next);
    toast.success(`${ids.length} image${ids.length === 1 ? '' : 's'} deleted for good`);
  };

  const duplicate = async (id: string) => {
    await flush();
    const next = await duplicateFlowImage(flowId, id);
    setFlow(next);
    await refreshRecords(next.items);
  };

  /* -------------------------------- collage -------------------------------- */
  /** Collage of the ticked images (or all of them); `extra` is the image open in the editor, as edited. */
  const openCollage = async (extra?: { blob: Blob; name: string }) => {
    if (!flow) return;
    try {
      await flush();
      const chosen = checked.size ? flow.items.filter((i) => checked.has(i.id)) : extra ? [] : flow.items;
      const seeds: Array<{ blob: Blob; name: string }> = extra ? [extra] : [];
      for (const it of chosen.slice(0, MAX_IMAGES - seeds.length)) {
        if (extra && it.id === selected) continue;
        const blob = await getCaptureBlob(it.id);
        if (blob) seeds.push({ blob, name: `${flow.items.indexOf(it) + 1} - ${it.description || it.pageTitle || 'image'}` });
      }
      if (chosen.length > MAX_IMAGES) toast.info(`A collage can hold up to ${MAX_IMAGES} images`, 'The first ones were added.');
      setCollageSeeds(seeds);
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };
  /** The finished collage becomes a new image at the end of the flow. */
  const addCollage = async (blob: Blob) => {
    if (!flow) return;
    setCollageSeeds(null);
    try {
      const bmp = await createImageBitmap(blob);
      const item = await storeFlowImage(flow.id, flow.items.length + 1, { blob, width: bmp.width, height: bmp.height, mode: 'visible', auto: false, url: '', pageTitle: 'Collage', description: 'Collage' });
      bmp.close();
      const next = await updateFlow(flow.id, (d) => ({ ...d, items: [...d.items, item] }));
      setFlow(next);
      await refreshRecords([...next.items, ...(next.deleted ?? [])]);
      broadcast({ target: 'broadcast', type: 'history/changed' });
      setRail('images');
      setSelected(item.id);
      toast.success('Collage added to the flow', `Image ${next.items.length}`);
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };

  /** Pictures from the computer or the clipboard become new images at the end of the flow. */
  const addImages = async (images: AddedImage[]) => {
    if (!flow) return;
    try {
      await flush();
      let next = flow;
      let first: string | null = null;
      for (const im of images) {
        const bmp = await createImageBitmap(im.blob);
        const name = im.name.replace(/\.[a-z0-9]+$/i, '');
        const item = await storeFlowImage(flow.id, next.items.length + 1, { blob: im.blob, width: bmp.width, height: bmp.height, mode: 'visible', auto: false, url: '', pageTitle: name, description: name });
        bmp.close();
        next = await updateFlow(flow.id, (d) => ({ ...d, items: [...d.items, item] }));
        first ??= item.id;
      }
      setFlow(next);
      await refreshRecords([...next.items, ...(next.deleted ?? [])]);
      broadcast({ target: 'broadcast', type: 'history/changed' });
      setRail('images');
      if (first) setSelected(first);
      toast.success(images.length > 1 ? `${images.length} images added to the flow` : 'Image added to the flow', `Image ${next.items.length}`);
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  };

  /* --------------------------------- steps --------------------------------- */
  const updateStep = (id: string, patch: Partial<FlowStep>) => flow && void saveFlow({ ...flow, steps: flow.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const moveStep = (id: string, dir: -1 | 1) => {
    if (!flow) return;
    const list = [...flow.steps];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void saveFlow({ ...flow, steps: list });
  };

  /* --------------------------- right-click menus --------------------------- */
  const imageMenu = (item: FlowItem, i: number): MenuItem[] => [
    { id: 'open', label: 'Open in editor', icon: <Pencil size={14} />, disabled: item.id === selected, onSelect: () => void select(item.id) },
    { id: 'tick', label: checked.has(item.id) ? 'Untick' : 'Tick', icon: <CheckSquare size={14} />, onSelect: () => setChecked((c) => { const n = new Set(c); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; }) },
    { id: 'up', label: 'Move up', icon: <ArrowUp size={14} />, separatorBefore: true, disabled: i === 0, onSelect: () => move(item.id, i - 1) },
    { id: 'down', label: 'Move down', icon: <ArrowDown size={14} />, disabled: i === items.length - 1, onSelect: () => move(item.id, i + 1) },
    { id: 'dup', label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => void duplicate(item.id) },
    { id: 'orig', label: changed(item.id) ? 'Compare with original' : 'View original', icon: <Eye size={14} />, separatorBefore: true, onSelect: () => void showOriginal(item.id) },
    { id: 'restore', label: 'Restore original', icon: <RotateCcw size={14} />, disabled: !changed(item.id), onSelect: () => void restore(item.id) },
    { id: 'del', label: checked.size > 1 && checked.has(item.id) ? `Delete ${checked.size} ticked images` : 'Delete image', description: 'Del', icon: <Trash2 size={14} />, danger: true, separatorBefore: true,
      onSelect: () => setConfirmDelete(checked.size > 1 && checked.has(item.id) ? [...checked] : [item.id]) },
  ];
  // Image cards have their menu; the rest of the page shows none (Chrome's menu stays hidden).
  const pageMenu = usePageContextMenu(noMenu);

  /* ----------------------------- Delete key ----------------------------- */
  // Delete / Backspace removes the ticked images, or the image whose card has the keyboard focus.
  // Runs before the editor's own shortcut, so a ticked image is never confused with an annotation.
  const deleteKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  deleteKey.current = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    if (confirmDelete || rail !== 'images') return;
    const inRail = !!t?.closest('aside[aria-label="Flow images"]');
    // A design selected in the editor: Delete removes that design (the editor handles it), never
    // images, even when focus is still on an image tick box. Esc deselects it first.
    if (editorActions.current?.hasSelection) return;
    const ids = checked.size ? items.filter((i) => checked.has(i.id)).map((i) => i.id) : inRail && selected ? [selected] : [];
    if (!ids.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setConfirmDelete(ids);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => deleteKey.current(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  /* -------------------------------- original -------------------------------- */
  const showOriginal = async (id: string) => {
    await flush().catch(() => undefined);
    const blob = await getOriginalImage(id);
    if (!blob) return;
    const edited = (await getCapture(id))?.edited;
    const current = edited ? await getCaptureBlob(id) : undefined;
    setOriginal({ id, url: URL.createObjectURL(blob), ...(current ? { current: URL.createObjectURL(current) } : {}) });
  };
  const closeOriginal = () => {
    if (original) {
      URL.revokeObjectURL(original.url);
      if (original.current) URL.revokeObjectURL(original.current);
    }
    setOriginal(null);
  };
  /** Restores the original picture of several images (edits are dropped; each stays undoable in the editor while open). */
  const restoreMany = async (ids: string[]) => {
    let n = 0;
    for (const id of ids) {
      const rec = await restoreOriginalImage(id);
      const unsaved = dirty.has(id);
      if (!rec && !unsaved) continue;
      histories.current.delete(id);
      savedDocs.current.delete(id);
      decodedForget(id);
      markDirty(id, false);
      clearLiveThumb(id);
      if (rec) setRecords((r) => ({ ...r, [id]: rec }));
      n++;
    }
    const next = await updateFlow(flowId, (d) => ({ ...d, items: d.items.map((i) => (ids.includes(i.id) ? { ...i, framedOnly: false } : i)) }));
    setFlow(next);
    setEditorKey((k) => k + 1);
    broadcast({ target: 'broadcast', type: 'history/changed' });
    toast.success(n ? `${n} original${n === 1 ? '' : 's'} restored` : 'Nothing to restore', n ? undefined : 'These images were never edited.');
  };
  const restore = async (id: string) => {
    const rec = await restoreOriginalImage(id);
    histories.current.delete(id);
    savedDocs.current.delete(id);
    decodedForget(id);
    markDirty(id, false);
    clearLiveThumb(id);
    if (rec) setRecords((r) => ({ ...r, [id]: rec }));
    setEditorKey((k) => k + 1);
    toast.success('Original restored');
  };

  if (missing) {
    return (
      <div className={styles.center}>
        <p>This flow no longer exists.</p>
        <Button onClick={() => location.assign(chrome.runtime.getURL('options.html#history'))}>Recent captures</Button>
      </div>
    );
  }
  if (!flow || !settings) return <div className={styles.center}><Spinner size={24} /></div>;

  const sel = items.find((i) => i.id === selected) ?? null;
  const selIndex = sel ? items.indexOf(sel) : -1;
  const deleted = flow.deleted ?? [];
  // The editor always shows the image it was loaded with (keyed by that image), never another one.
  const switching = loaded !== null && sel !== null && loaded.record.id !== sel.id;

  return (
    <div className={styles.editorPage}>
      {pageMenu.element}
      <header className={styles.flowHeader}>
        <img src="/icons/icon-48.png" alt="" className={styles.brand} />
        {renaming ? (
          <input
            className={styles.nameInput}
            autoFocus
            defaultValue={flow.name}
            aria-label="Flow name"
            onBlur={(e) => {
              setRenaming(false);
              const name = e.target.value.trim();
              if (name && name !== flow.name) {
                void saveFlow({ ...flow, name });
                void updateCapture(flow.id, { name }).catch(() => undefined);
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button type="button" className={styles.flowName} onClick={() => setRenaming(true)} title="Rename">
            {flow.name} <Pencil size={13} />
          </button>
        )}
        <span className={styles.headerInfo}>
          {items.length} image{items.length === 1 ? '' : 's'} · {flow.steps.length} step{flow.steps.length === 1 ? '' : 's'} · {formatDateTime(flow.startedAt)}
        </span>
        <span className={styles.flex} />
        {checked.size > 0 && (
          <Button size="sm" className={styles.darkBtn} icon={<Trash2 size={14} />} onClick={() => setConfirmDelete([...checked])}>
            Delete {checked.size}
          </Button>
        )}
        <Button size="sm" className={styles.darkBtn} icon={<LayoutGrid size={14} />} onClick={() => void openCollage()} disabled={!items.length}
          title={checked.size ? `Collage of the ${checked.size} selected images` : 'Collage of all images (tick images to choose)'}>
          Collage Flows{checked.size ? ` (${checked.size})` : ''}
        </Button>
        <Button size="sm" variant="primary" icon={<FileDown size={15} />} onClick={() => void flush().then(() => setExportOpen(true))} disabled={!items.length}>
          Export…
        </Button>
      </header>

      <div className={`${styles.editorBody} ${railHidden ? styles.editorBodyFull : ''}`}>
        {railHidden ? (
          <aside className={styles.railMini} aria-label="Flow images (hidden)">
            <IconButton tone="dark" size="sm" label="Show image panel" icon={<PanelLeftOpen size={16} />} onClick={toggleRail} />
            <span className={styles.railMiniCount}>{selIndex + 1}/{items.length}</span>
          </aside>
        ) : (
        <aside className={styles.rail} aria-label="Flow images">
          <div className={styles.railTabs} role="tablist">
            <button type="button" role="tab" aria-selected={rail === 'images'} className={rail === 'images' ? styles.railTabOn : undefined} onClick={() => setRail('images')}>
              <Images size={14} /> Images ({items.length})
            </button>
            <button type="button" role="tab" aria-selected={rail === 'steps'} className={rail === 'steps' ? styles.railTabOn : undefined} onClick={() => setRail('steps')}>
              <ListOrdered size={14} /> Steps ({flow.steps.length})
            </button>
            <button type="button" role="tab" aria-selected={rail === 'deleted'} aria-label={`Deleted (${deleted.length})`} title="Deleted images (restorable)" className={rail === 'deleted' ? styles.railTabOn : undefined} onClick={() => setRail('deleted')}>
              <Trash2 size={14} /> {deleted.length}
            </button>
            <button type="button" className={styles.railHide} aria-label="Hide image panel" title="Hide image panel" onClick={toggleRail}>
              <PanelLeftClose size={15} />
            </button>
          </div>

          {rail === 'images' && (
            <>
              <div className={styles.railTools}>
                <Checkbox checked={items.length > 0 && checked.size === items.length} onChange={(v) => setChecked(v ? new Set(items.map((i) => i.id)) : new Set())} label="Select all" />
                <AddImageMenu className={styles.railAdd} onAdd={(imgs) => void addImages(imgs)} />
              </div>
              <ol className={styles.thumbs}>
                {items.map((item, i) => {
                  const rec = records[item.id];
                  return (
                    <li
                      key={item.id}
                      className={[
                        styles.thumb,
                        item.id === selected ? styles.thumbOn : '',
                        dragging === item.id ? styles.thumbDragging : '',
                        dropAt?.id === item.id && dragging !== item.id ? (dropAt.after ? styles.dropAfter : styles.dropBefore) : '',
                      ].join(' ')}
                      draggable
                      onContextMenu={(e) => pageMenu.handle(e, imageMenu(item, i))}
                      onDragStart={(e) => {
                        dragId.current = item.id;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', item.id);
                        // The picture under the pointer while dragging: the thumbnail card itself.
                        const r = e.currentTarget.getBoundingClientRect();
                        e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
                        requestAnimationFrame(() => setDragging(item.id));
                      }}
                      onDragOver={(e) => {
                        if (!dragId.current) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const r = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > r.top + r.height / 2;
                        if (dropAt?.id !== item.id || dropAt.after !== after) setDropAt({ id: item.id, after });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragId.current;
                        if (from && dropAt) {
                          const fromIndex = items.findIndex((x) => x.id === from);
                          let to = i + (dropAt.after ? 1 : 0);
                          if (fromIndex < to) to -= 1;
                          if (to !== fromIndex) move(from, to);
                        }
                        dragId.current = null;
                        setDragging(null);
                        setDropAt(null);
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                        setDragging(null);
                        setDropAt(null);
                      }}
                    >
                      <div className={styles.thumbTop}>
                        <input type="checkbox" aria-label={`Select image ${i + 1}`} checked={checked.has(item.id)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(item.id); else n.delete(item.id); return n; })} />
                        <span className={styles.seq}>{i + 1}</span>
                        {item.auto && <span className={styles.autoTag} title="Captured automatically for an action"><Wand2 size={11} /> auto</span>}
                        {changed(item.id) && <span className={styles.editedTag}>edited</span>}
                        <GripVertical size={14} className={styles.grip} aria-hidden />
                      </div>
                      <button type="button" className={styles.thumbImg} onClick={() => void select(item.id)} aria-label={`Open image ${i + 1}`}>
                        {liveThumbs[item.id] ?? rec?.thumbnail ? <img src={liveThumbs[item.id] ?? rec?.thumbnail} alt="" /> : <span />}
                      </button>
                      <input className={styles.caption} value={item.description} placeholder="Add a description" aria-label={`Description of image ${i + 1}`} onChange={(e) => setDescription(item.id, e.target.value)} />
                      <div className={styles.thumbMeta} title={item.url}>
                        {new Date(item.at).toLocaleTimeString()} · {item.width}×{item.height}{item.url ? ` · ${safeHost(item.url)}` : ''}
                      </div>
                      <div className={styles.thumbActions}>
                        <IconButton tone="dark" size="sm" label="Move up" icon={<ArrowUp size={13} />} disabled={i === 0} onClick={() => move(item.id, i - 1)} />
                        <IconButton tone="dark" size="sm" label="Move down" icon={<ArrowDown size={13} />} disabled={i === items.length - 1} onClick={() => move(item.id, i + 1)} />
                        <IconButton tone="dark" size="sm" label="Duplicate" icon={<Copy size={13} />} onClick={() => void duplicate(item.id)} />
                        <IconButton tone="dark" size="sm" label="View original" icon={<Eye size={13} />} onClick={() => void showOriginal(item.id)} />
                        <IconButton tone="danger" size="sm" label="Delete image" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete([item.id])} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          {rail === 'deleted' && (
            <>
              {deleted.length > 0 && (
                <div className={styles.railTools}>
                  <Button size="sm" className={styles.darkBtn} icon={<Undo2 size={14} />} onClick={() => void restoreDeleted(deleted.map((d) => d.id))}>Restore all</Button>
                  <Button size="sm" className={styles.darkBtn} icon={<Trash2 size={14} />} onClick={() => setConfirmPurge(deleted.map((d) => d.id))}>Empty</Button>
                </div>
              )}
              <ol className={styles.thumbs} aria-label="Deleted images">
                {deleted.length === 0 && <li className={styles.hint}>No deleted images. Images you delete stay here until you delete them for good, so you can restore them.</li>}
                {deleted.map((item) => (
                  <li key={item.id} className={styles.thumb}>
                    <div className={styles.thumbImg} aria-hidden>{records[item.id]?.thumbnail ? <img src={records[item.id]!.thumbnail} alt="" /> : <span />}</div>
                    <div className={styles.thumbMeta}>{item.description || item.pageTitle || 'Image'} · deleted {new Date(item.deletedAt).toLocaleTimeString()}{item.steps?.length ? ` · ${item.steps.length} step${item.steps.length === 1 ? '' : 's'}` : ''}</div>
                    <div className={styles.thumbActions}>
                      <Button size="sm" className={styles.darkBtn} icon={<Undo2 size={13} />} onClick={() => void restoreDeleted([item.id])} aria-label={`Restore image ${item.description || item.pageTitle || ''}`.trim()}>Restore</Button>
                      <IconButton tone="danger" size="sm" label="Delete for good" icon={<Trash2 size={13} />} onClick={() => setConfirmPurge([item.id])} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          {rail === 'steps' && (
            <ol className={styles.steps} aria-label="Workflow steps">
              {flow.steps.length === 0 && <li className={styles.hint}>No interaction steps were recorded. Turn on “Auto steps” when starting a flow to record clicks, form steps and page changes.</li>}
              {flow.steps.map((s, i) => {
                const img = s.itemId ? items.findIndex((it) => it.id === s.itemId) : -1;
                return (
                  <li key={s.id} className={styles.step}>
                    <div className={styles.stepHead}>
                      <span className={styles.seq}>{i + 1}</span>
                      <span className={styles.stepAction}>{s.action}</span>
                      <span className={styles.flex} />
                      <IconButton tone="dark" size="sm" label="Move step up" icon={<ArrowUp size={12} />} disabled={i === 0} onClick={() => moveStep(s.id, -1)} />
                      <IconButton tone="dark" size="sm" label="Move step down" icon={<ArrowDown size={12} />} disabled={i === flow.steps.length - 1} onClick={() => moveStep(s.id, 1)} />
                      <IconButton tone="danger" size="sm" label="Delete step" icon={<Trash2 size={12} />} onClick={() => void saveFlow({ ...flow, steps: flow.steps.filter((x) => x.id !== s.id) })} />
                    </div>
                    <input className={styles.caption} value={s.title} aria-label={`Step ${i + 1} description`} onChange={(e) => updateStep(s.id, { title: e.target.value })} />
                    {s.value !== undefined && <div className={styles.stepValue}>{s.masked ? 'Value hidden (sensitive field)' : `Value: ${s.value}`}</div>}
                    <div className={styles.thumbMeta} title={s.url}>{new Date(s.at).toLocaleTimeString()} · {safeHost(s.url)}{s.element?.label ? ` · ${s.element.label}` : ''}</div>
                    {img >= 0 && <button type="button" className={styles.stepLink} onClick={() => { setRail('images'); void select(s.itemId!); }}>Image {img + 1}</button>}
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
        )}

        <section className={styles.editorHost} aria-label="Image editor">
          {!sel ? (
            <div className={styles.center}>
              <p>{items.length ? 'Select an image to edit it.' : 'This flow has no images.'}</p>
            </div>
          ) : !loaded ? (
            <div className={styles.center}><Spinner size={22} /></div>
          ) : (
            <>
              <div className={styles.imageBar}>
                <IconButton tone="dark" size="sm" label="Previous image" icon={<ChevronLeft size={16} />} disabled={selIndex <= 0} onClick={() => void select(items[selIndex - 1]!.id)} />
                <strong>Image {selIndex + 1}</strong>
                <IconButton tone="dark" size="sm" label="Next image" icon={<ChevronRight size={16} />} disabled={selIndex >= items.length - 1} onClick={() => void select(items[selIndex + 1]!.id)} />
                <span className={styles.headerInfo}>{sel.pageTitle || sel.url}</span>
                {switching && <Spinner size={14} />}
                <span className={styles.flex} />
                <Button size="sm" className={styles.darkBtn} icon={<Eye size={14} />} onClick={() => void showOriginal(sel.id)}>Original</Button>
                {(() => {
                  const editedIds = items.filter((i) => changed(i.id)).map((i) => i.id);
                  return (
                    <div className={styles.split} role="group" aria-label="Restore" data-has-menu>
                      <Button size="sm" className={`${styles.darkBtn} ${styles.splitMain}`} icon={<RotateCcw size={14} />} disabled={!changed(sel.id)}
                        title="Bring back the original screenshot of this image" onClick={() => void restore(sel.id)}>
                        Restore
                      </Button>
                      <Dropdown
                        align="end"
                        minWidth={230}
                        ariaLabel="Restore options"
                        items={[
                          { id: 'one', label: 'Restore this image', icon: <RotateCcw size={14} />, disabled: !changed(sel.id), onSelect: () => void restore(sel.id) },
                          { id: 'all', label: `Restore all${editedIds.length ? ` (${editedIds.length})` : ''}`, description: 'Original screenshots of every edited image', icon: <HistoryIcon size={14} />, disabled: !editedIds.length, onSelect: () => setConfirmRestoreAll(editedIds) },
                        ]}
                        trigger={({ toggle, open }) => (
                          <button type="button" className={`${styles.splitArrow} ${open ? styles.splitOpen : ''}`} aria-label="More restore options" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                            <ChevronDown size={14} />
                          </button>
                        )}
                      />
                    </div>
                  );
                })()}
                <Button size="sm" className={styles.darkBtn} icon={<Copy size={14} />} title="Copy image (Ctrl+C)" onClick={() => editorActions.current?.copy()}>Copy</Button>
                <Button size="sm" variant="primary" icon={<Download size={14} />} title="Download (Ctrl+S)" onClick={() => editorActions.current?.download()}>Download</Button>
              </div>
              <div className={styles.editorFrame}>
                <EmbeddedEditor
                  key={`${loaded.record.id}:${loadedKey(loaded)}`}
                  loaded={loaded}
                  settings={settings}
                  history={histories.current.get(loaded.record.id)}
                  frameApply={frameApply}
                  actionsRef={editorActions}
                  onHistory={(h) => {
                    const id = loaded.record.id;
                    histories.current.set(id, h);
                    const edited = h.present.doc !== h.original;
                    markDirty(id, edited);
                    scheduleLiveThumb(id, h.present.doc !== savedDocs.current.get(id) ? h.present.doc : null);
                  }}
                  onSaved={(rec) => { const id = loaded.record.id; savedDocs.current.set(id, histories.current.get(id)?.present.doc ?? loaded.doc); setRecords((r) => ({ ...r, [id]: rec })); }}
                  onCollage={(seed) => void openCollage(seed)}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {collageSeeds && (
        <div className={styles.collageHost}>
          <CollageWorkspace seeds={collageSeeds} doneLabel="Add to flow" onCancel={() => setCollageSeeds(null)} onDone={(blob) => void addCollage(blob)} />
        </div>
      )}
      <FlowExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        flow={flow}
        selected={items.filter((i) => checked.has(i.id))}
        current={sel}
        settings={settings}
        onDone={(msg) => toast.success(msg)}
        onError={(err) => toast.error(errorInfoOf(err))}
      />
      <CompareDialog
        open={original !== null}
        original={original?.url ?? ''}
        edited={original?.current}
        onClose={closeOriginal}
        onRestore={original && records[original.id]?.edited ? () => { const id = original.id; closeOriginal(); void restore(id); } : undefined}
      />
      <ConfirmationDialog
        open={confirmDelete !== null}
        title={confirmDelete && confirmDelete.length > 1 ? `Delete ${confirmDelete.length} images?` : 'Delete this image?'}
        message="They move to the Deleted list of this flow together with their workflow steps; restoring brings both back."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDeleteState(null)}
        onConfirm={() => {
          const ids = confirmDelete ?? [];
          setConfirmDeleteState(null);
          if (dontAskDelete) void updateSettings({ flow: { confirmDelete: false } });
          void remove(ids);
        }}
        extra={<Checkbox checked={dontAskDelete} onChange={setDontAskDelete} label="Don't ask me again" description="Deleted images can still be restored from the Deleted list. Turn the question back on in Settings → Flow Capture." />}
      />
      <ConfirmationDialog
        open={confirmRestoreAll !== null}
        title={`Restore ${confirmRestoreAll?.length ?? 0} original${confirmRestoreAll?.length === 1 ? '' : 's'}?`}
        message="The edits of these images (annotations, frames, crops) are replaced by the original screenshots."
        confirmLabel="Restore originals"
        onCancel={() => setConfirmRestoreAll(null)}
        onConfirm={() => { const ids = confirmRestoreAll ?? []; setConfirmRestoreAll(null); void restoreMany(ids); }}
      />
      <ConfirmationDialog
        open={confirmPurge !== null}
        title={confirmPurge && confirmPurge.length > 1 ? `Delete ${confirmPurge.length} images for good?` : 'Delete this image for good?'}
        message="This can’t be undone."
        confirmLabel="Delete for good"
        danger
        onCancel={() => setConfirmPurge(null)}
        onConfirm={() => { const ids = confirmPurge ?? []; setConfirmPurge(null); void purge(ids); }}
      />
    </div>
  );
}

function EmbeddedEditor({ loaded, settings, history, onHistory, onSaved, onCollage, frameApply, actionsRef }: { loaded: Loaded; settings: Settings; history?: HistoryState; onHistory: (h: HistoryState) => void; onSaved: (r: CaptureRecord) => void; onCollage: (seed: { blob: Blob; name: string }) => void; frameApply?: FrameApply; actionsRef: { current: EditorActions | null } }) {
  const params = useRef(new URLSearchParams()).current;
  return (
    <Editor
      record={loaded.record}
      initialDoc={loaded.doc}
      settings={settings}
      params={params}
      initialHistory={history}
      onHistory={onHistory}
      onSaved={onSaved}
      onCollage={onCollage}
      frameApply={frameApply}
      actionsRef={actionsRef}
      embedded
    />
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const noMenu = () => null;
