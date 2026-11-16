import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Builds the extension (unless SKIP_BUILD=1) and prepares the E2E variant. */
export default function globalSetup(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  if (process.env.SKIP_BUILD !== '1' || !existsSync(resolve(root, 'dist/manifest.json'))) {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  }
  execSync('node scripts/prepare-e2e.mjs', { cwd: root, stdio: 'inherit' });
}
