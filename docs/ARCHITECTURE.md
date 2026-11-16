# Architecture

## Execution contexts

| Context | Entry | Responsibilities | Never does |
| --- | --- | --- | --- |
| **Service worker** | `src/background/service-worker.ts` | Message routing, authoritative recording state, screenshots (`captureVisibleTab` + `OffscreenCanvas` stitching), downloads, commands, alarms, crash recovery | DOM, `MediaRecorder` |
| **Offscreen document** | `offscreen.html` → `src/offscreen/` | Hosts *tab / custom-area* recordings; creates `blob:` URLs for service-worker downloads | UI |
| **Recorder tab** | `recorder.html` → `src/recording/pages/RecorderApp.tsx` | Hosts *desktop / camera* recordings (needs the desktop picker and a visible page); "Entire Screen" screenshots | — |
| **Popup** | `popup.html` → `src/popup/` | Screenshot / Record UI; the recording controller (pause / stop, live tools) while a recording runs; the running full-page capture's progress and Stop (opened by the service worker with `action.openPopup`, state in `chrome.storage.session`). Holds no recording state, so it can close at any time | Long-running work |
| **Editor** | `editor.html` → `src/editor/` | Annotation editor, OCR, image export | — |
| **Result page** | `video.html` → `src/recording/pages/VideoApp.tsx` | Player, metadata, rename, trim, export / convert | — |
| **Control bar** (optional, off by default) | `controlbar.html` (popup window) | Pause / resume / stop / mic / camera, markers, zoom / spotlight / highlight, webcam style, live-drawing tools, audio meters | — |
| **Countdown** | `progress.html?mode=countdown` (small window) → `src/progress/` | Seconds left before an Entire Screen / App Window screenshot, Cancel; talks to the recorder tab over a `BroadcastChannel` | — |
| **Teleprompter** | `teleprompter.html` (popup window) → `src/teleprompter/` | Script editor and scrolling prompter; optionally sends its text to the recording host to be drawn into the video | — |
| **Options** | `options.html` → `src/settings/`, `src/history/` | Settings and Recent captures | — |
| **Content overlay** | `src/content/overlay.ts` (+ `annotate-layer.ts`) → `dist/content/overlay.js` | Area / region selection, countdown, recorded-area frame, click effects and cursor halo, cursor tracking for zoom / spotlight, live screen drawing, marker shortcut. Injected only on demand; removes itself when no recording is running | Capturing |

## Messaging

All messages are typed (`src/shared/messaging/messages.ts`) and carry a `target`:

- `background`: requests to the service worker. Validated by `isBackgroundMessage`; the sender must be this extension.
- `host`: commands to the recording host (offscreen or recorder tab). Each host only answers for its own `sessionId`.
- `offscreen`: blob URL creation and revocation.
- `broadcast`: `recording/state`, `history/changed`, `capture/status` to every open page.
- `content`: overlay commands, via `chrome.tabs.sendMessage`.

Responses use `{ ok: true, data } | { ok: false, error: AppErrorInfo }`. Errors are user-facing
(`src/shared/utils/errors.ts`): each has a title, a message and a recovery hint, plus technical
`detail` that is shown only with debug logging.

## Recording pipeline

```
popup ── recording/start ──▶ service worker (recording-manager)
                               │  PREPARE (state persisted in chrome.storage.session)
          tab / area ──────────┤──▶ tabCapture.getMediaStreamId ─▶ offscreen: host/start
          desktop / camera ────┘──▶ open recorder.html?session=…  (asks recording/get-pending)

host (RecordingSession):
  source stream ─┬─▶ [VideoCompositor] crop (VideoFrame.visibleRect, zero-copy)
                 │                    + camera bubble (OffscreenCanvas) ─┐
                 └──────────────────────────── video track ──────────────┼─▶ MediaRecorder
  system audio + mic ─▶ AudioMixer (Web Audio, mute = gain 0) ── audio ──┘      │ 1 s chunks
                                                                                 ▼
                                                               IndexedDB `chunks` (ChunkWriter)
  stop ─▶ assemble Blob (disk-backed) ─▶ WebM duration patch (header only) ─▶ `captures` + `blobs`
       ─▶ recording/host-finished ─▶ service worker opens video.html (reusing the recorder tab)
```

