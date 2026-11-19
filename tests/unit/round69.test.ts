import { describe, expect, it } from 'vitest';
import type { BoxAnnotation, StrokeAnnotation } from '@/editor/types';
import { clipFromShape } from '@/editor/tools/stroke-clip';
import { rotateBy, translate } from '@/editor/tools/annotations';

const shape: BoxAnnotation = { id: 's', type: 'ellipse', x: 100, y: 50, w: 200, h: 100, stroke: '#000', fill: 'transparent', width: 2, opacity: 1 } as BoxAnnotation;
const stroke = (): StrokeAnnotation => ({ id: 'h', type: 'highlighter', points: [{ x: 0, y: 100 }, { x: 400, y: 100 }], color: '#ff0', width: 30, opacity: 1, clip: clipFromShape(shape, 'outside') });

describe('cutting a stroke with a shape', () => {
  it('copies the shape outline onto the stroke', () => {
    expect(stroke().clip).toMatchObject({ from: 's', keep: 'outside', kind: 'ellipse', x: 100, y: 50, w: 200, h: 100 });
  });

  it('the cut moves and turns with the stroke', () => {
    const moved = translate(stroke(), 30, -10) as StrokeAnnotation;
    expect(moved.clip).toMatchObject({ x: 130, y: 40 });
    const turned = rotateBy(stroke(), 90) as StrokeAnnotation;
    expect(turned.clip!.rotation).toBe(90);
    // The stroke turns around its middle (200, 100), where the ellipse is centred too.
    expect(turned.clip!.x + turned.clip!.w / 2).toBeCloseTo(200, 5);
  });
});
