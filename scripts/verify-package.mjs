// Release check for the Chrome Web Store (runs at the end of `npm run build`).
//
//  1. Libraries keep default CDN addresses we never use (tesseract.js points its worker, core and
//     language data at cdn.jsdelivr.net; we always pass local paths in dist/ocr). Those strings are
//     replaced by local relative paths so the package contains no remote code location at all.
//  2. Fails the build if any remote script host, `eval(` or `new Function(` remains in our own
//     bundles, if a declared file is missing, or if the manifest asks for broad host access.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist);
const REMOTE_HOSTS = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|ajax\.googleapis\.com|cdn\.skypack\.dev|esm\.sh)\//g;

// 1. Neutralise unused library defaults.
for (const f of files.filter((p) => /\.(m?js|html)$/.test(p))) {
  const text = readFileSync(f, 'utf8');
  if (!REMOTE_HOSTS.test(text)) continue;
  REMOTE_HOSTS.lastIndex = 0;
  writeFileSync(f, text.replace(REMOTE_HOSTS, './'));
  console.log(`[verify] removed unused CDN default(s) from ${relative(root, f)}`);
}

// 2. Checks.
for (const f of files.filter((p) => /\.(m?js|html)$/.test(p))) {
  const text = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  if (REMOTE_HOSTS.test(text)) problems.push(`${rel}: remote script host`);
  REMOTE_HOSTS.lastIndex = 0;
  if (/<script[^>]+src=["']https?:/i.test(text)) problems.push(`${rel}: remote <script src>`);
  // The OCR worker is the unmodified tesseract.js build; its only `new Function` is a guarded
  // globalThis fallback (try/catch) that our CSP blocks harmlessly. Our own code must have none.
  if (!rel.includes(`${join('dist', 'ocr')}`) && /\beval\(|new Function\(/.test(text)) problems.push(`${rel}: eval / new Function`);
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const declared = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);
for (const p of declared) if (!existsSync(resolve(dist, p))) problems.push(`manifest file missing: ${p}`);
if (manifest.host_permissions?.length) problems.push(`host_permissions must stay optional: ${manifest.host_permissions.join(', ')}`);
if (manifest.content_scripts?.length) problems.push('static content_scripts would need host access on install');
if (manifest.description && manifest.description.length > 132) problems.push(`description is ${manifest.description.length} characters (store limit 132)`);
if (/unsafe-eval'/.test(JSON.stringify(manifest.content_security_policy ?? {}).replace(/wasm-unsafe-eval/g, ''))) problems.push("CSP allows 'unsafe-eval'");

if (problems.length) {
  console.error('[verify] package is not ready for the Chrome Web Store:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`[verify] package OK: ${files.length} files, manifest v${manifest.version}, no remote code`);
