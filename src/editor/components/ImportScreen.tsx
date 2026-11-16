import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, ImagePlus, LayoutGrid, Upload } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { useToast } from '@/shared/components/Toast';
import { TopBar } from '@/recording/pages/TopBar';
import styles from './editor.module.css';

import { IMAGE_ACCEPT, isSupportedImage, UNSUPPORTED_IMAGE_MESSAGE } from '@/shared/utils/image-types';

/** "Annotate Local & Clipboard Image": file picker, drag & drop and paste. */
export function ImportScreen({ onImage, onCollage }: { onImage: (blob: Blob, name: string) => void; onCollage: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const accept = (file: File | Blob | null | undefined, name = 'Pasted image') => {
    if (!file) return;
    if (!isSupportedImage(file as File)) {
      toast.error('Unsupported file', UNSUPPORTED_IMAGE_MESSAGE);
      return;
    }
    onImage(file, file instanceof File ? file.name : name);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      if (item) accept(item.getAsFile());
      else toast.info('No image on the clipboard', 'Copy an image first, then paste here.');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return accept(await item.getType(type));
      }
      toast.info('No image on the clipboard', 'Copy an image first, then try again.');
    } catch {
      toast.info('Press Ctrl+V to paste', 'Chrome needs a keyboard paste to read images from the clipboard here.');
    }
  }

  return (
    <div className={styles.import}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0 }}>
        <TopBar />
      </div>
      <div
        className={`${styles.dropZone} ${over ? styles.dropActive : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files[0]); }}
      >
        <span className={styles.dropIcon}>
          <ImagePlus size={30} />
        </span>
        <h1 className={styles.dropTitle}>Annotate an image</h1>
        <p className={styles.dropText}>Drop an image here, paste one with Ctrl+V, or choose a file from your computer.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ClipboardPaste size={16} />} onClick={() => void pasteFromClipboard()}>
            Paste from clipboard
          </Button>
          <Button variant="primary" icon={<Upload size={16} />} onClick={() => input.current?.click()}>
            Choose file
          </Button>
        </div>
        <Button variant="ghost" icon={<LayoutGrid size={16} />} onClick={onCollage}>
          Combine several images into a collage
        </Button>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => accept(e.target.files?.[0])} />
      </div>
    </div>
  );
}
