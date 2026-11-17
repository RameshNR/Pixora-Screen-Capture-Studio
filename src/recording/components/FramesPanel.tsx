import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, ExternalLink, ImagePlus, Pencil, Play, Plus, Save, Trash2, Workflow } from 'lucide-react';
import type { CaptureRecord, FlowDoc, Settings, VideoRedaction } from '@/shared/types';
import { Button, IconButton } from '@/shared/components/Button';
import { useToast } from '@/shared/components/Toast';
import { broadcast, errorInfoOf, onBroadcast } from '@/shared/messaging/client';
import { addCapture, getCapture, updateCapture } from '@/history/history-service';
import { copyImageToClipboard, downloadBlob } from '@/shared/utils/download';
import { stripExtension } from '@/shared/utils/filename';
import { createFlowFromImages, findDuplicate, getFlow, imageDigest, insertVideoFrame, itemVideoMs, softDeleteFlowImages, updateFlow } from '@/flow/flow-store';
import { trimBars } from '../services/trim-bars';
import { generateImageThumbnail } from '../services/thumbnail';
import { activeRedactions, applyRedactions } from '../services/redaction';
import type { VideoPlayerHandle } from './VideoPlayer';
import { usePageContextMenu } from '@/shared/components/PageContextMenu';
import styles from './VideoTools.module.css';

interface Frame {
  id: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  timeSec: number;
  caption: string;
  digest: string;
}

/** An image of the flow recorded with this video (a recorded step or a frame added here). */
interface FlowStepFrame {
  id: string;
  index: number;
  description: string;
  thumbnail?: string;
  /** Position in the video (seconds), when known. */
  timeSec: number | null;
  /** Added from the video here (not taken by Flow Capture). */
  added: boolean;
}

interface Props {
  record: CaptureRecord;
  settings: Settings;
  player: RefObject<VideoPlayerHandle>;
  regions: VideoRedaction[];
  time: number;
  /** Changes when the "Flow steps" button is pressed: scroll the step list into view. */
  focusSteps?: number;
  /** Number of images in the linked flow changed. */
  onStepCount?: (n: number) => void;
  /** Bumped by the header's "Create flow" button: build the flow from the frames added here. */
  createRequest?: number;
  /** Number of frames picked by hand (not yet a flow) changed. */
  onFrameCount?: (n: number) => void;
  /** The flow was created and linked to this recording. */
  onFlowCreated?: (record: CaptureRecord) => void;
}

