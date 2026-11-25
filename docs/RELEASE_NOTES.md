# Pixora – Release notes

## 1.1.6 — line designs, editable drawings after reload, copy between images (November 2026)

### New
- **Line designs**: zigzag, wavy, scalloped, curly and spiral lines, each shown as a picture in the Design list.
- **Several lines at once**: draw 1–20 lines side by side with an adjustable gap.
- **More line and border styles**: dash-dot, dash-dot-dot, long dash and loose / dense dotted, dashed and dash-dot variants, besides solid, dashed and dotted.
- **Type any pixel value**: every pixel slider has a box to type the exact size (also beyond the slider's range).
- **Copy & paste between images**: copy one or more annotations and paste them on another image (or in another Pixora tab); they land in the same place.
- **Adding images opens the Flow Editor**: images added in the screenshot editor carry on there, with steps and descriptions.

### Improved
- Lines, arrows and shapes start at 10 px.
- Drawings are kept as you make them: after a reload (or closing the tab) they come back still editable; one Undo removes them.
- Shape opacity makes the shape see-through (it used to darken it with the Glass, Shadow and Glow finishes); Gradient and Glass now also show on shapes without a fill.
- A page that runs into an error shows what happened and a Reload button instead of an empty white window.

## 1.1.5 — filters, erase & remove, compare, flows from images (November 2026)

### New
- **Filters**: presets, adjustments and effects, with Before / After on the picture.
- **Erase & remove**: erase annotations or part of the image, remove an object (click it, brush or box) or the background (transparent, white, a colour, a picture or blur), all on this device.
- **Compare bar under the picture**: Before / After (slider, side by side, overlay), Show Original / Edited / Both, Highlight changes, Sync zoom / scroll, a loupe, zoom sizes, Fit and Full screen — with the other open images in a strip in full screen.
- **Add from Recent captures**: add screenshots and flow images (several at once) to the editor; adding several images at once keeps them together as a flow.
- **Recent captures**: open several selected images together in the editor, *Make flow* from selected images and flows, or drag an image or flow onto another to put them in one flow.
- **Groups in Recent captures**: *New group*, name it, and drag screenshots, flows and videos into it; open a group, drag a capture onto *All captures* to take it out, rename or ungroup it. Videos can't go into a flow — Pixora says so if you try.
- **Image details**: the Info button (or ↓ in full screen) shows the file, size, ratio, a colour histogram, brightness / contrast / saturation and the main colours — click a colour to copy it. Docked beside the picture or as a popup (View settings).
- **Full screen**: ← / → move between the open images, with the image count and arrows always shown.
- **Export › Original**: download a picture as it came (same format and size, no re-encoding when nothing changed). Flow export can keep the images' original names, numbered or not.
- **Loading indicator**: anything that takes a moment (opening, adding, copying, exporting) shows a small busy pill.

### Improved
- Copy image, switching images and adding images are faster; full screen no longer flickers when switching images; the bar under the picture adapts to narrow windows.
- **Video export** redesigned like the flow export: Format, Range, Size and frame rate, Quality, Audio and Include as cards, with a summary of the output.
- **Flow export** redesigned; the ZIP holds only your images (no JSON file).
- Picking a drawing tool turns Before / After off; Before / After is offered only once the picture has changed.
- Dragging in Recent captures: a clear drag picture with the count, a drop guide and smoother animations.
- **Callouts**: Shift + drag on a corner keeps the callout square at the larger side; making a callout narrower wraps its text and grows it taller (long words break too).

### Fixed
- Recording a tab or window that goes full screen keeps the recording's size (the new size is fitted inside, not cut off), and a tab recording no longer stops when the page goes full screen.
- Pictures keep their own name and format: a JPEG downloaded unchanged stays a .jpeg of the same size (a 6 MB photo used to become ~40 MB as PNG), and export names no longer double the ending ("photo.jpeg.png").
- Flow names no longer show a stale image count ("Flow · 2 images" with 15 inside); flows are named by date.
- After downloading and then undoing, Compare no longer shows a difference that isn't there.

## 1.1.3 — right-click menu, Mac keyboard, blur / pixelate / mask redesigned (November 2026)

### New
- **Right-click menu**: right-click any web page › *Pixora – Screen Capture Studio* to capture the visible part, the full page, a selected area, after a delay, with text, or a screen / app window; to record this tab, an area, a screen or window, or the camera; or to open the image editor, a collage, Recent captures and Settings.
- **Better on a Mac**: every shortcut is shown the Mac way (⌘Z, ⇧⌘Z, ⌥⇧V), ⇧⌘Z redoes everywhere, ⌘⌫ deletes in the editor, keys shown in recordings read ⌘⇧ and Option letters correctly, and the popup shows the shortcuts actually set in Chrome.
- **Screen & app window screenshots** count down on Pixora's toolbar icon (like *Visible Part after Delay*) instead of a separate countdown window, with *Getting ready…* (page and icon) from the moment you pick the screen or window until the countdown starts.
- **Annotate an image from a web address**: paste a picture's address on the *Annotate an image* screen (or paste it with Ctrl+V); right-click a picture on a website › Pixora › *Annotate this image* fills it in. Chrome asks once to read from that site.
- Right-click › Pixora › *Settings* opens the General settings (Recent captures has its own item).
- **Mark an area with the Select tool**: in the image editor, drag on the picture with *Select & move* to mark an area, then copy it (Ctrl+C, paste it back with Ctrl+V as a picture you can move), cut it (Ctrl+X), delete it (Delete — the area becomes white) or crop to it (Enter). Esc or a click clears it. Moving around the picture is the hand tool, Space + drag or the mouse wheel.
- **Marked area › Duplicate** (Ctrl+D): a copy of the marked part is placed just beside it, straight away, as a picture you can move, resize or delete. After Paste or Duplicate only the new copy is selected.
- **Erase image** (toolbar, key I): a brush that erases the screenshot itself — painted white, or see-through in PNG downloads — while annotations stay. The Eraser still removes annotations only. Each eraser has its own icon.
- **Number fields with − and + buttons** in Resize image, Crop and Cut out & join (Shift+click steps by 10; hold to keep counting).
- Countdowns on the toolbar icon (delayed and screen / window screenshots, and before a recording, now with the seconds) use the recording red.
- **Blur, Pixelate and Solid mask: Apply to** — three tiles: *This area*, *Outside area* (the area stays clear) or *Whole image* (*Whole video* in the video editor), with a line saying what it does. Works with every design, and with nothing selected *Whole image* adds one covering the picture. Masks can now cover everything except the area too.
- **Filters** (key Y): 10 looks (Vintage, Cinematic, Warm, Cool, Dramatic, Portrait, Vivid, Noir, Retro…) with an intensity slider, 9 adjustments (brightness, contrast, saturation, exposure, temperature, tint, highlights, shadows, sharpness) and 5 effects (blur, vignette, grain, fade, sharpen), each with its own reset; Before / After. Never changes the original — change or undo any of it later.
- **Smart eraser**: Erase image › *Background* rebuilds what you paint over from the picture around it (sand stays sand, a wall’s pattern carries on), with hardness, feather, fill strength and *Preserve surrounding details*.
- **Remove object** (key Q): click what to remove — on screenshots a click picks exactly a button, badge, arrow or a word / line of text; on photos the AI finds the object — or brush / box it. Several things at once; they disappear into matching background. Marked areas get *Remove content* too.
- **Remove background** (key J): finds the subject, keeps fine edges, and puts it on a see-through, white, colour, picture or blurred background; Restore / Remove brushes and edge refinement. All AI runs on your computer.
- **Ctrl+drag** draws straight with Erase image, Remove object and the Remove background brushes (Shift: 45° steps).

- **One Erase & remove button** in the image editor: choose Annotation, Image, Object or Background in the panel (keys E, I, Q, J still work).
- **Unmark** brush in Remove object; **Ctrl+Z / Ctrl+Y** step through what you selected before touching the picture.

- **Video editor**: Delete, Cut and Crop on a marked area become annotations — *Deleted area*, *Cut area*, *Crop* — on the Annotations timeline, timed like any other.
- **Right-click** an annotation for **Cut** and **Crop to this object**; right-click a marked area for its own actions.

- **Filters, redesigned**: Presets / Adjust / Effects tabs, 16 looks with live previews, sliders with value boxes, new Noise and Glow, one-click effect tiles, and a **Before / After** divider on the picture itself.

### Fixed
- Big photos (20 MP and more) no longer freeze the editor when removing objects or backgrounds; progress is shown; photo backgrounds come off without a coloured halo; the brush circle no longer shows outside the picture.
- Removing things from screenshots continues the page's colours and edges instead of copying nearby text into the hole; no "willReadFrequently" warning on the Errors page.
- Remove object selects a whole product photo in a page (its coloured edges and the white parts inside too) and leaves nothing behind; erasing on a plain background fills with exactly that colour; Remove background keeps page header bars; the Undo / Redo buttons and History cover selection steps.
- Remove object's AI click no longer marks stray bits elsewhere on the page; Remove background on screenshots keeps edges sharp with no tint of the old background; clicks outside the picture do nothing.
- Settings › *Mouse cursor between clicks*: the Cursor and Both options no longer stretch across the whole card.
- **Camera preview matches the recording**: the bubble has the same size and the same small gap from every edge as in the video (bottom-left no longer touched the bottom with a gap on the left). Drag the bubble in the preview to place it anywhere. The camera settings keep one width whatever background is chosen.
- The camera background no longer leaves "OpenGL error checking is disabled" on the extension's Errors page.
- Popup: the selected Screenshot / Record tab is rounded only on its inner corner.
- Extracting text no longer leaves an "Estimating resolution as …" entry on the extension's Errors page.
- Blur / Pixelate / Solid mask designs no longer pile up: a design replaces only its own part of the look (style, shape, colour treatment, border or colour), so e.g. *Zoom blur* after *Depth blur* blurs only the area, and *Cloud* after *Text redaction* really shows a cloud. The design in use is highlighted.
- Design names and the *Place the mask* buttons are no longer cut off.
- **In use**: the parts of the look in use (style, shape, colour, border…) are listed above the designs, each removed with one click (e.g. take a border off without looking for it).
- Designs that can't work where the effect applies are greyed out with the reason (fades and frosted glass outside the area; text lines, face, card… for a mask outside the area); so are the matching settings under Adjust.
- *Circle* makes the area round and *Square* square (and their pictures show it); *Oval* makes it longer — they are no longer the same.
- Outside area with *Depth blur*, *Bokeh blur* or *Lens blur* no longer blurs the area too.
- Shift while drawing or resizing a box makes a square up to the pointer, instead of jumping bigger than the drag.
- *Move the mask to* Top / Centre / Bottom only moves the mask; its size stays.
- Choosing *Outside area* takes off looks that can't show there (a face, text lines, a fade, frosted glass) instead of leaving them stuck.
- A design adds to the shape in use: e.g. text lines or a face inside a cloud or wave.
- **Border and corners moved to Adjust** (no longer mixed into the designs): border style (none, solid, dashed, dotted, glow), any colour, thickness; corner radius; and opacity for blur and pixelate (a mask's opacity is its colour's). Designs never add or change a border.
- The small × buttons sit in the middle of their circles (other icon buttons are unchanged).
- **Camera and microphone settings** open as a page of the popup (Back / Done), like Flow Capture, instead of a panel that did not fit. The same camera settings (live preview, device, resolution, shape, position, size, opacity, border, mirror) and a microphone test (live level, record and play back) are in **Settings › Recording**.
- **Camera background**: blur it, remove it (only you in the camera bubble, the screen shows around you), or replace it with a colour, a ready-made picture or your own picture. Runs on this computer (bundled MediaPipe selfie segmenter); the camera picture never leaves it. In the popup's camera page and Settings › Recording, with a live preview.
- Tooltips stay inside the window; a tooltip wider than its button starts where the button starts (left) or ends where it ends (right). Tooltips in the right column (Camera Only, Custom Area) are no longer squeezed into narrow lines.
- Undoing a crop (or rotate / resize), redoing it or *Reset to original* shows the whole picture fitted to the screen again, instead of the full picture at the cropped zoom.
- After copying or cutting a marked area, right-click › *Paste* is available (and Ctrl+V puts the part back next to where it was).
- *Take screenshot & extract text* extracts the text once, when you take it; opening that capture again from Recent captures (or reloading) no longer runs text extraction again.
- Editor toolbar: a button no longer looks selected (a clipped blue ring) after its dialog closes; keyboard focus shows a ring in the theme colour inside the button.
- **Lighter while recording**: click effects no longer switch off for the rest of a recording when Chrome misses one status check; embedded frames no longer poll; page-wide click effects are drawn at 1×; the camera background works at the size the camera is shown and finds the person about 15 times a second; Flow Capture step screenshots taken during a recording are saved as JPEG (much quicker than PNG).
- *Mouse cursor between clicks › Cursor* uses the cursor design, size and colours from Highlight mouse clicks (no second set of controls).
- **Mouse cursor between clicks**: the separate *Cursor highlight* and *Styled cursor* switches are one setting — Off, Halo, Cursor (drawn into tab recordings, which never include the real cursor) or Both — in the popup and in Settings, next to Highlight mouse clicks.
- Sliders move smoothly while dragged (e.g. Effect size, Effect opacity and Animation duration in Highlight mouse clicks).
- **Blur, Pixelate and Solid mask designs, one part at a time**: instead of mixed design categories, the look is picked in separate parts — Blur: Effect, Strength, Shape, Edges, Colour, Glass; Pixelate: Pattern, Block size, Blocks, Shape, Edges, Colour; Mask: Colour, Shape, Inside the mask. Each part shows its choice in its header, exactly one choice is selected, and a choice never changes another part. Strength, opacity, corners and border are fine-tuned under Adjust.

## 1.1.2 — click highlights, cursor animations and a taller video (November 2026)

### New
- **Highlight mouse clicks, redesigned** (Settings › Recording): a live preview with *Try it*, and cards for Click effect, Quick looks, Effect settings, Click colours, Cursor design and other options — in two columns.
- **Real animations for every click effect**: Click ring, Ripple, Glow, Halo, Burst, Spotlight, Target, Click rays, Pulse and Emphasis each move in their own way, smoothly, with richer colours.
- **Show the cursor with each click**: any of the image editor's cursor designs, its size and colours, a motion (Trail, Dotted trail, Ghost, Bounce, Wavy, Loading, Signal) and the mouse button pressed — left, right or double click.
- **Quick looks** set the cursor, motion and effect in one click, and the one in use is highlighted.
- **Click highlights on every page** you visit while recording, also after a link opens a new page and in the tab you switch to during a screen or window recording.
- **Image editor Cursor tool**: the same quick looks, designs, effects and motions as the recording settings, an animated preview with its duration, and *In videos* — still, play once or repeat (played and exported by the video editor).
- **Taller video in the video editor**: drag the bar under the video to make it bigger for drawing and marking.

### Fixed
- Click effects no longer go missing on busy or slowly loading pages, on pages that re-draw themselves, or inside embedded frames.
- Settings changed quickly one after another are all kept.

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
