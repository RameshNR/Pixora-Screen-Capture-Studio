import { Camera, Video } from 'lucide-react';
import type { PopupTab } from '@/shared/types';
import styles from '../styles/popup.module.css';

interface Props {
  tab: PopupTab;
  onChange: (tab: PopupTab) => void;
  recording: boolean;
}

/** Screenshot / Record tab navigation (WAI-ARIA tabs pattern). */
export function PopupHeader({ tab, onChange, recording }: Props) {
  const tabs: Array<{ id: PopupTab; label: string; icon: JSX.Element }> = [
    { id: 'screenshot', label: 'Screenshot', icon: <Camera size={18} /> },
    { id: 'record', label: 'Record', icon: <Video size={18} /> },
  ];
  return (
    <>
    <div className={styles.brandBar}>
      <img src="/icons/icon-32.png" alt="" width={22} height={22} />
      <span className={styles.brandName}>Pixora</span>
      <span className={styles.brandTag}>Screen Capture Studio</span>
    </div>
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Capture type"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') onChange(tab === 'screenshot' ? 'record' : 'screenshot');
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          {t.label}
          {t.id === 'record' && recording && <span className={styles.recDot} aria-label="Recording in progress" />}
        </button>
      ))}
    </div>
    </>
  );
}
