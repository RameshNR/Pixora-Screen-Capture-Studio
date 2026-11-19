# Pixora – Release notes

## 1.1.1 — video editor and annotation improvements (November 2026)

### New
- **Video editor**: Undo, Redo, a History window and Reset to original in the header.
- **Callouts**: move the title and text anywhere with their four-arrow handles, and choose the colour of the leader line's end point.
- **Shift while resizing** keeps shapes and callouts square or round.
- **Size control**: hold − or + to keep changing the size, or click the number to type one.
- **Select several objects** with Ctrl + Shift + click, then move, copy, paste, duplicate or delete them together.
- **Ctrl + click** clears the selection without adding an annotation; **Ctrl + drag** moves an annotation.
- **Lock** an annotation (right-click, or the padlock in Layers) so it can't be moved or changed; **Move only** lets you drag it without changing anything else.
- **Cut a highlight with a shape**: select both, then *Cut the highlight away inside the shape* or *Keep the highlight only inside the shape*; *Undo cut* brings it back.
- **Move a callout's number badge** like its title and text; **Reset positions** puts them back.
- **Move the watermark** by dragging it; **Reset position** puts it back.
- **Move & pan tool (H)**: drag an annotation to move it, or the image to pan — also when the image fits on screen.
- **Blur and pixelate** also blur the annotations on lower layers.
- **Higher limits**: pen and highlighter up to 600 px, text 600 px, blur 200 px, stickers 1000 px and more.
- **Reset** buttons for the eraser, watermark and frame; the image editor's Reset has its own icon.

### Fixed
- Exporting at a lower resolution (for example 4K to 1080p) keeps annotations at the right size.
- Bring forward and Send backward now apply during playback and in the exported video.
- The export progress bar follows the real encoding progress and shows the time left.
- Choosing an annotation tool on the video no longer makes the page flicker.
- Clicking outside the image no longer adds an annotation.
- Callouts keep their shape when the text size changes, and return to their size when the text gets smaller.
- The Frames tab counts frames added by hand.
- Pointer and tapered arrows follow curves smoothly with a round tail; panels only show the options a design supports.
- Box highlights shrink again when you drag back; the Progress ring marker follows its style.
- Adding and removing annotations no longer marks an image as edited (Compare, Reset).
- The selection bar's ⋯ menu and the right-click menu offer the same options.
- Leader lines join the callout cleanly and arrow heads follow straight lines; dotted callout lines show; callouts without a background have a clean tail.

## 1.1.0 — themes, browser header and editor improvements (November 2026)

### New
- **Themes for every window**: Settings › General › Theme — choose Dark, System or Light, then one
  of 9 dark themes (Graphite Dark — the default —, Slate Night, Midnight Purple, Royal Indigo, Ocean
  Blue, Emerald Green, Sunset Gradient, Crimson Night, Warm Dark) or 9 light themes (Classic Blue,
  Slate Minimal, Purple Lavender, Teal Ocean, Sky Cyan, Emerald Fresh, Rose Coral, Sunrise Amber,
  Warm Sand). Colours are tuned to be easy on the eyes. The popup, settings, image editor, Compare
  window, video page, Flow Editor and helper windows all follow it, live. Your earlier Light / Dark
  choice becomes Classic Blue / Graphite Dark.
- **Browser header in screenshots** (Settings › Screenshot › Browser header & frames): visible-part
  and full-page screenshots can include the real tabs, address bar and bookmarks bar. Small window
  size differences are adjusted automatically; large ones are explained so you can fix them.
- **Create flow on the video page**: pick frames of a recording and turn them into a step-by-step
  flow (linked to the video; *Open flow* afterwards). Picked frames are kept while you switch tabs.
- **System sound button** on the Record tab, next to the camera and microphone.

### Improved
- Settings redesigned: icons, colour-coded groups one under another, a readable width next to the
  sidebar, and *Reset to defaults* per page.
- Light themes have clear contrast: the image on the editor canvas has an edge and shadow, arrow
  style previews and highlighter colours are easy to see, panels stand out from the page.
- Recording: the styled pointer follows the mouse exactly (no glide), hardware-friendly video
  formats keep the computer responsive while recording the whole screen, and a tip explains how to
  keep Chrome's "sharing your screen" bar out of the video.
- Recent captures: smooth hover; long names no longer push the buttons out of the card.
- "Ask where to save": *Saved* is shown only after you choose a place (nothing when you cancel).
- Full-page screenshots open the editor straight away ("Preparing your screenshot…") and are saved
  faster; exports show a progress message, and unedited screenshots download instantly.
