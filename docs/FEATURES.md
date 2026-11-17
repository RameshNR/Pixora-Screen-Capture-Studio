# Features & acceptance status

Status: ✅ implemented and covered by automated tests · 🟡 implemented, verified manually or partly
automated (Chrome blocks automating it) · ⚪ intentionally not in this release.

## Screenshots

| Feature | Status | Notes |
| --- | --- | --- |
| Visible part | ✅ | E2E |
| Full page (scroll + stitch, fixed/sticky elements re-detected on every step — including headers that only become fixed after scrolling — lazy-load pre-scroll, inner scrollers, integer-pixel stitching for 125%/150% scaling, scroll restored, progress, size limits) | ✅ | E2E (incl. seam regression test) + unit |
| Selected area (drag, move, resize with 8 handles, live dimensions, Enter / Esc / double-click) | ✅ | E2E |
| Visible part after delay (3/5/10/15 s or custom up to 300 s, badge countdown) | ✅ | E2E |
| Entire screen & app window (optionally without the taskbar / dock) | 🟡 | Chrome's picker can't be automated; work-area logic unit-tested |
| Annotate local & clipboard image (file, drag-drop, paste) | ✅ | E2E (file) |
| Screenshot & extract text (on-device Tesseract, keeps line breaks, editable, copy) | 🟡 | Unit (normalisation); OCR engine verified manually |
| Auto-open editor, auto-save, copy to clipboard, format / quality / scaling, filename patterns | ✅ | Integration + unit |

## Editor

- **Undo / redo / reset** (reset is undoable). The **History** tab lists every labelled step; click one to jump back, and use Redo to go forward again.
- **Layers** tab: every earlier change (annotations, watermark, frame) can be selected and re-edited, hidden, re-ordered or removed without undoing later changes.
- **Image operations:** crop with aspect presets and numeric fields, resize, rotate and flip (one menu).
- **Drawing tools:**
  - Pen, and a highlighter with thickness up to 120 px and opacity from 5%.
  - Rectangles with corner radius; rectangles and ellipses with solid, dashed or dotted borders.
  - **Arrows:** head styles (arrow, big head, open/line arrow, diamond, dot, bar) at either end, double-headed, curved bezier with a drag handle, dashed or dotted lines, and 10 one-click presets. Plus a plain line tool.
  - **Text:** 20 fonts, 15 of them bundled offline (Crafty Girls, Open Sans, Roboto, Montserrat, Limelight, Lobster, Anton, Chewy, Frijole, Spirax, Dancing Script, Changa One, Griffy…), size, bold, italic, alignment, colour, background, and a **border** with width, colour, style and radius.
  - **Callouts:** a speech bubble with a draggable tail, wrapped text, fill, outline and radius.
  - **Stickers:** 24 emoji and 12 coloured badges (NEW, BUG, FIX, TODO…), resizable.
  - Blur, pixelate, numbered markers, image insertion.
  - An **eraser** with its own on-screen cursor.
  - Select, move and resize; nudge with the arrow keys.
- **Watermark:** text, font, size, colour, opacity, rotation, corner/centre/tiled position.
- **Border & frame:** padding with solid or gradient background, corner radius, shadow, border, and a **browser window** (tab with title, new-tab button, minimise/maximise/close, back/forward/reload, address bar showing the page URL; light or dark; on top or bottom).
- **View:** zoom (fit, 100%, steps, Ctrl+wheel), pan (hand tool or Space).
- **Export:** PNG / JPEG / WebP with quality, file name, copy, download, save as. Exports include the frame and watermark.
- OCR and keyboard shortcuts.

✅ E2E + unit tests (history and jump, geometry, curves and heads, callout tails, frame layout).

### Editing earlier changes

With any tool, click an existing annotation to select and edit it. The pen and highlighter still draw over things; a plain click with them selects.
Selected text and callouts can be edited by clicking them again, or by typing in the panel's text box.
Every colour (stroke, fill, text, background, border, watermark, frame, collage) has an opacity slider.
Shift-drag draws straight lines with the pen and highlighter.
Line & arrow is one tool: heads at either end (or none, for a plain line), dashed or dotted styles, and up to **three bend points** (arc, S-curve, wave) that can each be dragged.
The browser frame comes in **Windows** and **macOS** styles.

### Rotate, resize, styles and shortcuts

