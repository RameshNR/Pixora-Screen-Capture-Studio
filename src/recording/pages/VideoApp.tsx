import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Clapperboard, Clock, Copy, Download, EyeOff, FastForward, FileOutput, FileVideo, FolderOpen, History, Images, ListOrdered, Pencil, Play, Rewind, Save, Trash2, Upload, VolumeX, Workflow, X } from 'lucide-react';
import type { AppErrorInfo, CaptureRecord, HardwareAcceleration, Marker, VideoContainer, VideoRedaction } from '@/shared/types';
import { ChaptersPanel, PrivacyPanel, RedactionPreview, TrimEditor } from '../components/VideoTools';
import { FramesPanel } from '../components/FramesPanel';
import { VideoHistoryControls } from '../components/VideoHistory';
import {
  canResetSnapshot, commitVideoHistory, createVideoHistory, HISTORY_SETTLE_MS, jumpVideoHistory, redoVideoHistory, resetSnapshot, sameSnapshot, undoVideoHistory, type VideoHistory, type VideoSnapshot,
} from '../services/video-history';
import { timeLeftLabel, type ExportStage } from '../services/export-progress';
import { AnnotateRail, ApplyToVideo, InlineDraw, OverlayPreview, OverlayTracks, preloadInlineEditor } from '../components/VideoOverlays';
import type { Tool } from '@/editor/types';
import { fromStored, toStored, type VideoOverlay } from '../services/video-overlays';
import { annotationId } from '@/editor/tools/common';
import { createId } from '@/shared/utils/misc';
import { ensureFonts } from '@/editor/fonts';
import { usedFonts } from '@/editor/render';
import type { EditorDoc, Watermark } from '@/editor/types';
import { ToggleSwitch } from '@/shared/components/FormControls';
import { Checkbox } from '@/shared/components/FormControls';
import { Button, IconButton } from '@/shared/components/Button';
import { ConfirmationDialog, Modal } from '@/shared/components/Modal';
import { ProgressIndicator, Spinner } from '@/shared/components/Progress';
import { RadioGroup, TextField } from '@/shared/components/FormControls';
import { Dropdown, Select } from '@/shared/components/Dropdown';
import { InlineNotice } from '@/shared/components/Settings';
import { Tooltip } from '@/shared/components/Tooltip';
import { useToast } from '@/shared/components/Toast';
import { useSettings } from '@/shared/hooks/useSettings';
import { useTheme } from '@/shared/hooks/useTheme';
import { broadcast, errorInfoOf } from '@/shared/messaging/client';
import { addCapture, deleteCapture, getCapture, getCaptureBlob, listCaptures, updateCapture } from '@/history/history-service';
import { downloadBlob, SAVED_TO_FOLDER, showInFolder } from '@/shared/utils/download';
import { extensionForMime, stripExtension } from '@/shared/utils/filename';
import { formatBytes, formatDateTime, formatDuration, formatResolution } from '@/shared/utils/format';
import { makeErrorInfo } from '@/shared/utils/errors';
import { usePageContextMenu } from '@/shared/components/PageContextMenu';
import type { MenuItem } from '@/shared/components/Dropdown';
import { getFlow } from '@/flow/flow-store';
import { generateVideoThumbnail } from '../services/thumbnail';
import { RESOLUTIONS, scaledSize } from '../services/video-size';
import type { VideoQuality } from '../services/export-service';
import { VideoPlayer, type TrimRange, type VideoPlayerHandle } from '../components/VideoPlayer';
import { TopBar } from './TopBar';
import styles from './video.module.css';

