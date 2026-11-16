import type { FlowSettings } from '@/shared/types';
import { RadioGroup, Slider, ToggleSwitch } from '@/shared/components/FormControls';
import { Select } from '@/shared/components/Dropdown';
import { CaptureOnPicker } from './CaptureOnPicker';
import styles from './CaptureOnPicker.module.css';

/** "Wait before each picture": automatic (until the page settles), no delay, or a fixed wait. */
export const SHOT_DELAY_OPTIONS: Array<{ value: number; label: string; description?: string }> = [
  { value: -1, label: 'Automatic', description: 'Waits until the page has reacted and finished loading' },
  { value: 0, label: 'No delay', description: 'Picture straight away' },
  { value: 100, label: '0.1 s' },
  { value: 250, label: '0.25 s' },
  { value: 500, label: '0.5 s' },
  { value: 1000, label: '1 s' },
  { value: 2000, label: '2 s' },
  { value: 3000, label: '3 s' },
];

export function intervalLabel(v: number): string {
  return v === 0 ? 'No delay (every step)' : `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : v % 100 === 0 ? 1 : 2)} s`;
}

/**
 * The automatic-step options of Flow Capture, shared by screenshot flows and by Flow Capture
 * during video recordings (both use the same settings): which interactions take a picture,
 * every step or new pages only, click picture timing, wait before the picture, scroll steps and
 * the minimum time between pictures.
 */
export function FlowAutoOptions({ flow, update, tone = 'light', autoToggle = false }: { flow: FlowSettings; update: (patch: Partial<FlowSettings>) => void; tone?: 'light' | 'dark'; autoToggle?: boolean }) {
  const f = flow;
  return (
    <div className={styles.options}>
      {autoToggle && (
        <div className={styles.optRow}>
          <span className={styles.optLabel}>Automatic screenshots</span>
          <ToggleSwitch size="sm" label="Auto steps" checked={f.autoSteps} onChange={(autoSteps) => update({ autoSteps })} />
        </div>
      )}
      {(!autoToggle || f.autoSteps) && (
        <>
          <CaptureOnPicker value={f.captureOn} onChange={(captureOn) => update({ captureOn })} tone={tone} />
          <div className={styles.optRow}>
            <span className={styles.optLabel}>Auto screenshots</span>
            <RadioGroup label="Auto screenshots" size="sm" value={f.screenshotWhen} onChange={(screenshotWhen) => update({ screenshotWhen })} options={[{ value: 'every-step', label: 'Every step' }, { value: 'page-change', label: 'New pages' }]} />
          </div>
          <div className={styles.optRow} title="After click: once the page reacted. On click: at the moment you press the mouse (or Enter / Space). On hover: while the pointer rests on the button, before the click.">
            <span className={styles.optLabel}>Click pictures</span>
            <RadioGroup label="Click pictures" size="sm" value={f.shotTiming} onChange={(shotTiming) => update({ shotTiming })} options={[{ value: 'after-click', label: 'After click' }, { value: 'on-click', label: 'On click' }, { value: 'on-hover', label: 'On hover' }]} />
          </div>
          <div className={styles.optRow} title="How long to wait after a step before taking its picture. No delay pictures the screen at once.">
            <span className={styles.optLabel}>Wait before picture</span>
            <Select<number> label="Wait before picture" value={f.shotDelayMs ?? -1} minWidth={170} onChange={(shotDelayMs) => update({ shotDelayMs })} options={SHOT_DELAY_OPTIONS} />
          </div>
          <div className={styles.optRow}>
            <span className={styles.optLabel}>Record scrolling as steps</span>
            <ToggleSwitch size="sm" label="Scroll steps" checked={f.scroll} onChange={(scroll) => update({ scroll })} />
          </div>
          {f.scroll && <Slider label="Minimum scroll" min={100} max={2000} step={50} value={f.scrollThresholdPx} format={(v) => `${v}px`} onChange={(scrollThresholdPx) => update({ scrollThresholdPx })} />}
          <Slider label="Minimum time between screenshots" min={0} max={5000} step={50} value={f.minShotIntervalMs} format={intervalLabel} onChange={(minShotIntervalMs) => update({ minShotIntervalMs })} />
        </>
      )}
    </div>
  );
}
