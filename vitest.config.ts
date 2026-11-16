import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // The first test of each integration file loads the whole service worker fresh; with many
    // files loading in parallel on Windows that can pass vitest's 5 s default (no test waits).
    testTimeout: 15_000,
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
