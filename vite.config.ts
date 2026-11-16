import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = __dirname;
const page = (name: string) => resolve(root, `${name}.html`);

/**
 * Builds every extension page (multi-page app) plus the MV3 service worker.
 * Content scripts must be classic scripts, so they are bundled separately as IIFE
 * by scripts/build-content.mjs.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: process.env.GLINT_SOURCEMAP === '1',
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        popup: page('popup'),
        editor: page('editor'),
        recorder: page('recorder'),
        video: page('video'),
        options: page('options'),
        offscreen: page('offscreen'),
        controlbar: page('controlbar'),
        teleprompter: page('teleprompter'),
        flowbar: page('flowbar'),
        flow: page('flow'),
        permissions: page('permissions'),
        progress: page('progress'),
        background: resolve(root, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
