import { CheckSquare, Workflow, X } from 'lucide-react';
import { getFlow, groupIntoFlow, renameCountNamedFlows } from '@/flow/flow-store';
import { BusyPill } from '@/shared/components/BusyPill';
import { addToGroup, loadGroups, newGroup, pruneGroups, removeFromGroups, saveGroups, type CaptureGroup } from '../capture-groups';
import { ArrowLeft, Folder, FolderPlus, FolderMinus } from 'lucide-react';
import { exportZip } from '@/flow/flow-export';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, Film, FolderOpen, Image as ImageIcon, MoreHorizontal, Pencil, Play, Trash2, Inbox } from 'lucide-react';
import type { CaptureRecord, Settings } from '@/shared/types';
import { Button, IconButton } from '@/shared/components/Button';
import { ContextMenu, Dropdown, Select, useContextMenu, type MenuItem } from '@/shared/components/Dropdown';
import { RadioGroup, TextField } from '@/shared/components/FormControls';
import { ConfirmationDialog, Modal } from '@/shared/components/Modal';
import { Spinner } from '@/shared/components/Progress';
import { useToast } from '@/shared/components/Toast';
import { broadcast, errorInfoOf, onBroadcast } from '@/shared/messaging/client';
import { copyImageToClipboard, downloadBlob, SAVED_TO_FOLDER, showInFolder } from '@/shared/utils/download';
import { extensionForMime, replaceExtension, stripExtension } from '@/shared/utils/filename';
import { formatBytes, formatDateTime, formatDuration, formatResolution } from '@/shared/utils/format';
import { deleteCapture, getCaptureBlob, listCaptures, updateCapture, type HistoryFilter, type HistorySort } from '../history-service';
import styles from './history.module.css';
import { formatKeys } from '@/shared/utils/keys';

