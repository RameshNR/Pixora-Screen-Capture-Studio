/**
 * Drawn icons for the two erasers, in the same line style as the lucide icons around them.
 * Eraser: an eraser leaving a dashed trail (rubs out annotations).
 * Erase image: a picture with an eraser over its corner (rubs out the screenshot itself).
 */
type Props = { size?: number };

const svg = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export function EraserIcon({ size = 18 }: Props) {
  return (
    <svg {...svg(size)}>
      <g transform="translate(14 10) rotate(45)">
        <rect x="-3.6" y="-7.6" width="7.2" height="15.2" rx="1.8" />
        {/* The rubber end, shaded. */}
        <path d="M-3.6 2.6h7.2v3.2a1.8 1.8 0 0 1-1.8 1.8h-3.6a1.8 1.8 0 0 1-1.8-1.8z" fill="currentColor" fillOpacity={0.35} />
      </g>
      <path d="M3 21h2.5M9 21h2.5M15 21h6" />
    </svg>
  );
}

export function EraseImageIcon({ size = 18 }: Props) {
  return (
    <svg {...svg(size)}>
      {/* Picture, open at the corner the eraser covers. */}
      <path d="M9 16H4.5A2.5 2.5 0 0 1 2 13.5v-9A2.5 2.5 0 0 1 4.5 2h10A2.5 2.5 0 0 1 17 4.5v4" />
      <circle cx="12.2" cy="6.6" r="1.4" />
      <path d="m2.4 13 4.1-4.1 3.6 3.6" />
      <g transform="translate(16.8 16.6) rotate(45)">
        <rect x="-2.6" y="-5.4" width="5.2" height="10.8" rx="1.4" />
        <path d="M-2.6 1.6h5.2v2.4a1.4 1.4 0 0 1-1.4 1.4h-2.4a1.4 1.4 0 0 1-1.4-1.4z" fill="currentColor" fillOpacity={0.35} />
      </g>
    </svg>
  );
}
