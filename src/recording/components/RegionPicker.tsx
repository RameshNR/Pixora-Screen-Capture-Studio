import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { RelativeRect } from '@/shared/types';
import { Button } from '@/shared/components/Button';
import styles from './RegionPicker.module.css';

interface Props {
  /** The <video> showing the shared screen; the region is measured against its picture. */
  video: HTMLVideoElement | null;
  title: string;
  confirmLabel: string;
  onConfirm: (rect: RelativeRect) => void;
  onCancel: () => void;
  /** Zoom: a click (no drag) chooses the point to zoom 2× into. */
  clickToZoom?: boolean;
}

/** Where the picture actually sits inside a `object-fit: contain` video element. */
function contentBox(video: HTMLVideoElement): { x: number; y: number; w: number; h: number } {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth || r.width;
  const vh = video.videoHeight || r.height;
  const scale = Math.min(r.width / vw, r.height / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}

/** Lets the user drag a rectangle over a live video preview (Enter confirms, Esc cancels). */
export function RegionPicker({ video, title, confirmLabel, onConfirm, onCancel, clickToZoom }: Props) {
  const [box, setBox] = useState(() => (video ? contentBox(video) : null));
  const [rect, setRect] = useState<RelativeRect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!video) return;
    const update = () => setBox(contentBox(video));
    update();
    video.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', update);
    return () => {
      video.removeEventListener('loadedmetadata', update);
      window.removeEventListener('resize', update);
    };
  }, [video]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && rect) onConfirm(rect);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rect, onCancel, onConfirm]);

  if (!box) return null;
  const toRel = (clientX: number, clientY: number) => ({
    x: Math.max(0, Math.min(1, (clientX - box.x) / box.w)),
    y: Math.max(0, Math.min(1, (clientY - box.y) / box.h)),
  });

  return (
    <div className={styles.layer} role="dialog" aria-label={title}>
      <div
        className={styles.area}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = toRel(e.clientX, e.clientY);
          setRect({ ...start.current, width: 0, height: 0 });
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = toRel(e.clientX, e.clientY);
          setRect({
            x: Math.min(p.x, start.current.x),
            y: Math.min(p.y, start.current.y),
            width: Math.abs(p.x - start.current.x),
            height: Math.abs(p.y - start.current.y),
          });
        }}
        onPointerUp={() => {
          const s0 = start.current;
          start.current = null;
          if (clickToZoom && s0 && (!rect || (rect.width <= 0.01 && rect.height <= 0.01))) {
            const w = 0.5;
            const h = 0.5;
            onConfirm({ x: Math.max(0, Math.min(1 - w, s0.x - w / 2)), y: Math.max(0, Math.min(1 - h, s0.y - h / 2)), width: w, height: h });
            return;
          }
          setRect((r) => (r && r.width > 0.01 && r.height > 0.01 ? r : null));
        }}
      >
        {rect && rect.width > 0 && (
          <div
            className={styles.sel}
            style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
          >
            {video?.videoWidth ? (
              <span className={styles.dims}>
                {Math.round(rect.width * video.videoWidth)} × {Math.round(rect.height * video.videoHeight)}
              </span>
            ) : null}
          </div>
        )}
      </div>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={<Check size={15} />} disabled={!rect} onClick={() => rect && onConfirm(rect)}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
