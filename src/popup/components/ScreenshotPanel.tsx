import { useEffect, useState } from 'react';
import { AppWindow, ChevronRight, Crop, ImagePlus, LayoutGrid, Monitor, ScanText, ScrollText, ShieldCheck, TimerReset } from 'lucide-react';
import type { ScreenshotMode, ScrollAreaChoice, Settings } from '@/shared/types';
import type { ScrollAreaReport } from '@/screenshot/services/page-scripts';
import { ScrollAreaChooser } from './ScrollAreaChooser';
import { FlowRunning, FlowSetup, useFlowSession } from './FlowSetup';
import { Workflow } from 'lucide-react';
import { sendToBackground, errorInfoOf } from '@/shared/messaging/client';
import { useToast } from '@/shared/components/Toast';
import { Dropdown } from '@/shared/components/Dropdown';
import { Modal } from '@/shared/components/Modal';
import { Button } from '@/shared/components/Button';
import { TextField } from '@/shared/components/FormControls';
import { SCREENSHOT_DELAY_OPTIONS } from '@/shared/constants/media';
import type { ActiveTabInfo } from '../hooks/useActiveTab';
import { ActionRow, CaptureModeCard, FeatureRow, SectionLabel } from './CaptureModeCard';
import styles from '../styles/popup.module.css';
import { useShortcuts } from '@/shared/hooks/useShortcuts';

interface Props {
  settings: Settings;
  update: (patch: { screenshot?: Partial<Settings['screenshot']>; flow?: Partial<Settings['flow']> }) => Promise<void>;
  activeTab: ActiveTabInfo;
}