/** Several screenshots open together in the editor (its image list). */
export function openImages(list: CaptureRecord[]): void {
  const ids = list.map((c) => encodeURIComponent(c.id));
  void chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?id=${ids[0]}${ids.length > 1 ? `&set=${ids.join(',')}` : ''}`) });
}

/** "4 images" of a flow (from its subtitle), or ''. */
export function imageCount(c: CaptureRecord): string {
  return /^\d+ images?/.exec(c.sourceTitle ?? '')?.[0] ?? '';
}

/** An empty drag picture (the page draws its own, at full strength). */
const BLANK = (() => {
  const img = new Image();
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  return img;
})();

export function openCapture(c: CaptureRecord): void {
  const page = c.kind === 'video' ? 'video.html' : c.kind === 'flow' ? 'flow.html' : 'editor.html';
  void chrome.tabs.create({ url: chrome.runtime.getURL(`${page}?id=${encodeURIComponent(c.id)}`) });
}

/** Recent captures: screenshots and recordings stored locally in IndexedDB. */
export function HistoryView({ settings }: { settings: Settings }) {
  const toast = useToast();
  const [items, setItems] = useState<CaptureRecord[] | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [sort, setSort] = useState<HistorySort>('newest');
  const [renaming, setRenaming] = useState<CaptureRecord | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [deleting, setDeleting] = useState<CaptureRecord | null>(null);
  const context = useContextMenu();
  const [contextItem, setContextItem] = useState<CaptureRecord | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Which bulk action is running (its button shows the spinner). */
  const [bulkAction, setBulkAction] = useState<'download' | 'delete' | null>(null);
  /** Captures being downloaded right now (their download buttons spin). */
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
  /** Groups: any captures (videos too) kept together under a name; the open group; renaming. */
  const [groups, setGroups] = useState<CaptureGroup[]>([]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  useEffect(() => { void loadGroups().then(setGroups); }, []);
  const changeGroups = (fn: (g: CaptureGroup[]) => CaptureGroup[]) => setGroups((cur) => { const next = fn(cur); void saveGroups(next); return next; });
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;

  const refresh = useCallback(() => {
    void listCaptures(filter, sort)
      .then(async (list) => {
        // Old flows named by a count that went stale ("Flow · 2 images" with 15) get their date name.
        const renamed = await renameCountNamedFlows(list).catch(() => []);
        const byId = new Map(renamed.map((r) => [r.id, r]));
        setItems(list.map((c) => byId.get(c.id) ?? c));
        if (filter === 'all') {
          const existing = new Set(list.map((c) => c.id));
          setGroups((cur) => {
            if (cur.every((g) => g.ids.every((id) => existing.has(id)))) return cur;
            const next = pruneGroups(cur, existing);
            void saveGroups(next);
            return next;
          });
        }
      })
      .catch((err: unknown) => {
        toast.error(errorInfoOf(err));
        setItems([]);
      });
  }, [filter, sort, toast]);

  useEffect(refresh, [refresh]);
  // Drop selections that are no longer listed (deleted, or hidden by the filter).
  useEffect(() => {
    if (items) setSelected((cur) => (cur.size ? new Set([...cur].filter((id) => items.some((i) => i.id === id))) : cur));
  }, [items]);

  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const inGroups = new Set(groups.flatMap((g) => g.ids));
  /** The grid: the open group's captures, or the captures in no group (the groups come first as cards). */
  const shown = items === null ? null : openGroup ? items.filter((c) => openGroup.ids.includes(c.id)) : items.filter((c) => !inGroups.has(c.id));
  const selectedItems = (items ?? []).filter((c) => selected.has(c.id));
  const onlyImages = selectedItems.length > 0 && selectedItems.every((c) => c.kind === 'screenshot');
  const canFlow = selectedItems.length > 1 && selectedItems.every((c) => c.kind !== 'video');
  /** Drag and drop: the card being dragged and the one under it. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  /** Cards going into a flow (shrink away) and the flow they went into (pops). */
  const [merging, setMerging] = useState<Set<string>>(() => new Set());
  const [popId, setPopId] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  /** What is being dragged (one card, or all the selected ones). */
  const dragging = dragId ? (selected.has(dragId) && selected.size > 1 ? selectedItems : (items ?? []).filter((c) => c.id === dragId)) : [];
  const draggingVideo = dragging.some((c) => c.kind === 'video');
  const draggingOnlyVideos = dragging.length > 0 && dragging.every((c) => c.kind === 'video');
  /** A drop target for groups: the group card under the pointer, or the "All captures" crumb. */
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  /** "Videos can't go into a flow" is said once per drag. */
  const videoHintShown = useRef(false);
  useEffect(() => { if (!dragId) videoHintShown.current = false; }, [dragId]);
  function sayVideosNoFlow() {
    if (videoHintShown.current) return;
    videoHintShown.current = true;
    toast.info('Videos can’t go into a flow', 'Flows are made of images. Drop videos on a group to keep them together with screenshots and flows.');
  }
  function dropOnGroup(groupId: string | null) {
    const list = dragging;
    setDragId(null);
    setDropId(null);
    setDropGroup(null);
    if (!list.length) return;
    const ids = list.map((c) => c.id);
    if (groupId) {
      changeGroups((g) => addToGroup(g, groupId, ids));
      const name = groups.find((g) => g.id === groupId)?.name ?? 'the group';
      toast.success(`Added to ${name}`, `${ids.length} item${ids.length === 1 ? '' : 's'}`);
      setPopId(groupId);
      setTimeout(() => setPopId((p) => (p === groupId ? null : p)), 1200);
    } else {
      changeGroups((g) => removeFromGroups(g, ids));
      toast.success('Taken out of the group', `${ids.length} item${ids.length === 1 ? '' : 's'}`);
    }
    setSelected(new Set());
  }
  function createGroup(ids: string[]) {
    const g = newGroup(groups, ids);
    changeGroups((cur) => [g, ...removeFromGroups(cur, ids)]);
    setSelected(new Set());
    setGroupDraft(g.name);
    setEditingGroup(g.id);
  }
  function renameGroup(id: string, name: string) {
    const clean = name.trim();
    setEditingGroup(null);
    if (clean) changeGroups((g) => g.map((x) => (x.id === id ? { ...x, name: clean } : x)));
  }
  function ungroup(id: string) {
    changeGroups((g) => g.filter((x) => x.id !== id));
    if (openGroupId === id) setOpenGroupId(null);
  }
  const dragCount = dragging.reduce((n, c) => n + (c.kind === 'flow' ? Number(/^\d+/.exec(c.sourceTitle ?? '')?.[0] ?? 1) : 1), 0);

  /** Images and flows into one flow (into an existing flow when one is dropped on / chosen first). */
  async function makeFlow(list: CaptureRecord[], into?: string) {
    const usable = list.filter((c) => c.kind !== 'video');
    if (usable.length + (into ? 1 : 0) < 2) return;
    try {
      // The cards going in shrink away while the flow is put together.
      setMerging(new Set(usable.map((c) => c.id).filter((id) => id !== into)));
      setBusyLabel(into ? 'Adding to the flow…' : 'Making the flow…');
      const [id] = await Promise.all([groupIntoFlow(usable.map((c) => c.id), into ? { into } : {}), new Promise((r) => setTimeout(r, 260))]);
      setMerging(new Set());
      setBusyLabel(null);
      setPopId(id);
      setTimeout(() => setPopId((p) => (p === id ? null : p)), 1200);
      setSelected(new Set());
      toast.success(into ? 'Added to the flow' : 'Flow created', `${usable.length} item${usable.length === 1 ? '' : 's'} ${into ? 'added' : 'put together'} — open it in the Flow Editor.`);
      broadcast({ target: 'broadcast', type: 'history/changed' });
      refresh();
    } catch (err) {
      setBusyLabel(null);
      setMerging(new Set());
      toast.error(errorInfoOf(err));
    }
  }
  /** The picture under the pointer while dragging: the thumbnails stacked, with how many. */
  /**
   * The picture under the pointer while dragging: the thumbnails stacked, with how many. Drawn by
   * the page (Chrome's own drag picture is always faded), following the pointer.
   */
  const [ghost, setGhost] = useState<{ list: CaptureRecord[]; x: number; y: number } | null>(null);
  function dragPicture(e: React.DragEvent, list: CaptureRecord[]) {
    e.dataTransfer.setDragImage(BLANK, 0, 0);
    setGhost({ list, x: e.clientX, y: e.clientY });
  }
  useEffect(() => {
    if (!dragId) { setGhost(null); return; }
    const move = (ev: DragEvent) => { if (ev.clientX || ev.clientY) setGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g)); };
    document.addEventListener('dragover', move);
    return () => document.removeEventListener('dragover', move);
  }, [dragId]);
  function dropOn(target: CaptureRecord) {
    const dragged = (items ?? []).find((c) => c.id === dragId);
    setDragId(null);
    setDropId(null);
    if (!dragged || dragged.id === target.id || target.kind === 'video') return;
    // Dragging one of several selected cards moves them all; videos are left out of flows.
    const all = selected.has(dragged.id) && selected.size > 1 ? selectedItems.filter((c) => c.id !== target.id) : [dragged];
    const moving = all.filter((c) => c.kind !== 'video');
    if (moving.length < all.length) sayVideosNoFlow();
    if (!moving.length) return;
    if (target.kind === 'flow') void makeFlow(moving, target.id);
    else {
      const flow = moving.find((c) => c.kind === 'flow');
      if (flow) void makeFlow([target, ...moving.filter((c) => c.id !== flow.id)], flow.id);
      else void makeFlow([target, ...moving]);
    }
  }
  useEffect(() => onBroadcast((m) => m.type === 'history/changed' && refresh()), [refresh]);

  /** The file for a capture; a flow downloads as a ZIP of its (edited) images with metadata. */
  async function fileFor(c: CaptureRecord): Promise<{ blob: Blob; name: string }> {
    if (c.kind === 'flow') {
      const doc = await getFlow(c.id);
      if (!doc || doc.items.length === 0) throw new Error('This flow has no images');
      const blob = await exportZip(doc, { items: doc.items, version: 'edited', format: 'original', quality: 1, metadata: false, steps: false });
      return { blob, name: `${stripExtension(c.name)}.zip` };
    }
    const blob = await getCaptureBlob(c.id);
    if (!blob) throw new Error('The file for this capture is missing');
    return { blob, name: c.name };
  }

  /** Downloads one capture. Bulk downloads never ask where to save each file. */
  async function download(c: CaptureRecord, bulk = false): Promise<boolean> {
    setDownloading((s) => new Set(s).add(c.id));
    try {
      const { blob, name } = await fileFor(c);
      const id = await downloadBlob(blob, name, { saveAs: bulk ? false : settings.storage.askWhereToSave, subfolder: settings.storage.subfolder });
      await updateCapture(c.id, { downloadId: id });
      if (!bulk) refresh();
      return true;
    } catch (err) {
      const info = errorInfoOf(err);
      if (info.code !== 'cancelled') toast.error(info);
      return false;
    } finally {
      setDownloading((s) => {
        const n = new Set(s);
        n.delete(c.id);
        return n;
      });
    }
  }

  async function downloadSelected() {
    setBulkBusy(true);
    setBulkAction('download');
    let done = 0;
    for (const c of selectedItems) if (await download(c, true)) done++;
    setBulkBusy(false);
    setBulkAction(null);
    refresh();
    if (done) toast.success(`Downloaded ${done} item${done === 1 ? '' : 's'}`);
  }

  async function deleteSelected() {
    setBulkBusy(true);
    setBulkAction('delete');
    const list = selectedItems;
    for (const c of list) await deleteCapture(c.id).catch((err: unknown) => toast.error(errorInfoOf(err)));
    setBulkBusy(false);
    setBulkAction(null);
    setBulkDelete(false);
    setSelected(new Set());
    broadcast({ target: 'broadcast', type: 'history/changed' });
    toast.success(`Deleted ${list.length} item${list.length === 1 ? '' : 's'}`);
    refresh();
  }

  async function copy(c: CaptureRecord) {
    try {
      const blob = await getCaptureBlob(c.id);
      if (!blob) throw new Error('missing');
      await copyImageToClipboard(blob);
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error(errorInfoOf(err));
    }
  }

  function menuFor(c: CaptureRecord): MenuItem[] {
    return [
      { id: 'open', label: 'Open', icon: c.kind === 'video' ? <Play size={15} /> : <ExternalLink size={15} />, onSelect: () => openCapture(c) },
      { id: 'rename', label: 'Rename', icon: <Pencil size={15} />, onSelect: () => { setNameDraft(stripExtension(c.name)); setRenaming(c); } },
      { id: 'download', label: c.kind === 'flow' ? 'Download as ZIP' : 'Download', icon: <Download size={15} />, onSelect: () => void download(c) },
      { id: 'select', label: selected.has(c.id) ? 'Deselect' : 'Select', icon: <CheckSquare size={15} />, onSelect: () => toggleSelected(c.id) },
      { id: 'copy', label: c.kind === 'screenshot' ? 'Copy image' : 'Copy (images only)', icon: <Copy size={15} />, disabled: c.kind !== 'screenshot', onSelect: () => void copy(c) },
      {
        id: 'folder',
        label: 'Show in downloads folder',
        icon: <FolderOpen size={15} />,
        disabled: c.downloadId === undefined,
        description: c.downloadId === undefined ? 'Download it first' : undefined,
        onSelect: () => void showInFolder(c.downloadId).then((ok) => !ok && (c.downloadId === SAVED_TO_FOLDER ? toast.info('Saved in your chosen folder', 'Open that folder to find it (Settings › Storage shows its name).') : toast.info('File not found', 'It may have been moved or deleted. Download it again.'))),
      },
      { id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, danger: true, separatorBefore: true, onSelect: () => setDeleting(c) },
    ];
  }

  return (
    <section className={styles.wrap} aria-labelledby="history-title">
      <header className={styles.head}>
        <div>
          <h2 id="history-title" className={styles.title}>Recent captures</h2>
          <p className={styles.subtitle}>Stored privately on this device.</p>
        </div>
        <div className={styles.controls}>
          <RadioGroup<HistoryFilter>
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'screenshot', label: <><ImageIcon size={14} /> Screenshots</> },
              { value: 'video', label: <><Film size={14} /> Videos</> },
              { value: 'flow', label: <><Workflow size={14} /> Flows</> },
            ]}
          />
          <Button size="sm" icon={<FolderPlus size={15} />} onClick={() => createGroup([])}>New group</Button>
          <Select<HistorySort>
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'name', label: 'Name' },
              { value: 'size', label: 'File size' },
            ]}
          />
        </div>
      </header>

      {items !== null && items.length > 0 && (
        <div className={`${styles.selectBar} ${selected.size ? styles.selectBarOn : ''}`} role="toolbar" aria-label="Selection">
          <label className={styles.selectAll}>
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === (shown ?? []).length}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && selected.size < (shown ?? []).length;
              }}
              onChange={(e) => setSelected(e.target.checked ? new Set((shown ?? []).map((i) => i.id)) : new Set())}
              aria-label="Select all"
            />
            {selected.size ? `${selected.size} selected` : 'Select all'}
          </label>
          {selected.size > 0 && (
            <>
              <span className={styles.flex} />
              {onlyImages && (
                <Button size="sm" icon={<ExternalLink size={15} />} onClick={() => openImages(selectedItems)}>
                  {selectedItems.length > 1 ? `Open ${selectedItems.length} images` : 'Open'}
                </Button>
              )}
              {canFlow && (
                <Button size="sm" icon={<Workflow size={15} />} onClick={() => { const f = selectedItems.find((c) => c.kind === 'flow'); void makeFlow(f ? selectedItems.filter((c) => c.id !== f.id) : selectedItems, f?.id); }}>
                  Make flow
                </Button>
              )}
              {openGroup ? (
                <Button size="sm" icon={<FolderMinus size={15} />} onClick={() => { changeGroups((g) => removeFromGroups(g, [...selected])); setSelected(new Set()); }}>
                  Remove from group
                </Button>
              ) : (
                <Button size="sm" icon={<FolderPlus size={15} />} onClick={() => createGroup([...selected])}>
                  Group
                </Button>
              )}
              <Button size="sm" icon={<Download size={15} />} loading={bulkAction === 'download'} disabled={bulkBusy} onClick={() => void downloadSelected()}>
                Download
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={15} />} disabled={bulkBusy} onClick={() => setBulkDelete(true)}>
                Delete
              </Button>
              <IconButton size="sm" label="Clear selection" icon={<X size={15} />} onClick={() => setSelected(new Set())} />
            </>
          )}
        </div>
      )}

      {items === null ? (
        <div className={styles.empty}>
          <Spinner size={22} />
        </div>
      ) : items.length === 0 && groups.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Inbox size={30} />
          </span>
          <h3>{filter === 'all' ? 'No captures yet' : filter === 'video' ? 'No recordings yet' : 'No screenshots yet'}</h3>
          <p>{formatKeys('Click the Pixora icon in the toolbar (or press Alt+Shift+V) to take your first screenshot or start a recording.')}</p>
        </div>
      ) : (
        <>
        {dragId && (
          <div className={styles.dragGuide} role="status">
            <Workflow size={16} aria-hidden />
            {draggingOnlyVideos
              ? `Dragging ${dragging.length} video${dragging.length === 1 ? '' : 's'} — drop on a group to add ${dragging.length === 1 ? 'it' : 'them'}. Videos can't go into a flow.`
              : `Dragging ${dragCount} item${dragCount === 1 ? '' : 's'} — drop on an image to make a flow, on a flow to add to it, or on a group.${draggingVideo ? ' Videos only go into groups.' : ''}`}
          </div>
        )}
        {openGroup && (
          <div className={styles.groupBar}>
            <button type="button" className={`${styles.crumb} ${dropGroup === 'out' ? styles.crumbDrop : ''}`} onClick={() => { setOpenGroupId(null); setSelected(new Set()); }}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); setDropGroup('out'); }} onDragLeave={() => setDropGroup(null)} onDrop={(e) => { e.preventDefault(); dropOnGroup(null); }}
              title="Back to all captures (drop here to take items out of the group)">
              <ArrowLeft size={15} /> All captures
            </button>
            <span className={styles.crumbSep}>/</span>
            {editingGroup === openGroup.id ? (
              <input className={styles.groupName} autoFocus aria-label="Group name" value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)}
                onBlur={() => renameGroup(openGroup.id, groupDraft)} onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(openGroup.id, groupDraft); if (e.key === 'Escape') setEditingGroup(null); }} />
            ) : (
              <button type="button" className={styles.groupTitle} title="Rename the group" aria-label={`Rename the group (${openGroup.name})`} onClick={() => { setGroupDraft(openGroup.name); setEditingGroup(openGroup.id); }}>
                <Folder size={16} /> {openGroup.name} <Pencil size={13} />
              </button>
            )}
            <span className={styles.flex} />
            <Button size="sm" variant="ghost" icon={<FolderMinus size={15} />} onClick={() => ungroup(openGroup.id)}>Ungroup</Button>
          </div>
        )}
        <ul className={styles.grid}>
          {!openGroup && groups.map((g) => {
            const members = (items ?? []).filter((c) => g.ids.includes(c.id));
            const videos = members.filter((c) => c.kind === 'video').length;
            return (
              <li key={g.id} className={`${styles.card} ${styles.groupCard} ${dropGroup === g.id ? styles.cardDrop : ''} ${popId === g.id ? styles.cardPop : ''}`}
                onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropGroup !== g.id) setDropGroup(g.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropGroup((d) => (d === g.id ? null : d)); }}
                onDrop={(e) => { e.preventDefault(); dropOnGroup(g.id); }}>
                <button type="button" className={styles.thumb} onClick={() => { setOpenGroupId(g.id); setSelected(new Set()); }} aria-label={`Open group ${g.name}`}>
                  <span className={styles.mosaic}>
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i}>{members[i]?.thumbnail ? <img src={members[i]!.thumbnail} alt="" loading="lazy" /> : null}</span>
                    ))}
                  </span>
                  <span className={styles.kind}><Folder size={12} aria-hidden /> Group</span>
                  {dropGroup === g.id && (
                    <span className={styles.dropHint}>
                      <FolderPlus size={22} aria-hidden />
                      <strong>Add {dragging.length} to {g.name}</strong>
                      <small>Screenshots, flows and videos</small>
                    </span>
                  )}
                </button>
                <div className={styles.info}>
                  <div className={styles.nameRow}>
                    {editingGroup === g.id ? (
                      <input className={styles.groupName} autoFocus aria-label="Group name" value={groupDraft} onChange={(e) => setGroupDraft(e.target.value)}
                        onBlur={() => renameGroup(g.id, groupDraft)} onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(g.id, groupDraft); if (e.key === 'Escape') setEditingGroup(null); }} />
                    ) : (
                      <span className={styles.name} title={g.name}>{g.name}</span>
                    )}
                    <IconButton size="sm" label={`Rename ${g.name}`} icon={<Pencil size={15} />} onClick={() => { setGroupDraft(g.name); setEditingGroup(g.id); }} />
                    <IconButton size="sm" label={`Ungroup ${g.name}`} icon={<FolderMinus size={15} />} onClick={() => ungroup(g.id)} />
                  </div>
                  <div className={styles.meta}>
                    {members.length} item{members.length === 1 ? '' : 's'}{videos ? ` · ${videos} video${videos === 1 ? '' : 's'}` : ''}
                  </div>
                  <div className={styles.meta}>{members.length ? 'Drop captures here to add them' : 'Empty — drag captures here'}</div>
                </div>
              </li>
            );
          })}
          {(shown ?? []).map((c) => (
            <li
              key={c.id}
              className={`${styles.card} ${selected.has(c.id) ? styles.cardSelected : ''} ${dropId === c.id ? styles.cardDrop : ''} ${dragging.some((d) => d.id === c.id) ? styles.cardDragging : ''} ${dragId && (c.kind === 'video' || draggingOnlyVideos) && !dragging.some((d) => d.id === c.id) ? styles.cardNoDrop : ''} ${merging.has(c.id) ? styles.cardMerging : ''} ${popId === c.id ? styles.cardPop : ''}`}
              draggable
              title={c.kind !== 'video' ? 'Drag onto another image or flow to make a flow, or onto a group' : 'Drag onto a group to keep it with other captures'}
              onDragStart={(e) => {
                setDragId(c.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-pixora-capture', c.id);
                dragPicture(e, selected.has(c.id) && selected.size > 1 ? selectedItems : [c]);
              }}
              onDragEnd={() => { setDragId(null); setDropId(null); }}
              onDragEnter={() => { if (dragId && dragId !== c.id && c.kind !== 'video' && draggingOnlyVideos) sayVideosNoFlow(); }}
              onDragOver={(e) => {
                if (!dragId || dragId === c.id || c.kind === 'video' || draggingOnlyVideos) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropId !== c.id) setDropId(c.id);
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropId((d) => (d === c.id ? null : d)); }}
              onDrop={(e) => { e.preventDefault(); dropOn(c); }}
              onContextMenu={(e) => {
                setContextItem(c);
                context.open(e);
              }}
            >
              <label className={`${styles.check} ${selected.size ? styles.checkShown : ''}`} title={selected.has(c.id) ? 'Deselect' : 'Select'}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} aria-label={`Select ${c.name}`} />
              </label>
              <button type="button" className={styles.thumb} onClick={() => (selected.size ? toggleSelected(c.id) : openCapture(c))} aria-label={`Open ${c.name}`}>
                {c.thumbnail ? <img src={c.thumbnail} alt="" loading="lazy" /> : <span className={styles.noThumb}>{c.kind === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}</span>}
                {c.kind === 'video' && (
                  <>
                    <span className={styles.play}>
                      <Play size={18} fill="currentColor" />
                    </span>
                    {c.durationMs ? <span className={styles.duration}>{formatDuration(c.durationMs)}</span> : null}
                  </>
                )}
                <span className={styles.kind}>{c.kind === 'video' ? 'Video' : c.kind === 'flow' ? 'Flow' : 'Screenshot'}</span>
                {dropId === c.id && (
                  <span className={styles.dropHint}>
                    <Workflow size={22} aria-hidden />
                    <strong>{c.kind === 'flow' ? `Add ${dragCount} to this flow` : `Make a flow of ${dragCount + 1}`}</strong>
                    <small>{c.kind === 'flow' ? imageCount(c) || 'Flow' : 'Release to put them together'}</small>
                  </span>
                )}
                {c.kind === 'flow' && imageCount(c) && <span className={styles.flowCount}><Workflow size={12} aria-hidden /> {imageCount(c)}</span>}
              </button>
              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <span className={styles.name} title={c.name}>
                    {c.name}
                  </span>
                  <IconButton size="sm" label={c.kind === 'flow' ? `Download ${c.name} as ZIP` : `Download ${c.name}`} icon={<Download size={15} />} loading={downloading.has(c.id)} onClick={() => void download(c)} />
                  <IconButton size="sm" label={`Delete ${c.name}`} icon={<Trash2 size={15} />} onClick={() => setDeleting(c)} />
                  <Dropdown
                    align="end"
                    minWidth={220}
                    ariaLabel="Capture actions"
                    items={menuFor(c)}
                    trigger={({ toggle }) => <IconButton size="sm" label="More actions" icon={<MoreHorizontal size={16} />} onClick={toggle} />}
                  />
                </div>
                <div className={styles.meta}>
                  {formatDateTime(c.createdAt)} · {formatBytes(c.size)}
                </div>
                <div className={styles.meta}>
                  {formatResolution(c.width, c.height)}
                  {c.kind === 'video' && c.fps ? ` · ${c.fps} fps` : ''}
                  {c.kind === 'flow' && imageCount(c) ? ` · ${imageCount(c)}` : ''}
                  {c.edited ? ' · Edited' : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}

      {ghost && (
        <div className={styles.ghost} style={{ transform: `translate(${ghost.x + 14}px, ${ghost.y + 10}px)` }} aria-hidden>
          {ghost.list.slice(0, 3).map((c, i) => (
            <div key={c.id} className={styles.ghostCard} style={{ transform: `translate(${i * 8}px, ${i * 8}px) rotate(${(i - 1) * 4}deg)`, zIndex: 3 - i }}>
              {c.thumbnail && <img src={c.thumbnail} alt="" />}
            </div>
          ))}
          <span className={styles.ghostCount}>{dragCount}</span>
        </div>
      )}
      <BusyPill label={busyLabel} />
      <ContextMenu anchor={context.anchor} items={contextItem ? menuFor(contextItem) : []} onClose={context.close} />

      <Modal
        open={renaming !== null}
        title="Rename"
        onClose={() => setRenaming(null)}
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!nameDraft.trim()}
              onClick={async () => {
                if (!renaming) return;
                await updateCapture(renaming.id, { name: replaceExtension(nameDraft.trim(), extensionForMime(renaming.mimeType)) });
                setRenaming(null);
                broadcast({ target: 'broadcast', type: 'history/changed' });
                refresh();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} suffix={renaming ? `.${extensionForMime(renaming.mimeType)}` : ''} aria-label="New name" />
      </Modal>

      <ConfirmationDialog
        open={bulkDelete}
        title={`Delete ${selected.size} capture${selected.size === 1 ? '' : 's'}?`}
        message="They will be removed from Recent captures. Files you already downloaded are not affected."
        confirmLabel="Delete"
        danger
        onCancel={() => setBulkDelete(false)}
        onConfirm={() => void deleteSelected()}
      />

      <ConfirmationDialog
        open={deleting !== null}
        title="Delete this capture?"
        message={`“${deleting?.name ?? ''}” will be removed from Recent captures. Files you already downloaded are not affected.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteCapture(deleting.id);
          setDeleting(null);
          broadcast({ target: 'broadcast', type: 'history/changed' });
          toast.success('Capture deleted');
          refresh();
        }}
      />
    </section>
  );
}
