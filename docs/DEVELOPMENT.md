# Development

## Layout

```
public/manifest.json, public/icons/     static extension files (copied to dist/)
*.html                                   page entries (popup, editor, recorder, video, flow, flowbar, options, controlbar, progress, teleprompter, permissions, offscreen)
scripts/                                 build helpers: content-script IIFE bundle, OCR assets, icons, E2E manifest, release check (verify-package), release zip (package)
src/
  background/      service worker: message-handler, recording-manager, offscreen-manager, download-manager, scheduler, commands, badge, overlay
  content/         on-demand page overlay (classic script, type-only imports)
  popup/           popup UI (components, hooks, styles)
  screenshot/      capture services: visible, full page (page-scripts + image-stitching), area, desktop, OCR
  recording/       services (session, recorder, compositor, audio, camera, codec, chunk store, export, state) + pages (recorder, video, control bar, permissions)
  editor/          editor page, canvas workspace, tools, history, render, image panel, compare
  collage/         collage workspace (inside the editor page)
  flow/            Flow Capture: Flow Editor, exports (PDF, HTML, ZIP, JSON)
  progress/        countdown window before Entire Screen / App Window screenshots
  teleprompter/    teleprompter window
  settings/        settings service + options page
  history/         history service + Recent captures UI
  offscreen/       offscreen document host
  shared/          types, constants, messaging, storage (IndexedDB), utils, design-system components, hooks
  styles/          design tokens (variables.css), dark theme, global styles
tests/unit, tests/integration (Vitest) · tests/e2e (Playwright)
docs/
```

## Conventions

- TypeScript strict mode, with `noUncheckedIndexedAccess`. Shared types live in `src/shared/types`.
- Browser APIs sit behind services (`media-stream-service`, `capture-service`, `download`…). UI components don't call `getUserMedia` or `chrome.downloads` directly.
- CSS Modules per component, with design tokens in `src/styles/variables.css` and a dark theme via `[data-theme='dark']`.
- No dynamic `import()` in code reachable from the service worker (Vite's preload helper needs `document`).
- Content scripts may only use **type** imports; they are bundled separately as IIFE.
- Functions in `page-scripts.ts` are serialised by Chrome, so they must be completely self-contained.

## Build pipeline

1. `tsc --noEmit` for the whole project, including tests.
2. `vite build` for multi-page React + `background.js` (ES module service worker).
3. `scripts/build-content.mjs` bundles `content/overlay.js` as IIFE.
4. `scripts/copy-ocr-assets.mjs` copies the Tesseract worker, the LSTM WASM cores and `eng.traineddata.gz` to `dist/ocr`.
5. `scripts/verify-package.mjs` checks the result (no remote code, no `eval`, manifest files present, no required host access). `npm run package` then zips `dist/` to `release/pixora-<version>.zip`.

Because step 1 type-checks the tests too, a type error in a test file stops the build — and end-to-end runs with `SKIP_BUILD=1` would then test the previous `dist/`. Check the build output for `[verify] package OK` before trusting an end-to-end run.

## Testing

- `npm test` runs about 300 Vitest tests (41 files):
  - **Units:** filenames, codecs, stitching math, WebM duration patcher, recording state machine, settings, history, chunk store, editor history and geometry, message validation, error mapping.
  - **Integration:** the service-worker recording manager (tab / area / desktop / recovery / errors) and the screenshot pipeline, against a mocked `chrome` API and fake IndexedDB.
- `npm run test:e2e` runs Playwright with the real extension in Chromium. `scripts/prepare-e2e.mjs` creates `dist-e2e/` with `<all_urls>`, because automation can't click the toolbar icon to grant `activeTab`. The shipped `dist/` is unchanged.
  - 17 spec files covering: visible / full-page (scroll areas, popup progress and Stop, split long pages) / area / delayed screenshots, the editor (tools, image panel, compare, collage, cut out & join, exports), the popup and its live recording tools, settings, history, camera + microphone recording, pause / resume, 1080p and 4K attempts, trim, exports, video annotations and their timeline, privacy regions burned into exports, Flow Capture and the Flow Editor, and locked storage.
  - Run them in groups with `--workers=1` on a busy machine; recording tests are timing-sensitive under heavy load.
  - Recording specs run **headed** (a browser window appears). Headless Chromium's MediaRecorder emits no data. The fake camera and microphone are generated files (`tests/e2e/media-fixtures.ts`).
  - Skipped in automation, with the reason recorded: **tab capture** (needs a real toolbar click) and **desktop capture** (Chrome's `desktopCapture` picker can't be auto-answered). Verify these manually as below.

## Manual test checklist (real Chrome)

Things automation can't do (Chrome's pickers, a real toolbar click) — check them before each release
in a clean profile with `dist/` loaded unpacked:

1. Popup → Screenshot → Visible Part, Selected Area, Delay 3 s.
2. Full Page on a long page with a sticky header → Pixora's popup opens by itself with progress and Stop → the editor opens. Try Stop half-way, and a very long page (several images in the image panel).
3. Entire Screen & App Window → pick a window → countdown window → the editor opens with that window.
4. Annotate Local & Clipboard Image → paste with Ctrl+V; Add image → From a web address (Chrome asks for that site).
5. Take Screenshot & Extract Text → the OCR dialog shows text → Copy.
6. Record → This Tab with microphone → pause / resume and Live tools from the popup (Zoom in: click a point; Highlight area; Draw) → stop → the result page plays and seeks.
7. Custom (This Tab) → drag a region → the recording contains only that region.
8. Desktop → share the entire screen with system audio (Windows) → Zoom to area while recording: the recording pauses while you choose and Pixora's selection is not in the video → stop → check "Audio: System".
9. Result page → Annotate rail → draw an arrow and a text → set animations → Export → MP4: the annotations are in the video.
10. Flow Capture → click through 3–4 steps on two sites → Finish → Flow Editor → export PDF.
11. Close the recorder tab mid-recording → the recording is recovered and opened.