- **State machine:** `recording-state.ts` is a pure reducer. It ignores invalid transitions, so late or duplicate host events can't corrupt the state. The service worker serialises updates with a queue and mirrors them to `chrome.storage.session`, so they survive worker suspension.
- **One session at a time:** `PREPARE` is rejected while busy, and the API returns `already-recording`.
- **Codec selection:** `codec-service.ts` probes `MediaRecorder.isTypeSupported` for H.264 High@5.1 / VP9 / VP8 / AV1 with AAC / Opus. It falls back from MP4 to WebM with an explanation.
- **Resolution:** the preset becomes `maxWidth/maxHeight` constraints, so Chrome scales down only. `fitWithin` never upscales. The real track settings are reported, and a note appears when the source is smaller than requested.
- **Bitrate:** about 0.12 bits/pixel/frame (≈7.5 Mbps at 1080p30, ≈30 Mbps at 4K30), unless overridden.
- **Memory:** chunks go to IndexedDB every second and the final `Blob` is assembled from stored blobs (Chrome keeps large blobs on disk). The duration patch rewrites only the WebM header.
- **Interruptions:**
  - Source ended (tab closed or sharing stopped): stop and save.
  - Microphone or camera unplugged: a warning, and recording continues.
  - Storage full: stop and save what was written.
  - Recorder tab closed, or the offscreen document gone after a worker restart: the service worker recovers the session from IndexedDB (`finalizeRecording`).
  - Nothing written at all: a clear `recording-empty` error.
- **Cleanup:** `RecordingSession.releaseMedia()` stops every track, the audio graph and the compositor. The offscreen document is closed after each tab recording.

## Live recording tools

`src/background/live-tools.ts` turns user actions into state events, host messages and overlay
messages. State stays in `recording-manager.ts` (`markers` and `effects` in `RecordingState`), so the
control bar renders from the same broadcast as everything else.

| Feature | Where it happens | How it reaches the video |
| --- | --- | --- |
| Markers / chapters | `recording/marker` → `MARKER_ADD` (time = active recording time) | Saved on the capture (`CaptureRecord.markers`) when the host finishes or a recording is recovered |
| Zoom, spotlight, region highlight, teleprompter caption, webcam style | `recording/effect` → `EFFECT` + `host/effect` → `RecordingSession.applyEffect` → `LiveEffects` | Drawn by `VideoCompositor` on an `OffscreenCanvas`; frames pass through untouched (zero copy) while no effect is visible |
| Cursor-following zoom, auto zoom on click, spotlight | The page overlay posts cursor positions over a `glint-cursor` port to the offscreen host (tab recordings only) | `LiveEffects.onCursor` |
| Region pick | Tab recordings: the page overlay's selector (`region-highlight` / `region-zoom`). Desktop / camera: `RegionPicker` on the recorder tab's live preview | `recording/region-selected` → effect |
| Click effects, cursor halo, live drawing | DOM inside the overlay's closed shadow root | Part of the page, so tab capture (and screen capture) records them |
| Audio monitoring | `RecordingSession.reportLevels` broadcasts `recording/levels` 4× per second (mic, system, muted, silent time) | Control bar meters and warnings; the popup has its own pre-recording meter and playback test |

Custom-area recording of a screen is a desktop recording with `config.selectArea`: the recorder tab
shows the shared screen and `RegionPicker`, and the chosen region becomes the compositor's crop.

## Video editing pipeline

`src/recording/services/export-service.ts` runs mediabunny's `Conversion` entirely on the device:
trim (`trim`), resolution / quality / frame rate, audio removal, frame-accurate cuts
(`forceTranscode`), privacy regions (`video.process` → `redaction.ts`: blur, pixelation or solid mask
for each frame, timed on the original video), and chapters written into the `description` /
`comment` metadata (`chapters.ts`, which also produces WebVTT chapter files). The result page keeps
chapters and privacy regions on the capture record and never modifies the original recording.

