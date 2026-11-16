import type { ReactNode } from 'react';
import { ArrowDownUp, CheckSquare, ChevronDownSquare, CircleDot, CornerDownLeft, FileCheck, Globe, MousePointerClick, TextCursorInput } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { FLOW_SHOT_KINDS, type FlowShotKind } from '@/shared/types';
import styles from './CaptureOnPicker.module.css';

export const SHOT_KIND_INFO: Record<FlowShotKind, { label: string; hint: string; icon: ReactNode }> = {
  click: { label: 'Clicks', hint: 'Buttons, links, tabs and menu items', icon: <MousePointerClick size={14} /> },
  dropdown: { label: 'Dropdowns', hint: 'Opening a dropdown or menu, and choosing an option', icon: <ChevronDownSquare size={14} /> },
  input: { label: 'Text input', hint: 'Filling in a field (one screenshot per field)', icon: <TextCursorInput size={14} /> },
  checkbox: { label: 'Checkboxes', hint: 'Ticking or unticking a box', icon: <CheckSquare size={14} /> },
  radio: { label: 'Radio buttons', hint: 'Choosing an option', icon: <CircleDot size={14} /> },
  submit: { label: 'Submit', hint: 'Sending a form', icon: <FileCheck size={14} /> },
  navigate: { label: 'Page changes', hint: 'A new page or view opens', icon: <Globe size={14} /> },
  scroll: { label: 'Scrolling', hint: 'Scrolling further than the minimum distance', icon: <ArrowDownUp size={14} /> },
  key: { label: 'Enter / Esc', hint: 'Pressing Enter or Escape', icon: <CornerDownLeft size={14} /> },
};

interface Props {
  value: Record<FlowShotKind, boolean> | undefined;
  onChange: (next: Record<FlowShotKind, boolean>) => void;
  tone?: 'light' | 'dark';
}

/** "Take screenshots on": which interactions add an automatic screenshot to the flow. */
export function CaptureOnPicker({ value, onChange, tone = 'light' }: Props) {
  const current = { ...DEFAULT_SETTINGS.flow.captureOn, ...(value ?? {}) };
  const on = FLOW_SHOT_KINDS.filter((k) => current[k]).length;
  return (
    <div className={`${styles.wrap} ${tone === 'dark' ? styles.dark : ''}`}>
      <div className={styles.head}>
        <span>Take screenshots on</span>
        <span className={styles.links}>
          <button type="button" onClick={() => onChange(Object.fromEntries(FLOW_SHOT_KINDS.map((k) => [k, true])) as Record<FlowShotKind, boolean>)} disabled={on === FLOW_SHOT_KINDS.length}>All</button>
          <button type="button" onClick={() => onChange(Object.fromEntries(FLOW_SHOT_KINDS.map((k) => [k, false])) as Record<FlowShotKind, boolean>)} disabled={on === 0}>None</button>
        </span>
      </div>
      <div className={styles.chips} role="group" aria-label="Take screenshots on">
        {FLOW_SHOT_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="checkbox"
            aria-checked={current[k]}
            title={SHOT_KIND_INFO[k].hint}
            className={current[k] ? styles.chipOn : styles.chip}
            onClick={() => onChange({ ...current, [k]: !current[k] })}
          >
            {SHOT_KIND_INFO[k].icon}
            {SHOT_KIND_INFO[k].label}
          </button>
        ))}
      </div>
      {on === 0 && <span className={styles.note}>No automatic screenshots: steps are still listed, and you can press Capture any time.</span>}
    </div>
  );
}
