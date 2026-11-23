import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './editor.module.css';

export interface StripItem {
  id: string;
  name: string;
  thumbnail?: string;
}

/** Where the row was scrolled (the strip is rebuilt with every image: it comes back at the same place). */
let lastScroll = 0;
/** Arrows and hidden counts as last measured (used until the new strip is measured). */
let lastEdges = { left: false, right: false };
let lastHidden = { left: 0, right: 0 };

/**
 * The open images in full screen (bottom left, next to the controls): small thumbnails; the edges
 * fade where more images are out of view, the arrows show how many and scroll the row; the row can
 * also be dragged.
 */
export function FilmStrip({ items, currentId, onOpen }: { items: StripItem[]; currentId: string; onOpen: (id: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState(lastEdges);
  /** Images out of view (also partly) on each side. */
  const [hidden, setHidden] = useState(lastHidden);
  const [dragging, setDragging] = useState(false);
  /** The current image was brought into view at the strip's real size. */
  const placed = useRef(false);
  const measure = () => {
    const el = row.current;
    // Not laid out (being removed while switching images): keep what was measured before.
    if (!el || !el.isConnected || el.clientWidth === 0) return;
    lastScroll = el.scrollLeft;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    lastEdges = { left, right };
    setEdges((e) => (e.left === left && e.right === right ? e : lastEdges));
    const r = el.getBoundingClientRect();
    let l = 0;
    let rr = 0;
    for (const c of el.children) {
      const b = c.getBoundingClientRect();
      if (b.left < r.left - 1) l++;
      else if (b.right > r.right + 1) rr++;
    }
    lastHidden = { left: l, right: rr };
    setHidden((h) => (h.left === l && h.right === rr ? h : lastHidden));
  };
  // Before the first paint: same scroll as before, the current image in view, arrows measured
  // (they appeared a moment later and the row jumped — a flicker when switching images).
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    el.scrollLeft = lastScroll;
    placed.current = false;
    // Measured by the resize watcher (before paint), not here: right after a switch the picture area
    // is still at its starting size, and a narrow row showed arrows and counts that were not needed.
    const ro = new ResizeObserver(() => {
      // First real size: bring the current image into view (once), then measure.
      if (!placed.current && el.clientWidth > 0) {
        placed.current = true;
        el.scrollLeft = lastScroll;
        const cur = el.querySelector<HTMLElement>('[aria-current="true"]');
        if (cur) {
          const r = el.getBoundingClientRect();
          const b = cur.getBoundingClientRect();
          if (b.left < r.left) el.scrollLeft -= r.left - b.left + 8;
          else if (b.right > r.right) el.scrollLeft += b.right - r.right + 8;
        }
      }
      measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, currentId]); // eslint-disable-line react-hooks/exhaustive-deps
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * Math.max(64, row.current.clientWidth * 0.8), behavior: 'smooth' });

  // Drag the row to scroll it (a drag is not a click on a thumbnail).
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !row.current) return;
    drag.current = { x: e.clientX, scroll: row.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = row.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 5) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = d.scroll - dx;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.moved && row.current?.hasPointerCapture(e.pointerId)) row.current.releasePointerCapture(e.pointerId);
    setDragging(false);
    // The click that ends a drag is ignored; then forget the drag.
    setTimeout(() => { drag.current = null; }, 0);
  };

  const overflow = edges.left || edges.right;
  return (
    <div className={styles.strip} role="group" aria-label="Open images">
      {overflow && (
        <button type="button" className={styles.stripArrow} aria-label={hidden.left ? `Earlier images (${hidden.left} more)` : 'Earlier images'} disabled={!edges.left} onClick={() => scroll(-1)}>
          <ChevronLeft size={16} />{hidden.left > 0 && <span className={styles.stripCount} aria-hidden>{hidden.left}</span>}
        </button>
      )}
      <div ref={row} className={`${styles.stripRow} ${edges.left ? styles.fadeL : ''} ${edges.right ? styles.fadeR : ''} ${dragging ? styles.stripDragging : ''}`} role="list"
        onScroll={measure} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {items.map((r, i) => (
          <button key={r.id} type="button" role="listitem" aria-label={`Show image ${i + 1}`} aria-current={r.id === currentId ? 'true' : undefined} title={r.name}
            className={styles.stripThumb} draggable={false}
            onClick={() => { if (drag.current?.moved) return; if (r.id !== currentId) onOpen(r.id); }}>
            {r.thumbnail ? <img src={r.thumbnail} alt="" draggable={false} decoding="sync" /> : <span />}
          </button>
        ))}
      </div>
      {overflow && (
        <button type="button" className={styles.stripArrow} aria-label={hidden.right ? `More images (${hidden.right} more)` : 'More images'} disabled={!edges.right} onClick={() => scroll(1)}>
          <ChevronRight size={16} />{hidden.right > 0 && <span className={styles.stripCount} aria-hidden>{hidden.right}</span>}
        </button>
      )}
    </div>
  );
}
