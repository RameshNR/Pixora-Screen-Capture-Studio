import { useEffect, useState } from 'react';
import { ArrowLeft, Check, LocateFixed, ScrollText } from 'lucide-react';
import type { ScrollAreaChoice } from '@/shared/types';
import type { ScrollAreaReport } from '@/screenshot/services/page-scripts';
import { sendToBackground } from '@/shared/messaging/client';
import { SCROLL_AREAS_PORT } from '@/shared/messaging/messages';
import { Button, IconButton } from '@/shared/components/Button';
import { Select } from '@/shared/components/Dropdown';
import styles from '../styles/popup.module.css';

interface Props {
  report: ScrollAreaReport;
  tabId: number;
  onCancel: () => void;
  onCapture: (choice: ScrollAreaChoice[]) => void;
}

const SCREEN_OPTIONS = [1, 2, 3, 5, 10, 20];

/** "CONTENT 1 - VACATION PACKAGE RESULTS" reads better as "Content 1 - Vacation package results". */
export function displayTitle(label: string): string {
  const letters = label.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return label;
  const lower = label.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Lists the page's scrollable panels (outlined and numbered on the page itself) so the user can
 * choose which to include in the full-page capture and how many screens of each.
 */
export function ScrollAreaChooser({ report, tabId, onCancel, onCapture }: Props) {
  const [picked, setPicked] = useState<Record<number, boolean>>(() => Object.fromEntries(report.areas.map((a) => [a.index, true])));
  const [screens, setScreens] = useState<Record<number, number>>(() => Object.fromEntries(report.areas.map((a) => [a.index, 0])));
  // The page scrolls to a panel only when asked (the Show button), not on hover.
  const [shown, setShown] = useState<number | null>(null);
  const show = (index: number | null) => {
    setShown(index);
    void sendToBackground({ target: 'background', type: 'screenshot/highlight-area', tabId, index, show: true }).catch(() => undefined);
  };
  const chosen = report.areas.filter((a) => picked[a.index]).map((a) => ({ index: a.index, screens: screens[a.index] ?? 0 }));
  const allOn = chosen.length === report.areas.length;

  // While this list is open the page shows the outlines; closing the popup (in any way) removes them.
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: `${SCROLL_AREAS_PORT}:${tabId}` });
    } catch {
      /* not in an extension page (tests) */
    }
    return () => port?.disconnect();
  }, [tabId]);

  return (
    <div className={styles.areaChooser}>
      <div className={styles.panelHead}>
        <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={onCancel} />
        Scrollable areas found
      </div>
      <p className={styles.lineHint}>
        {report.areas.length} panel{report.areas.length > 1 ? "s" : ""} on this page scroll on their own (outlined on the page). Ticked panels are expanded so all their rows are in the picture; unticked ones keep only the rows you see now
        {report.pageScrolls ? `; the page itself (${report.pageScreens} screens) is always included.` : '.'}
      </p>
      <div className={styles.areaToolbar}>
        <span>{chosen.length} of {report.areas.length} selected</span>
        <button type="button" className={styles.linkBtn} onClick={() => setPicked(Object.fromEntries(report.areas.map((a) => [a.index, !allOn])))}>
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <ul className={styles.areaList} aria-label="Scrollable areas">
        {report.areas.map((a) => {
          const on = picked[a.index] ?? false;
          const title = displayTitle(a.label);
          return (
            <li key={a.index} className={`${styles.areaCard} ${on ? styles.areaCardOn : ''} ${shown === a.index ? styles.areaCardShown : ''}`}>
              <label className={styles.areaHead} title={a.label}>
                <input type="checkbox" className={styles.areaCheckInput} checked={on} onChange={(e) => setPicked((p) => ({ ...p, [a.index]: e.target.checked }))} aria-label={a.label} />
                <span className={styles.areaCheck} aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
                <span className={styles.areaNum}>{a.index + 1}</span>
                <span className={styles.areaTitle}>{title}</span>
              </label>
              <button type="button" className={`${styles.areaShow} ${shown === a.index ? styles.areaShowOn : ''}`} aria-label={`Show area ${a.index + 1} on the page`} aria-pressed={shown === a.index}
                title="Scroll the page to this panel and outline it" onClick={() => show(shown === a.index ? null : a.index)}>
                <LocateFixed size={14} />
              </button>
              <div className={styles.areaFoot}>
                <span className={styles.areaMeta}>
                  {a.detail && <span className={styles.areaChip}>{a.detail}</span>}
                  <span className={styles.areaScreens}>{a.screens} screen{a.screens > 1 ? 's' : ''}</span>
                </span>
                <Select
                  label={`How much of area ${a.index + 1}`}
                  value={screens[a.index] ?? 0}
                  minWidth={118}
                  disabled={!on}
                  onChange={(v) => setScreens((s) => ({ ...s, [a.index]: v }))}
                  options={[{ value: 0, label: `All (${a.screens})` }, ...SCREEN_OPTIONS.filter((n) => n < a.screens).map((n) => ({ value: n, label: `${n} screen${n > 1 ? 's' : ''}` }))]}
                />
              </div>
              <p className={on ? styles.areaFull : styles.areaShown}>
                {!on ? 'Not expanded: only the rows visible now' : (screens[a.index] ?? 0) > 0 && (screens[a.index] ?? 0) < a.screens ? `Expanded: the first ${screens[a.index]} screen${(screens[a.index] ?? 0) > 1 ? 's' : ''} of rows are captured` : 'Expanded: every row is captured'}
              </p>
            </li>
          );
        })}
      </ul>
      <div className={styles.areaActions}>
        <Button variant="ghost" onClick={() => onCapture([])}>Page only</Button>
        <Button variant="primary" icon={<ScrollText size={16} />} onClick={() => onCapture(chosen)}>
          Capture {chosen.length ? `with ${chosen.length} panel${chosen.length > 1 ? 's' : ''}` : 'page'}
        </Button>
      </div>
    </div>
  );
}