- Calmer buttons: no glowing halos or gradient sheen.
- Collage: Ctrl + mouse wheel zooms the collage instead of the whole page.

### Fixed
- Full-page screenshots no longer crop the right edge where a scrollbar was.
- Editor no longer flickers while the window is resized.
- Browser header: "Try again" no longer closes the window.
- Video frames: no more Canvas2D "willReadFrequently" warning in Chrome's error list.

## 1.0.0 — first public release (November 2026)

Pixora – Screen Capture Studio: screenshots, screen recording and step-by-step guides, all on your
own computer. No account, no uploads, no tracking.

### Screenshots
- Visible part, full page, selected area, delayed capture (3–300 s), entire screen or app window.
- Full pages: fixed and sticky headers handled, lazy content loaded, panels that scroll on their own
  included (a chooser shows each one on the page), sticky table headers kept. Progress and **Stop**
  open in Pixora's popup. Pages taller than one image allows (~32 000 px) are saved as several
  full-resolution images; the limit is 100 000 px by default and up to 500 000 px in Settings.
- Pages that scroll a box under a fixed header (booking systems, web apps) are captured with their
  header once at the top; headers, menu arrows and toolbars fixed to the window (like XRebel) are
  never repeated — top ones appear once at the top, bottom ones once at the bottom.
- Entire screen / app window: a countdown (3 s or more, set in Settings) after you pick, so you can
  get the screen ready; optionally without the taskbar.
- Optional **real browser header**: visible and full-page screenshots can include your real tabs,
  address bar and bookmarks bar (Settings › Screenshots; Chrome asks which window to share).
- On-device text recognition (OCR) and sensitive-information detection.

### Image editor
- Pen, highlighter, shapes, 60+ line and arrow styles, text presets, callouts, numbered markers,
  stickers, cursors, blur / pixelate / mask, eraser, watermark.
- Crop, resize, rotate, Cut out & join, browser frame (with optional Home button) and device
  frames, backgrounds, borders.
- Image panel for several images: add from a file, the clipboard or a web address; Compare
  before / after (side by side, slider, full screen); Collage with export settings and an expected
  file size.
- Layers and History keep every change editable; originals are kept.
- Export PNG, JPEG, WebP, PDF or Word; QR code for a link; copy; save to any folder.
- Works on small screens: the toolbar wraps and the side panels narrow.

### Screen recording
- This tab, a custom area, desktop or window, or camera only — up to 4K, MP4 or WebM.
- Microphone, system / tab audio, camera bubble, countdown, pause / resume, maximum length,
  scheduled recordings.
- Live tools in the popup while recording: zoom (click a point or drag an area), highlight,
  spotlight, draw on the screen, markers, teleprompter, mic and camera on / off. Choosing an area
  pauses the recording, so Pixora's own controls never appear in the video. The separate control-bar
  window is still available (Settings › Recording).
- Click effects, cursor halo, keyboard-shortcut highlights, auto zoom on click.

### Video editor
- Filmstrip timeline, trim, preview selection, chapters with WebVTT export, frame grabs and Flow
  steps from frames.
- Advanced Video Editor (on by default): draw on the video with the image editor's tools; each
  annotation has its own time on the timeline (drag, right-click menu, Delete key), several
  entry / exit animations (fade, slide from any side, zoom, …), effects and movement over time —
  all burned into exports.
- Privacy regions (blur / pixelate / mask) over a time range.
- Export / convert to MP4 or WebM at 240p–4K, with or without audio; open your own video files.

### Flow Capture
- Pictures of each step while you click through a task, optionally with written steps; works while
  recording video too. Passwords and sensitive fields are always masked.
- Flow Editor: edit, reorder and describe; export PDF, HTML, ZIP, JSON or separate files.

### Privacy and security
- Everything stays on your computer. No server, analytics or advertising; no remote code.
- Website access is never required. It is asked for only when needed for something you start —
  following you across sites during a Flow Capture, or reading a picture from a web address you
  type — and can be declined.

### Known limitations
- Chrome doesn't allow capturing `chrome://` pages, the Chrome Web Store or the built-in PDF viewer
  as a tab; use *Entire Screen & App Window* for those.
- Desktop and window capture always go through Chrome's own picker.
- System audio: Windows and ChromeOS only (macOS records tab audio only).
- The mouse pointer is only known inside web pages, so cursor-following zoom works in tab
  recordings; desktop recordings zoom where you click or on an area you pick.
- Opening Pixora's popup automatically for full-page progress needs Chrome 127 or newer; on older
  versions click the toolbar icon (the badge shows the percentage).
- Browsers can't copy video files to the clipboard.