export function ScreenshotPanel({ settings, update, activeTab }: Props) {
  const toast = useToast();
  const keys = useShortcuts();
  const [busy, setBusy] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDelay, setCustomDelay] = useState(String(settings.screenshot.delaySeconds));
  const [areas, setAreas] = useState<ScrollAreaReport | null>(null);
  const [flowSetup, setFlowSetup] = useState(false);
  const flow = useFlowSession();
  const flowActive = flow?.status === 'recording' || flow?.status === 'paused';
  const tabId = activeTab.tab?.id;
  const blocked = !activeTab.capturable || tabId === undefined;

  async function capture(mode: ScreenshotMode, opts: { delaySeconds?: number; ocr?: boolean; scrollAreas?: ScrollAreaChoice[] } = {}) {
    if (tabId === undefined) return;
    // Full page on a page with scrollable panels: let the user pick which panels to include.
    if (mode === 'full' && !opts.scrollAreas && settings.screenshot.fullPage.scrollAreas === 'ask') {
      setBusy('full');
      try {
        const report = await sendToBackground<ScrollAreaReport>({ target: 'background', type: 'screenshot/scroll-areas', tabId });
        if (report.areas.length > 0) {
          setAreas(report);
          setBusy(null);
          return;
        }
      } catch {
        /* fall through: capture the page */
      }
      setBusy(null);
    }
    const message = { target: 'background' as const, type: 'screenshot/capture' as const, mode, tabId, ...opts };
    // A delayed capture continues in the service worker; close the popup so it is not in the way.
    if (opts.delaySeconds) {
      void sendToBackground(message);
      window.close();
      return;
    }
    // Full page: the popup stays open and turns into the capture's progress with Stop (it closes
    // itself when the editor opens).
    if (mode === 'full') {
      setBusy('full');
      sendToBackground(message).catch((err: unknown) => {
        setBusy(null);
        toast.error(errorInfoOf(err));
      });
      return;
    }
    setBusy(mode + (opts.ocr ? '-ocr' : ''));
    try {
      await sendToBackground(message);
      window.close();
    } catch (err) {
      toast.error(errorInfoOf(err));
    } finally {
      setBusy(null);
    }
  }

  // Enter captures with the default mode (Settings › Screenshot › Default capture mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || blocked || busy || (e.target as HTMLElement).closest('button, input, [role="menu"], [role="dialog"]')) return;
      e.preventDefault();
      void capture(settings.screenshot.defaultMode);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function openPage(path: string) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    window.close();
  }

  const delayItems = [
    ...SCREENSHOT_DELAY_OPTIONS.map((s) => ({
      id: `d${s}`,
      label: s === 0 ? 'No delay (0 seconds)' : `${s} second${s === 1 ? '' : 's'}`,
      checked: settings.screenshot.delaySeconds === s,
      onSelect: () => {
        void update({ screenshot: { delaySeconds: s } });
        void capture('visible', { delaySeconds: s });
      },
    })),
    { id: 'custom', label: 'Custom delay…', separatorBefore: true, onSelect: () => setCustomOpen(true) },
  ];

  if (flowSetup) {
    return <FlowSetup settings={settings} tabId={tabId} onBack={() => setFlowSetup(false)} updateFlow={(patch) => void update({ flow: patch })} />;
  }

  if (areas && tabId !== undefined) {
    return (
      <ScrollAreaChooser
        report={areas}
        tabId={tabId}
        onCancel={() => {
          void sendToBackground({ target: 'background', type: 'screenshot/highlight-area', tabId, index: null, show: false }).catch(() => undefined);
          setAreas(null);
        }}
        onCapture={(choice) => void capture('full', { scrollAreas: choice })}
      />
    );
  }

  return (
    <>
      {blocked && !activeTab.loading && (
        <div className={styles.warn} role="note">
          Chrome doesn’t allow capturing this page (browser pages, the Web Store and the PDF viewer). Use <strong>Entire Screen &amp; App Window</strong> instead.
        </div>
      )}
      {flowActive && flow && <FlowRunning state={flow} />}
      <div className={styles.cards3}>
        <CaptureModeCard icon={<AppWindow size={18} />} label="Visible Part" hint={keys['capture-visible'] || undefined} disabled={blocked || busy !== null} onClick={() => void capture('visible')} />
        <CaptureModeCard icon={<ScrollText size={18} />} label="Full Page" hint={keys['capture-full'] || undefined} disabled={blocked || busy !== null} onClick={() => void capture('full')} />
        <CaptureModeCard icon={<Crop size={18} />} label="Selected Area" hint={keys['capture-area'] || undefined} disabled={blocked || busy !== null} onClick={() => void capture('area')} />
      </div>

      <FeatureRow
        icon={<Workflow size={18} />}
        label={flowActive ? 'Flow Capture is running' : 'Flow Capture'}
        description={flowActive ? 'Use the flow toolbar to capture or finish' : 'Step-by-step screenshots while you browse'}
        badge={flowActive ? undefined : 'New'}
        disabled={blocked || flowActive}
        onClick={() => setFlowSetup(true)}
      />

      <SectionLabel>More ways to capture</SectionLabel>
      <Dropdown
        items={delayItems}
        minWidth={348}
        ariaLabel="Delay"
        trigger={({ toggle }) => (
          <ActionRow
            icon={<TimerReset size={17} />}
            label="Visible Part after Delay"
            disabled={blocked}
            ariaHasPopup
            onClick={toggle}
            trailing={
              <>
                {settings.screenshot.delaySeconds}s <ChevronRight size={16} />
              </>
            }
          />
        )}
      />
      <ActionRow icon={<Monitor size={17} />} label="Entire Screen & App Window" onClick={() => openPage('recorder.html?intent=screenshot')} trailing={<ChevronRight size={15} />} />
      <ActionRow
        icon={<ScanText size={17} />}
        label="Take Screenshot & Extract Text"
        disabled={blocked || busy !== null}
        onClick={() => void capture('visible', { ocr: true })}
        trailing={<ChevronRight size={16} />}
      />

      <SectionLabel>Edit &amp; combine</SectionLabel>
      <ActionRow icon={<ImagePlus size={17} />} label="Annotate Local & Clipboard Image" onClick={() => openPage('editor.html?import=1')} trailing={<ChevronRight size={15} />} />
      <ActionRow icon={<LayoutGrid size={17} />} label="Create Collage" onClick={() => openPage('editor.html?collage=1')} trailing={<ChevronRight size={15} />} />

      <div className={styles.privacy}>
        <ShieldCheck size={14} aria-hidden /> Captures are saved only on this device.
      </div>

      <Modal
        open={customOpen}
        title="Custom delay"
        onClose={() => setCustomOpen(false)}
        width={320}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const s = Math.round(Number(customDelay));
                if (!Number.isFinite(s) || s < 0 || s > 300) {
                  toast.error('Enter a delay between 0 and 300 seconds');
                  return;
                }
                setCustomOpen(false);
                void update({ screenshot: { delaySeconds: s } }).then(() => capture('visible', { delaySeconds: s }));
              }}
            >
              Start
            </Button>
          </>
        }
      >
        <TextField type="number" min={0} max={300} value={customDelay} onChange={(e) => setCustomDelay(e.target.value)} suffix="seconds" aria-label="Delay in seconds" />
      </Modal>
    </>
  );
}
