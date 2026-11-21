import { CheckSquare, Workflow, X } from 'lucide-react';
import { getFlow } from '@/flow/flow-store';
import { exportZip } from '@/flow/flow-export';
import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(() => {
    void listCaptures(filter, sort)
      .then(setItems)
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
  const selectedItems = (items ?? []).filter((c) => selected.has(c.id));
  useEffect(() => onBroadcast((m) => m.type === 'history/changed' && refresh()), [refresh]);

  /** The file for a capture; a flow downloads as a ZIP of its (edited) images with metadata. */
  async function fileFor(c: CaptureRecord): Promise<{ blob: Blob; name: string }> {
    if (c.kind === 'flow') {
      const doc = await getFlow(c.id);
      if (!doc || doc.items.length === 0) throw new Error('This flow has no images');
      const blob = await exportZip(doc, { items: doc.items, version: 'edited', format: 'png', quality: 1, metadata: true, steps: true });
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
              checked={selected.size > 0 && selected.size === items.length}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && selected.size < items.length;
              }}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
              aria-label="Select all"
            />
            {selected.size ? `${selected.size} selected` : 'Select all'}
          </label>
          {selected.size > 0 && (
            <>
              <span className={styles.flex} />
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
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Inbox size={30} />
          </span>
          <h3>{filter === 'all' ? 'No captures yet' : filter === 'video' ? 'No recordings yet' : 'No screenshots yet'}</h3>
          <p>{formatKeys('Click the Pixora icon in the toolbar (or press Alt+Shift+V) to take your first screenshot or start a recording.')}</p>
        </div>
      ) : (
        <ul className={styles.grid}>
          {items.map((c) => (
            <li
              key={c.id}
              className={`${styles.card} ${selected.has(c.id) ? styles.cardSelected : ''}`}
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
                  {c.edited ? ' · Edited' : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

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
