import { useEffect, useState, type ReactNode } from 'react';
import { Camera, FolderOpen, Workflow, HardDrive, Keyboard, Settings2, SlidersHorizontal, Video } from 'lucide-react';
import { useSettings } from '@/shared/hooks/useSettings';
import { useTheme } from '@/shared/hooks/useTheme';
import { Spinner } from '@/shared/components/Progress';
import { HistoryView } from '@/history/components/HistoryView';
import { AdvancedSection, FlowSection, GeneralSection, RecordingSection, ScreenshotSection, ShortcutsSection, StorageSection } from '../components/SettingsSections';
import styles from './options.module.css';

type Route = 'history' | 'general' | 'screenshot' | 'recording' | 'flow' | 'storage' | 'shortcuts' | 'advanced' | 'welcome';

const NAV: Array<{ id: Route; label: string; icon: ReactNode; group?: string }> = [
  { id: 'history', label: 'Recent captures', icon: <FolderOpen size={17} /> },
  { id: 'general', label: 'General', icon: <Settings2 size={17} />, group: 'Settings' },
  { id: 'screenshot', label: 'Screenshot', icon: <Camera size={17} /> },
  { id: 'recording', label: 'Recording', icon: <Video size={17} /> },
  { id: 'flow', label: 'Flow Capture', icon: <Workflow size={17} /> },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={17} /> },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={17} /> },
  { id: 'advanced', label: 'Advanced', icon: <SlidersHorizontal size={17} /> },
];

function readRoute(): Route {
  const h = location.hash.replace('#', '') as Route;
  return [...NAV.map((n) => n.id), 'welcome'].includes(h) ? h : 'history';
}

export function OptionsApp() {
  const { settings, update } = useSettings();
  useTheme(settings?.general.theme);
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = route === 'history' ? 'Recent captures · Pixora' : 'Settings · Pixora';
  }, [route]);

  return (
    <div className={styles.layout}>
      <nav className={styles.sidebar} aria-label="Sections">
        <div className={styles.brand}>
          <img src="/icons/icon-48.png" alt="" />
          <span>Pixora</span>
        </div>
        {NAV.map((n) => (
          <div key={n.id}>
            {n.group && <div className={styles.navGroup}>{n.group}</div>}
            <a href={`#${n.id}`} className={`${styles.navItem} ${route === n.id ? styles.navActive : ''}`} aria-current={route === n.id ? 'page' : undefined}>
              {n.icon}
              {n.label}
            </a>
          </div>
        ))}
        <div className={styles.version}>Version {chrome.runtime.getManifest().version}</div>
      </nav>
      <main className={styles.content}>
        {!settings ? (
          <Spinner size={22} />
        ) : (
          <div className={route === 'history' ? styles.wide : styles.narrow}>
            {route === 'welcome' && <Welcome />}
            {route === 'history' && <HistoryView settings={settings} />}
            {route === 'general' && <GeneralSection settings={settings} update={update} />}
            {route === 'screenshot' && <ScreenshotSection settings={settings} update={update} />}
            {route === 'recording' && <RecordingSection settings={settings} update={update} />}
            {route === 'flow' && <FlowSection settings={settings} update={update} />}
            {route === 'storage' && <StorageSection settings={settings} update={update} />}
            {route === 'shortcuts' && <ShortcutsSection />}
            {route === 'advanced' && <AdvancedSection settings={settings} update={update} />}
          </div>
        )}
      </main>
    </div>
  );
}

function Welcome() {
  return (
    <section className={styles.welcome}>
      <img className={styles.welcomeBanner} src="/brand/banner.webp" alt="Pixora – Screen Capture Studio: Screenshot, Record, Edit, Workflow" />
      <h1>Welcome to Pixora</h1>
      <p>Pin Pixora to your toolbar (puzzle icon → pin) and click it to capture or record. Everything stays on this device.</p>
      <ul>
        <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> capture the visible part</li>
        <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> capture the full page</li>
        <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> capture a selected area</li>
        <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> open Pixora</li>
      </ul>
      <a href="#general">Review settings →</a>
    </section>
  );
}
