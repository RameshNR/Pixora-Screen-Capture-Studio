import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Tooltip } from '@/shared/components/Tooltip';
import styles from '../styles/popup.module.css';

interface CaptureModeCardProps {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Large primary capture tile (Visible Part / Full Page / Selected Area). */
export function CaptureModeCard({ icon, label, hint, onClick, disabled }: CaptureModeCardProps) {
  const card = (
    <button type="button" className={styles.card} onClick={onClick} disabled={disabled}>
      <span className={styles.cardIcon} aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );
  return hint ? <Tooltip content={hint}>{card}</Tooltip> : card;
}

interface RecordingModeCardProps {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}

/** Selectable recording-source tile (radio semantics). */
export function RecordingModeCard({ icon, label, selected, onSelect, disabled, hint }: RecordingModeCardProps) {
  const card = (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`${styles.card} ${styles.modeCard} ${selected ? styles.modeSelected : ''}`}
      onClick={onSelect}
      disabled={disabled}
    >
      <span className={styles.modeIcon} aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );
  return hint ? <Tooltip content={hint}>{card}</Tooltip> : card;
}

interface ActionRowProps {
  icon: ReactNode;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  trailing?: ReactNode;
  disabled?: boolean;
  ariaHasPopup?: boolean;
}

/** A highlighted row with a title and a one-line description (used for Flow Capture). */
export function FeatureRow({ icon, label, description, badge, onClick, disabled }: { icon: ReactNode; label: string; description: string; badge?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.feature} onClick={onClick} disabled={disabled} aria-label={label} aria-description={description}>
      <span className={styles.featureIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.featureText}>
        <span className={styles.featureTitle}>
          {label}
          {badge && <span className={styles.badge}>{badge}</span>}
        </span>
        <span className={styles.featureDesc}>{description}</span>
      </span>
      <ChevronRight size={16} className={styles.featureChevron} aria-hidden />
    </button>
  );
}

/** Small uppercase heading between groups of rows. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={styles.sectionLabel}>{children}</div>;
}

export function ActionRow({ icon, label, onClick, trailing, disabled, ariaHasPopup }: ActionRowProps) {
  return (
    <button type="button" className={styles.row} onClick={onClick} disabled={disabled} aria-haspopup={ariaHasPopup || undefined}>
      <span className={styles.rowIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.rowLabel}>{label}</span>
      {trailing && <span className={styles.rowTrail}>{trailing}</span>}
    </button>
  );
}
