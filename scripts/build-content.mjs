// Bundles content scripts as self-contained IIFE files (content scripts cannot be ES modules
// when injected with chrome.scripting.executeScript({ files })).
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = { overlay: 'src/content/overlay.ts' };
const watch = process.argv.includes('--watch');

for (const [name, file] of Object.entries(entries)) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    resolve: { alias: { '@': resolve(root, 'src') } },
    build: {
      outDir: resolve(root, 'dist/content'),
      emptyOutDir: false,
      target: 'chrome116',
      minify: true,
      watch: watch ? {} : null,
      lib: { entry: resolve(root, file), name: `glint_${name}`, formats: ['iife'], fileName: () => `${name}.js` },
    },
  });
  console.log(`content script built: content/${name}.js`);
}
