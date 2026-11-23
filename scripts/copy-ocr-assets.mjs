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

// Camera background (MediaPipe selfie segmenter, Apache-2.0): the engine runs from the package too.
// The model is in public/models. Only the SIMD build is needed (Chrome 116+ always has WebAssembly SIMD).
const mp = resolve(root, 'dist/mediapipe');
rmSync(mp, { recursive: true, force: true });
mkdirSync(mp, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) cpSync(nm(`@mediapipe/tasks-vision/wasm/${f}`), resolve(mp, f));
console.log('Camera background engine copied to dist/mediapipe');

