import { useEffect, useState } from 'react';
import type { SensitiveMatch } from '@/screenshot/services/sensitive-detect';
import { SENSITIVE_LABELS } from '@/screenshot/services/sensitive-detect';
import { Modal } from './Modal';
import { Button } from './Button';
import { Checkbox, RadioGroup } from './FormControls';
import { ProgressIndicator } from './Progress';
import { InlineNotice } from './Settings';
import styles from './SensitiveDialog.module.css';

export type RedactKind = 'blur' | 'pixelate' | 'mask';

interface Props {
  open: boolean;
  /** null while scanning. */
  matches: SensitiveMatch[] | null;
  progress: number;
  error: string | null;
  /** Matches left out because a blur / pixelate / mask already covers them. */
  alreadyHidden?: number;
  tone?: 'light' | 'dark';
  onClose: () => void;
  onApply: (selected: SensitiveMatch[], kind: RedactKind) => void;
}

/** Shows text that looks sensitive and lets the user choose what to hide (nothing is hidden without confirmation). */
export function SensitiveDialog({ open, matches, progress, error, alreadyHidden = 0, tone = 'light', onClose, onApply }: Props) {
  const [checked, setChecked] = useState<boolean[]>([]);
  const [kind, setKind] = useState<RedactKind>('blur');
  useEffect(() => {
    if (matches) setChecked(matches.map(() => true));
  }, [matches]);
  const selected = (matches ?? []).filter((_, i) => checked[i]);
  return (
    <Modal
      open={open}
      title="Find sensitive information"
      onClose={onClose}
      tone={tone}
      width={500}
      draggable
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!selected.length} onClick={() => onApply(selected, kind)}>
            Hide {selected.length || ''} selected
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.lead}>Text is read on this device; nothing is uploaded. Review what was found and choose what to hide.</p>
        {error ? (
          <InlineNotice tone="error">{error}</InlineNotice>
        ) : !matches ? (
          <ProgressIndicator value={progress || null} label="Reading text…" />
        ) : matches.length === 0 && alreadyHidden > 0 ? (
          <InlineNotice tone="success">Everything found is already hidden ({alreadyHidden} item{alreadyHidden === 1 ? '' : 's'} covered by blur, pixelate or mask).</InlineNotice>
        ) : matches.length === 0 ? (
          <InlineNotice>Nothing that looks private was found (emails, phone / card / account / ID numbers, keys, tokens, passwords and labelled personal details are checked). Very small or stylised text can be missed — zoom the page before capturing, or hide areas by hand with Blur, Pixelate or Mask.</InlineNotice>
        ) : (
          <>
            {alreadyHidden > 0 && <p className={styles.lead}>{alreadyHidden} item{alreadyHidden === 1 ? ' is' : 's are'} already hidden and not listed.</p>}
            <ul className={styles.list} aria-label="Sensitive text found">
              {matches.map((m, i) => (
                <li key={`${m.text}-${i}`}>
                  <Checkbox
                    checked={checked[i] ?? false}
                    onChange={(v) => setChecked((c) => c.map((x, j) => (j === i ? v : x)))}
                    label={<span className={styles.kind}>{SENSITIVE_LABELS[m.kind]}</span>}
                    description={<span className={styles.text}>{m.text}</span>}
                  />
                </li>
              ))}
            </ul>
            <div className={styles.row}>
              <span>Hide with</span>
              <RadioGroup<RedactKind> label="Hide with" tone={tone} size="sm" value={kind} onChange={setKind} options={[{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'mask', label: 'Solid mask' }]} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
