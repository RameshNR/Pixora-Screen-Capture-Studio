import { describe, expect, it } from 'vitest';
import type { CalloutAnnotation, MarkerAnnotation, MarkerStyle } from '@/editor/types';
import { fitCallout } from '@/editor/tools/callouts';
import { renderMarker } from '@/editor/tools/shapes';

const callout = (patch: Partial<CalloutAnnotation>): CalloutAnnotation => ({
  id: 'c', type: 'callout', opacity: 1, x: 200, y: 200, w: 400, h: 260, tailX: 900, tailY: 700, text: 'Click the Settings icon in the top-right corner.', title: 'Step 1', badge: '01', fill: '#fff', stroke: '#000', strokeWidth: 2, radius: 8,
  tail: 'none', design: 'circle-arc', color: '#000', fontFamily: 'Inter', fontSize: 20, bold: false, italic: false, align: 'center', ...patch,
} as CalloutAnnotation);
const centre = (a: CalloutAnnotation) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });

describe('callout text size', () => {
  it.each(['circle-arc', 'step-seal', 'oval', 'bubble', 'step'] as const)('%s grows around its centre and comes back', (design) => {
    const a = fitCallout(callout({ design }));
    let now = a;
    for (const fontSize of [32, 48, 64, 96]) {
      now = fitCallout({ ...now, fontSize });
      expect(centre(now).x).toBeCloseTo(centre(a).x, 5);
      expect(centre(now).y).toBeCloseTo(centre(a).y, 5);
    }
    expect(now.w * now.h).toBeGreaterThan(a.w * a.h);
    const back = fitCallout({ ...now, fontSize: 20 });
    expect([back.x, back.y, back.w, back.h]).toEqual([a.x, a.y, a.w, a.h]);
  });

  it('a design with a minimum height does not push the box down', () => {
    const a = callout({});
    const fitted = fitCallout(a);
    expect(fitted.h).toBeGreaterThan(a.h);
    expect(centre(fitted).y).toBeCloseTo(centre(a).y, 5);
  });
});

describe('progress ring marker', () => {
  /** Everything the marker draws with: colours, line widths, dashes and shapes. */
  function look(style: MarkerStyle) {
    const log: string[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 0 });
        if (k === 'createLinearGradient') return () => { log.push('gradient'); return { addColorStop() {} }; };
        return (...args: unknown[]) => { log.push(`${k}(${args.join(',')})`); };
      },
      set(t, k: string, v) {
        t[k] = v;
        log.push(`${k}=${String(v)}`);
        return true;
      },
    });
    const marker = { id: 'm', type: 'marker', x: 50, y: 50, n: 1, size: 60, color: '#E05252', shape: 'ring', style, opacity: 1 } as MarkerAnnotation;
    renderMarker(ctx as unknown as CanvasRenderingContext2D, marker);
    return { log: log.join('|'), number: log.filter((l) => l.startsWith('fillStyle=')).at(-1) };
  }

  it('looks different in every style', () => {
    const styles: MarkerStyle[] = ['gradient', 'filled', 'outline', 'soft', 'dashed', 'layered'];
    expect(new Set(styles.map((s) => look(s).log)).size).toBe(styles.length);
  });

  it('keeps the number readable', () => {
    expect(look('filled').number).toBe('fillStyle=#FFFFFF');
    expect(look('gradient').number).toBe('fillStyle=#FFFFFF');
    expect(look('outline').number).toBe('fillStyle=#E05252');
  });
});
