/**
 * Colours are stored as CSS strings: `#rrggbb`, `#rrggbbaa` (with transparency), `transparent`, or
 * a two-stop gradient `linear:<colour>:<colour>`. Canvas and CSS both understand 8-digit hex.
 */
export interface ParsedColor {
  hex: string;
  alpha: number;
}

export function parseColor(value: string): ParsedColor {
  if (!value || value === 'transparent') return { hex: '#000000', alpha: 0 };
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!m) return { hex: '#000000', alpha: 1 };
  return { hex: `#${m[1]!.toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

export function formatColor(hex: string, alpha: number): string {
  // A fully transparent colour keeps its hue (#rrggbb00), so the colour and its opacity slider stay visible.
  const a = Math.max(0, Math.min(1, alpha));
  const base = parseColor(hex).hex;
  if (a >= 1) return base;
  return `${base}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

/** Applies an opacity to a solid colour or to both stops of a gradient. */
export function withAlpha(value: string, alpha: number): string {
  if (value.startsWith('linear:')) {
    const [, a = '#ffffff', b = '#000000'] = value.split(':');
    return `linear:${formatColor(a, alpha)}:${formatColor(b, alpha)}`;
  }
  if (value === 'transparent') return value;
  return formatColor(value, alpha);
}

export function alphaOf(value: string): number {
  if (value.startsWith('linear:')) return parseColor(value.split(':')[1] ?? '').alpha;
  return parseColor(value).alpha;
}

export function sameHue(a: string, b: string): boolean {
  if (a === 'transparent' || b === 'transparent') return a === b;
  return parseColor(a).hex === parseColor(b).hex;
}

/** CSS for previewing a stored colour/gradient. */
export function cssPaint(value: string): string {
  if (value.startsWith('linear:')) {
    const [, a, b] = value.split(':');
    return `linear-gradient(135deg, ${a}, ${b})`;
  }
  return value;
}
