import { FolderOpen, Keyboard, Settings2 } from 'lucide-react';
import { IconButton } from '@/shared/components/Button';
import styles from '../styles/popup.module.css';

function open(path: string) {
  void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

export function PopupFooter() {
  return (
    <footer className={styles.footer}>
      <button type="button" className={styles.footerLink} onClick={() => open('options.html#history')}>
        <FolderOpen size={17} />
        Recent captures
      </button>
      <div className={styles.footerIcons}>
        <IconButton label="Keyboard shortcuts" tooltipSide="top" icon={<Keyboard size={18} />} onClick={() => open('options.html#shortcuts')} />
        <IconButton label="Settings" tooltipSide="top" icon={<Settings2 size={18} />} onClick={() => open('options.html#general')} />
      </div>
    </footer>
  );
}