- **Rotate & resize everything:** rectangles, ellipses, text, callouts, stickers, images and pen / highlighter strokes have corner handles and a rotation handle (Shift snaps to 15°), plus a Rotation slider. `,` / `.` rotate by 15° from the keyboard.
- **Defaults:** pen and lines 14 px; highlighter 35 px at 60 % opacity. There is one opacity control per colour (the separate opacity slider only remains for images, stickers and markers). Opacity 0 keeps the colour and its slider.
- **Lines & arrows:** 28 previewed presets (highlighted when active), designs (line, block, block outline, tapered, double line, chevron trail, dash tail), 15 head styles, and up to **six** curve points.
- **Text:** bold, italic, underline, strike-through, capitals, letter spacing, outline and shadow; a **title (header)** and **footer**, each with its own font, size and colour, optional divider lines; a border toggle with width, colour and style; and the space around the text set for all sides or **each side separately**.
- **Callouts:** 19 designs (bubble, oval, title bar, quote, divided, side bar, brackets, braces, arrow, ribbon, leader, tag, hexagon, circle, number, underline, corners, stripes, banner), pointer as a tail, a leader line (ring, dot, square, diamond, arrow end) or none, a title and body text styled separately, accent colour, line style. The box fits its text, including after a design change.
- **Eraser size:** 4–200 px, shown as a circle at the pointer.
- **Border & frame:** background + padding, border and browser window are separate switches (no padding added when you only want a border). Border styles: solid, dashed, dotted.
- **Zoom:** type any level (e.g. `150`, `75%`, `2x`) or pick a preset.
- **Remembered:** tool styles, last frame and watermark, and export format / quality are kept between sessions.
- **Keyboard:** `?` lists every shortcut. Added: Tab / Shift+Tab to cycle objects, Enter to edit text, `[` / `]` thinner / thicker, Ctrl+D duplicate, Ctrl+C / X / V copy, cut and paste objects (Ctrl+V also pastes clipboard images), Ctrl+] / Ctrl+[ to reorder, Ctrl+Shift+C copies the image.

## Collage

Collage opens **inside the editor page**: from the popup's *Create Collage*, the import screen, or the editor toolbar (which seeds it with the current image). It combines up to 30 images from files, paste, or Recent captures.

- **Layouts:** side by side (horizontal), stacked (vertical), grid, and feature left / right / top / bottom.
- **Cell sizes:** cells are sized so images aren't cropped. Drag the gaps to resize cells.
- **Per image:** fill or fit, zoom (slider or scroll), drag to reposition, reorder, replace, remove.
- **Grid columns:** adjustable.
- **Split lines:** colour, opacity, thickness, solid / dashed / dotted.
- **Canvas:** spacing, padding, corner radius, background with opacity, shape (fit images or a fixed aspect ratio), width up to 4K.
- **Output:** download, or *Edit collage* to keep annotating it.

✅ Unit (layout engine) + E2E.

## Recording

| Feature | Status |
| --- | --- |
| Camera only (device, resolution, preview) | ✅ E2E |
| Microphone (device, volume, level meter, noise suppression, echo cancellation, mute while recording) | ✅ E2E (mic recorded) |
| Pause / resume / stop, timer, remaining time, live resolution, fps, codec | ✅ E2E |
| 1080p and 4K requests: real resolution reported, never upscaled | ✅ E2E |
| This tab (with tab audio, kept audible to you) | 🟡 Needs a real toolbar click (integration-tested) |
| Custom area of this tab (zero-copy crop, frame drawn outside the area, resize-safe) | 🟡 Integration-tested |
| Desktop / window / tab with system audio | 🟡 Picker can't be automated |
| Camera overlay (position, size, circle / rounded / square, toggle while recording) | 🟡 Integration of compositor verified manually |
| Recording controls in the popup (pause / resume, stop, discard, live tools); optional floating control-bar window (off by default since Round 41; configurable position, minimise) | ✅ E2E + integration |
| Countdown, maximum duration, scheduled recording (with Chrome restrictions explained) | 🟡 Timing logic unit-tested; scheduling verified manually |
| Click and keyboard-shortcut highlights | 🟡 |
| Codec / bitrate / format selection with fallbacks and warnings | ✅ Unit |
| Single-session guard | ✅ E2E + integration |
| Crash / close recovery from IndexedDB chunks | ✅ Integration |
| Result page: player (play, seek, volume, speed, fullscreen, keyboard), metadata, rename, delete, download, save as, show in folder | ✅ E2E (partly) |
| Trim (handles, preview range) and export, WebM ↔ MP4 conversion (original kept) | ✅ E2E |
| Remove audio after recording (in place, video copied untouched) or export without audio | ✅ E2E |
| Export at 4K / 2K / 1080p / 720p / 480p / 360p / 240p (never upscaled), quality (original, high, medium, low, smallest) and frame rate | ✅ E2E (240p export) + unit (sizes) |
| Videos without sound: hover badge and tooltip on the player, disabled volume, export dialog says so | ✅ E2E |
| Open a local video file (MP4, WebM, MOV, MKV) to trim, convert, resize or mute (“Edit a Video File” in the popup, “Open video…” on the result page) | ✅ E2E |
| Toolbar badge shows the recording time (0:07, 12:45, 1h05) and the tooltip shows the full time | ✅ unit + integration |
| Record a whole screen without the taskbar / dock | 🟡 Work-area logic unit-tested; picker can't be automated |
| Copy video | ⚪ Browsers don't support it; explained in the UI |

## Live recording tools

| Feature | Status | Verified by |
| --- | --- | --- |
| **Webcam overlay:** circle / rounded / square, size, position (grid or sliders), border width and colour, opacity, mirror, camera device, live shaped preview in the popup; move, resize and restyle from the control bar while recording; composited into the video | ✅ | Unit (bubble geometry) + E2E (camera recordings) |
| **Mouse effects:** click ring / ripple / pulse, separate left / right click colours, radius, opacity, duration; cursor halo with size and colour; drawn in the recorded page | ✅ | Implemented in the page overlay; cursor positions drive zoom / spotlight |
| **Trimming:** filmstrip timeline, draggable start / end handles (arrow keys nudge), exact time fields (±0.1 s, “set to playhead”), selected duration, play / pause / seek, preview selection, export without touching the original, optional frame-accurate cut | ✅ | E2E (trim editor, trimmed export) |
| **Privacy:** editor blur, pixelate and new solid mask (tool M) — select, move, resize, restyle, undo; “Find sensitive info” (on-device OCR) with a confirmation list; video privacy regions (blur / pixelate / mask, strength, whole video or a time range) burned into exports | ✅ | E2E (mask pixels verified in the exported video) + unit (matching, Luhn, timing) |
| **Audio monitoring:** popup level meter, warnings (muted, disconnected, missing device, very low input), record-and-play-back test; control bar meters for microphone and system / tab audio with warnings and “not captured” notice | ✅ | Implemented; levels broadcast from the recording host |
| **Teleprompter:** saved scripts (create, edit, paste, rename, delete), font, size, colour, background opacity, alignment, line spacing, width, speed, mirror; play / pause / restart / speed with Space, ↑ ↓, R, Esc, + −; movable, resizable window; optionally drawn into the recording as a caption | ✅ | E2E (scrolling, pause, speed, restart, saving) |
| **Zoom & spotlight:** manual zoom (1–3×, or zoom to a region), auto zoom on click with level, transition, hold time and easing; cursor-following zoom and spotlight in tab recordings; spotlight radius and dimming; region highlight with dimmed background | ✅ | Unit (easing, view clamping, auto zoom timing) + E2E (effects accepted while recording) |
| **Live screen drawing:** pen, arrow, line, rectangle, circle, text, eraser; colour, thickness, opacity, font size; undo / redo / clear / show-hide; page shortcuts (P A L R O T E, Ctrl+Z, Ctrl+Y, Delete, H, Esc to use the page, Alt+Shift+D); drawing never blocks the page while off | ✅ | E2E (drawn pixels visible, undo) + unit (eraser hit tests) |
| **Markers & chapters:** add while recording (control bar M, Alt+Shift+M in the page, “Add marker” shortcut), rename / describe / delete, saved with the recording; timeline ticks, chapter list with jump, previous / next (Page Up / Down), add (M), move to playhead, export a chapter, WebVTT download, “00:00 Title” list, chapters kept in exported file metadata | ✅ | E2E (markers saved, chapters on the result page) + unit (VTT, ranges) |
| Custom area of a **screen or window** (not only a tab) | 🟡 | Region picker on the live preview; Chrome's picker can't be automated |
| Stale custom-area border after recording | ✅ Fixed | The frame sits further outside the crop and the overlay removes itself when no recording runs (E2E) |

Limits: Chrome can't report the cursor outside the recorded tab, so cursor-following zoom / spotlight
and page drawing work in tab recordings (and on the page you draw on during desktop recordings);
desktop recordings zoom on the centre or a picked region. The teleprompter and control bar windows
are never part of a tab recording; a full-screen desktop capture includes every visible window.

## Flow Capture

| Feature | Status | Verified by |
| --- | --- | --- |
| Session-based capture: floating toolbar window (movable, minimisable) with modes Visible Part, Full Page, Selected Area, Full Screen, Application Window; Capture, Pause / Resume, Undo last capture, Finish, Cancel (with confirmation); timer and counters | ✅ | E2E |
| Session survives popup closing, page loads and new tabs opened from a followed tab (state in session storage, images in IndexedDB); interrupted sessions are kept | ✅ | E2E |
| Optional **Auto steps**: clicks, typing (one step per field, final value), selects, checkboxes, radios, submits, Enter / Esc, debounced scrolling, SPA and full navigations; repeats, tiny scrolls, duplicate navigations and unchanged screens are skipped; auto screenshots on every step or new pages only, with a minimum interval | ✅ | E2E + unit (grouping, dedup, hashing) |
| Privacy: passwords, one-time codes, card / account / ID numbers and secrets are always masked (never leave the page); ordinary values only if allowed | ✅ | E2E (password never stored) + unit |
| Works with recordings (tab, area, desktop; Camera Only only when enabled) — steps carry the video time; the result page links to the flow | ✅ | Implemented |
| Flow Editor: thumbnail rail (select, multi-select, rename / describe, drag or arrow reorder, duplicate, delete), the full screenshot editor per image with its own undo history, originals kept (view / restore), workflow steps list (edit, reorder, delete) | ✅ | E2E |
| Exports: individual files, ZIP (numbered files + metadata.json / metadata.csv), PDF (one image per page; A4 / Letter / Legal / fit image; auto / portrait / landscape; margins; fit page or actual size; captions), HTML (self-contained), JSON (optional embedded images); all / selected / current; edited, original or both; PNG / JPEG / WebP | ✅ | E2E (ZIP, PDF) + unit (ZIP, PDF writers) |
| Following other sites needs the optional “all sites” access, requested when a flow starts; without it Pixora captures the starting site only and says so | ✅ | Implemented |

## Screenshot additions

| Feature | Status | Verified by |
| --- | --- | --- |
| Full page with scrollable panels: panels are detected and numbered on the page; choose which to include and how many screens each (or set “Page only” / “Every panel” in Settings) | ✅ | E2E (40-row panel captured in full, page restored) |
| Save as PDF (page size, margins) and QR code (captured page link or a pasted link) from the editor | ✅ | E2E |
| Find sensitive info: upscaled / contrast-adjusted / inverted OCR input (small and dark-mode text), labelled values (“Account:”, “Username:”, “SSN”…), links with tokens | ✅ | Unit + manual check |
| Editor polish: grouped property sections, auto-growing text box, marker shapes / styles / counting, sticker categories (developer, designer, editor, status), modern callout designs (card, tooltip, sticky note, pill, step, glass), disabled border section until a background is on | ✅ | E2E |
| Collage: editor-style side panel (Properties, Images, History), undo / redo / revert, typed zoom, fit | ✅ | E2E |

## Round 7 changes

| Feature | Status | Verified by |
| --- | --- | --- |
| Flow with no images: Finish becomes **Stop** and just ends the session (nothing saved, no editor); Cancel needs no confirmation when empty | ✅ | E2E |
| Discard a running recording (trash icon in the control bar and the popup): stops and deletes the recording and its linked flow | ✅ | Implemented (uses the existing cancel path) |
| Recent captures: select several (or all) to download or delete; download / delete buttons on every card; flows download as a ZIP | ✅ | E2E |
| Flow Capture starts by itself once Chrome's all-sites prompt is approved (the popup no longer needs a second click); granting access later lifts the "this site only" limit of a running flow | ✅ | Unit (messages) + implemented |
| Popup refresh: Flow Capture feature row, grouped sections, privacy line (removed the disabled cloud option); Flow Capture setup in clear sections with a mode picker | ✅ | E2E (popup) |
| Find sensitive info skips text already hidden by blur / pixelate / mask (image) or by a privacy region active at that time (video) | ✅ | Unit |
| Heart shape for numbered markers; roomier text spacing in callout designs; segmented controls never squeeze labels (Curve points "None") | ✅ | Unit + visual check |
| Flow Editor: hide / show the image panel (remembered), previous / next image buttons; fixed: choosing an image now shows that image (the first image was shown before) | ✅ | E2E |
| Flow Editor: deleted images go to a **Deleted** list (Undo in the toast, Restore, Restore all, delete for good) | ✅ | E2E |
| No duplicate images: a capture identical to an image already in the flow is not added (manual, area, screen / window, auto steps and flows recorded with videos); the toolbar says "Same as image N" | ✅ | E2E + unit |
| Screenshots wait for page animations (dropdowns, menus, popovers growing open) to finish, up to 1 s, so they are never captured squashed or half-open; auto steps also give the page a moment to react to the click | ✅ | E2E (fails without the wait) |
| Flow Capture "Take screenshots on": clicks, dropdowns (opening and choosing), text input, checkboxes, radio buttons, submit, page changes, scrolling, Enter / Esc; steps are still listed for the ones turned off. Opening a dropdown / menu is its own step ("Open the … dropdown") | ✅ | E2E + unit |
| Word (.docx) export, made on the device: Flow export (title, one page per image with heading, details and steps; A4 / Letter / Legal, orientation, margins) and a **Word** button in the screenshot editor | ✅ | E2E + unit (well-formed package) |
| Find sensitive info: second "sparse text" OCR pass reads values inside form boxes; labels above a field ("Password" over the typed value) are matched; ordinary words after "private" / "password." are no longer flagged; the dialog can be dragged by its title bar | ✅ | E2E (real OCR on a sign-in form) + unit |
| Flow Editor: deleting an image also removes its workflow steps; restoring brings both back in place | ✅ | Unit |
| Flow Editor: **Collage** of the ticked images (or all), also from the editor toolbar; the collage is added to the flow as a new image | ✅ | E2E |
| Automatic flow screenshots wait for the page to be ready after a click: no visible loader (spinner, progress bar, skeleton, aria-busy), page loaded, network quiet (up to 8 s; permanent loaders are learned and ignored) | ✅ | E2E (fails without the wait) |
| Video editor **Frames** tab: copy, download, save to Recent captures or edit the current frame (privacy regions applied); build a flow from frames picked by hand (captions, order, identical frames skipped) | ✅ | E2E |
| Record tab: Flow Capture card uses the same design as on the Screenshot tab | ✅ | Implemented |
| Fixed: offscreen document error "Cannot read properties of undefined (reading 'local')" | ✅ | Implemented |

## Settings & history

General, Screenshot, Recording, Storage (usage, retention, temp clean-up, delete all), Keyboard
shortcuts (via Chrome's shortcut manager), Advanced (hardware acceleration for export, codec preference,
experimental AV1, debug logging, reset, clear cache). Persisted in `chrome.storage.local` (✅ E2E).
Recent captures: thumbnails, filter, sort, open, rename, download, copy, show in folder, delete, context
menu, empty state (✅ unit + E2E).

## Round 11: Pixora branding, arrows and markers

| Feature | Where | Notes |
|---|---|---|
| New name and logo | Everywhere | Pixora – Screen Capture Studio. New toolbar icons (16/32/48/128, transparent), brand bar in the popup, banner on the welcome page. Internal storage keys are unchanged, so existing captures and settings carry over |
| Click-to-click arrows | Editor → Line & arrow | Click point A, then click point B (a rubber band follows the pointer). Shift keeps 45°; Esc cancels. Dragging still works |
| New arrow designs | Editor → Line & arrow → Style | Heads: Stealth, Triple ›››, Bowed », Echo, Framed. Designs: Notched block, Triple line, Dot / Square / Bar trails, Loop. Presets for each, plus Swoosh |
| Marker counting for all | Editor → Numbered marker | Changing 1 2 3 / A B C / a b c / i ii iii changes every marker in the image (one undo step); layers show "Marker A" etc. |
| Centred marker labels, proper heart | Editor → Numbered marker | Labels are centred on their ink (not the font box) in every shape; the heart is a classic two-lobe shape |

## Round 12: editor selection, stickers, recordings

| Feature | Where | Notes |
|---|---|---|
| Floating selection bar | Editor, any selected object | White pill above the object: Duplicate, Delete and a “…” menu (Copy, Paste, Duplicate, Delete, Layer ▸ forward / to front / backward / to back, Align to image ▸ left / centre / right / top / middle / bottom). Text and callouts also get size −/+, Bold and Italic |
| New selection look | Editor | Solid violet outline with white corner dots, side pills and a round rotate button; the inline text box has a solid violet frame |
| Curve points stay straight | Editor → Line & arrow → Curve points | Points are placed on the line and bend it only when dragged. The Curved / S-curve / Wave presets still start bent |
| Your own text stickers | Editor → Sticker → Your text sticker | Type any words (up to 40 characters); selecting a text sticker lets you change its words |
| Apply marker shape to all | Editor → Numbered marker | “Apply this look to all markers” gives every marker the selected shape, style and size (one undo step) |
| Desktop + Flow Capture by default | Popup → Record | New default recording source is Desktop and Flow Capture with recordings is on (existing settings are moved over once) |
| Flow steps in the Frames tab | Video page → Frames | “Flow steps” opens the Frames tab listing the recording’s step images with their video times (click to jump); “Add to my frames” copies them into the frame list; “Open in Flow Editor” |
| Frames without black bars | Video page → Frames | Copy / Download / Save / Edit / Add frame cut off black letterbox bands around the picture |
| Smooth image switching | Flow Editor | The current image stays until the next is ready, neighbours are decoded in advance and the editor fits before the first paint, so switching no longer flashes a spinner |

## Round 13: handles with every tool, flows across pages, capture on hover

| Feature | Where | Notes |
|---|---|---|
| Resize and rotate with any tool | Editor | With the highlighter, pen or any drawing tool active, click an object to select it, then use its handles to resize / rotate or drag it to move; no need to switch to Select first |
| Marker size applied to all | Editor → Numbered marker | “Apply this look to all markers” now also gives every marker the same size |
| Collage side panel fits | Collage | The panel fills its column (it was 40px wider and clipped) and the toolbar wraps on narrow windows |
| Frames tab label | Video page | Tabs no longer wrap; the Frames tab shows the number of flow steps, e.g. “Frames (5)” |
| Flow steps button | Video page | Disabled (with a hint) when the recording has no flow steps; shows the count otherwise |
| Flow Capture on every page | Window / Desktop recordings | The flow follows every web page you switch to or open, not only the starting tab. Starting a recording with Flow Capture asks once for all-sites access (declining keeps it to the first page). Step pictures are always automatic during recordings |
| Step picture timing | Popup → Record (“Step pictures”), Flow Capture setup (“Click pictures”), Settings → Flow Capture | “After click” (default): once the page reacted. “On click”: at the moment the mouse button is pressed, or Enter / Space on a focused button or link. “On hover”: while the pointer rests on the button (300 ms), before the click. Works for image flows and recordings |

## Round 14: one step list, cleaner flows, markers, frames, collage keys

| Feature | Where | Notes |
|---|---|---|
| One step list for recordings | Video page → Frames | Recordings with flow steps show one “Flow steps” list. “Add this frame” puts the frame into that flow at its video time, between the recorded steps; captions are editable and images can be removed (restorable in the Flow Editor). “Add to my frames” is gone |
| Flow steps button | Video page header | Opens the Frames tab and scrolls to the step list (highlighted briefly) |
| Side panel fits | Video page | The side panel no longer grows past its column |
| No stray step pictures | Flow Capture, recordings | A step gets a picture only when its tab is the one on screen (also re-checked after waiting for the page), so background tabs no longer add other screens |
| Markers | Editor → Numbered marker | Default size 50 px. “Custom colours” (off by default) adds background and text colours. “Apply this look to all markers” copies shape, style, size and colours |
| Rotation control | Editor → selected object | Dial (drag; Shift snaps to 15°, arrow keys step), exact angle field, ±15° / ±90° buttons and Reset |
| One logo in the Flow Editor | Flow Editor | The embedded editor no longer shows a second logo |
| Add to every screenshot | Popup → Screenshot, Settings → Screenshots | Browser window, Background and Border can be added automatically to every new screenshot (visible part, full page, area, screen and window). All off by default; uses your last frame choices |
| Collage keyboard | Collage | Delete / Backspace removes the selected image from the collage (the capture is kept), Esc deselects, ← / → move the selection; exports and the preview while exporting show no selection outline or resize handles |

## Round 15: Flow Editor frames, zoom, drag, video scrubbing

| Feature | Where | Notes |
|---|---|---|
| Capture delay 0–4 s | Popup → Visible Part after Delay, Settings | New choices: no delay, 1, 2 and 4 seconds (plus 3, 5, 10, 15 and custom 0–300) |
| Step list layout | Video page → Frames | Caption fits the card, delete button sits next to the time, thumbnails fill their tile |
| Scrub pauses playback | Video player | Dragging the progress bar pauses a playing video and resumes it on release |
| Flow kept in sync | Flow Editor, video page | Both pages reload the flow when the other changes it, so an image deleted in one is never brought back by a save in the other |
| Drag to reorder | Flow Editor → Images | The dragged card fades and a violet line shows where it will land (before / after the card under the pointer) |
| Apply / Apply to all | Flow Editor → Border & frame | “Apply” saves the frame on this image; “Apply to all (n)” gives every image of the flow the same background, border and browser window (or removes them). Images never edited by hand are framed from their original, so applying again never doubles a frame; images with their own edits get the frame on top; undo works per image |
| Original screenshot viewer | Flow Editor → View original | Larger window, zoom − / + / Fit / 100 %, wheel zoom at the pointer, double-click to zoom, drag to move around, keys + − 0 1 |
| Marker colours | Editor → Numbered marker → Custom colours | Border, background and text colour (off by default); “Apply this look to all markers” copies them |

## Round 16: quality, cleaner settings, compare, cursors

| Feature | Where | Notes |
|---|---|---|
| High quality by default | Recording | New recordings are MP4 (WebM if Chrome can't record MP4) at the screen's own resolution, with a higher automatic bitrate (≈ 12 Mbps at 1080p30, ≈ 50 Mbps at 4K30). Saved settings still on WebM / 1080p move over once. Screenshots, flow pictures and video frames stay lossless PNG at full device resolution |
| Quality only when it matters | Settings → Screenshot, editor export, flow export | The quality slider shows only for JPEG and WebP (PNG is lossless) |
| One setting per row | Settings → Recording / Screenshot | Noise suppression and echo cancellation are separate rows; the three “Add … to every screenshot” switches each have their own row and description. The popup no longer shows these options |
| Compare original and edited | Flow Editor → View original | For edited images: Original / Edited / Side by side / Slider (slider when both are the same size), with zoom and drag; images are decoded before they are shown and the view never toggles scrollbars, so no flicker |
| Restore originals | Flow Editor → Images | “Restore originals (n)” brings back the original screenshots of the ticked images, or of every edited image when none is ticked (asks first) |
| Resize cursors | Editor | Each handle shows its own direction (↔ sides, ↕ top / bottom, ⤡ ⤢ corners, turned with the object's rotation); the selected object shows the four-way move cursor with any tool |
| Step list badge | Video page → Frames | “Added” sits on the thumbnail, so the time chip stays on one line |
| 0 s between auto screenshots | Flow Capture setup, Settings | Every step can get a picture (Chrome's limit of about two pictures per second is still respected) |

## Round 17: Flow Editor header, right-click menus, sliders

| Feature | Where | Notes |
|---|---|---|
| Sliders follow the pointer | Settings (and every slider) | The dragged value shows at once while it is saved; settings rows show only the value next to the slider (the row already has the name) |
| Flow Editor header | Flow Editor → image bar | Original · Restore ▾ (Restore this image / Restore all) · Copy · Download. The embedded editor has no second Copy / Download, no Export panel on the right (Export… is at the top) and no second logo. “Collage” is now “Collage Flows”. The editor's “Done” button is now “Download” |
| Delete key | Flow Editor → Images | Delete / Backspace removes the ticked images (or the focused card's image) after asking |
| Pixora right-click menus | Editor, Flow Editor, collage, video page | Chrome's menu is replaced by Pixora's own: objects on the canvas (Edit text, Copy, Paste, Duplicate, layer order, Centre, Delete), the image / editor (Paste, Undo, Redo, Copy image, Download, Fit, Shortcuts), flow image cards (Open, Tick, Move, Duplicate, Compare / View original, Restore, Delete), collage images (Replace, Move, Remove) and the collage, the video page (Play, ±5 s, Frames / Flow steps, Chapters, Privacy, Open video, Recent) and flow steps (Go to, Open in Flow Editor, Remove). A right click on a button with a dropdown opens that dropdown; text fields keep Chrome's menu |
| Video page scrolling | Video page | The side panel scrolls on its own, so long frame lists no longer leave an empty area beside them |

## Round 18: live Restore, focused right-click menus

| Feature | Where | Notes |
|---|---|---|
| Restore reacts at once | Flow Editor → Restore ▾ | Enabled as soon as the open image is edited (no need to switch images); Restore / Restore all also discard unsaved edits |
| Menus only where they belong | Editor, Flow Editor, collage, video page | Pixora's menu appears on the canvas and its objects, flow image cards, collage images, the video player and flow steps; elsewhere a right click shows nothing |
| Right click opens dropdowns | Any button with a dropdown, split buttons like Restore ▾ | A right click on any part of the button opens its dropdown |
| Menus close on any click | Everywhere | A click anywhere (including the canvas), a scroll or leaving the window closes the menu |

## Not in this release

Sign in, feedback, subscriptions, cloud storage (no cloud option is shown — Pixora is local-only),
webcam repositioning after recording, background replacement and multiple audio tracks. The editor
and export services are modular so these can be added later. (Video annotations and text overlays
arrived in Rounds 38–40.)

## Round 19 — Full quality everywhere (up to 8K)

- **Collage export is sharp.** The collage is laid out once and exported by scaling that layout up, so each picture is resampled only once, from its full-resolution source. The new **Export size** default, *Original detail*, picks the size at which no picture is shrunk at all. Fixed sizes: Full HD, QHD, 4K UHD (3840) and 8K UHD (7680). Output is always lossless PNG; it is limited only by Chrome's largest canvas (16384 px a side), and the panel says so when that happens.
- **Video up to 8K.** New *8K UHD* recording preset. *Original* now allows 7680 px on both sides, so portrait 8K screens are not scaled down. The automatic bitrate keeps ~0.2 bits per pixel up to 250 Mbps (≈ 200 Mbps at 8K30; it was capped at 80 Mbps). A manual bitrate can be set up to 250 Mbps.
- **Video export keeps quality.** *8K (4320p)* was added to the export resolutions. With quality *Original*, the video is still copied untouched when possible; when it must be re-encoded (resize, frame rate, exact cuts, privacy blur, format change), it is encoded at the high recording bitrate instead of the encoder's default.
- **Images at 100%.** Screenshots are always lossless PNG at the screen's full pixel density. The JPEG/WebP quality default is now 100% (settings v4 moves the old 92% default to 100%; a value you chose yourself is kept). Flow export, PDF and Word pages also use 100%. Desktop / window screenshots take the full source with no 8K cap.

## Round 20 — Live Restore all, per-page browser frames, "Don't ask me again"

- **Restore all is in sync.** It now restores the image open in the editor too. Before, the editor sent its old edit history again whenever the page re-rendered, so the edits came back. The editor now reports history only when it changes, and remounts from the restored picture. Restore all no longer saves the open edits first (that raced the restore).
- **The image list is live.** Thumbnails follow unsaved edits within a moment (a small preview rendered from the editor), and the *edited* tag appears as soon as an image changes. Restore / Restore all switch back to the stored thumbnails at once.
- **Apply to all with a browser window:** every image gets a browser frame showing its own page address and tab title (falling back to the image description), not those of the image the frame was designed on (`src/flow/own-frame.ts`).
- **Delete question:** a "Don't ask me again" checkbox. Once ticked, images are deleted straight away (they can still be restored from the Deleted list). Settings → Flow Capture → *Ask before deleting images* turns the question back on (`flow.confirmDelete`).

## Round 21 — Cursor & click effects in the Screenshot Editor

New **Cursor** tool (toolbar, shortcut **U**; `src/editor/tools/cursor.ts`). Click on the image where the cursor should point; each cursor is its own object (move, resize from a corner, delete, undo / redo, Layers).

- **8 designs:** classic arrow, modern arrow, pointer, hand (link), text I-beam, crosshair, presenter dot, touch point. Each starts with its own colours.
- **Size** 16–240 px; **cursor colour** and **outline colour** (any colour, with transparency); **opacity**.
- **Click indicator:** none, left, right or double click — a small mouse with the pressed button coloured, plus click marks at the tip. The click colour is adjustable.
- **Effects** around the click point: click ring, ripple, glow, halo, burst, spotlight (dims the rest of the image). Effect colour and size are adjustable.
- The x / y of a cursor is its hot spot, so resizing and image crops keep it pointing at the same place. Works on Flow Capture images too (same editor).
- Not included here: animated cursor movement, auto-zoom and live click effects in video recordings, and the AI features (screenshot understanding, AI documentation). Those need a separate design; the AI ones would also need an AI service, which conflicts with the "no cloud / captures stay local" rule.

## Round 22 — Premium design library, device mockups, video cursor

**Delete key fix (Flow Editor).** With a design selected on the image, Delete removes that design, even if image tick boxes are still focused or ticked. Images are deleted only when no design is selected (Esc deselects).

**Shapes** (Rectangle / Ellipse tool → *Shape* picker, `src/editor/tools/shape-lib.ts`). 16 categories, 110+ ready-made shapes, each with its own colours: Basic, Filled, Outlined, Rounded & soft (pill, cloud, clover, wavy), Callout & speech (speech box, oval, rounded, thought, slanted, cloud speech), Highlight (brush strokes, soft regions, dashed focus box, glow pill, input highlight, focus corners), Badge & label (pentagon badge, bookmark, ribbon banners, seal, scallop, star badge, shield), Step & number (step tags, number box / circle), Geometric (trapezoid, parallelogram, hexagon, octagon, cylinder, crystal, cone), Frames (dashed, scalloped, wavy, ticket, chamfered), Flowchart (start/end, process, decision, data, database, document, documents, display), Decorative (starburst, sparkle, flower, seals, stamp, cloud), Icons (check, cross, plus, minus, warning, info, stop, star), Corners (notched, chamfered, folded, cut, leaf), Ribbons (banner, curved banner, wavy flag, flag), 3D & layered (3D square / circle / hexagon, layers, glass card). *Finish*: flat, soft shadow, glow, gradient, 3D or glass. Stroke, fill, line style and thickness stay editable.

**Callouts** (Callout tool → category tabs, `callout-recipes.ts`, `callout-presets.ts`). 40+ new designs built from parts (body shape, gradient / brush fill, sketch / double / open line, offset layer, quote marks, number badges, folds, ribbons, scribble background, rule lines), in 100+ colourways:
- *Premium*: rounded rectangle, pill label, speech bubble, cloud bubble, quote callout, highlight label, note with folded corner, sketch callout, ribbon label, arrow label.
- *Steps*: seal-badge steps (purple / blue / green), circle step, step banner with dark seal, step boxes with pointer (outline / filled / lime), peel-corner cards, title band, circle with arc, number chips.
- *Quotes*: quote bubble, highlighter quote, soft bubble, quote frame, bubble with quote badge, offset card, circle / orange circle, heart, flower, open frame (solid / dashed), curved open frame, open circle, lines quote, double frame, ruled box, sketch quote (black / blue), scribble square / circle / hexagon / leaf, dark offset frame, hexagon, slanted.
- *Speech & shapes*, *Labels & tags* (slanted, arrow tags, note with tail, leader labels, tooltip, offset label, ribbons in 4 colours), *Badges* (Tip, Info, Note, Warning, Error, Important, Action, Shortcut, Step, Pro Tip, Success, New … with vector icons), *Frames* (title, dashed, folded, side accent, glass), and the earlier designs under *Classic*.
- Premium designs also have *Body shape* (24 shapes), *Badge text* and *Icon* controls. Text is centred in round shapes, and round shapes keep their proportions.

**Markers.** New *Premium* style (glossy gradient, soft shadow, shine) and a *seal* (scalloped) shape.

**Arrows & connectors.** 18 ready-made coloured styles (purple / orange block arrows, curves, dashed, hook, red swoosh, loop, dot / ring / curved connectors, elbow connector and elbow arrow, yellow outlined block arrow, double chevron, blue dotted, navy curves). New *Route: Elbow* (right-angle connector with a rounded corner) and an outline colour for block arrows.

**Cursor tool.** *Quick looks* (plain, soft halo, purple / red rings, hand with yellow / red rays, purple / red target, pink click, blue rings) and two new effects: *Target* and *Click rays*.

**Mockups** (Border & frame). *Device mockup*: laptop, desktop monitor (chin, neck, foot), tablet, mobile (island); finishes space grey, silver, black, white, gold; camera, glass reflection, shadow. Browser windows: Chrome, Chrome mac, Edge, Safari. More gradients plus your own *background image* (stored at up to 2560 px). *Shadow strength*, *Perspective* (tilt left / right, lean back, float; editing, selection and export follow the tilt), *Position* left/right and up/down inside the background. Exports stay PNG / JPG / WebP at full resolution.

**Video cursor effects** (popup → Recording settings → Overlays). *Styled cursor* drawn into the recorded page (8 designs, size, colour, outline) with *Smooth movement* (eased motion interpolation) and *Hide the real cursor*. Click effects gain *Burst*, *Target* and *Glow* (left / right colours, radius, opacity, duration as before). Auto-zoom on click (level, transition, hold, easing) and the cursor spotlight were already available. These page effects apply to the recorded tab; Chrome gives extensions no mouse position outside web pages, so desktop recordings use the real cursor.

## Round 23 — Pointer fixes, one Shapes tool, and the full design sheets

**Fixes**
- **Callout pointers touch the shape.** Speech tails and leader lines now start on the design's real outline (pill ends, parallelogram and slanted sides, clouds, hearts, hexagons, ellipses), not on its bounding box, so there is no gap and no floating tail. Tails overlap the body slightly so the fill joins without a seam (`calloutOutline`, `outlineEdge` in `callouts.ts`).
- **Leader lines always show.** Designs without an outline draw the leader in the accent colour (else the fill colour) instead of an invisible one.
- **Scrolling a long dropdown scrolls it.** The wheel inside an open list (fonts, effects…) scrolls the list; scrolling anywhere else still closes it.
- **One Shapes button.** Rectangle and circle were the same tool; there is now one *Shapes* button (R, or O to start with the ellipse). The shape picker opens on *Outlined* shapes, the default, and has one rectangle and one ellipse (drag a square / circle, or hold Shift).

**Highlighter** (`pen-styles.ts`) — 12 categories, 74 designs: marker / brush, rectangle, underline (double line, wavy), hand-drawn scribble, wavy band, circle & focus (single, double, dashed), text box with border, corner / tape, spotlight glow, annotation with arrow, creative (brush, hatched box, clouds, sketch box) and gradient. Second colour for borders and arrows.

**Pen** — 8 categories, 51 designs: standard, brush (calligraphy), dotted / dashed / dash-dot, sketch and hatched (with sketch arrow), creative (glossy tube, beads, hearts, stars, zig-zag arrow, loops), pressure taper, textured chalk and spray, special effects (neon, outlined, hollow). *Plain pen / highlighter* returns to the classic look.

**Text — Text Settings** with *Basic / Design / Advanced* tabs and *Edit style for Title / Body / Footer*:
- Basic: text content, typography (font, size, bold, italic, underline, strike-through, capitals, alignment, colour), *Quick presets* (Default, Highlight, Success, Warning) and *See all* — 70 text designs: title styles, banners (NEW, UPDATE, FEATURE, TIP, IMPORTANT, NOTE), badges & labels (Beta, New, 👑 Pro, Free, 🔥 Hot, 🔄 Update, ✨ AI, v2.0), outline & stroke, background highlight, shadow & 3D, handwritten, callout text, numbered steps, decorative (WOW!, SALE, NEW!, COMING SOON, Let's Go!, Congrats!), gradient & modern, combinations (title + subtitle, key point, pro tip).
- Design: background None / Solid / Gradient / Design (18 designs: brush, swash under, banner, ribbon, burst, underline swash, hand ring, tape, outline box, side bar, gradient / dark / outline pill, speech, cloud, chevron, dashed box, megaphone) with two colours; section backgrounds; border (width, colour, style); corner radius and padding per side.
- Advanced: letter spacing, text outline (width, colour, solid / dashed / dotted), shadow (blur, opacity, colour, offset), gradient letters, 3D depth and side colour; title and footer; divider lines.
- *Reset* and *Apply to all text* (every text on the image takes this style, words stay).

**Blur** — 10 categories, 36 designs: light / medium / heavy, area shapes, custom shapes (cloud, star, heart, hexagon), motion (horizontal, vertical, diagonal, radial), gradient fades, focus (blur everything else: circle, rectangle, custom), frosted glass, advanced (tilt-shift, depth, zoom, bokeh), redaction & privacy, creative (spin, lens, noise, B&W). Every setting is also adjustable on its own: shape, style, corner radius, fade, colour treatment, focus, glass, border.

**Pixelate** — 9 categories, 41 designs: block size, shapes, patterns (square, rectangular, mixed, mosaic tiles), border styles (white, coloured, dashed, glow), directional (↔ ↕ ⤡, radial), advanced (heavy, soft, gradient, edge), pixelate + blur / dim / B&W / tint, colour variations (classic, grayscale, brand tint, monochrome), selection styles and *pixelate others*.

**Solid masks** — 11 categories, 44 designs: black / white / gray / custom, red / blue / green / yellow, shape masks, geometric (square, triangle, hexagon, polygon), custom shapes (cloud, star, heart, badge), text & content (text lines, block, multi-block, password dots), borders, corners (0 / 8 / 16 px, pill), stylized (slanted, parallelogram, trapezoid, wave), multi-element (multiple blocks, mixed, rows, grid), use cases (face, card info, ID, address). *Place mask*: full area, top (header), bottom (footer), middle band.

**Numbered markers** — 28 shapes (adds speech, square speech, cloud, pin with rings, square pin, chevron, triangle, parallelogram, progress ring, brush splash, blob, sticky note with clip, folded card, layered square, rosette with ribbons, ribbon, curved ribbon), 6 styles (adds *Dashed* and *Layered*), *Step 1* counting, and a *label beside the number* ("Step One", "Note", "Tip") as a pill, slanted or tag.

**Stickers** — the full sticker sheet with a white die-cut edge and soft shadow (on by default, can be turned off): emojis & reactions, badges & labels (NEW burst, 🔥 HOT, 👑 PRO, BETA, UPDATE, 💡 TIP, NOTE, IMPORTANT, Beta, New, Free, Hot, Update, AI, v2.0 — pill, burst, tilted, soft and outline badge styles with an optional emoji), check & status (check, cross, warning, info, question, check boxes, toggles), arrows & pointers, shapes & highlights, callouts & speech (Step 1 / 2 / 3, quote box), symbols, people, devices & UI (browser and code windows), objects, decorative, seasonal — plus the earlier developer / designer / editor / status sets. Icons and badges can be recoloured.

**Cursors** — 48 designs in 8 groups: classic & system (default, filled, outlined, hand, text, crosshair…), themed (gradient, neon, pastel, gaming, pixel, paper plane), shape (heart, star, pencil, eraser, magnifier, target), recording & tutorial (recording, pause, play, focus ring), hand & gesture (grab, pan, drag, move, not allowed), resize (↔ ↕ ↗ ↖ corner, all), UI & action (add, remove, rotate, refresh, link, colour picker), custom & creative (pizza, rocket, sword, dart, leaf, lightning). New effects *Pulse* and *Emphasis*; *Motion* draws the animated looks as a still (trail, dotted trail, ghost, bounce, wavy, loading, signal). 30 quick looks (highlight glows, click colours, ripple, pulse, trails, tutorial, presentation, spotlight, emphasis).

**Watermarks** — 28 designs in 10 groups: text (pill, Confidential stamp, signature), logo (logo + name, glass, pill), diagonal, tiled pattern, opacity (80 / 40 / 15 %), large background, stamps (round red / blue / green, dashed box), corner ribbons (Confidential, Draft, Approved, For Review), corner marks, custom (brush, tape, dashed box). Plus *Style*, *second line*, *accent colour*, *opacity* and your own *logo* (kept on this computer, max 512 px, included in exports).

Not included: *Auto subject*, *Blur face* detection and *Freehand* selection from the blur sheet need object / face detection or a lasso tool; *Blur face* here is a soft oval you place yourself. Timelines that connect several markers with a line are made with the line tool.

## Round 24 — One panel design everywhere, sticker grid, flow options for recordings

**Every tool panel uses the Text Settings design**: segmented tabs at the top and cards with an icon and a title, with *Reset* (back to the tool's default look) at the bottom. The open tab is remembered per tool.
- Pen / Highlighter: *Design* · *Style* (colour, second colour, thickness).
- Line & arrow: *Styles* (styles, ready-made arrows) · *Customize* (colour & thickness, route, design, line style, curve points, arrow heads).
- Shapes: *Shapes* (library) · *Style* (colours, finish, border, corners).
- Callout: *Design* · *Text* (content, typography, title) · *Advanced* (pointer, colours & lines).
- Sticker: *Stickers* (library, your own words) · *Style* (badge style and icon, colour, edge, size).
- Blur / Pixelate / Mask: *Designs* (and mask placement) · *Adjust* (strength, shape, style, fade, colour, focus, glass, border).
- Numbered marker: *Design* (shape, style, counting, label) · *Colours & size*, with *Apply to all markers*.
- Cursor: *Design* (quick looks, designs, motion) · *Click & effects*.
- Watermark: *Designs* · *Text & logo* · *Style* (look, colours, opacity, position, size, rotation).
- Border & frame: *Background* (background & padding, border, corners) · *Window* (browser) · *Device* (mockup).
- Selected objects get a *Rotation & opacity* card.

**Sticker grid.** Each sticker is drawn off-screen, its real edges are measured, and it is centred and scaled to fit its cell, so nothing crosses the cell border (icons with rays or effects included). Text badges take two cells so their words stay readable.

**Flow Capture options for video recordings.** Turning on Flow Capture under *Record* now shows *Flow Capture options* with the same settings as a screenshot flow (one shared set of settings): automatic screenshots, *Take screenshots on* (clicks, dropdowns, text input, checkboxes, radio buttons, submit, page changes, scrolling, Enter / Esc), every step or new pages only, click picture timing, scroll steps and minimum scroll, minimum time between screenshots.

**No-delay capture timing.** New *Wait before picture* setting (flow setup, recording options and Settings → Flow Capture): *Automatic* (as before: waits until the page reacted and finished loading), *No delay* (pictures at once), or 0.1–3 s. *Minimum time between screenshots* goes down to *No delay (every step)* in 50 ms steps. Chrome itself allows about two tab pictures per second.

## Round 25 — Sharper video captures, popup flow options screen, collage panel

**Capture sharpness.** Checked every capture path with a 1-pixel test grid. Visible area, full page, Flow Capture pictures and editor exports keep every pixel 1:1.
- *Tab and area video recordings* only gave Chrome an upper size limit (up to 7680 × 7680). Chrome then chose its own frame size and scaled the page into it, adding black bars. Saved frames trim the bars, but the picture inside was already resampled, which softens text. Recordings now measure the tab's real pixel size and ask Chrome for exactly that size (or the chosen preset, keeping the shape), so the page is captured pixel for pixel.
- *Area recordings* with an odd width were shown one pixel wider than the cropped pixels (a slight stretch); the crop is now shown at its exact size.
- *Full-page screenshots* at fractional display scales (125 %, 150 %) drew each strip into a slot that could be a pixel taller or shorter than the strip (a slight stretch); strips are now copied 1:1 at full resolution.

**Popup → Record → Flow Capture options** is now its own screen (back arrow, intro, "Auto steps" and "Form values" cards, Done), with the same cards and layout as the Screenshot tab's Flow Capture setup; the Record tab shows a single "Flow Capture options ›" row with its state.

**Collage panel** uses the editor's panel design: an always-visible output size line, *Layout · Canvas · Image* tabs, and icon cards (Layout, Split lines, Shape & export size, Spacing & corners, Background, Image N). Selecting an image opens its Image tab. Images and History are cards too.

**Fix:** collage *Revert to original* returned to the empty start (no images); it now returns to the collage as first made with its images.

## Round 26 — Flow Capture button on Record, new defaults, countdown fix

- **Record tab:** Flow Capture is a button like on the Screenshot tab ("On · step screenshots while you record" / "Off …"). Clicking it opens its screen: the *Flow Capture with recordings* switch (Camera Only: *during Camera Only*), then the same *Auto steps* and *Form values* cards as the screenshot Flow Capture, and Done.
- **Defaults (settings v5, existing settings moved once):** Flow Capture with recordings **on**, Auto steps (a screenshot of each step) **on**, minimum time between screenshots **0 (no delay)** (an old 0.6 s default becomes 0; a value you chose is kept), click pictures **On click** (an old *After click* becomes *On click*). With *On click* the picture is taken at the moment you press, before the page reacts; choose *After click* to picture opened dropdowns and loaded pages.
- **Countdown fix:** the recording countdown (recorder window and popup) briefly showed a too-high number at the start, because its clock still held the time from when the page opened; it now uses the current time immediately.

## Round 27 — Recording when Pixora's storage cannot be opened

Chrome sometimes cannot open an extension's IndexedDB ("Internal error opening backing store for indexedDB.open"): its files are locked by another Chrome process or damaged after a crash. Recordings used to fail at once with "Something went wrong".
- Opening the database now retries a few times (a lock is often short-lived).
- If it still cannot be opened, the recording continues: its data is kept in memory and, when you stop, the video is saved straight to your **Downloads** folder (the recorder page shows "Recording saved to Downloads"). Tab and area recordings ask the service worker to save the file (only blob URLs made by Pixora and a plain file name are accepted).
- The error is named clearly ("Pixora's storage could not be opened", with what to do), and the recorder's error page shows **Technical details** with **Copy details**.

## Round 28 — Repair storage, saving without storage, save to any folder

**Storage problems ("Internal error opening backing store")**
- Errors that are really "storage could not be opened" are no longer shown as "Export failed": they are recognised even when wrapped, so recordings fall back to **Downloads** as intended (round 27), and screenshots are saved to Downloads too (with a notification) instead of being lost.
- The editor's **Download** and **Copy** no longer fail when only updating Recent captures fails: the file is saved / copied, and a note says Recent captures could not be updated.
- **Settings › Advanced › Repair storage** rebuilds Pixora's storage (deleted and created again, empty) after a confirmation. It shows "Repair storage now" when Chrome cannot open the storage. The recorder error page links to it.

**Save location (Settings › Storage)**
- *Downloads folder* (as before) or *A folder I choose*: pick any folder on this computer, including outside Chrome's downloads folder. Files from the editor, video page, Flow Editor and collage are written straight into it (optional sub-folder; never overwrites, adds " (1)", " (2)"…). The folder is shown with *Change…*; after a Chrome restart Chrome asks once for access (*Allow access*, or on the next save).
- If access is not given or writing fails, the file goes to Downloads instead, so nothing is lost. "Ask where to save" still opens Chrome's Save-as dialog. Saves made in the background with no page open (auto-save after capture, emergency recording saves) use Downloads, because Chrome only lets pages write to a chosen folder.

## Round 29 — Verified behaviour with locked storage; popup recording card on top

- Reproduced the user's error exactly by locking Pixora's IndexedDB files (as a stuck Chrome process does): "Internal error opening backing store for indexedDB.open". New test `tests/e2e/storage-locked.spec.ts` (Windows) runs a visible screenshot, a full-page screenshot and a recording in that state: both PNGs and the MP4 are saved to Downloads and complete, and no "Export failed" / "Something went wrong" appears.
- A recording kept in Downloads is reported as finished (notification "Recording saved to Downloads"), not as a failed recording in the popup.
- After storage fails to open, further attempts in the next 30 s try once without waiting, so stopping a recording takes about 4 s instead of hanging on repeated retries.
- Repair storage cannot fix *locked* files (Chrome cannot delete them either); it reports this and asks to close all Chrome windows and reopen Chrome, which releases the lock.
- Popup › Record: while recording, the live recording card (time, size, Pause / Stop) is shown at the top, above Desktop / Camera Only.

## Round 30 — Export popup, missed flow frames, pages with several scroll areas

- **Export popup (screenshot editor):** the Export section no longer sits at the bottom of the side panel. The toolbar has an **Export…** button after **Download**; it opens a popup with the file name, format (PNG / JPEG / WebP), quality, Copy, Save as…, PDF…, Word, QR code… and Download. Download, Save as, PDF and QR close the popup first. The Flow Editor (embedded editor) is unchanged.
- **Flow Capture while recording – missed frames:** every click now gets its own early "press" picture (the old rule skipped a click within 450 ms of the previous picture, so quick click → submit → page change sequences lost frames). The rough "looks the same" check that drops a repeated picture now applies only to scroll steps; clicks, submits and page changes always keep their picture.
- **Full page with several scroll areas:**
  - Areas below the visible part of the page are found too (the travel portal now lists Content 1, 2 and 3), and each is named after its section title.
  - The numbered blue outlines scroll with the page (they are no longer pinned to the screen), and checking an area scrolls it into view.
  - The outlines are removed before the capture starts, so they never appear in the image.
  - Each strip fills its slot exactly, so no white or dark line shows where two frames join; **Select all** expands every chosen area.
- Tests: `tests/e2e/scroll-areas.spec.ts` (travel portal: 3 areas, every area expanded, no seam rows, no outlines), flow "quick clicks with On click pictures", editor and capture-extras specs use the Export popup.

## Round 31 — Cut out & join, Export popup design, scroll-area chooser

- **Cut out & join (editor toolbar, scissors next to Resize):** removes a part from the middle of the image and joins the rest — keep the top and bottom of a long screenshot without what is in between (or keep left + right). Drag over the part to remove on the preview (shown in red) or type the pixel range; choose the join: Seamless, Dashed line or Torn edge. Annotations below the cut move up with the image; ones entirely inside the removed part are dropped. One undo step.
- **Export popup redesigned:** File name with the image size, format cards (PNG – sharp, lossless; JPEG – small, for photos; WebP – smallest file), quality slider for JPEG/WebP, "Other ways to share" cards (PDF, Word, QR code) and a footer with Copy, Save as… and Download.
- **Scroll-area outlines vanish when the popup closes:** the chooser keeps a connection to the service worker while open; however the popup closes (Back, capture, click elsewhere, Esc) the outlines are removed from the page. Only Pixora's own pages may open that connection.
- **Outline labels** ("Area 1", "Area 2"…) sit on the outline's corner, outside the content, so they no longer cover the page's own numbers.
- **Scroll-area chooser redesigned:** each area is a card with a checkbox, number, title (all-caps titles shown in sentence case, two lines at most), a chip with the title bar's extra text (e.g. "25 packages"), the number of screens and a compact "how much" selector; plus "n of m selected" with Select all / Clear all. Area names no longer include the count text from the title bar.
- Tests: `tests/unit/round31.test.ts`, `tests/e2e/round31.spec.ts` (cut-out pixels verified in the exported PNG, undo; area names and detail; outlines removed on popup close).

## Round 32 — Table headers in expanded scroll areas; Chrome Web Store readiness

- **Table header rows kept in full-page captures:** a sticky header inside a scrolling panel (e.g. the `#  Airline / Flight  Departure …` row of Content 2 and 3) was hidden after the first frame, like a page header, leaving a blank strip. Now:
  - when a panel is expanded, its sticky parts are shown in place (they no longer scroll), and
  - only elements that stick to the **page** are hidden after the first frame; elements that stick inside their own panel are kept.
  - The scroll-area e2e test checks both table header rows are in the image (the old code produced none — verified).
- **Release check in every build** (`scripts/verify-package.mjs`): replaces tesseract.js's unused CDN defaults with local paths, and fails the build on any remote script host, `eval` / `new Function` in our bundles, a missing manifest file, required host access, static content scripts, `unsafe-eval` in the CSP, or a description over 132 characters.
- **`npm run package`** writes `release/pixora-<version>.zip` (manifest at the root, no dependencies).
- **Docs for the store:** `docs/PRIVACY.md` (privacy policy) and `docs/STORE.md` (listing text, single purpose, permission justifications, data-usage answers, assets checklist). `docs/PERMISSIONS.md` notes the save-folder picker.
- Removed a stray test artifact folder (`undefined/`) and the old `dist.zip`.

## Round 33 — Cut out & join on the canvas

- Cut out & join is now a canvas tool (scissors in the toolbar, highlighted while active), like Crop — no popup. The part to remove is shown **on the image itself** as a red hatched band with a "Remove N px" label.
  - Drag across the image to mark a new band; drag a red edge (grip) to adjust it; drag inside the band to move it. The cursor shows which one you will do.
  - The side panel: Horizontal band (keep top + bottom) / Vertical band (keep left + right), exact From / to pixels, the join (Seamless, Dashed line, Torn edge), the result size, Cancel and **Cut out & join**.
  - Enter applies, Esc cancels; one Ctrl+Z undoes it.
- The Round 31 popup (`CutOutDialog`) is removed.
- Test: `tests/e2e/round31.spec.ts` drags a band on the canvas, sets exact pixels in the panel, applies, checks the exported pixels (red meets blue, no green) and undo.
- After **Cut out & join** is applied the Cut tool stays on and its settings stay open (it no longer switches to Select): a fresh band appears in the middle of the new, shorter image with the same direction and join style, so several parts can be cut in a row. Undo / redo while cutting also re-centres the band. Only Cancel / Esc leaves the tool.

## Round 34 — "Without taskbar" recordings, smoother cursor

- **Record without taskbar actually crops the taskbar now.** The screen was matched to a monitor by aspect ratio using the track's *reported* size, which before the first frame can be the requested box (e.g. 1920×1080). On any screen that isn't exactly that shape (16:10 laptops, scaled displays…) no monitor matched and the full screen — taskbar included — was recorded. Now:
  - the real size of the first frame is measured (a cloned track, read once);
  - captures Chrome labels `screen:…` are known whole screens: small aspect differences from scaling are tolerated (5%), and with one monitor that monitor is used;
  - windows (`window:…`) and auto-hidden taskbars are still never cropped.
  The same helper serves "Entire screen without taskbar" screenshots.
- **Mouse in recordings:**
  - The styled cursor's glide is time-based and short (about 45 ms to catch up at the default smoothing, was about 100 ms of visible trailing), the same at any refresh rate.
  - It and the cursor halo hide when the mouse leaves the page, instead of freezing at the edge.
  - Desktop / window recordings no longer draw a page cursor or hide the real one: Chrome records the real cursor there, and a page-drawn copy could only lag behind inside the page. The popup hint says so.
- Tests: `tests/unit/round34.test.ts` (16:10 screens, reported-vs-real size, rounding, windows, auto-hide; glide speed and frame-rate independence). The "flow from chosen frames" e2e test records a little longer and picks two clearly different moments (it could judge two fake-camera frames 1.3 s apart identical).

## Round 35 — Select pans, zoom kept after cuts, page-placed zoom / highlight, Compare window, image panel everywhere

- **Select tool drag = pan.** With Select (V), dragging an empty spot moves around the image like the hand tool (grab cursor); pressing on an object still selects / moves / resizes it as before. Drawing tools are unchanged.
- **Cut out & join keeps the zoom** (crop, rotate and resize still fit the new image to the window).
- **Zoom / highlight during desktop and window recordings** are chosen **on the page you work on**, not in the recorder tab:
  - the page reports where it is on screen (window position and size, viewport size, page zoom via devicePixelRatio); the recorder places the area on the recorded screen (the monitor the window is on) or window (when the recorded window has the browser window's shape) — `src/recording/services/screen-map.ts`;
  - when the page can't be placed (it is on another monitor, another window is recorded, or Pixora has no access to the page) the live-preview picker opens as before, with a note saying why;
  - **Zoom in follows the mouse** in desktop recordings too: the page reports the mouse, placed on the recording the same way (it used to zoom into the centre). Limits: two monitors with exactly the same shape can't be told apart (Chrome doesn't say which one is recorded).
  - Messages carrying page geometry are validated (`isPageGeometry`), host message `host/page-region`.
- **Find sensitive information:** “Sort by: A | 4 Package Includes:” was reported as an account number (“sort” as in *sort code*). Now “sort” counts only as “sort code”, and account / ID / phone values must start with a number-like word, run only over number-like words and contain at least 4 digits (SWIFT / BIC / IFSC codes and UPI ids keep their own shapes).
- **Compare window redesigned** (shared by the screenshot editor and the Flow Editor; `CompareDialog`): header with Full screen / Close; zoom − % +, Fit, 100%; Side by side / Slider; Original / Edited / Both; two panes with their own label, size chip and scrolling; **View Options**: Sync Zoom, Sync Scroll, **Highlight Changes** (pixels that differ, computed on this device, with “n% of the picture changed”; same-size pictures only); **Restore Original** and **Done**. Wheel zooms at the pointer, drag to move, double-click zooms, keys + − 0 1, Esc closes.
- **Screenshot editor = Flow Editor features:**
  - **Image panel on the left** (hideable): the screenshot plus images added to it; tick boxes, numbers, “edited” / “open” tags, thumbnails, size; per image Compare, Restore original, Remove from list. The list is kept in the address (`?id=…&set=…`), so reloading keeps it. Switching images saves the edits of the open one (its original is kept) and keeps each image's undo history.
  - **Add image**: from the computer (several at once; folders synced by OneDrive / Google Drive for desktop are reachable from the same picker) or from the clipboard. Nothing is uploaded — Pixora has no cloud account by design.
  - **Collage** of the ticked images (or all) from the panel, and from the toolbar (the open image as edited plus the others).
  - **Compare with original** in the toolbar.
  - Every screenshot now keeps its untouched original on the first saved edit (before, only Flow images did).
- **Flow Editor:** the same **Add image** button (images go to the end of the flow) and the new Compare window.
- Tests: `tests/unit/round35.test.ts` (screen / window / zoom / scaling / second monitor mapping, message validation, sensitive-text false positives and true positives), `tests/e2e/round35.spec.ts` (select-drag pans without an undo step, cut keeps 200%, add image, switch keeps the cut, compare sizes / sync / highlight disabled for different sizes, restore, highlight on same size, collage from the panel).

## Round 36 — Compare full screen and flicker, image cards with the Flow options, click pictures at the press

- **Compare window:**
  - Full screen now fills the window exactly (the backdrop's 16 px margin was added on top, so it ran past the right and bottom edges).
  - **No flicker:** at Fit the picture area was exactly as large as the pane, so a scrollbar appearing shrank the pane, the picture was re-fitted, the scrollbar went away… over and over. Now a picture that fits shows no scrollbars at all (they come back once you zoom in), nothing is drawn until the pictures are decoded and the pane measured (no first frame at 100%), and the window fades in.
- **Image cards in the screenshot editor have the Flow Editor's options:** editable name (renames the capture), time · size · website line, Move up / Move down, drag to reorder, Duplicate (as it is now, edits included; the copy opens), Compare / View original, Restore original, Remove from list. The “edited” tag appears as soon as you change an image (and goes away when you undo back to the original).
- **Flow Capture — the picture of a click is taken at the press:** Chrome allows two screen captures in any one second, but Pixora spaced every capture 0.55 s apart, so a click right after a scroll (or page-load) picture waited — by then the page had reacted (loading fog, “View Details & Customize” already opening). Now captures are counted in a sliding one-second window like Chrome does, and automatic pictures (scrolls, pages loaded) only take a capture when none was made in the last second, so one is always free for a click. “Wait before picture: No delay” therefore really means the moment of the press.
- **Scrollable areas found:** each card says what its tick does — “Expanded: every row is captured” / “Not expanded: only the rows visible now”, and the intro explains it. (Measured on the travel test page: all three ticked 7 819 px, only panel 1 5 895 px, none 3 467 px.)
- Tests: `tests/unit/round36.test.ts` (capture window: click right after an automatic picture is immediate, automatic pictures leave a call free, third call waits), `tests/unit/scroll-area-chooser.test.tsx` (tick text, only ticked panels expanded), `tests/e2e/round36.spec.ts` (full screen = window size, no scrollbars at Fit, scrollbars at 100%, live edited tag with undo / redo, rename, duplicate, move).
- Test reliability: integration tests get a 15 s time limit (the first test of each file loads the whole service worker; under parallel load on Windows that passed the 5 s default without any test actually waiting), and the locked-storage e2e test waits until PowerShell really holds the database lock instead of a fixed 2.5 s.

## Round 37 — Add image from the clipboard / a web address, Flow pictures at the right moment, full-page Stop, collage export, video studio, browser frame

- **Add image everywhere offers three sources**: from the computer (several files), **paste from clipboard** (a copied picture, or a copied picture address), and **from a web address (URL)**. Used by the editor toolbar's *Insert image* (places the picture on the image), the image panel's *Add image* (adds images to the list) and the Flow Editor. A web address must be http(s) or a `data:image/…` address (no `javascript:`, `file:`, `chrome:`); Chrome asks once for permission to read from that one site (Pixora requests only that origin, from its optional host permission); the file must really be a picture and at most 50 MB. Nothing is uploaded.
- **Flow Capture — each picture shows its own step:**
  - A step picture that is still waiting (a page loading after “Go to”, a scroll picture waiting for the page) is taken the moment the user does something else. A click hands over its press picture (the screen just before the click is how the previous step ended); starting to scroll or pressing a scroll key is reported by the page straight away (`flow/activity`, on the first wheel / touch / key event, before the page moves) and the picture is taken then.
  - A scroll is reported 500 ms after it stops; a click, Enter or submit within that time reports it first, so steps arrive in order.
  - Before: “Go to …” could show the page already scrolled, and “Scroll down …” the page after the next click (loading fog). An e2e test reproduces the scroll-then-click case with a busy network and a real-length press (it fails without the fix — verified).
- **Full-page capture progress on the page** (right side): progress bar, “n of m screens” and **Stop & open**. The panel is hidden only while each picture is taken (never in the capture). Stop keeps the screens captured so far and opens them in the editor with a note.
- **Scrollable areas found:** the page scrolls to a panel only when you click its **Show** button (hover does nothing now); the “Expanded / Not expanded” line sits on its own row at the bottom of the card.
- **Collage export:** new *Export* card — export size, **file type** (PNG, JPEG, WebP), **quality** (JPEG / WebP) and the **expected file size** (a real encode with these settings, refreshed shortly after each change); the output line shows it too. Download uses these settings; “Edit collage” / “Add to flow” keep a lossless PNG.
- **Video page (“Visual Capture Studio”)** redesigned after the mock-up: always dark, navy panels with a purple accent, brand subtitle, film icon by the name, icons on Flow steps / Recent, **Recent is a menu of the latest videos** (+ all recent captures), player sized so the *Timeline* card fits below it, Timeline card with a time ruler and a “Trim range” row, purple segmented tabs on the side panel. All existing controls keep their names and behaviour.
- **Browser window frame:** redrawn back / forward arrows (rounded, 45° heads) and reload (circle with a solid arrowhead); new **Home button** switch in *Border & frame › Window* (Chrome / Edge styles).
- Tests: `tests/unit/round37.test.ts` (URL rules and names, ruler, sizes), `tests/unit/scroll-area-chooser.test.tsx` (hover does not scroll, Show does), `tests/e2e/round37.spec.ts` (URL from the toolbar and the panel, refusing `javascript:`, Home button changes the frame, collage JPEG + quality + size, download as .jpg; full-page Stop opens the partial capture and the panel is not in it), new flow test (scroll picture taken before the click).

## Round 38 — Advanced Video Editor, no SVG, collage Add image / Export popup, video panel fixes

- **Advanced Video Editor** (on by default; switch in the video page's top bar and in Settings › Recording):
  - **Draw tab → “Draw on this frame”** pauses the video and opens the image editor on that frame with all its drawing tools — pen, highlighter, shapes, arrows, text, callouts, blur, pixelate, masks, numbered markers, stickers, cursors, images (computer / clipboard / web address), eraser and watermark. Tools that change the picture size (crop, resize, rotate / flip, cut out, border & frame, collage) are hidden in this “video mode”, and their shortcuts are off.
  - “Add to video” turns each drawing into a **timed overlay** (from the frame's time, 4 s by default). Drawings visible at that moment can be edited again the same way; the watermark covers the whole video.
  - Each overlay has **From / To** times (typed or “Now”), an **animation in** (Fade, Pop, Slide up, Slide in, Wipe, Draw / type on), an **animation out** (Fade, Pop, Slide down, Slide out) and an **effect** while visible (Pulse, Bounce, Shake, Glow, Float), Go to and Delete.
  - **Live preview** on the player (frame by frame while playing, animations included; blur / pixelate read the current frame).
  - **Export burns them in** (“Burn in drawings … and watermark”, on by default): every frame is drawn after the privacy regions; text fonts are loaded first. Verified by decoding an exported frame and finding the drawing's pixels.
  - Overlays and the watermark are **saved with the recording** (image overlays store their picture as a PNG blob).
- **SVG is not offered or accepted**: every picker lists PNG, JPEG, WebP, GIF, BMP, AVIF only (types and extensions); dropped, pasted or downloaded SVG files are refused with a clear message.
- **Collage**: *Add images* is the editor's menu (computer, clipboard, web address); new header **Export…** popup with size, file type, quality, expected file size and Download (the Canvas tab's Export card has the same settings).
- **Video page**: the side panel's tab bar stays at the top while the panel scrolls; the trim range on the player's seek bar is a slim highlight with small handles instead of a yellow box around the bar.
- **Scrollable areas found**: the selected card's outline is drawn inside the card (no overlap / clipping), the size chip and screen count share one line, and the card text says “the first N screens” when a panel is limited.
- Tests: `tests/unit/round38.test.ts` (no SVG, overlay timing / animations / effects), `tests/e2e/round38.spec.ts` (draw on a frame, video mode hides size tools, overlay times / animation / effect, live preview pixels, saved, burned into the exported frames); collage tests use the Export popup and the Add images menu.

## Round 39 — Video editor in the studio layout (Annotate rail, drawing on the video, annotation timeline), Frames tab fix, recording load check

- **Frames tab buttons hidden:** the side panel's tab bar was made “sticky” with negative margins inside the scrolling panel, which in some states hid the tabs. Now the tab bar sits outside the scrolling area and only the content below it scrolls — the tabs are always visible.
- **Video editor, studio layout (Advanced Video Editor on):**
  - **Annotate rail** on the left: Select, Draw, Text, Shapes, Arrows, Callout, Highlight, Blur, Pixelate, Mask, Numbered, Stickers, Cursor, Eraser, Watermark. Picking a tool pauses the video, opens the Draw tab and starts that tool.
  - **Drawing directly on the video**: while paused with the Draw tab open, the image editor's canvas lies exactly over the video picture (no margin, transparent workspace) with the usual selection handles, floating bar, text editing, undo / redo. Seeking to another moment shows that frame and the drawings visible then. Every change updates the video's overlays at once (`syncOverlays`): new drawings start at the current time with the default length / animations / effect; deleted ones are removed.
  - **Draw tab** = the image editor's full settings panel for the tool or the selected drawing (designs, style, colours, sizes…, the same panel as the image editor), plus **Apply to video** for the selected drawing: Start / End time (or “Now”), **Apply throughout video**, Animation in / out, Effect, **Save as default** (length, animations and effect for new drawings), **Reset**, and a **Saved** badge (shows when the overlays are stored with the recording).
  - **Timeline annotation tracks**: one row per drawing with show / hide (eye), coloured type marker, name (click to go there), a bar for its time (drag to move, drag either end to change), delete, the playhead line, and **Add annotation**.
  - Browser / Frame (border) from the mock-up are not offered for videos: they change the picture size, which a video can't do per frame.
- **Recording load check (mouse not moving smoothly):** the recorder now measures how long each frame takes to process against the frame budget (33 ms at 30 fps — including waiting for the encoder). If more than 15% of frames were over budget, frames were skipped; the recording gets a note with the numbers and what to change (lower resolution / frame rate, camera bubble or live effects off, close heavy programs). A skipped-frame recording shows exactly a jumpy mouse, so the note confirms or rules out this cause.
- Tests: `tests/unit/round39.test.ts` (live overlay sync, video end, performance note), `tests/e2e/round38.spec.ts` (rail tool pauses and opens Draw, drawing on the video, timeline track, Apply to video with animation / effect and Saved, hide / show, preview while playing, burned into the export).

## Round 40 — Timeline details, multiple / directional animations, moves over time, no “screen in screen” when zooming, Frames buttons on top

- **Timeline tracks:** clicking an annotation selects it and shows its details (Apply to video) — going to a moment where it is shown if needed; while dragging a bar (or for the selected one) its **start and end times show on both sides** of the bar.
- **Several animations per drawing:** *Animations in*, *Animations out* and *Effects while shown* are lists (chips with ×, “+ Add”) and combine. New choices:
  - In: Fade, Pop, Zoom in, Spin in, Blur in, Slide in from left / right / top / bottom (with fade), Fly in from left / right, Wipe left → right / right → left / top → bottom / bottom → top, Draw / type on.
  - Out: Fade, Pop, Zoom out, Spin out, Blur out, Slide out to left / right / top / bottom (with fade), Wipe out left → right / right → left.
  - Effects: Pulse, Bounce, Shake, Glow, Float, Wiggle, Heartbeat.
  - Older recordings keep working (the single animation fields are still read).
- **Move over time (point A → point B):** tick *Move over time*, go to a later moment and drag the drawing — it glides there (smoothly) from where it was; each move point is listed (time and direction) with Go to and remove. Style changes on a moved frame keep the path. Preview and export follow the path.
- **Zoom showed the screen inside the screen:** choosing a zoom / highlight area on the recorder's live preview during a desktop recording put the recorder page — a live picture of the screen — into the recording. Now the recording **pauses while you choose** (and resumes after), and the preview shows a still frame. (Areas chosen on the page you work on, Round 35, never open the preview.) If clicks zoom the recording by themselves: that is *Auto zoom on click* (popup › Recording settings › Zoom); since Round 35 it applies to desktop recordings too.
- **Frames tab:** *Add this frame* and *Open in Flow Editor* sit together at the top of Flow steps (sticky), instead of the Flow Editor button after the whole step list.
- Tests: `tests/unit/round40.test.ts` (combined and directional animations, wipes in four directions, older fields, gliding between points, dragging adds a move point, style changes keep the path), `tests/e2e/round38.spec.ts` extended (add animations / effects as chips, Move over time with a drag at a later moment, track details and times, the moved box burned into the export).

## Round 41 — Full-page progress window, Entire-screen countdown, controls never recorded, popup controller, smaller screens

- **Full-page capture progress** is a small window of its own beside the browser window (progress bar, “n% captured”, **Stop & open**), opened by the service worker and closed when the capture ends. Nothing is added to the page any more, so nothing has to be hidden for each screen (the on-page panel blinked) and nothing can end up in the picture. `screenshot/stop-full` is accepted only from Pixora's own pages.
- **Entire Screen & App Window**: after you pick the screen / window, Pixora switches back to the tab you were on and shows a **countdown window** (Settings › Screenshot › *Entire screen / window delay*: 3, 5, 10 or 15 s; at least 3) with the seconds left and Cancel. It closes itself just before the picture; the frame is read from the stream after the countdown (works while Pixora's page is in the background), then Pixora's editor opens.
- **Controls are not recorded when you zoom / highlight**: choosing an area shows Pixora's selection on screen, so the recording **pauses while the area is chosen** — on the page (tab and desktop recordings) and on the recorder's preview — and resumes after you confirm or cancel (`recording/region-cancelled`).
- **Recording controller in the popup** (the separate control-bar window is now off by default — settings v6 migration — and can still be switched on): status and timer, Pause / Resume, Stop, Discard, and **Live tools**: Zoom in / out, Zoom to area, Highlight area / Clear highlight, Spotlight, Draw on screen, Marker (with count), Teleprompter, Mic, Camera.
- **Smaller screens (image editor and video editor):**
  - Image editor: below 1360 px the drawing tools get their own toolbar row (nothing hides behind zoom / export); narrower side panel (300 / 270 px) and image panel (200 / 168 px, icon-only Add image, card actions wrap); the picture re-fits when the window size changes (while it is at “fit”).
  - Video editor: below 1280 px the brand subtitle hides; below 1180 px secondary top-bar buttons show icons only (names kept as tooltips / accessible names) and the Annotate rail becomes an icon column (tooltips); below 820 px everything stacks in one column with the rail as a horizontal strip.
- Test reliability: the video-privacy export check reads the brightest of several outside points (the test camera's moving stripes can make one point dark); the recording-manager test switches the control window on explicitly.
- Tests: `tests/unit/round41.test.tsx` (v6 migration, delay default, new messages, countdown window), `tests/e2e/round41.spec.ts` (no control window by default, popup Live tools change the recording, Zoom to area pauses and Cancel resumes), `tests/e2e/round37.spec.ts` (Stop in the progress window; the window closes; nothing added to the page).

## Round 42 — Full-page Stop in the popup, click to zoom, timeline menu and Delete, layout fixes

- **Full-page capture progress and Stop are in Pixora's popup** (no extra window): while a capture runs, opening the popup shows “Capturing full page… n%” with the page title, a progress bar and **Stop & open**. The service worker publishes the progress in session storage (`glint.fullpage`); the progress window of Round 41 is gone (its page now only hosts the screenshot countdown).
- **Zoom in asks where:** the popup's *Zoom in* (and *Zoom to area*) open the picker — **click a point** to zoom 2× there (a box half the view, centred on the click, kept inside), or drag an area. Works on the page and on the recorder's preview; the recording pauses while choosing and resumes after.
- **Timeline annotations:**
  - **Right-click** a track: Edit details, Go to start, Hide / Show, Duplicate, Start / End at the playhead, Apply throughout video, Delete.
  - **Keys:** with an annotation selected on the timeline, **Delete / Backspace** removes it; on a focused track ← / → move it by 0.1 s (Shift: 1 s), Enter shows its details.
  - Changes made outside the drawing layer (delete, duplicate, hide) re-open the drawing layer with the current drawings, so a deleted drawing can't come back with the next edit.
- **Video page layout:** icon-only top-bar buttons are square (no space left for hidden text); side-panel tabs have real spacing and wrap to a second row instead of squeezing; the trim row is two groups that wrap as a whole — *Trim range / Start / End / Selected* and *⏮ ▶ ⏭ (framed) · Preview selection · Reset · Export trimmed* — so the playback buttons are never split across lines.
- **Screenshot editor flicker on resize:** the picture re-fits only once the size has settled and only for real size changes (larger than a scrollbar) — re-fitting on every change made scrollbars appear / disappear and the picture flicker.
- Tests: `tests/e2e/round42.spec.ts` (popup progress card + Stop, no extra window; click-to-zoom = 2× and recording resumes; timeline right-click Duplicate and Delete key; zoom value stable after a resize), `tests/e2e/round37.spec.ts` updated (Stop from the popup).

## Round 43 — Full-page progress opens in the popup, longer full pages, Pointer arrow, video side panel

- **Full-page capture opens Pixora's popup by itself** (anchored to the toolbar icon, like other capture extensions): it shows only *Full page capturing…*, the page title, a progress bar with the percentage, the tips (*do not scroll or move the pointer*; *end very long or endless pages with Stop*) and **Stop** (what is captured so far opens in the editor). Started from the popup, the popup stays open and turns into this view; it closes itself when the editor opens. Where Chrome doesn't allow opening the popup, the badge shows the percentage and a click on the icon shows the same view. The popup is never part of the screenshot (only the page is captured).
- **Longer full pages:** default limit 100 000 px (was 30 000; settings v7 raises the old default, a limit you chose is kept), options up to 500 000 px. A page too tall for one image (Chrome allows ~32 000 px per side) is saved as **several full-resolution images** (“… (part 1 of 3)”, top to bottom) instead of one scaled-down image; all parts open together in the editor's image panel. Each part is made as soon as it is complete and its screens are released, so memory stays low on very long pages. Flow Capture full pages are unchanged (one image per step).
- **Pointer arrow** (Line & arrow styles › *Pointer*, and *Red pointer* in the ready-made arrows): one filled shape — a sharp tail that widens towards a large head whose barbs reach back past the body, with rounded corners; follows the line width, colour and outline like the other styles.
- **Video editor side panel:** the tabs stay on one row — *Details · Annotations · Chapters · Frames* (counts as small badges). *Draw* is now **Annotations** (the drawings on the video and their timing, animations and effects). **Privacy** moved to the bottom of the left **Annotate** rail (with its count); with the Advanced editor off there is no rail, so Privacy stays a tab.
- **Frames tab:** *Add this frame* and *Open in Flow Editor* sit one under the other at full width, so they never run past the panel.
- **Drawing on the video right after it opens:** picking a tool before the first frame was loaded left the drawing layer empty until the playhead moved; it now waits for the frame.
- Tests: `tests/unit/round43.test.ts` (v7 limit migration, parts within Chrome's canvas limits, Pointer outline shape and preset), `tests/e2e/round42.spec.ts` (popup progress view with tips and Stop; a 25 600 px page becomes two full-resolution images, named in order, both in the editor), `tests/e2e/round38.spec.ts` (Annotations tab), `tests/e2e/live-tools.spec.ts` (Privacy from the Annotate rail), `tests/e2e/round37.spec.ts` (Stop in the popup).
- (Follow-up) The full-page popup is exactly as tall as its content (the popup's 420 px minimum height no longer applies to it), and the popup no longer draws its normal, taller view first while it checks whether a capture is running. Test: the popup box is no taller than the progress view.

## Release preparation (1.0.0)

- The disabled “Cloud — coming in a future release” storage choice was removed from the Record tab (with only “Local” left, the Storage menu did nothing, so it is gone too). Settings still store `local`.
- Docs refreshed for the release: README (features, install, release build, limitations), [RELEASE_NOTES.md](RELEASE_NOTES.md), [STORE.md](STORE.md) (listing text, permission justifications incl. per-site access for *Add image › From a web address*, the images to upload), [PRIVACY.md](PRIVACY.md) and [PERMISSIONS.md](PERMISSIONS.md) (the web-address picture download), [ARCHITECTURE.md](ARCHITECTURE.md) and [DEVELOPMENT.md](DEVELOPMENT.md) (manual release checklist).

## Round 44 — Full page on pages that scroll a box under a fixed header

Reported on a booking site (a fixed header with a menu, the page content scrolling in a box under it, and the XRebel toolbar fixed at the bottom right):

- **The header is in the image again.** Pages that scroll a full-width inner box are captured as the strip above the box (from the first screen), the whole box content, and the strip below the box (from the last screen) — not the box alone. Boxes with side bars next to them are captured as before (box only).
- **No repeated bits:** from the second screen on, everything outside the scrolling box is hidden while capturing (only the box is used from those screens), so things that hang over it — like the menu's ▼ “current page” arrow — are not stamped on every screen.
- **Fixed elements in the right place:** fixed elements in the top half of the window (headers) appear on the first screen only; fixed elements in the bottom half (XRebel and other toolbars, chat buttons, cookie bars) appear on the last screen only — at the bottom of the page — instead of on the first screen as well. Applies to normal pages too.
- Elements are hidden with an attribute matched by the capture's own stylesheet instead of inline styles, so widgets that rewrite their `style` can't reappear mid-capture; everything is restored afterwards.
- Stopped early (or the page turned out shorter): the strip below the box is left out, since bottom-fixed elements were still hidden.
- **Follow-up — XRebel still shown twice:** its toolbar is a transparent strip the full height of the window with the visible box at its bottom, so it counted as a top element and stayed on the first screen. Now only header-like fixed elements (at the top edge, less than half the window tall) stay on the first screen; every other fixed element — bottom bars, floating buttons, full-height strips — appears on the last screen only. Sticky elements are never shown again at the end. The test page now has such a strip (it reproduced the duplicate before the change).
- **Follow-up 2 — still twice:** toolbars can also be a zero-size fixed wrapper whose box is drawn outside it, or live in a shadow DOM tree — both were missed on the first screen. The fixed-element scan now goes into open shadow roots (hiding the outer host, which the capture stylesheet can reach), and zero-size wrappers count by where their visible contents are drawn. The test runs with all three structures (strip, zero-size wrapper, shadow DOM); the two new ones reproduced the duplicate before the change.
- **Follow-up 3 — never hidden at all:** the second copy at the end also hid the fact that the toolbar was on *every* screen (each screen's bottom corner is painted over by the next). Two structures were out of reach: a toolbar attached to `<html>` outside `<body>` (the scan only covered `<body>`), and a custom element whose contents are in a *closed* shadow root (nothing inside can be measured). The scan now covers the whole document; a top-level custom element that draws nothing measurable counts as a bottom toolbar (hidden until the last screen); siblings that can't be measured are treated the same way; and hidden elements get `opacity: 0` as well, which nothing inside them can undo. Both structures reproduced the duplicate before the change; the test now runs five toolbar structures.
- **Confirmed on the reported page** (XRebel appears once, at the bottom).
- **Sidebars that become fixed while scrolling** (a booking “Cruise Summary / Need help?” column made fixed by the page's script) were stamped a second time on the last screen, because any non-header fixed element was shown there. Now only elements already pinned to the window on the *first* screen can be shown again at the end (window toolbars like XRebel); anything that becomes fixed later is page content — kept where it is on the first screen, hidden afterwards. Tests: script-made fixed sidebar and CSS `position: sticky` sidebar each appear once, in place (the first reproduced the duplicate before the change).
- **Sticky sidebar still twice (real cause):** sticky elements inside a scrolling *panel* (a table header in a list) are kept on purpose; the panel test counted any parent with `overflow: clip` as a panel. Sites clip page-wide wrappers to stop sideways scrolling — that doesn't scroll, and a sticky sidebar inside still sticks to the page — so the sidebar was kept on every screen. `clip` no longer counts (`auto`, `scroll`, `hidden`, `overlay` still do). Tests: sticky sidebars inside `overflow: clip` and `overflow-x: clip` wrappers appear once in place; a striped-content version that showed the sidebar on three screens every time before the change shows it once in 6 of 6 runs after; the sidebar tests pass 16 of 16 in repeated runs.
- **Right edge cut off on pages with scroll boxes** (a booking page's *View Penalties* button half cropped): *Hide scrollbars* was switched on after the page was measured, so the page grew by a scrollbar's width while the image kept the old, narrower width. Scrollbars are now hidden first, then the page is measured; they are also hidden on every element through `scrollbar-width`, which sites' own scrollbar colours otherwise override. Tests (run in a real window, because headless Chrome has no scrollbars to hide): one scroll box, a site-styled scrollbar, and a scroll box inside a scroll box — right-aligned buttons are whole and reach the edge (the nested case cut the button before the change).
- **Image panel:** *Add image* is an icon-only button at every width (name kept as its tooltip and accessible name).
- **Pointer arrow reshaped (and the white triangles fixed):** the outline crossed itself where the body met the head — the body's sides joined the opposite barbs — and the crossing areas were left unfilled (two white triangles in the head). Now the body widens from a thin rounded tail to about half the head's width and ends exactly on the head's straight back edge, the barbs stick out on both sides, the head is about twice as long as it is half-wide, and corners are rounded. On curves the body is trimmed at the head's back edge. *Red pointer* is thicker (20 px). Unit test: the outline never crosses itself (straight, diagonal and curved paths, widths 4–24).
- Tests: `tests/e2e/round44.spec.ts` (box under a fixed header with a hanging arrow and a bottom-right widget: header once at the top, arrow never repeated, widget once at the bottom, full height, page restored; normal page with a fixed header and a bottom widget), `tests/unit/round44.test.ts` (strip sizes).

## Round 45 — Real browser header on screenshots, editor flicker

- **Include the real browser header** (Settings › Screenshots, off by default): visible and full-page screenshots get the real tabs, address bar, bookmarks bar and extension icons on top. Chrome's screenshot API only sees the page, so after the capture a small Pixora window asks Chrome for a picture of the browser window: Chrome's *Choose what to share* dialog opens (app windows only) — pick the Chrome window with the page and click *Share*. Pixora's window minimises itself first (it is never in the picture), then:
  - the page is found inside the window picture by comparing it with a normal screenshot of the tab (a grid of samples at every position; the page's first rows are skipped because Chrome draws the toolbar's shadow over them), so window borders, maximised windows and DevTools docked on the right are handled; when the page can't be found, the usual layout is used only if the picture is the browser window's size — another window gives *“That window doesn't show the page you captured”* with **Try again** / **Skip header**;
  - the strip above the page (full window width) is put above the screenshot — on the first image of a long page that comes in parts; stretched to the screenshot width when within 3% (scrollbar), otherwise the wider of the two sets the width; scaled with *Image scale: CSS pixels*.
  - Cancel in Chrome's dialog, **Skip header**, closing the window, or no answer within 3 minutes keeps the screenshot as it was. No new permission (it uses `desktopCapture`, already used for Entire Screen & App Window); the window picture stays on your computer and only the cut strip is used.
  - The strip comes back to the service worker as a PNG data URL in a validated message (`screenshot/header`: a PNG data URL or null, accepted only from Pixora's own pages).
- **Editor flicker** (the picture blinked while the window was resized, focused or restored): resizing the canvas clears it, and the picture was drawn one frame later, so Chrome sometimes showed the empty canvas. The canvas is now resized in the same frame it is drawn.
- Tests: `tests/unit/round45.test.ts` (page found under the header with a border, maximised, DevTools docked, colour differences and a changed area, a page starting with plain rows, the toolbar shadow; another window / no header give nothing; header sizing; setting default; message validation); `tests/e2e/round46.spec.ts` (headed, real window size, Chrome's dialog answered by the test: visible and full-page screenshots are exactly the header plus the same screenshot taken without it; closing the header window keeps the screenshot unchanged); `tests/e2e/round45.spec.ts` (the editor canvas is never blank while the window is resized — 9 742 blank samples before the change, 0 after).

### Round 45 follow-ups — settings layout, header window

- **Recent captures and Settings use the whole window width** (the 760 / 1400 px limits are gone).
- **Settings are grouped**: every settings page has a title and titled groups laid out side by side (one column on narrow windows), so each setting's scope is clear — e.g. *Screenshot* › Capture · After capturing · Image format & size · **Full page** (only for full-page screenshots; the “Full page:” prefixes are gone) · Browser header & frames · Entire screen & app window; *Recording* › Video · Audio · Camera · While recording · Clicks, keys & cursor · After recording; *Flow Capture* › Capturing steps · Scrolling & timing · Privacy · With recordings · Flow Editor; *Storage* › Saving files · Recent captures; *Keyboard shortcuts* › Shortcuts on any page · In the screenshot editor; *Advanced* › Video encoding · Troubleshooting. Each group is a labelled region (`aria-labelledby` its heading).
- **Header window** (Include the real browser header):
  - Opens at the browser window's size, centred over it (Chrome draws its *Choose what to share* dialog inside the window that asks; the old 440 × 250 window cramped it and broke its own layout). Its page is a centred card that reflows at any size: three numbered steps naming the exact window to pick (“*page title* - Google Chrome”) and warning not to pick Pixora's own window, which is titled “Pixora – adding the browser header”.
  - **Sizes are fitted automatically when close:** the page picture may be a few pixels wider than the window picture (rounding at 125 % / 150 % scaling, a window that isn't maximised — seen as 1295 vs 1294 px, which used to fail with “doesn't show the page”); up to 8 px is compared on the part that fits. A header within 6 % of the screenshot's width is stretched to it; the window may differ from the screenshot by up to 5 % in width (at least 16 px) and 10 % in height (at least 48 px, e.g. the bookmarks bar shown or hidden) before the user is asked.
  - The message no longer shows Chrome's internal window id (“window:…”), which isn't a name.
  - **Must match the screenshot:** the screenshot's tab and page-area size are passed to the window; before Chrome's dialog and again just before the picture it checks them. A window resized more than that (e.g. no longer maximised) shows *“The browser window changed size after the screenshot”* with both sizes and why; another tab shows *“Another tab is showing now”*. It continues by itself as soon as the window matches again, or **Keep screenshot without header**.
  - Picking Pixora's own window, or another window, says so (with the picked window's name); other failures show the picture sizes as details. A window picture at another scale than the page (some screen setups) is matched at that scale and the header scaled back.
  - Only cancelling Chrome's dialog on the first attempt closes the window (keeping the screenshot as it was); after **Try again** the window stays and explains, so it never disappears under a click. The window waits up to 10 minutes (was 3).
- Tests: `tests/unit/round45.test.ts` (window query; same tab and size → ok, resized → size, other tab → tab); `tests/e2e/round46.spec.ts` (resized after the screenshot: the message shows, nothing is saved yet, and once the size is back the screenshot is saved with the header).
- **Coloured settings groups:** each group on a settings page has its own accent colour — a 3 px top edge, a square marker before its title and a lightly tinted heading (blue, green, amber, purple, pink, teal, then again), in the same order on every page, in light and dark themes.
- Chrome's *Share an application window* dialog is Chrome's own: its size can't be changed by an extension (Pixora's window behind it names the window to choose).

### Round 47 — Settings page redesign

- **Page header:** a gradient icon tile, large title and description, and **Reset to defaults** on the right (General, Screenshot, Recording, Flow Capture, Storage, Advanced). It asks first and resets only that page's settings — other pages and captures are kept (Storage: files go to Downloads again).
- **Groups:** an icon tile in the group's colour, a gradient-tinted heading, rounded cards with a soft shadow; colours in a fixed order (blue, purple, teal, green, pink, amber). Three columns on wide windows, one on narrow.
- **Every setting has an icon** before its name (76 settings, 26 groups); rows whose control sits under the text keep the icon beside the text.
- **Purple accents** on these pages: toggles, selected segments (filled), the selected sidebar item (gradient) and dialogs shown over the page; the sidebar shows *Pixora · Screen Capture Studio*. Dark theme: a deep blue-purple gradient background with a translucent sidebar; light theme: soft tints.
- Not added from the mock-up: a *Pixora Pro — Upgrade* card (there is no paid version, account or cloud sync, and every control must do real work).
- Tests: `tests/e2e/round47.spec.ts` (page heading and titled group regions; Cancel keeps settings; Reset restores the Screenshot settings and leaves Recording settings as they were).
- (Follow-up) Groups are shown **one under another** in a single full-width column (side-by-side cards left empty space under the shorter ones).
- **Header window uses Chrome's web share dialog** (`getDisplayMedia`, the one websites use) instead of the extension picker (`chrome.desktopCapture`, whose *Share an application window* box has a fixed small size). It opens on the **Window** tab with *Entire screen* hidden (`monitorTypeSurfaces: exclude`), this page excluded (`selfBrowserSurface: exclude`) and no switching while shared. Its size is still Chrome's own. When Chrome wants a click on the page before showing it, the window shows **Choose window…**. Sharing a tab or screen instead of a window is reported. The extension picker is still used for *Entire Screen & App Window* screenshots and desktop recordings.

### Round 48 — Recording without slowing the computer

- **The computer (and mouse) lagged while recording the entire 4K screen:** every frame was encoded at the screen's full size (≈ 50 Mbps at 4K30); without a hardware encoder for that size, Chrome encodes on the processor and the whole computer slows down. Before each recording Pixora now asks Chrome (`MediaCapabilities.encodingInfo`, type `record`) which formats are **smooth and hardware-encoded** at the source size, trying the container's codecs in the usual order (H.264, VP9 … for MP4). With resolution **Original** it lowers the size to 1440p, then 1080p, when only that is hardware-encoded (via `applyConstraints` on the capture), and the result page says so. A resolution or codec chosen by the user is never changed; when nothing is hardware-encoded, the size is kept and the result page suggests 1080p / 1440p. Camera-only recordings are not affected.
- **"Pixora is sharing your screen · Stop sharing · Hide" bar:** Chrome's own security notice for any screen / window capture; extensions can't remove it. *Hide* hides it for that recording; window recordings don't include it.
- Tests: `tests/unit/round48.test.ts` (full size when hardware-encoded; 1440p / 1080p with *Original*; chosen resolution / codec kept; no hardware encoder → kept and reported; another codec when only that is hardware-encoded; browser errors ignored).
- **Recording pointer felt floaty:** Pixora's styled recording pointer (Cursor effects) glided towards the mouse with *Smooth movement* 60 % by default, so it trailed the hand. Default is now **Off** (settings v8 turns an unchanged 60 % off; another chosen value is kept); with it off the pointer is moved inside the mouse event itself, with no frame of delay.
- **System sound button on the Record tab** (speaker, next to camera and microphone): switches *Record system / tab audio*; disabled for Camera Only. For Desktop recordings a tip says to keep *Share system audio* ticked in Chrome's dialog and to click **Hide** on Chrome's *sharing your screen* bar during the countdown (Chrome's own bar can't be removed by an extension; hidden, it isn't recorded).
- **Settings pages are 1 080 px wide, centred** (Recent captures keeps the full width).
- Tests: `tests/unit/round48.test.ts` (v8 pointer smoothing), `tests/unit/designs.test.ts` (default Off), `tests/e2e/round48.spec.ts` (System sound button on / off saved, disabled for Camera Only; Desktop tip shown only for Desktop).

### Round 49 – Settings alignment
- Settings pages (max 1080px wide) now start right next to the sidebar instead of being centred in a wide window; Recent captures still uses the full width.
- Flow Capture › "Take screenshots on": the row's name and description sit on one line, with the interaction chips (and All / None) underneath at full width, so the label is no longer squeezed into a narrow column. The picker no longer repeats its title inside Settings.
- Test: tests/e2e/round49.spec.ts (headless).

### Round 50 – "Ask where to save" waits for you
- With Settings › Storage › "Ask where to save" on (or Save as…), Chrome returns the download while its Save-as dialog is still open. Pixora now waits for the dialog: the "Saved" message appears only after the file is really written, and nothing is shown if the dialog is closed without saving (a real failure such as a full disk is reported).
- Applies everywhere files are saved: editor (image, PDF, Word), collage, video page, video frames, Flow exports, Recent captures.
- `downloadOutcome(id)` in src/shared/utils/download.ts reports complete / cancelled / Chrome's interrupt reason (also handles an item that ended before listening, or was removed).
- Tests: tests/unit/round50.test.ts.