Sensitive-text detection (`src/screenshot/services/sensitive-detect.ts`) runs the bundled Tesseract
OCR with word boxes, matches emails, phone / card (Luhn) / IBAN / account numbers, IDs, IP addresses,
keys and "password:" values, and maps each match to the boxes of the words it covers. The user
confirms every item before it is hidden (editor annotations or video privacy regions).

## Flow Capture

| Part | File | Role |
| --- | --- | --- |
| Session manager | `src/background/flow-manager.ts` | State (session storage), captures with the existing engines (`captureVisibleTabRaw`, `captureFullPage`, the area selector, the desktop picker page), undo, pause, finish / cancel, following tabs |
| Step engine | `src/flow/flow-engine.ts` | Pure: descriptions, privacy masking, grouping / dedup / merging, screenshot need, image hashes |
| Page tracker | `src/content/flow-tracker.ts` (in the overlay) | Grouped interaction events; sensitive values never sent |
| Storage | `src/flow/flow-store.ts` | `flows` store (order, captions, steps); images are screenshot captures with `flowId`, originals under `orig:<id>` |
| Toolbar | `flowbar.html` → `src/flow/pages/FlowBarApp.tsx` | Floating window, not part of tab screenshots |
| Flow Editor | `flow.html` → `src/flow/pages/FlowEditorApp.tsx` | Thumbnail rail + the screenshot `Editor` (exported from `EditorApp.tsx`, with per-image history), exports in `src/flow/flow-export.ts` (ZIP: `src/shared/utils/zip.ts`, PDF: `src/shared/utils/pdf.ts`) |

Finished flows are a `flow` capture in Recent captures (deleting it deletes its images). Service
workers cannot use dynamic `import()`, so background code imports everything statically.

## Screenshot pipeline

- **Visible:** `captureVisibleTab` (PNG) → `OffscreenCanvas` (optional CSS-pixel scaling).
- **Full page:** `page-scripts.ts` functions are injected with `scripting.executeScript({ func })`. They measure the page, detect app-style inner scrollers, optionally pre-scroll for lazy content, and hide sticky/fixed elements after the first frame. `planFullPageCapture` → capture each step (rate-limited to Chrome's 2/s) → `stitchFrames` draws each frame at its *actual* scroll offset, so no rows repeat. Output is scaled to stay inside canvas limits. The page is always restored in `finally`.
- **Area:** the overlay returns a CSS-pixel rectangle after removing itself → capture → crop.
- **Desktop:** `chooseDesktopMedia` → one frame from a `<video>` → editor.
- All captures are stored losslessly (PNG) in history. The format and quality apply on export.

## Editor

- **Document:** `EditorDoc` holds `{ base: ImageBitmap, width, height, annotations[] }` and is immutable. History is snapshot-based with structural sharing (`history/history.ts`). Commits can coalesce, so a slider drag is one undo step.
- **Geometry:** crop / rotate / flip / resize create a new base bitmap and map annotations through a `GeometryTransform`, so they stay editable. Earlier bitmaps remain in history, so these operations are fully undoable and the original capture is never modified.
- **Rendering:** a viewport-sized canvas draws the document through a zoom/pan transform (`render.ts`), so a 30 000-pixel-tall page doesn't need full-size canvases. Blur and pixelate regions are cached per base bitmap and region. Export renders once at full resolution.
- **Tools:** per-type behaviour (render, bounds, hit test, move, resize, transform) lives in `tools/`.

## Storage

- `chrome.storage.local`: typed settings (`settings-service.ts`). Normalised on read: unknown keys dropped, ranges clamped, defaults merged. Also the editor's tool styles.
- `chrome.storage.session`: recording state and pending session (survives service-worker restarts, cleared with the browser).
- IndexedDB `glint-capture`: `captures` (metadata), `blobs` (payloads), `chunks` / `sessions` (in-progress recordings). It self-repairs if the database exists without the expected stores.