/** Recording result page: playback, metadata, rename, download, trim and format conversion. */
export function VideoApp() {
  const { settings, update: updateSettings } = useSettings();
  // Follows Settings › General › Theme (light, dark or the computer's setting).
  useTheme(settings?.general.theme);
  const toast = useToast();
  /** The header's Download is saving the video (its button spins). */
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const id = params.get('id') ?? '';
  /** Latest videos for the "Recent" menu. */
  const [recentVideos, setRecentVideos] = useState<CaptureRecord[]>([]);
  useEffect(() => {
    void listCaptures('video', 'newest').then((list) => setRecentVideos(list.filter((r) => r.id !== id).slice(0, 6))).catch(() => undefined);
  }, [id]);
  const importing = !id && params.get('import') === '1';
  /** Whether the file really contains an audio track (probed), null while unknown. */
  const [audioTrack, setAudioTrack] = useState<boolean | null>(null);
  const [time, setTime] = useState(0);
  // Pixora's own right-click menu (text fields keep Chrome's).
  const menuItems = useRef<() => MenuItem[]>(() => []);
  // Only the video itself has a menu; the rest of the page shows none.
  const pageMenu = usePageContextMenu(useCallback((target: HTMLElement) => {
    // A drawing's track on the timeline has its own menu.
    const track = target.closest<HTMLElement>('[data-overlay-id]');
    if (track) return trackMenu.current(track.dataset.overlayId ?? '');
    return target.closest('[data-player]') ? menuItems.current() : null;
  }, []));
  const [playing, setPlaying] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [regions, setRegions] = useState<VideoRedaction[]>([]);
  const [sideTab, setSideTab] = useState<'details' | 'chapters' | 'privacy' | 'frames' | 'overlays'>('details');
  /** Advanced Video Editor: drawings on the video (timed, animated) and a watermark. */
  const [overlays, setOverlays] = useState<VideoOverlay[]>([]);
  const [videoWatermark, setVideoWatermark] = useState<Watermark | null>(null);
  /** Drawing on the paused video: the frame under the playhead, the tool asked for by the rail, the selection. */
  const [editFrame, setEditFrame] = useState<{ frame: ImageBitmap; time: number } | null>(null);
  const editFrameRef = useRef(editFrame);
  editFrameRef.current = editFrame;
  /** Which drawing layer has painted (the video and its preview stay visible until it has). */
  const [paintedLayer, setPaintedLayer] = useState<string | null>(null);
  const [toolRequest, setToolRequest] = useState<{ tool: Tool; n: number } | null>(null);
  const [currentTool, setCurrentTool] = useState<Tool | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [selectRequest, setSelectRequest] = useState<{ id: string; n: number } | null>(null);
  /** Bumped when drawings change outside the drawing layer (timeline delete, duplicate…): it reopens with them. */
  const [drawRev, setDrawRev] = useState(0);
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null);
  const [saved, setSaved] = useState(true);
  const advanced = settings?.recording.advancedVideoEditor ?? true;
  /** Images Flow Capture took during this recording (0 when none were recorded). */
  const [flowSteps, setFlowSteps] = useState(0);
  /** Bumped by the header's "Flow steps" button: the Frames panel scrolls to the step list. */
  const [focusSteps, setFocusSteps] = useState(0);
  /** Frames picked by hand in the Frames panel, and the header's "Create flow" request for them. */
  const [frameCount, setFrameCount] = useState(0);
  const [createFlowRequest, setCreateFlowRequest] = useState(0);
  const metaLoaded = useRef(false);
  const [record, setRecord] = useState<CaptureRecord | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<AppErrorInfo | null>(null);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<TrimRange | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmMute, setConfirmMute] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [muting, setMuting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const autosaved = useRef(false);

  useEffect(() => {
    if (importing) return;
    let objectUrl: string | null = null;
    void (async () => {
      const [rec, data] = await Promise.all([getCapture(id), getCaptureBlob(id)]);
      if (!rec || !data) {
        setLoadError(makeErrorInfo('unknown', 'Recording not found'));
        return;
      }
      objectUrl = URL.createObjectURL(data);
      setRecord(rec);
      setMarkers(rec.markers ?? []);
      setRegions(rec.redactions ?? []);
      setOverlays(await fromStored(rec.overlays));
      setVideoWatermark(rec.videoWatermark ?? null);
      const stepCount = rec.linkedFlowId ? ((await getFlow(rec.linkedFlowId).catch(() => null))?.items.length ?? 0) : 0;
      setFlowSteps(stepCount);
      if (stepCount) setSideTab('frames');
      else if (rec.markers?.length) setSideTab('chapters');
      metaLoaded.current = true;
      setBlob(data);
      setUrl(objectUrl);
      document.title = `${rec.name} · Pixora`;
      try {
        const { probeVideo } = await import('../services/export-service');
        setAudioTrack((await probeVideo(data)).audioCodec !== null);
      } catch {
        setAudioTrack(null);
      }
    })().catch((err: unknown) => setLoadError(errorInfoOf(err)));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, importing]);

  // Chapters and privacy regions are saved with the recording (debounced).
  useEffect(() => {
    if (!metaLoaded.current || !record) return;
    const t = setTimeout(() => {
      void (async () => updateCapture(record.id, { markers, redactions: regions, overlays: await toStored(overlays), videoWatermark }))()
        .then(() => setSaved(true), () => undefined);
    }, 400);
    setSaved(false);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, regions, overlays, videoWatermark]);

  // Draw tab open and the video paused: the image editor covers the video picture (that frame).
  const editing = advanced && sideTab === 'overlays' && !playing && Boolean(settings && record);
  // Ready before the first click on a tool.
  useEffect(() => {
    if (!advanced) return;
    const t = setTimeout(preloadInlineEditor, 300);
    return () => clearTimeout(t);
  }, [advanced]);
  useEffect(() => {
    if (!editing) {
      setEditFrame((f) => { f?.frame.close(); return null; });
      return;
    }
    let alive = true;
    let waitingOn: HTMLVideoElement | null = null;
    const grab = () => {
      const v = playerRef.current?.element();
      if (!alive || !v) return;
      // The picture isn't loaded yet (just opened, or seeking): try again as soon as it is.
      if (!v.videoWidth || v.readyState < 2) {
        waitingOn = v;
        v.addEventListener('loadeddata', grab, { once: true });
        v.addEventListener('seeked', grab, { once: true });
        return;
      }
      // Already showing this frame: grabbing it again would restart the drawing layer.
      const shown = editFrameRef.current;
      if (shown && Math.abs(shown.time - v.currentTime) < 0.001) return;
      void createImageBitmap(v).then((frame) => {
        if (!alive) { frame.close(); return; }
        setEditFrame((f) => { f?.frame.close(); return { frame, time: v.currentTime }; });
      }).catch(() => undefined);
    };
    const t = setTimeout(grab, 120);
    return () => {
      alive = false;
      clearTimeout(t);
      waitingOn?.removeEventListener('loadeddata', grab);
      waitingOn?.removeEventListener('seeked', grab);
    };
  }, [editing, Math.round(time * 1000)]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A tool from the Annotate rail (or "Add annotation"): pause, open the Draw tab, use that tool. */
  const pickTool = (tool: Tool) => {
    playerRef.current?.pause();
    setSideTab('overlays');
    setToolRequest((r) => ({ tool, n: (r?.n ?? 0) + 1 }));
  };
  const selectedOverlay = selectedAnnotation ? overlays.find((o) => o.annotation.id === selectedAnnotation) ?? null : null;

  /** Timeline actions on a drawing (buttons, right-click menu, keys). */
  const showOverlay = (o: VideoOverlay) => {
    playerRef.current?.pause();
    setSideTab('overlays');
    setSelectedAnnotation(o.annotation.id);
    setSelectRequest((r) => ({ id: o.annotation.id, n: (r?.n ?? 0) + 1 }));
    if (time < o.start || time > o.end) playerRef.current?.seek(Math.min(o.end, o.start + Math.min(1, (o.end - o.start) / 2)));
  };
  const deleteOverlay = (o: VideoOverlay) => {
    setOverlays((list) => list.filter((x) => x.id !== o.id));
    if (selectedAnnotation === o.annotation.id) setSelectedAnnotation(null);
    setDrawRev((r) => r + 1);
  };
  const updateOverlay = (o: VideoOverlay, patch: Partial<VideoOverlay>) => setOverlays((list) => list.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
  const trackMenu = useRef<(id: string) => MenuItem[] | null>(() => null);
  trackMenu.current = (id: string) => {
    const o = overlays.find((x) => x.id === id);
    if (!o) return null;
    const hidden = Boolean(o.annotation.hidden);
    return [
      { id: 'edit', label: 'Edit details', icon: <Pencil size={14} />, onSelect: () => showOverlay(o) },
      { id: 'go', label: `Go to start (${formatDuration(o.start * 1000)})`, icon: <Play size={14} />, onSelect: () => playerRef.current?.seek(o.start + 0.01) },
      { id: 'hide', label: hidden ? 'Show' : 'Hide', icon: <EyeOff size={14} />, onSelect: () => { updateOverlay(o, { annotation: { ...o.annotation, hidden: !hidden } as VideoOverlay['annotation'] }); setDrawRev((r) => r + 1); } },
      { id: 'dup', label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => {
        const copy: VideoOverlay = { ...o, id: createId('ov_'), annotation: { ...o.annotation, id: annotationId() } as VideoOverlay['annotation'] };
        setOverlays((list) => [...list, copy]);
        setDrawRev((r) => r + 1);
      } },
      { id: 'start', label: 'Start at the playhead', separatorBefore: true, disabled: time >= o.end, onSelect: () => updateOverlay(o, { start: Math.min(time, o.end - 0.1) }) },
      { id: 'end', label: 'End at the playhead', disabled: time <= o.start, onSelect: () => updateOverlay(o, { end: Math.max(time, o.start + 0.1) }) },
      { id: 'whole', label: 'Apply throughout video', onSelect: () => updateOverlay(o, { start: 0, end: duration }) },
      { id: 'del', label: 'Delete', description: 'Del', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => deleteOverlay(o) },
    ];
  };

  // Delete removes the drawing selected on the timeline (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || !selectedAnnotation) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const o = overlays.find((x) => x.annotation.id === selectedAnnotation);
      if (!o) return;
      e.preventDefault();
      deleteOverlay(o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ------------------------------ undo / redo / history ------------------------------ */
  const snapshot = useMemo<VideoSnapshot>(() => ({ overlays, watermark: videoWatermark, markers, regions, trim }), [overlays, videoWatermark, markers, regions, trim]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [history, setHistory] = useState<VideoHistory | null>(null);
  const historyRef = useRef<VideoHistory | null>(null);
  const saveHistory = useCallback((h: VideoHistory) => {
    historyRef.current = h;
    setHistory(h);
  }, []);
  // Every change becomes a step once it settles (a drag or a held button is one step).
  useEffect(() => {
    if (!metaLoaded.current || !blob) return;
    const h = historyRef.current;
    if (!h) { saveHistory(createVideoHistory(snapshot)); return; }
    if (sameSnapshot(h.present.snapshot, snapshot)) return;
    const t = setTimeout(() => saveHistory(commitVideoHistory(historyRef.current!, snapshotRef.current)), HISTORY_SETTLE_MS);
    return () => clearTimeout(t);
  }, [snapshot, blob, saveHistory]);
  /** Moves through the history and puts that step's drawings, chapters, regions and trim back. */
  const moveHistory = useCallback((move: (h: VideoHistory) => VideoHistory) => {
    const now = historyRef.current;
    if (!now) return;
    const settled = commitVideoHistory(now, snapshotRef.current);
    const next = move(settled);
    saveHistory(next);
    if (next === settled) return;
    const s = next.present.snapshot;
    setOverlays(s.overlays);
    setVideoWatermark(s.watermark);
    setMarkers(s.markers);
    setRegions(s.regions);
    setTrim(s.trim);
    setSelectedAnnotation((id) => (id && s.overlays.some((o) => o.annotation.id === id) ? id : null));
    setDrawRev((r) => r + 1);
  }, [saveHistory]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const undo = k === 'z' && !e.shiftKey;
      const redo = k === 'y' || (k === 'z' && e.shiftKey);
      if (!undo && !redo) return;
      const t = e.target as HTMLElement;
      const typing = t.closest('textarea, select, [contenteditable="true"]') || (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(t.type));
      if (typing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      moveHistory(undo ? undoVideoHistory : redoVideoHistory);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveHistory]);
  const historyPending = Boolean(history && !sameSnapshot(history.present.snapshot, snapshot));

  const onTime = useCallback((t: number, p: boolean) => {
    setTime(t);
    setPlaying(p);
  }, []);

  const download = useCallback(
    async (saveAs: boolean, data?: Blob, name?: string) => {
      if (!record || !settings) return;
      if (!data) setDownloadingVideo(true);
      try {
        const downloadId = await downloadBlob(data ?? blob!, name ?? record.name, {
          saveAs: saveAs || settings.storage.askWhereToSave,
          subfolder: settings.storage.subfolder,
        });
        if (!data) setRecord(await updateCapture(record.id, { downloadId }));
        toast.success(saveAs || settings.storage.askWhereToSave ? 'Saved' : 'Download started', name ?? record.name);
      } catch (err) {
        const info = errorInfoOf(err);
        if (info.code !== 'cancelled') toast.error(info);
      } finally {
        if (!data) setDownloadingVideo(false);
      }
    },
    [record, blob, settings, toast],
  );

  useEffect(() => {
    if (params.get('autosave') === '1' && record && blob && settings && !autosaved.current) {
      autosaved.current = true;
      void download(false);
    }
  }, [params, record, blob, settings, download]);

  async function rename() {
    if (!record) return;
    const base = nameDraft.trim();
    if (!base) return setRenaming(false);
    const ext = extensionForMime(record.mimeType);
    // The field excludes the extension, so dots in the name (times like 22.00.46) are kept.
    const withoutExt = base.toLowerCase().endsWith(`.${ext}`) ? base.slice(0, -(ext.length + 1)) : base;
    const next = await updateCapture(record.id, { name: `${withoutExt}.${ext}` });
    setRecord(next);
    setRenaming(false);
    broadcast({ target: 'broadcast', type: 'history/changed' });
  }

  /** Removes the audio from this recording (video is copied, not re-encoded). */
  async function removeAudio() {
    if (!record || !blob) return;
    setConfirmMute(false);
    setMuting(true);
    try {
      const { exportVideo } = await import('../services/export-service');
      const container: VideoContainer = record.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const result = await exportVideo(blob, { container, removeAudio: true });
      const next = await updateCapture(record.id, { audio: { microphone: false, system: false }, mimeType: result.mimeType, notes: [...(record.notes ?? []), 'Audio removed.'] }, result.blob);
      setRecord(next);
      setAudioTrack(false);
      setBlob(result.blob);
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(result.blob);
      });
      broadcast({ target: 'broadcast', type: 'history/changed' });
      toast.success('Audio removed', 'The recording is now silent.');
    } catch (err) {
      toast.error(errorInfoOf(err));
    } finally {
      setMuting(false);
    }
  }

  async function remove() {
    if (!record) return;
    await deleteCapture(record.id);
    broadcast({ target: 'broadcast', type: 'history/changed' });
    location.replace(chrome.runtime.getURL('options.html#history'));
  }

  if (importing) {
    return (
      <div className={styles.page}>
        <TopBar />
        <VideoImport />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.center}>
          <InlineNotice tone="error">This recording could not be found. It may have been deleted.</InlineNotice>
          <Button onClick={() => location.assign(chrome.runtime.getURL('options.html#history'))}>Open Recent captures</Button>
        </div>
      </div>
    );
  }
  if (!record || !url || !blob) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.center}>
          <Spinner size={24} />
        </div>
      </div>
    );
  }

  const knownDuration = record.durationMs ? record.durationMs / 1000 : null;
  const recordSaysAudio = record.audio ? record.audio.microphone || record.audio.system : null;
  const hasAudio = audioTrack ?? recordSaysAudio ?? true;
  const audioLabel = !hasAudio
    ? 'No audio'
    : record.audio && (record.audio.microphone || record.audio.system)
      ? [record.audio.microphone && 'Microphone', record.audio.system && 'System / tab'].filter(Boolean).join(' + ')
      : 'Audio track';

  menuItems.current = () => {
    const v = playerRef.current?.element();
    const playing = !!v && !v.paused && !v.ended;
    return [
      { id: 'play', label: playing ? 'Pause' : 'Play', description: 'Space', icon: <Play size={14} />, onSelect: () => playerRef.current?.toggle() },
      { id: 'back', label: 'Back 5 seconds', description: '←', icon: <Rewind size={14} />, onSelect: () => playerRef.current?.seek(Math.max(0, time - 5)) },
      { id: 'fwd', label: 'Forward 5 seconds', description: '→', icon: <FastForward size={14} />, onSelect: () => playerRef.current?.seek(time + 5) },
      { id: 'frames', label: flowSteps ? `Flow steps (${flowSteps})` : 'Frames', icon: <Images size={14} />, separatorBefore: true, onSelect: () => { setSideTab('frames'); if (flowSteps) setFocusSteps((n) => n + 1); } },
      { id: 'chapters', label: 'Chapters', icon: <ListOrdered size={14} />, onSelect: () => setSideTab('chapters') },
      { id: 'privacy', label: 'Privacy', icon: <EyeOff size={14} />, onSelect: () => setSideTab('privacy') },
      { id: 'open', label: 'Open video…', icon: <Upload size={14} />, separatorBefore: true, onSelect: () => void chrome.tabs.create({ url: chrome.runtime.getURL('video.html?import=1') }) },
      { id: 'recent', label: 'Recent captures', icon: <History size={14} />, onSelect: () => void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#history') }) },
    ];
  };
  return (
    <div className={`${styles.page} ${styles.studio}`}>
      {pageMenu.element}
      <TopBar subtitle="Visual Capture Studio">
        <div className={styles.titleArea}>
          {renaming ? (
            <form className={styles.renameForm} onSubmit={(e) => { e.preventDefault(); void rename(); }}>
              <TextField autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} suffix={`.${extensionForMime(record.mimeType)}`} aria-label="File name" />
              <IconButton type="submit" label="Save name" icon={<Check size={18} />} />
              <IconButton label="Cancel rename" icon={<X size={18} />} onClick={() => setRenaming(false)} />
            </form>
          ) : (
            <button type="button" className={styles.title} onClick={() => { setNameDraft(stripExtension(record.name)); setRenaming(true); }} title="Rename">
              <Clapperboard size={16} className={styles.titleIcon} />
              {record.name}
              <Pencil size={14} />
            </button>
          )}
        </div>
        <div className={styles.topActions}>
          <VideoHistoryControls
            history={history}
            canUndo={Boolean(history?.past.length) || historyPending}
            canRedo={Boolean(history?.future.length) && !historyPending}
            canReset={canResetSnapshot(snapshot)}
            onUndo={() => moveHistory(undoVideoHistory)}
            onRedo={() => moveHistory(redoVideoHistory)}
            onReset={() => setConfirmReset(true)}
            onJump={(index) => moveHistory((h) => jumpVideoHistory(h, index))}
          />
          <label className={styles.advancedSwitch} title="Draw on the video with the image editor's tools, with timed overlays, animations and effects">
            <span className={styles.btnText}>Advanced editor</span>
            <ToggleSwitch size="sm" label="Advanced Video Editor" checked={advanced} onChange={(v) => { void updateSettings({ recording: { advancedVideoEditor: v } }); if (!v && sideTab === 'overlays') setSideTab('details'); }} />
          </label>
          {record?.linkedFlowId ? (
            <Button
              variant="ghost"
              icon={<Workflow size={16} />}
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL(`flow.html?id=${encodeURIComponent(record.linkedFlowId!)}`) })}
              title="Open this recording's flow (its step images) in the Flow Editor"
              aria-label={`Open flow${flowSteps ? ` (${flowSteps})` : ''}`}
            >
              <span className={styles.btnText}>Open flow{flowSteps ? ` (${flowSteps})` : ''}</span>
            </Button>
          ) : (
            <Button
              variant="ghost"
              icon={<Workflow size={16} />}
              onClick={() => {
                setSideTab('frames');
                if (frameCount > 0) setCreateFlowRequest((n) => n + 1);
                else toast.info('Add the frames first', 'Pause on each step of the video and click “Add this frame”, then Create flow.');
              }}
              title={frameCount ? `Create a flow from the ${frameCount} frame${frameCount === 1 ? '' : 's'} you added` : 'Create a flow (step-by-step guide) from frames of this video'}
              aria-label={`Create flow${frameCount ? ` (${frameCount})` : ''}`}
            >
              <span className={styles.btnText}>Create flow{frameCount ? ` (${frameCount})` : ''}</span>
            </Button>
          )}
          <Button icon={<Upload size={16} />} variant="ghost" aria-label="Open video…" title="Open video…" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('video.html?import=1') })}>
            <span className={styles.btnText}>Open video…</span>
          </Button>
          <Dropdown
            minWidth={300}
            align="end"
            ariaLabel="Recent videos"
            items={[
              ...recentVideos.map((r) => ({
                id: r.id,
                label: r.name,
                description: `${formatDuration(r.durationMs ?? 0)} · ${formatDateTime(r.createdAt)}`,
                icon: <FileVideo size={14} />,
                onSelect: () => location.assign(chrome.runtime.getURL(`video.html?id=${encodeURIComponent(r.id)}`)),
              })),
              { id: 'all', label: 'All recent captures', icon: <History size={14} />, separatorBefore: recentVideos.length > 0, onSelect: () => void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#history') }) },
            ]}
            trigger={({ toggle, open }) => (
              <Button icon={<Clock size={16} />} variant="ghost" aria-haspopup="menu" aria-expanded={open} aria-label="Recent" title="Recent videos" onClick={toggle}>
                <span className={styles.menuLabel}><span className={styles.btnText}>Recent</span><ChevronDown size={14} /></span>
              </Button>
            )}
          />
          <Button icon={<FileOutput size={16} />} aria-label="Export / Convert" title="Export / Convert" onClick={() => setExportOpen(true)}>
            <span className={styles.btnText}>Export / Convert</span>
          </Button>
          <Button variant="primary" icon={<Download size={16} />} loading={downloadingVideo} onClick={() => void download(false)}>
            Download
          </Button>
        </div>
      </TopBar>

      <main className={`${styles.layout} ${advanced ? styles.layoutRail : ''}`}>
        {advanced && <AnnotateRail tool={currentTool} active={editing} onPick={pickTool} privacy={{ count: regions.length, open: sideTab === 'privacy', onOpen: () => setSideTab('privacy') }} />}
        <section className={styles.stage}>
          <VideoPlayer
            ref={playerRef}
            src={url}
            knownDurationSec={knownDuration}
            trim={trim}
            onTrimChange={setTrim}
            onDuration={setDuration}
            hasAudio={hasAudio}
            markers={markers}
            onTime={onTime}
            overlay={(box) => (
              <>
                <RedactionPreview regions={regions} time={time} />
                <OverlayPreview overlays={overlays} watermark={videoWatermark} player={playerRef} box={box} hidden={Boolean(editFrame) && paintedLayer === `${editFrame?.time}:${drawRev}`} />
                {editing && editFrame && settings && record && (
                  <InlineDraw
                    key={`${editFrame.time}:${drawRev}`}
                    onReady={() => setPaintedLayer(`${editFrame.time}:${drawRev}`)}
                    frame={editFrame.frame}
                    time={editFrame.time}
                    duration={duration}
                    overlays={overlays}
                    watermark={videoWatermark}
                    settings={settings}
                    record={record}
                    panelSlot={panelSlot}
                    requestedTool={toolRequest}
                    requestedSelect={selectRequest}
                    onToolChange={setCurrentTool}
                    onSelectionChange={setSelectedAnnotation}
                    onChange={(next, wm) => { setOverlays(next); setVideoWatermark(wm); }}
                  />
                )}
              </>
            )}
          />

          <TrimEditor
            src={url}
            duration={duration}
            trim={trim}
            onTrim={setTrim}
            time={time}
            playing={playing}
            player={playerRef}
            markers={markers}
            onExport={() => setExportOpen(true)}
            tracks={advanced ? (
              <OverlayTracks overlays={overlays} duration={duration} time={time} selectedId={selectedAnnotation} onChange={setOverlays}
                onSelect={showOverlay}
                onDelete={deleteOverlay}
                onAdd={() => pickTool('text')} />
            ) : undefined}
          />
        </section>

        <aside className={styles.side}>
          <div className={styles.sideTabs} role="tablist" aria-label="Recording tools">
            {/* With the Advanced editor, Privacy is in the Annotate rail on the left (keeps these on one row). */}
            {([
              ['details', 'Details', 0],
              ...(advanced ? [['overlays', 'Annotations', overlays.length] as const] : []),
              ['chapters', 'Chapters', markers.length],
              ...(!advanced ? [['privacy', 'Privacy', regions.length] as const] : []),
              // Steps of the recording's flow plus the frames added by hand.
              ['frames', 'Frames', flowSteps + frameCount],
            ] as const).map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={sideTab === id} aria-label={count ? `${label} (${count})` : label} className={`${styles.sideTab} ${sideTab === id ? styles.sideTabOn : ''}`} onClick={() => setSideTab(id)}>
                {label}
                {count > 0 && <span className={styles.sideTabCount}>{count}</span>}
              </button>
            ))}
          </div>
          {/* Only the content scrolls: the tab bar above always stays visible. */}
          <div className={styles.sideBody}>
          {sideTab === 'chapters' && (
            <ChaptersPanel
              markers={markers}
              onChange={setMarkers}
              time={time}
              duration={duration}
              onSeek={(t) => playerRef.current?.seek(t)}
              onExportRange={(range) => { setTrim(range); setExportOpen(true); }}
              fileBase={stripExtension(record.name)}
              onDownload={(data, name) => void download(false, data, name)}
              onCopied={() => toast.success('Chapter list copied')}
            />
          )}
          {/* Kept mounted: frames picked by hand survive switching side tabs. */}
          {settings && (
            <div hidden={sideTab !== 'frames'}>
              <FramesPanel record={record} settings={settings} player={playerRef} regions={regions} time={time} focusSteps={focusSteps} onStepCount={setFlowSteps}
                createRequest={createFlowRequest} onFrameCount={setFrameCount} onFlowCreated={(rec) => setRecord(rec)} />
            </div>
          )}
          {sideTab === 'overlays' && advanced && (
            <div className={styles.drawTab}>
              {playing ? (
                <div className={styles.drawPaused}>
                  <p>Pause the video to draw on that frame.</p>
                  <Button variant="primary" onClick={() => playerRef.current?.pause()}>Pause and draw</Button>
                </div>
              ) : (
                <>
                  {/* The image editor's settings for the tool or the selected drawing. */}
                  <div ref={setPanelSlot} className={styles.drawSettings} />
                  {selectedOverlay ? (
                    <ApplyToVideo overlay={selectedOverlay} duration={duration} time={time} saved={saved} onSeek={(t) => playerRef.current?.seek(t)} onChange={(o) => setOverlays((list) => list.map((x) => (x.id === o.id ? o : x)))} />
                  ) : (
                    <p className={styles.drawHint}>Draw on the video with the tools on the left. Select a drawing to set when it shows, its animations and effect.</p>
                  )}
                  {videoWatermark && (
                    <div className={styles.drawWatermark}>
                      <span>Watermark on the whole video</span>
                      <Button size="sm" variant="ghost" onClick={() => setVideoWatermark(null)}>Remove</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {sideTab === 'privacy' && <>
            {advanced && <h2 className={styles.sideTitle}>Privacy</h2>}
            <PrivacyPanel regions={regions} onChange={setRegions} time={time} duration={duration} player={playerRef} />
          </>}
          {sideTab === 'details' && <>
          <h2 className={styles.sideTitle}>Recording details</h2>
          <dl className={styles.meta}>
            <Meta label="Resolution" value={formatResolution(record.width, record.height)} />
            <Meta label="Frame rate" value={record.fps ? `${record.fps} fps` : '—'} />
            <Meta label="Duration" value={formatDuration(record.durationMs ?? duration * 1000)} />
            <Meta label="Format" value={record.videoCodec ?? record.mimeType} />
            <Meta label="File size" value={formatBytes(record.size)} />
            <Meta label="Audio" value={audioLabel} />
            <Meta label="Recorded" value={formatDateTime(record.createdAt)} />
            {record.sourceTitle && <Meta label="Source" value={record.sourceTitle} />}
          </dl>
          {record.notes && record.notes.length > 0 && (
            <div className={styles.notes}>
              {record.notes.map((n) => (
                <InlineNotice key={n}>{n}</InlineNotice>
              ))}
            </div>
          )}
          <div className={styles.sideActions}>
            <Button icon={<Save size={16} />} onClick={() => void download(true)}>
              Save to a custom location…
            </Button>
            <Button
              icon={<FolderOpen size={16} />}
              disabled={record.downloadId === undefined}
              onClick={() => void showInFolder(record.downloadId).then((ok) => !ok && (record.downloadId === SAVED_TO_FOLDER ? toast.info('Saved in your chosen folder', 'Open that folder to find it (Settings › Storage shows its name).') : toast.info('File not found', 'Download it again to open its folder.')))}
            >
              Show in folder
            </Button>
            <Tooltip content="Browsers can’t put video files on the clipboard. Download the file and share it instead.">
              <span>
                <Button icon={<Copy size={16} />} disabled block>
                  Copy video
                </Button>
              </span>
            </Tooltip>
            <Button
              icon={<VolumeX size={16} />}
              loading={muting}
              disabled={!hasAudio}
              title={hasAudio ? undefined : 'This video has no audio'}
              onClick={() => setConfirmMute(true)}
            >
              {hasAudio ? 'Remove audio…' : 'No audio to remove'}
            </Button>
            <Button icon={<Trash2 size={16} />} variant="ghost" className={styles.danger} onClick={() => setConfirmDelete(true)}>
              Delete recording
            </Button>
          </div>
          </>}
          </div>
        </aside>
      </main>

      <ExportDialog
        overlays={overlays}
        watermark={videoWatermark}
        hardwareAcceleration={settings?.advanced.hardwareAcceleration ?? 'auto'}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        source={blob}
        record={record}
        hasAudio={hasAudio}
        markers={markers}
        redactions={regions}
        trim={trim}
        duration={duration}
        onDownload={(data, name) => download(false, data, name)}
        onSaved={() => broadcast({ target: 'broadcast', type: 'history/changed' })}
      />
      <ConfirmationDialog
        open={confirmReset}
        title="Reset to the original video?"
        message="All drawings, the watermark, privacy regions and the trim are removed. Chapters are kept. You can undo this until you close this page."
        confirmLabel="Reset"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          moveHistory((h) => commitVideoHistory(h, resetSnapshot(h.present.snapshot), 'Reset to original'));
        }}
      />
      <ConfirmationDialog
        open={confirmMute}
        title="Remove the audio?"
        message="All sound (microphone and system audio) is removed from this recording. The video stays exactly the same. To keep a copy with sound, download it first or use Export with audio."
        confirmLabel="Remove audio"
        danger
        onCancel={() => setConfirmMute(false)}
        onConfirm={() => void removeAudio()}
      />
      <ConfirmationDialog
        open={confirmDelete}
        title="Delete this recording?"
        message="It will be removed from Recent captures. Files you already downloaded are not affected."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface ExportProps {
  overlays: VideoOverlay[];
  watermark: Watermark | null;
  hardwareAcceleration: HardwareAcceleration;
  open: boolean;
  onClose: () => void;
  source: Blob;
  record: CaptureRecord;
  hasAudio: boolean;
  markers: Marker[];
  redactions: VideoRedaction[];
  trim: TrimRange | null;
  duration: number;
  onDownload: (blob: Blob, name: string) => Promise<void>;
  onSaved: () => void;
}

type QualityChoice = 'original' | VideoQuality;

function ExportDialog({ overlays, watermark, hardwareAcceleration, open, onClose, source, record, hasAudio, markers, redactions, trim, duration, onDownload, onSaved }: ExportProps) {
  const toast = useToast();
  const sourceContainer: VideoContainer = record.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const [container, setContainer] = useState<VideoContainer>(sourceContainer === 'webm' ? 'mp4' : 'webm');
  const [useTrim, setUseTrim] = useState(Boolean(trim));
  const [keepAudio, setKeepAudio] = useState(true);
  const [resolution, setResolution] = useState(0);
  const [quality, setQuality] = useState<QualityChoice>('original');
  const [frameRate, setFrameRate] = useState(0);
  const [precise, setPrecise] = useState(false);
  const [applyPrivacy, setApplyPrivacy] = useState(true);
  const [keepChapters, setKeepChapters] = useState(true);
  const [applyOverlays, setApplyOverlays] = useState(true);
  const drawingsOn = applyOverlays && (overlays.length > 0 || Boolean(watermark));
  const srcW = record.width ?? 0;
  const srcH = record.height ?? 0;
  const out = scaledSize(srcW, srcH, resolution || null);
  const privacyOn = applyPrivacy && redactions.length > 0;
  const transforms = Boolean(out.scaled || quality !== 'original' || frameRate || (precise && useTrim) || privacyOn || drawingsOn);
  const [progress, setProgress] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  /** What the export is doing now: encoding has a percentage, the last steps only a moving bar. */
  const [phase, setPhase] = useState<ExportStage | 'saving'>('encoding');
  const startedAt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) setUseTrim(Boolean(trim));
  }, [open, trim]);

  async function run(keepInHistory: boolean) {
    setWorking(true);
    setProgress(0);
    setPhase('encoding');
    startedAt.current = performance.now();
    abortRef.current = new AbortController();
    try {
      // Text drawings need their fonts before frames are drawn.
      if (drawingsOn) await ensureFonts(usedFonts({ annotations: overlays.map((o) => o.annotation) } as EditorDoc));
      // Lazy-load the media toolkit only when exporting.
      const { exportVideo } = await import('../services/export-service');
      const range = useTrim && trim ? trim : null;
      const result = await exportVideo(source, {
        container,
        ...(range ? { trimStart: range.start, trimEnd: range.end } : {}),
        onProgress: setProgress,
        onStage: setPhase,
        signal: abortRef.current.signal,
        hardwareAcceleration: hardwareAcceleration === 'auto' ? 'no-preference' : hardwareAcceleration,
        removeAudio: !keepAudio || !hasAudio,
        resolution: resolution || null,
        quality: quality === 'original' ? null : quality,
        frameRate: frameRate || null,
        precise: precise && Boolean(range),
        redactions: privacyOn ? redactions : [],
        overlays: drawingsOn ? overlays : [],
        watermark: drawingsOn ? watermark : null,
        chapters: keepChapters ? markers : [],
      });
      setPhase('saving');
      const sizeTag = out.scaled ? ` (${Math.min(out.width, out.height)}p)` : '';
      const suffix = `${range ? ' (trimmed)' : ''}${sizeTag}${keepAudio && hasAudio ? '' : ' (no audio)'}`;
      // Append the extension directly: names often contain dots (times like 22.00.46).
      const name = `${stripExtension(record.name)}${suffix}.${container}`;
      if (keepInHistory) {
        await addCapture(
          {
            kind: 'video',
            name,
            mimeType: result.mimeType,
            width: out.width || record.width,
            height: out.height || record.height,
            fps: frameRate || record.fps,
            durationMs: Math.round(((range ? range.end - range.start : duration) || (record.durationMs ?? 0) / 1000) * 1000),
            videoCodec: container === 'mp4' ? 'MP4' : 'WebM',
            audio: keepAudio && hasAudio ? record.audio : { microphone: false, system: false },
            thumbnail: record.thumbnail,
            sourceTitle: record.sourceTitle,
            notes: [`Exported from “${record.name}”.`, ...(privacyOn ? [`${redactions.length} privacy region${redactions.length > 1 ? 's' : ''} applied.`] : [])],
            markers: keepChapters ? markers.filter((m) => !range || (m.timeMs / 1000 >= range.start && m.timeMs / 1000 <= range.end)).map((m) => ({ ...m, timeMs: m.timeMs - Math.round((range?.start ?? 0) * 1000) })) : [],
          },
          result.blob,
        );
        onSaved();
        toast.success('Saved to Recent captures', name);
      }
      await onDownload(result.blob, name);
      onClose();
    } catch (err) {
      const info = errorInfoOf(err);
      if (info.code !== 'cancelled') toast.error(info);
    } finally {
      setWorking(false);
      setProgress(null);
    }
  }

  const timeLeft = progress !== null ? timeLeftLabel(progress, performance.now() - startedAt.current) : null;

  return (
    <Modal
      open={open}
      title="Export recording"
      onClose={() => { abortRef.current?.abort(); onClose(); }}
      width={520}
      footer={
        working ? (
          <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
            Cancel export
          </Button>
        ) : (
          <>
            <Button onClick={() => void run(true)}>Export &amp; keep copy</Button>
            <Button variant="primary" onClick={() => void run(false)}>
              Export &amp; download
            </Button>
          </>
        )
      }
    >
      <div className={styles.exportBody}>
        <div>
          <div className={styles.fieldLabel}>Format</div>
          <RadioGroup
            label="Format"
            value={container}
            onChange={setContainer}
            options={[
              { value: 'webm', label: 'WebM' },
              { value: 'mp4', label: 'MP4 (H.264)' },
            ]}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Range</div>
          <RadioGroup
            label="Range"
            value={useTrim ? 'trim' : 'full'}
            onChange={(v) => setUseTrim(v === 'trim')}
            options={[
              { value: 'full', label: 'Full recording' },
              { value: 'trim', label: trim ? `Trimmed (${formatDuration((trim.end - trim.start) * 1000)})` : 'Trimmed', disabled: !trim },
            ]}
          />
        </div>
        <div className={styles.exportRow}>
          <div>
            <div className={styles.fieldLabel}>Resolution</div>
            <Select
              label="Resolution"
              value={resolution}
              minWidth={230}
              onChange={setResolution}
              options={[
                { value: 0, label: `Original${srcW && srcH ? ` (${srcW} × ${srcH})` : ''}` },
                ...RESOLUTIONS.map((r) => {
                  const larger = Boolean(srcW && srcH && r.value >= Math.min(srcW, srcH));
                  return { value: r.value, label: larger ? `${r.label} — source is smaller` : r.label, disabled: larger };
                }),
              ]}
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>Frame rate</div>
            <Select
              label="Frame rate"
              value={frameRate}
              minWidth={150}
              onChange={setFrameRate}
              options={[
                { value: 0, label: `Original${record.fps ? ` (${record.fps} fps)` : ''}` },
                ...[60, 30, 24, 15].map((f) => ({ value: f, label: `${f} fps`, disabled: Boolean(record.fps && f > record.fps) })),
              ]}
            />
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Quality</div>
          <RadioGroup<QualityChoice>
            label="Quality"
            value={quality}
            onChange={setQuality}
            options={[
              { value: 'original', label: 'Original' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
              { value: 'very-low', label: 'Smallest' },
            ]}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Audio</div>
          {hasAudio ? (
            <RadioGroup
              label="Audio"
              value={keepAudio ? 'keep' : 'remove'}
              onChange={(v) => setKeepAudio(v === 'keep')}
              options={[
                { value: 'keep', label: 'Keep audio' },
                { value: 'remove', label: 'Remove audio' },
              ]}
            />
          ) : (
            <div className={styles.noAudioNote} role="note">
              <VolumeX size={15} /> This video has no audio — the export will be silent.
            </div>
          )}
        </div>
        <div className={styles.exportChecks}>
          {useTrim && trim && <Checkbox checked={precise} onChange={setPrecise} label="Frame-accurate cut" description="Re-encodes so the cut lands exactly on your start time (slower)." />}
          {redactions.length > 0 && <Checkbox checked={applyPrivacy} onChange={setApplyPrivacy} label={`Apply ${redactions.length} privacy region${redactions.length > 1 ? 's' : ''}`} description="Blur, pixelate or mask the regions in the exported video." />}
          {markers.length > 0 && <Checkbox checked={keepChapters} onChange={setKeepChapters} label="Keep chapters" description="Written into the file description (“00:00 Title”)." />}
          {(overlays.length > 0 || watermark) && (
            <Checkbox checked={applyOverlays} onChange={setApplyOverlays} label={`Burn in drawings${overlays.length ? ` (${overlays.length})` : ''}${watermark ? ' and watermark' : ''}`} description="Drawn into every frame with their animations and effects (the video is re-encoded)." />
          )}
        </div>
        <div className={styles.exportSummary} aria-label="Output summary">
          Output: {out.width && out.height ? `${out.width} × ${out.height}` : 'original size'} · {container === 'mp4' ? 'MP4' : 'WebM'}
          {frameRate ? ` · ${frameRate} fps` : ''} · {keepAudio && hasAudio ? 'with audio' : 'no audio'}
        </div>
        <InlineNotice>
          {container === sourceContainer && !transforms
            ? 'Same format: video is copied without re-encoding (fast, no quality loss). Cuts snap to the nearest key frame.'
            : 'The video is re-encoded on this device using your GPU/CPU. Lower resolution or quality makes a smaller file. Long or 4K recordings can take a while. Your original stays untouched.'}
        </InlineNotice>
        {progress !== null && (
          <ProgressIndicator
            value={phase === 'encoding' ? progress : null}
            label={phase === 'saving' ? 'Saving the video…' : phase === 'finishing' ? 'Finishing the file…' : `Encoding video…${timeLeft ? ` ${timeLeft} left` : ''}`}
          />
        )}
      </div>
    </Modal>
  );
}

const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';

/** Opens a video file from this computer so it can be trimmed, converted, resized or muted. */
function VideoImport() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function open(file: File | undefined) {
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) {
      toast.error('That is not a video file', 'Pick an MP4, WebM, MOV or MKV file.');
      return;
    }
    setBusy(true);
    try {
      const { probeVideo } = await import('../services/export-service');
      const info = await probeVideo(file).catch(() => null);
      if (!info || !info.videoCodec) throw new Error('This file can’t be opened. Use an MP4, WebM, MOV or MKV video.');
      const record = await addCapture(
        {
          kind: 'video',
          name: file.name,
          mimeType: file.type || (file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'),
          width: info.width,
          height: info.height,
          durationMs: Math.round(info.durationSec * 1000),
          videoCodec: info.videoCodec.toUpperCase(),
          audio: { microphone: false, system: info.audioCodec !== null },
          thumbnail: await generateVideoThumbnail(file),
          sourceTitle: 'Local file',
          notes: ['Opened from a file on this computer. The original file is not changed.'],
        },
        file,
      );
      broadcast({ target: 'broadcast', type: 'history/changed' });
      location.replace(chrome.runtime.getURL(`video.html?id=${encodeURIComponent(record.id)}`));
    } catch (err) {
      toast.error(errorInfoOf(err));
      setBusy(false);
    }
  }

  return (
    <div
      className={`${styles.importZone} ${dragging ? styles.importDragging : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void open(e.dataTransfer.files[0]); }}
    >
      <FileVideo size={40} strokeWidth={1.5} />
      <h1 className={styles.importTitle}>Edit a video file</h1>
      <p className={styles.importText}>Trim, convert to MP4 or WebM, change the resolution (480p – 4K) or quality, or remove the audio. Everything happens on this device.</p>
      <Button variant="primary" icon={<Upload size={16} />} loading={busy} onClick={() => inputRef.current?.click()}>
        Choose a video…
      </Button>
      <p className={styles.importHint}>…or drop a file here (MP4, WebM, MOV, MKV)</p>
      <input ref={inputRef} type="file" accept={VIDEO_ACCEPT} hidden aria-label="Video file" onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
