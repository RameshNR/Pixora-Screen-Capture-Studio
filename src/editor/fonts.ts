// Locally bundled web fonts (no remote requests). Only the Latin subsets are included.
import '@fontsource/crafty-girls/latin-400.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/limelight/latin-400.css';
import '@fontsource/lobster/latin-400.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/chewy/latin-400.css';
import '@fontsource/frijole/latin-400.css';
import '@fontsource/spirax/latin-400.css';
import '@fontsource/dancing-script/latin-400.css';
import '@fontsource/dancing-script/latin-700.css';
import '@fontsource/changa-one/latin-400.css';
import '@fontsource/griffy/latin-400.css';
import { DEFAULT_FONT } from './types';

export interface FontOption {
  label: string;
  /** CSS font-family list used for canvas text. */
  family: string;
  /** Web fonts that must be loaded before drawing (system fonts need nothing). */
  webFont?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: 'Inter', family: DEFAULT_FONT },
  { label: 'Times New Roman', family: '"Times New Roman", Times, serif' },
  { label: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { label: 'Crafty Girls', family: '"Crafty Girls", cursive', webFont: 'Crafty Girls' },
  { label: 'Open Sans', family: '"Open Sans", sans-serif', webFont: 'Open Sans' },
  { label: 'Roboto', family: 'Roboto, sans-serif', webFont: 'Roboto' },
  { label: 'Montserrat', family: 'Montserrat, sans-serif', webFont: 'Montserrat' },
  { label: 'Limelight', family: 'Limelight, serif', webFont: 'Limelight' },
  { label: 'Lobster', family: 'Lobster, cursive', webFont: 'Lobster' },
  { label: 'Anton', family: 'Anton, sans-serif', webFont: 'Anton' },
  { label: 'Chewy', family: 'Chewy, cursive', webFont: 'Chewy' },
  { label: 'Frijole', family: 'Frijole, cursive', webFont: 'Frijole' },
  { label: 'Spirax', family: 'Spirax, cursive', webFont: 'Spirax' },
  { label: 'Dancing Script', family: '"Dancing Script", cursive', webFont: 'Dancing Script' },
  { label: 'Changa One', family: '"Changa One", sans-serif', webFont: 'Changa One' },
  { label: 'Griffy', family: 'Griffy, cursive', webFont: 'Griffy' },
  { label: 'Georgia', family: 'Georgia, serif' },
  { label: 'Courier New', family: '"Courier New", Courier, monospace' },
  { label: 'Impact', family: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Comic Sans', family: '"Comic Sans MS", cursive' },
];

const loaded = new Set<string>();

/**
 * Canvas text only uses a web font once it is loaded. Loads every web font referenced by
 * `families` (bold + regular) and resolves true if anything new became available.
 */
export async function ensureFonts(families: Iterable<string>): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const jobs: Promise<unknown>[] = [];
  for (const family of families) {
    const opt = FONT_OPTIONS.find((f) => f.family === family);
    if (!opt?.webFont || loaded.has(opt.webFont)) continue;
    loaded.add(opt.webFont);
    jobs.push(document.fonts.load(`400 32px "${opt.webFont}"`), document.fonts.load(`700 32px "${opt.webFont}"`).catch(() => undefined));
  }
  if (!jobs.length) return false;
  await Promise.allSettled(jobs);
  return true;
}
