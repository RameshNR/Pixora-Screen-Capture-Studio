import { useRef, useState } from 'react';
import { ClipboardPaste, FolderOpen, ImagePlus, Link2 } from 'lucide-react';
import { Dropdown } from './Dropdown';
import { Modal } from './Modal';
import { Button, IconButton } from './Button';
import { TextField } from './FormControls';
import { useToast } from './Toast';
import { fetchImageFromUrl, parseImageUrl } from '@/shared/utils/image-url';
import { IMAGE_ACCEPT, isSupportedImage, UNSUPPORTED_IMAGE_MESSAGE } from '@/shared/utils/image-types';

export interface AddedImage {
  blob: Blob;
  name: string;
}

interface Props {
  onAdd: (images: AddedImage[]) => void;
  /** Style of the text button (variant "button"). */
  className?: string;
  label?: string;
  /** "icon": a toolbar icon button (dark editor toolbar). */
  variant?: 'button' | 'icon';
}

/**
 * "Add image": pictures from this computer (several at once — folders synced by cloud drives such as
 * OneDrive or Google Drive for desktop are reachable from the same picker), from the clipboard, or
 * from a web address. Nothing is uploaded; Pixora has no cloud account by design.
 */
export function AddImageMenu({ onAdd, className, label = 'Add image', variant = 'button' }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const found: AddedImage[] = [];
      for (const item of items) {
        const type = item.types.find((t) => isSupportedImage({ type: t }));
        if (type) found.push({ blob: await item.getType(type), name: `Pasted image.${type.split('/')[1] ?? 'png'}` });
      }
      if (found.length) {
        onAdd(found);
        return;
      }
      // A copied picture address works too.
      const text = (await navigator.clipboard.readText().catch(() => '')).trim();
      if (/^(https?:|data:image\/)/i.test(text)) {
        setUrl(text);
        setError(null);
        setUrlOpen(true);
        return;
      }
      toast.info('No picture on the clipboard', 'Copy an image (or take a screenshot with the Print Screen key), then try again.');
    } catch {
      toast.info('Could not read the clipboard', 'Allow Pixora to see the clipboard when Chrome asks, or press Ctrl+V.');
    }
  };

  const fromUrl = async () => {
    const parsed = parseImageUrl(url);
    if ('error' in parsed) { setError(parsed.error); return; }
    setBusy(true);
    setError(null);
    try {
      const img = await fetchImageFromUrl(parsed.url);
      onAdd([img]);
      setUrlOpen(false);
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The picture could not be downloaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropdown
        minWidth={250}
        ariaLabel={label}
        items={[
          { id: 'file', label: 'From your computer…', description: 'Also folders synced by OneDrive / Google Drive', icon: <FolderOpen size={15} />, onSelect: () => input.current?.click() },
          { id: 'clip', label: 'Paste from clipboard', description: 'A copied picture or picture address', icon: <ClipboardPaste size={15} />, onSelect: () => void fromClipboard() },
          { id: 'url', label: 'From a web address (URL)…', description: 'Downloads the picture to this computer', icon: <Link2 size={15} />, onSelect: () => { setError(null); setUrlOpen(true); } },
        ]}
        trigger={({ toggle, open }) =>
          variant === 'icon' ? (
            <IconButton tone="dark" label={label} icon={<ImagePlus size={18} />} aria-haspopup="menu" aria-expanded={open} onClick={toggle} />
          ) : (
            <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-label={label} title="Add images from your computer, the clipboard or a web address" onClick={toggle}>
              <ImagePlus size={15} /> <span>{label}</span>
            </button>
          )
        }
      />
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        aria-label={variant === 'icon' ? `${label}: files` : 'Images to add'}
        onChange={(e) => {
          const all = Array.from(e.target.files ?? []);
          const files = all.filter((f) => isSupportedImage(f));
          e.target.value = '';
          if (files.length < all.length) toast.info(`${all.length - files.length} file${all.length - files.length > 1 ? 's' : ''} skipped`, UNSUPPORTED_IMAGE_MESSAGE);
          if (files.length) onAdd(files.map((f) => ({ blob: f, name: f.name })));
        }}
      />
      <Modal
        open={urlOpen}
        title="Picture from a web address"
        tone="dark"
        width={460}
        onClose={() => !busy && setUrlOpen(false)}
        footer={
          <>
            <Button onClick={() => setUrlOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!url.trim()} onClick={() => void fromUrl()}>Add picture</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <TextField tone="dark" value={url} autoFocus placeholder="https://example.com/picture.png" aria-label="Picture address"
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !busy) void fromUrl(); }} />
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.75 }}>
            Right-click a picture on a website and choose “Copy image address”. Chrome asks once for permission to read from that site; the picture is downloaded to this computer and nothing is sent anywhere.
          </p>
          {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: '#fca5a5' }}>{error}</p>}
        </div>
      </Modal>
    </>
  );
}
