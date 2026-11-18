import { useState, type CSSProperties } from 'react';
import { Check, Image as ImageIcon, Monitor, Moon, Sun } from 'lucide-react';
import { THEMES, themeById, themeSwatches, themeTokens, type ThemeId, type ThemeMode, type ThemePreference, type ThemeSpec } from '@/shared/theme/themes';
import styles from './ThemePicker.module.css';

type View = ThemeMode | 'system';

/** Last theme picked in each group, so switching Dark ↔ Light comes back to it. */
const LAST_KEY = (mode: ThemeMode) => `pixora.theme.last.${mode}`;
const FIRST: Record<ThemeMode, ThemeId> = { dark: 'graphite-dark', light: 'classic-blue' };

function lastOf(mode: ThemeMode): ThemeId {
  try {
    const v = localStorage.getItem(LAST_KEY(mode));
    if (v && THEMES.some((t) => t.id === v && t.mode === mode)) return v as ThemeId;
  } catch {
    /* storage blocked */
  }
  return FIRST[mode];
}

function remember(id: ThemeId) {
  try {
    localStorage.setItem(LAST_KEY(themeById(id).mode), id);
  } catch {
    /* storage blocked */
  }
}

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
    <button type="button" role="radio" data-card aria-checked={selected} aria-label={t.name} className={`${styles.card} ${selected ? styles.cardOn : ''}`} style={cardStyle(t)} onClick={onPick}>
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

const VIEWS: Array<{ id: View; label: string; icon: JSX.Element }> = [
  { id: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  { id: 'system', label: 'System', icon: <Monitor size={16} /> },
  { id: 'light', label: 'Light', icon: <Sun size={16} /> },
];

/**
 * Settings › General › Theme: Dark / System / Light at the top; below, the themes of the chosen
 * group (System follows the computer: Classic Blue in light mode, Graphite Dark in dark mode).
 * Every window (popup, editors, settings, helper windows) uses it.
 */
export function ThemePicker({ value, onChange }: { value: ThemePreference; onChange: (v: ThemePreference) => void }) {
  const current: View = value === 'system' ? 'system' : themeById(value).mode;
  const [view, setView] = useState<View>(current);
  const pick = (id: ThemeId) => {
    remember(id);
    onChange(id);
  };
  const choose = (v: View) => {
    setView(v);
    if (v === 'system') onChange('system');
    // Switching group applies that group's last theme (keeps the current one if it is already in it).
    else if (current !== v) onChange(lastOf(v));
  };
  const list = view === 'system' ? [] : THEMES.filter((t) => t.mode === view);
  return (
    <div className={styles.picker}>
      <div className={styles.modes} role="radiogroup" aria-label="Theme mode">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={`${styles.mode} ${view === v.id ? styles.modeOn : ''}`} onClick={() => choose(v.id)}>
            {v.icon} {v.label}
          </button>
        ))}
      </div>
      {view === 'system' ? (
        <p className={styles.systemNote}>
          <Monitor size={16} /> Follows your computer: <strong>Classic Blue</strong> when it is in light mode, <strong>Graphite Dark</strong> when it is in dark mode.
        </p>
      ) : (
        <div className={styles.grid} role="radiogroup" aria-label={view === 'dark' ? 'Dark themes' : 'Light themes'}>
          {list.map((t) => <ThemeCard key={t.id} t={t} selected={value === t.id} onPick={() => pick(t.id)} />)}
        </div>
      )}
    </div>
  );
}
