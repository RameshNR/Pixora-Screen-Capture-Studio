import { useEffect, useMemo, useState } from 'react';
import { Check, Workflow } from 'lucide-react';
import type { CaptureRecord } from '@/shared/types';
import { listPickableImages } from '@/history/history-service';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Progress';
import styles from './RecentImagesPicker.module.css';

/**
 * "From Recent captures": screenshots and the images of flow captures (videos are not offered),
 * several can be chosen; `onPick` gets their ids in the order shown.
 */
export function RecentImagesPicker({ open, onClose, onPick, exclude = [] }: { open: boolean; onClose: () => void; onPick: (ids: string[]) => void; exclude?: string[] }) {
  const [data, setData] = useState<{ images: CaptureRecord[]; flows: CaptureRecord[] } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setChosen([]);
    setData(null);
    void listPickableImages().then(setData).catch(() => setData({ images: [], flows: [] }));
  }, [open]);
  const groups = useMemo(() => {
    if (!data) return [];
    const skip = new Set(exclude);
    const list = (xs: CaptureRecord[]) => xs.filter((x) => !skip.has(x.id));
    const out: Array<{ id: string; title: string; flow: boolean; images: CaptureRecord[] }> = [];
    const loose = list(data.images.filter((i) => !i.flowId));
    if (loose.length) out.push({ id: 'shots', title: 'Screenshots', flow: false, images: loose });
    for (const f of data.flows) {
      const imgs = list(data.images.filter((i) => i.flowId === f.id)).sort((a, b) => a.createdAt - b.createdAt);
      if (imgs.length) out.push({ id: f.id, title: f.name, flow: true, images: imgs });
    }
    return out;
  }, [data, exclude]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const toggleGroup = (ids: string[]) => setChosen((c) => (ids.every((i) => c.includes(i)) ? c.filter((x) => !ids.includes(x)) : [...c, ...ids.filter((i) => !c.includes(i))]));
  return (
    <Modal
      open={open}
      title="Add from Recent captures"
      tone="dark"
      width={720}
      onClose={onClose}
      footer={
        <>
          <span className={styles.count}>{chosen.length ? `${chosen.length} selected` : 'Choose one or more images'}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!chosen.length} onClick={() => { onPick(chosen); onClose(); }}>
            {chosen.length > 1 ? `Add ${chosen.length} images` : 'Add image'}
          </Button>
        </>
      }
    >
      <div className={styles.body} role="group" aria-label="Recent images">
        {!data ? (
          <div className={styles.empty}><Spinner size={20} /></div>
        ) : !groups.length ? (
          <div className={styles.empty}>No images in Recent captures yet (videos are not offered here).</div>
        ) : (
          groups.map((g) => {
            const ids = g.images.map((i) => i.id);
            const all = ids.every((i) => chosen.includes(i));
            return (
              <section key={g.id} className={styles.group} aria-label={g.flow ? `Flow: ${g.title}` : g.title}>
                <div className={styles.head}>
                  {g.flow && <Workflow size={14} aria-hidden />}
                  <span className={styles.title}>{g.title}</span>
                  <span className={styles.n}>{g.images.length}</span>
                  <button type="button" className={styles.all} onClick={() => toggleGroup(ids)}>{all ? 'Deselect all' : 'Select all'}</button>
                </div>
                <div className={styles.grid}>
                  {g.images.map((img) => {
                    const on = chosen.includes(img.id);
                    return (
                      <button key={img.id} type="button" role="checkbox" aria-checked={on} aria-label={img.name} title={img.name}
                        className={`${styles.tile} ${on ? styles.tileOn : ''}`} onClick={() => toggle(img.id)}>
                        {img.thumbnail ? <img src={img.thumbnail} alt="" loading="lazy" /> : <span />}
                        {on && <span className={styles.badge}><Check size={13} strokeWidth={3} /></span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </Modal>
  );
}
