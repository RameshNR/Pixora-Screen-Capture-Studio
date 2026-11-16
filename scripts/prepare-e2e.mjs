// Creates dist-e2e: a copy of the production build whose manifest also grants <all_urls>.
// Automated browsers cannot click the toolbar icon, so activeTab is never granted; the host
// permission lets tests capture pages instead. The shipped extension (dist/) is NOT modified.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist');
const out = resolve(root, 'dist-e2e');
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const manifestPath = resolve(out, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['<all_urls>'];
manifest.name = `${manifest.name} (E2E)`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('dist-e2e prepared');
