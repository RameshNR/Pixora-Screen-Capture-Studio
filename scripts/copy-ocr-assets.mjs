// Copies Tesseract worker, WASM core and English language data into dist/ocr so OCR runs fully
// offline. MV3 forbids remotely hosted code, and user screenshots must never leave the device.
import { cpSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/ocr');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const nm = (p) => resolve(root, 'node_modules', p);

cpSync(nm('tesseract.js/dist/worker.min.js'), resolve(out, 'worker.min.js'));
// We run Tesseract in LSTM-only mode (OEM 1); the worker then loads exactly one of these
// (relaxed-SIMD, SIMD or plain), each with its WASM inlined.
const coreDir = nm('tesseract.js-core');
for (const f of readdirSync(coreDir)) {
  if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f)) cpSync(resolve(coreDir, f), resolve(out, f));
}
const langCandidates = [nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), nm('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz')];
const lang = langCandidates.find((p) => existsSync(p));
if (!lang) {
  console.warn('[ocr] English language data not found. Run: npm i -D @tesseract.js-data/eng');
} else {
  cpSync(lang, resolve(out, 'eng.traineddata.gz'));
}
console.log('OCR assets copied to dist/ocr');
