import type { CursorEffects } from '@/shared/types';
import { ColorSwatches, RadioGroup, Slider, ToggleSwitch } from './FormControls';

export type MovingCursor = 'off' | 'halo' | 'cursor' | 'both';

/** What follows the mouse between clicks: a soft halo, a drawn cursor (tab recordings have none), or both. */
export function movingCursorOf(fx: Pick<CursorEffects, 'cursor' | 'pointer'>): MovingCursor {
  return fx.cursor && fx.pointer ? 'both' : fx.cursor ? 'halo' : fx.pointer ? 'cursor' : 'off';
}

export function movingCursorPatch(v: MovingCursor): Pick<CursorEffects, 'cursor' | 'pointer'> {
  return { cursor: v === 'halo' || v === 'both', pointer: v === 'cursor' || v === 'both' };
}

const COLOURS = ['#FFD84D', '#4F8DF7', '#E05252', '#8B5CF6', '#24A36A', '#F59E0B', '#FFFFFF', '#111827'];

/**
 * One setting for the mouse between clicks (Highlight mouse clicks covers the clicks themselves):
 * Off, a soft halo, a drawn cursor, or both — with their options. Same in Settings and the popup.
 */
export function MovingCursorFields({ fx, onChange, tone = 'light' }: { fx: CursorEffects; onChange: (patch: Partial<CursorEffects>) => void; tone?: 'light' | 'dark' }) {
  const value = movingCursorOf(fx);
  const halo = value === 'halo' || value === 'both';
  const drawn = value === 'cursor' || value === 'both';
  return (
    // As wide as the Off / Halo / Cursor / Both switch: the sliders and texts below never stretch across a wide card.
    <div style={{ display: 'grid', gap: 12, width: '100%', maxWidth: 576, boxSizing: 'border-box' }}>
      <RadioGroup<MovingCursor> label="Mouse cursor between clicks" tone={tone} size="sm" value={value} onChange={(v) => onChange(movingCursorPatch(v))}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'halo', label: 'Halo', title: 'A soft halo follows the mouse, so viewers can follow it' },
          { value: 'cursor', label: 'Cursor', title: 'Shows the mouse pointer all the time in tab recordings (they never include the real one)' },
          { value: 'both', label: 'Both', title: 'Halo and cursor' },
        ]} />
      <span style={{ fontSize: 12, opacity: 0.75 }}>
        {value === 'off' && 'Only the clicks are shown (Highlight mouse clicks). Tab recordings never include the mouse cursor itself.'}
        {halo && 'Halo: a soft circle follows the mouse in the recorded page. '}
        {drawn && 'Cursor: Pixora draws a mouse pointer that follows the mouse all the time (tab recordings have none). Desktop and window recordings already show the real cursor.'}
      </span>
      {halo && (
        <>
          <Slider tone={tone} label="Halo size" min={16} max={120} value={fx.cursorSize} format={(v) => `${v}px`} onChange={(cursorSize) => onChange({ cursorSize })} />
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13 }}>Halo colour</span>
            <ColorSwatches label="Halo colour" colors={COLOURS} value={fx.cursorColor} onChange={(cursorColor) => onChange({ cursorColor })} alpha={false} />
          </div>
        </>
      )}
      {drawn && (
        <>
          <span style={{ fontSize: 12, opacity: 0.75 }}>Uses the cursor design, size and colours chosen under Highlight mouse clicks › Cursor design.</span>
          <Slider tone={tone} label="Smooth movement" min={0} max={0.9} step={0.05} value={fx.smoothing ?? 0} format={(v) => (v < 0.05 ? 'Off' : `${Math.round(v * 100)}%`)} onChange={(smoothing) => onChange({ smoothing })} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            Hide the real cursor in the recorded page
            <ToggleSwitch size="sm" label="Hide the real cursor" checked={Boolean(fx.hideSystemCursor)} onChange={(hideSystemCursor) => onChange({ hideSystemCursor })} />
          </label>
        </>
      )}
    </div>
  );
}