/** "0:12.4" */
function stamp(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * Video frames as images: copy, download or save the current frame (privacy regions applied),
 * and build a flow from frames picked by hand.
 */
export function FramesPanel({ record, settings, player, regions, time, focusSteps = 0, onStepCount, createRequest = 0, onFrameCount, onFlowCreated }: Props) {
  const toast = useToast();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [name, setName] = useState(() => `${stripExtension(record.name)} – steps`);
  const [busy, setBusy] = useState<string | null>(null);
  const stepMenu = usePageContextMenu(noMenu, { global: false });
  const urls = useRef(new Set<string>());
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Images captured by Flow Capture during this recording, shown here with their video times.
  const [flow, setFlow] = useState<FlowDoc | null>(null);
  const [steps, setSteps] = useState<FlowStepFrame[]>([]);
  const thumbs = useRef(new Map<string, string | undefined>());
  const showFlow = async (doc: FlowDoc) => {
    const list = await Promise.all(
      doc.items.map(async (it, index) => {
        if (!thumbs.current.has(it.id)) thumbs.current.set(it.id, (await getCapture(it.id))?.thumbnail);
        const ms = itemVideoMs(doc, it.id);
        return { id: it.id, index, description: it.description || it.pageTitle || `Image ${index + 1}`, thumbnail: thumbs.current.get(it.id), timeSec: ms !== null ? ms / 1000 : null, added: !it.auto && it.mode === 'visible' && !it.url };
      }),
    );
    setFlow(doc);
    setSteps(list);
    onStepCount?.(doc.items.length);
  };
  useEffect(() => {
    if (!record.linkedFlowId) return;
    let alive = true;
    void getFlow(record.linkedFlowId).then((doc) => {
      if (doc && alive) void showFlow(doc);
    });
    return () => {
      alive = false;
    };
  }, [record.linkedFlowId]);

  // Changes made in the Flow Editor (deleted, restored or new images) show here too.
  useEffect(() => {
    if (!record.linkedFlowId) return;
    return onBroadcast((m) => {
      if (m.type === 'history/changed') void getFlow(record.linkedFlowId!).then((doc) => doc && showFlow(doc));
    });
  }, [record.linkedFlowId]);

  // "Flow steps" in the header: bring the step list into view.
  const stepsRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focusSteps) return;
    const el = stepsRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(t);
  }, [focusSteps, flow]);

  /** Edits the caption of a flow image (saved when the field is left). */
  const saveCaption = async (id: string, text: string) => {
    if (!flow) return;
    const doc = await updateFlow(flow.id, (d) => ({ ...d, items: d.items.map((it) => (it.id === id ? { ...it, description: text } : it)) }));
    broadcast({ target: 'broadcast', type: 'history/changed' });
    await showFlow(doc);
  };

  const removeStep = (id: string, n: number) => run('remove', async () => {
    if (!flow) return;
    await showFlow(await softDeleteFlowImages(flow.id, [id]));
    broadcast({ target: 'broadcast', type: 'history/changed' });
    toast.success(`Image ${n} removed`, 'You can restore it in the Flow Editor (Deleted images).');
  });

  /** The frame on screen as a PNG (with the privacy regions active at that time burned in). */
  async function grab(): Promise<{ blob: Blob; width: number; height: number; timeSec: number }> {
    const v = player.current?.element();
    if (!v || !v.videoWidth || v.readyState < 2) throw new Error('The video frame is not ready yet. Play or seek the video a moment, then try again.');
    player.current?.pause();
    const t = v.currentTime;
    const W = v.videoWidth;
    const H = v.videoHeight;
    // Black letterbox bars around the picture are cut off (only the recorded content is kept).
    const canvas = trimBars(applyRedactions(
      { displayWidth: W, displayHeight: H, draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(v, dx, dy, dw ?? W, dh ?? H) },
      activeRedactions(regions, t),
    ));
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), width: canvas.width, height: canvas.height, timeSec: t };
  }

  const fileName = (t: number) => `${stripExtension(record.name)} frame ${stamp(t).replace(':', '-')}.png`;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      const info = errorInfoOf(err);
      if (info.code !== 'cancelled') toast.error(info);
    } finally {
      setBusy(null);
    }
  }

  const copy = () => run('copy', async () => {
    const f = await grab();
    await copyImageToClipboard(f.blob);
    toast.success('Frame copied', `At ${stamp(f.timeSec)}`);
  });

  const download = () => run('download', async () => {
    const f = await grab();
    await downloadBlob(f.blob, fileName(f.timeSec), { saveAs: settings.storage.askWhereToSave, subfolder: settings.storage.subfolder });
  });

  /** Saves the frame to Recent captures; `edit` also opens it in the screenshot editor. */
  const save = (edit: boolean) => run(edit ? 'edit' : 'save', async () => {
    const f = await grab();
    const rec = await addCapture(
      { kind: 'screenshot', name: fileName(f.timeSec), mimeType: 'image/png', width: f.width, height: f.height, thumbnail: await generateImageThumbnail(f.blob), sourceTitle: `${record.name} at ${stamp(f.timeSec)}` },
      f.blob,
    );
    broadcast({ target: 'broadcast', type: 'history/changed' });
    if (edit) await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?id=${encodeURIComponent(rec.id)}`) });
    else toast.success('Frame saved to Recent captures', rec.name);
  });

  const addFrame = () => run('add', async () => {
    const f = await grab();
    const digest = await imageDigest(f.blob);
    if (flow) {
      // A recording with flow steps: the frame joins them, in video order.
      const doc = (await getFlow(flow.id)) ?? flow;
      const same = findDuplicate(doc.items, digest);
      if (same >= 0) {
        toast.info(`Same picture as image ${same + 1}`, 'Identical images are not added twice.');
        return;
      }
      const res = await insertVideoFrame(flow.id, { blob: f.blob, width: f.width, height: f.height, videoMs: Math.round(f.timeSec * 1000), description: `Frame at ${stamp(f.timeSec)}`, digest, pageTitle: record.name });
      broadcast({ target: 'broadcast', type: 'history/changed' });
      await showFlow(res.doc);
      const at = res.doc.items.findIndex((it) => it.id === res.item.id);
      toast.success(`Frame added as image ${at + 1}`, `At ${stamp(f.timeSec)}, between the recorded steps`);
      return;
    }
    const same = frames.findIndex((x) => x.digest === digest);
    if (same >= 0) {
      toast.info(`Same picture as frame ${same + 1}`, 'Identical frames are not added twice.');
      return;
    }
    const url = URL.createObjectURL(f.blob);
    urls.current.add(url);
    const frame: Frame = { id: crypto.randomUUID(), ...f, url, caption: '', digest };
    // Frames stay in video order.
    setFrames((list) => [...list, frame].sort((a, b) => a.timeSec - b.timeSec));
  });

  const update = (id: string, patch: Partial<Frame>) => setFrames((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) =>
    setFrames((list) => {
      const f = list.find((x) => x.id === id);
      if (f) {
        URL.revokeObjectURL(f.url);
        urls.current.delete(f.url);
      }
      return list.filter((x) => x.id !== id);
    });
  const move = (i: number, dir: -1 | 1) =>
    setFrames((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const createFlow = () => run('flow', async () => {
    const id = await createFlowFromImages({
      name: name.trim() || `${stripExtension(record.name)} – steps`,
      recordingId: record.id,
      sourceTitle: record.name,
      images: frames.map((f, i) => ({ blob: f.blob, width: f.width, height: f.height, description: f.caption.trim() || `Step ${i + 1} (${stamp(f.timeSec)})`, videoMs: Math.round(f.timeSec * 1000) })),
    });
    // Linked to the recording: its images show here as flow steps, and "Open flow" opens it.
    const linked = await updateCapture(record.id, { linkedFlowId: id }).catch(() => null);
    broadcast({ target: 'broadcast', type: 'history/changed' });
    frames.forEach((f) => URL.revokeObjectURL(f.url));
    urls.current.clear();
    setFrames([]);
    if (linked) onFlowCreated?.(linked);
    toast.success('Flow created', `${frames.length} step${frames.length === 1 ? '' : 's'} — opening the Flow Editor`);
    await chrome.tabs.create({ url: chrome.runtime.getURL(`flow.html?id=${encodeURIComponent(id)}`) });
  });

  useEffect(() => onFrameCount?.(frames.length), [frames.length]);
  // "Create flow" in the header.
  const lastRequest = useRef(createRequest);
  useEffect(() => {
    if (createRequest === lastRequest.current) return;
    lastRequest.current = createRequest;
    if (frames.length > 0 && busy === null) void createFlow();
  }, [createRequest]);

  return (
    <div className={styles.panel}>
      {stepMenu.element}
      <h3 className={styles.framesTitle}>This frame <span className={styles.framesTime}>{stamp(time)}</span></h3>
      <div className={styles.frameActions}>
        <Button size="sm" icon={<Copy size={14} />} loading={busy === 'copy'} disabled={busy !== null} onClick={() => void copy()}>Copy</Button>
        <Button size="sm" icon={<Download size={14} />} loading={busy === 'download'} disabled={busy !== null} onClick={() => void download()}>Download</Button>
        <Button size="sm" icon={<Save size={14} />} loading={busy === 'save'} disabled={busy !== null} onClick={() => void save(false)}>Save</Button>
        <Button size="sm" icon={<Pencil size={14} />} loading={busy === 'edit'} disabled={busy !== null} onClick={() => void save(true)}>Edit</Button>
      </div>
      <p className={styles.hint}>PNG at the video’s full resolution. Privacy regions active at this moment are applied. “Save” adds it to Recent captures.</p>

      {flow && (
        <div ref={stepsRef} className={`${styles.stepsBlock} ${flash ? styles.stepsFlash : ''}`}>
          <h3 className={styles.framesTitle}>Flow steps <span className={styles.framesTime}>{steps.length}</span></h3>
          <p className={styles.hint}>Images Flow Capture took while recording. Frames you add join them in video order.</p>
          {/* Both actions at the top: with many steps the list is long. */}
          <div className={styles.stepsActions}>
            <Button size="sm" variant="primary" icon={<Plus size={14} />} loading={busy === 'add'} disabled={busy !== null} onClick={() => void addFrame()}>
              Add this frame ({stamp(time)})
            </Button>
            <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL(`flow.html?id=${encodeURIComponent(flow.id)}`) })}>Open in Flow Editor</Button>
          </div>
          {steps.length === 0 ? (
            <p className={styles.hint}>No images yet. Pause on a moment of the video and add the frame.</p>
          ) : (
            <ol className={styles.chapters} aria-label="Flow steps of this recording">
              {steps.map((s) => (
                <li key={s.id} className={s.timeSec !== null && Math.abs(s.timeSec - time) < 0.05 ? styles.chapterOn : undefined}
                  onContextMenu={(e) => stepMenu.handle(e, [
                    { id: 'go', label: s.timeSec !== null ? `Go to ${stamp(s.timeSec)}` : 'Go to', icon: <Play size={14} />, disabled: s.timeSec === null, onSelect: () => s.timeSec !== null && player.current?.seek(s.timeSec) },
                    { id: 'open', label: 'Open in Flow Editor', icon: <ExternalLink size={14} />, onSelect: () => void chrome.tabs.create({ url: chrome.runtime.getURL(`flow.html?id=${encodeURIComponent(flow.id)}`) }) },
                    { id: 'remove', label: `Remove step ${s.index + 1}`, icon: <Trash2 size={14} />, danger: true, separatorBefore: true, disabled: busy !== null, onSelect: () => void removeStep(s.id, s.index + 1) },
                  ])}>
                  <div className={styles.frameRow}>
                    <button type="button" className={styles.frameThumb} disabled={s.timeSec === null} onClick={() => s.timeSec !== null && player.current?.seek(s.timeSec)}
                      aria-label={s.timeSec !== null ? `Go to step ${s.index + 1} at ${stamp(s.timeSec)}` : `Step ${s.index + 1}`}>
                      {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <ImagePlus size={16} />}
                      {s.added && <span className={styles.addedTag} title="Frame added from the video">Added</span>}
                    </button>
                    <div className={styles.frameInfo}>
                      <span className={styles.stepMeta}>
                        <span className={`${styles.chapterTime} ${styles.stepTime}`}>{s.index + 1}{s.timeSec !== null ? ` · ${stamp(s.timeSec)}` : ''}</span>
                        <span className={styles.stepSpacer} />
                        <IconButton size="sm" label={`Remove step ${s.index + 1}`} icon={<Trash2 size={13} />} disabled={busy !== null} onClick={() => void removeStep(s.id, s.index + 1)} />
                      </span>
                      <input key={s.description} className={`${styles.desc} ${styles.stepCaption}`} defaultValue={s.description} aria-label={`Caption of step ${s.index + 1}`}
                        onBlur={(e) => { if (e.target.value !== s.description) void saveCaption(s.id, e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {!flow && <>
      <h3 className={styles.framesTitle}>Flow from frames</h3>
      <p className={styles.hint}>Pause on each step of the video and add the frame. Frames are kept in video order; identical frames are skipped.</p>
      <Button size="sm" variant="primary" icon={<Plus size={14} />} loading={busy === 'add'} disabled={busy !== null} onClick={() => void addFrame()}>
        Add this frame ({stamp(time)})
      </Button>
      {frames.length > 0 && (
        <>
          <ol className={styles.chapters} aria-label="Frames for the flow">
            {frames.map((f, i) => (
              <li key={f.id}>
                <div className={styles.frameRow}>
                  <button type="button" className={styles.frameThumb} onClick={() => player.current?.seek(f.timeSec)} aria-label={`Go to frame ${i + 1} at ${stamp(f.timeSec)}`}>
                    <img src={f.url} alt="" />
                  </button>
                  <div className={styles.frameInfo}>
                    <span className={styles.chapterTime}>{i + 1} · {stamp(f.timeSec)}</span>
                    <input className={styles.desc} value={f.caption} placeholder="Describe this step" aria-label={`Caption of frame ${i + 1}`} onChange={(e) => update(f.id, { caption: e.target.value })} />
                  </div>
                </div>
                <div className={styles.chapterActions}>
                  <IconButton size="sm" label="Move up" icon={<ArrowUp size={13} />} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton size="sm" label="Move down" icon={<ArrowDown size={13} />} disabled={i === frames.length - 1} onClick={() => move(i, 1)} />
                  <IconButton size="sm" label={`Remove frame ${i + 1}`} icon={<Trash2 size={13} />} onClick={() => remove(f.id)} />
                </div>
              </li>
            ))}
          </ol>
          <div className={styles.flowNameRow}>
            <span className={styles.flowNameLabel}>Flow name</span>
            <input className={`${styles.desc} ${styles.flowNameInput}`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Flow name" />
          </div>
          <Button variant="primary" icon={<Workflow size={15} />} loading={busy === 'flow'} disabled={busy !== null} onClick={() => void createFlow()}>
            Create flow ({frames.length} frame{frames.length === 1 ? '' : 's'})
          </Button>
        </>
      )}
      {frames.length === 0 && (
        <p className={styles.hint}>
          <ImagePlus size={13} style={{ verticalAlign: -2 }} /> No frames yet.
        </p>
      )}
      </>}
    </div>
  );
}

const noMenu = () => null;
