import type { CSSProperties } from 'react';
import { Check, Image as ImageIcon, Monitor, Moon, Sun } from 'lucide-react';
import { THEMES, themeSwatches, themeTokens, type ThemePreference, type ThemeSpec } from '@/shared/theme/themes';
import styles from './ThemePicker.module.css';

/** A card's own colours (each card is drawn in its theme, whatever theme the page uses). */
function cardStyle(t: ThemeSpec): CSSProperties {
  const k = themeTokens(t);
  return {
    '--t-page': k['--c-bg-subtle'],
    '--t-panel': k['--c-bg'],
    '--t-chrome': k['--c-editor-chrome'],
    '--t-canvas': k['--c-editor-canvas'],
    '--t-border': k['--c-border-strong'],
    '--t-text': k['--c-text'],
    '--t-dim': k['--c-text-secondary'],
    '--t-primary': k['--c-primary'],
    '--t-on-primary': k['--c-on-primary'],
    '--t-soft': k['--c-primary-soft-strong'],
    '--t-secondary': k['--c-secondary'],
  } as CSSProperties;
}

/** A small picture of the editor in the theme: toolbar, image rail, canvas, side panel. */
function Preview() {
  return (
    <div className={styles.preview} aria-hidden>
      <div className={styles.pvBar}>
        <span className={styles.pvLogo} />
        {Array.from({ length: 8 }, (_, i) => <span key={i} className={styles.pvTool} />)}
        <span className={styles.pvCta} />
      </div>
      <div className={styles.pvBody}>
        <div className={styles.pvRail}>
          <span className={styles.pvThumb}><ImageIcon size={14} /></span>
          <span className={styles.pvLine} />
          <span className={`${styles.pvLine} ${styles.pvShort}`} />
        </div>
        <div className={styles.pvCanvas}><span className={styles.pvImage}><ImageIcon size={26} /></span></div>
        <div className={styles.pvPanel}>
          <span className={styles.pvPill} />
          <span className={styles.pvLine} />
          <span className={`${styles.pvLine} ${styles.pvShort}`} />
          <span className={styles.pvLine} />
          <span className={styles.pvBtn} />
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ t, selected, onPick }: { t: ThemeSpec; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={t.name} className={`${styles.card} ${selected ? styles.cardOn : ''}`} style={cardStyle(t)} onClick={onPick}>
      <span className={styles.cardHead}>
        <span>
          <span className={styles.cardName}>{t.name}</span>
          <span className={styles.cardDesc}>{t.description}</span>
        </span>
        {selected ? (
          <span className={styles.badge}><Check size={12} /> Selected</span>
        ) : t.badge ? (
          <span className={styles.badgeQuiet}>{t.badge}</span>
        ) : null}
      </span>
      <Preview />
      <span className={styles.swatches}>
        {themeSwatches(t).map((s) => (
          <span key={s.label} className={styles.swatch}>
            <span className={styles.chip} style={{ background: s.color }} />
            <span className={styles.hex}>{s.color.toUpperCase()}</span>
            <span className={styles.swLabel}>{s.label}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

/** Settings › General › Theme: every window (popup, editors, settings, helper windows) uses it. */
export function ThemePicker({ value, onChange }: { value: ThemePreference; onChange: (v: ThemePreference) => void }) {
  const group = (mode: 'dark' | 'light') => THEMES.filter((t) => t.mode === mode);
  return (
    <div className={styles.picker} role="radiogroup" aria-label="Theme">
      <button type="button" role="radio" aria-checked={value === 'system'} className={`${styles.system} ${value === 'system' ? styles.systemOn : ''}`} onClick={() => onChange('system')}>
        <Monitor size={18} />
        <span>
          <strong>Match my computer</strong>
          <small>Classic Blue when your computer is in light mode, Graphite Dark when it is in dark mode.</small>
        </span>
        {value === 'system' && <Check size={16} className={styles.systemCheck} />}
      </button>
      <h3 className={styles.groupTitle}><Moon size={15} /> Dark themes</h3>
      <div className={styles.grid}>
        {group('dark').map((t) => <ThemeCard key={t.id} t={t} selected={value === t.id} onPick={() => onChange(t.id)} />)}
      </div>
      <h3 className={styles.groupTitle}><Sun size={15} /> Light themes</h3>
      <div className={styles.grid}>
        {group('light').map((t) => <ThemeCard key={t.id} t={t} selected={value === t.id} onPick={() => onChange(t.id)} />)}
      </div>
    </div>
  );
}
