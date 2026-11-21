import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, ImagePlus, LayoutGrid, Link2, Upload } from 'lucide-react';
import { TextField } from '@/shared/components/FormControls';
import { fetchImageFromUrl, parseImageUrl } from '@/shared/utils/image-url';
import { Button } from '@/shared/components/Button';
import { useToast } from '@/shared/components/Toast';
import { TopBar } from '@/recording/pages/TopBar';
import styles from './editor.module.css';

import { IMAGE_ACCEPT, isSupportedImage, UNSUPPORTED_IMAGE_MESSAGE } from '@/shared/utils/image-types';
import { formatKeys } from '@/shared/utils/keys';

/** "Annotate Local & Clipboard Image": file picker, drag & drop, paste, and a picture from a web address. */
export function ImportScreen({ onImage, onCollage }: { onImage: (blob: Blob, name: string) => void; onCollage: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // A picture's web address: typed, pasted, or handed over by the right-click menu (?url=).
  const [url, setUrl] = useState(() => new URLSearchParams(location.search).get('url') ?? '');
  const [busy, setBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  /** Downloads the picture (Chrome asks once for that site; must run in the click). */
  async function fromUrl(text = url) {
    const parsed = parseImageUrl(text);
    if ('error' in parsed) { setUrlError(parsed.error); return; }
    setBusy(true);
    setUrlError(null);
    try {
      const img = await fetchImageFromUrl(parsed.url);
      onImage(img.blob, img.name);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'The picture could not be downloaded.');
    } finally {
      setBusy(false);
    }
  }
  const isUrl = (t: string) => /^(https?:\/\/|data:image\/)/i.test(t.trim());

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
      if ((e.target as HTMLElement | null)?.closest?.('input')) return; // Pasting into the address field.
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (item) accept(item.getAsFile());
      else if (isUrl(text)) { setUrl(text.trim()); setUrlError(null); }
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
      // A copied picture address: put it in the address field.
      const text = await navigator.clipboard.readText().catch(() => '');
      if (isUrl(text)) { setUrl(text.trim()); setUrlError(null); return; }
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
        <p className={styles.dropText}>{formatKeys('Drop an image here, paste one with Ctrl+V, or choose a file from your computer.')}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ClipboardPaste size={16} />} onClick={() => void pasteFromClipboard()}>
            Paste from clipboard
          </Button>
          <Button variant="primary" icon={<Upload size={16} />} onClick={() => input.current?.click()}>
            Choose file
          </Button>
        </div>
        <form
          className={styles.urlRow}
          onSubmit={(e) => { e.preventDefault(); if (url.trim() && !busy) void fromUrl(); }}
        >
          <TextField
            className={styles.urlField}
            value={url}
            placeholder="Or paste a picture's web address (https://…)"
            aria-label="Picture web address"
            onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
          />
          <Button type="submit" icon={<Link2 size={16} />} loading={busy} disabled={!url.trim()}>
            Open from URL
          </Button>
        </form>
        {urlError ? (
          <p role="alert" className={styles.urlError}>{urlError}</p>
        ) : (
          <p className={styles.urlNote}>Right-click a picture on a website › “Copy image address”. Chrome asks once to read from that site; nothing is sent anywhere.</p>
        )}
        <Button variant="ghost" icon={<LayoutGrid size={16} />} onClick={onCollage}>
          Combine several images into a collage
        </Button>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => accept(e.target.files?.[0])} />
      </div>
    </div>
  );
}
