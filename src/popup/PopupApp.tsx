import { useCallback, useEffect, useRef, useState } from 'react';
import { FullPageProgressView, useFullPageProgress } from './components/FullPageProgress';
import type { PopupTab, RecordingSettings, ScheduleSettings } from '@/shared/types';
import { useSettings } from '@/shared/hooks/useSettings';
import { useTheme } from '@/shared/hooks/useTheme';
import { useRecordingState } from '@/shared/hooks/useRecordingState';
import { sendToBackground } from '@/shared/messaging/client';
import { Spinner } from '@/shared/components/Progress';
import { isBusy } from '@/recording/services/recording-state';
import { PopupHeader } from './components/PopupHeader';
import { PopupFooter } from './components/PopupFooter';
import { ScreenshotPanel } from './components/ScreenshotPanel';
import { RecordingPanel } from './components/RecordingPanel';
import { AdvancedRecordingSettings } from './components/AdvancedRecordingSettings';
import { useActiveTab } from './hooks/useActiveTab';
import styles from './styles/popup.module.css';

export function PopupApp() {
  const { settings, update } = useSettings();
  useTheme(settings?.general.theme);
  const recording = useRecordingState();
  const activeTab = useActiveTab();
  const [tab, setTab] = useState<PopupTab | null>(null);
  const [view, setView] = useState<'main' | 'advanced'>('main');
  const fullPage = useFullPageProgress();
  // When the full-page capture this popup showed ends, the editor opens: close the popup.
  const sawFullPage = useRef(false);
  useEffect(() => {
    if (fullPage) sawFullPage.current = true;
    else if (sawFullPage.current) window.close();
  }, [fullPage]);

  useEffect(() => {
    if (!settings || tab !== null) return;
    const pref = settings.general.defaultTab;
    setTab(pref === 'last' ? settings.general.lastTab : pref);
  }, [settings, tab]);

  // Always surface the recording controls while a recording is running.
  useEffect(() => {
    if (isBusy(recording)) setTab('record');
  }, [recording]);

  const changeTab = (t: PopupTab) => {
    setTab(t);
    setView('main');
    void update({ general: { lastTab: t } });
  };

  const updateRec = useCallback((patch: Partial<RecordingSettings>) => void update({ recording: patch }), [update]);
  const updateSchedule = useCallback(
    (patch: Partial<ScheduleSettings>) => {
      void update({ schedule: patch }).then(() => sendToBackground({ target: 'background', type: 'schedule/update' }).catch(() => undefined));
    },
    [update],
  );

  // A full-page capture is running: the popup shows only its progress and Stop, sized to fit
  // (no minimum height, so there is no empty space below Stop).
  if (fullPage) {
    return (
      <div className={`${styles.popup} ${styles.popupCompact}`}>
        <FullPageProgressView state={fullPage} />
      </div>
    );
  }
  // Not known yet whether a capture runs: draw nothing (a tiny popup), never the tall view first.
  if (fullPage === undefined) return <div className={`${styles.popup} ${styles.popupCompact}`} />;

  if (!settings || !tab) {
    return (
      <div className={styles.popup} style={{ display: 'grid', placeItems: 'center' }}>
        <Spinner size={22} />
      </div>
    );
  }

  if (view === 'advanced') {
    return (
      <div className={styles.popup}>
        <AdvancedRecordingSettings settings={settings} updateRec={updateRec} updateSchedule={updateSchedule} onBack={() => setView('main')} />
      </div>
    );
  }

  return (
    <div className={styles.popup}>
      <PopupHeader tab={tab} onChange={changeTab} recording={recording.status === 'recording' || recording.status === 'paused'} />
      <main className={styles.body} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'screenshot' ? (
          <ScreenshotPanel settings={settings} update={update} activeTab={activeTab} />
        ) : (
          <RecordingPanel settings={settings} updateRec={updateRec} updateFlow={(patch) => void update({ flow: patch })} activeTab={activeTab} state={recording} onMore={() => setView('advanced')} />
        )}
      </main>
      <PopupFooter />
    </div>
  );
}
