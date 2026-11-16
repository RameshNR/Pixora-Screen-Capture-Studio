# Chrome Web Store submission sheet

Everything the Developer Dashboard asks for, ready to paste. Re-check after any change to the
manifest's permissions.

## 1. Build the upload

```
npm run package
```

Builds `dist/`, runs the release check (`scripts/verify-package.mjs`: no remote code, no `eval` in our
bundles, every manifest file present, no required host access, description ≤ 132 characters) and
writes **`release/pixora-<version>.zip`** with `manifest.json` at its root. Upload that zip.

Before every submission:

- [ ] `npm test` and `npx playwright test --workers=1` pass
- [ ] `version` in `public/manifest.json` (and `package.json`) is higher than the published one
- [ ] Load `dist/` unpacked in a **clean Chrome profile** and go through the manual checklist in
      [DEVELOPMENT.md](DEVELOPMENT.md#manual-test-checklist-real-chrome) — at least: visible / full-page /
      area screenshot, Entire Screen, tab recording, desktop recording, editor export, video export, Flow Capture
- [ ] `docs/PRIVACY.md` is published at the URL entered below, and its date is current
- [ ] [RELEASE_NOTES.md](RELEASE_NOTES.md) describes this version

## 2. Store listing

**Name:** Pixora – Screen Capture Studio

**Summary (≤ 132 characters, = manifest `description`):** Capture visible, full-page or selected-area screenshots, annotate them, and record your tab, desktop or camera in up to 4K.

**Category:** Productivity (Tools also fits) · **Language:** English

**Description:**

> Pixora is a complete screen capture studio that works entirely on your computer — no account, no
> uploads, no tracking.
>
> SCREENSHOTS
> • Visible part, full page, selected area, delayed, or your whole screen / an app window
> • Full pages of any length: sticky headers handled, panels that scroll on their own included, very long pages saved as several full-resolution images — with progress and Stop in the popup
> • On-device text recognition (OCR) and sensitive-information detection
>
> IMAGE EDITOR
> • Arrows (60+ styles), shapes, text, callouts, highlighter, pen, numbered steps, stickers, cursors, blur / pixelate / mask, watermark
> • Crop, rotate, resize, Cut out & join, browser and device frames, backgrounds
> • Work on several images: add from a file, the clipboard or a web address, Compare before / after, make a Collage
> • Export PNG, JPEG, WebP, PDF or Word; copy to the clipboard; save to any folder
>
> SCREEN RECORDING
> • Record a tab, a custom area, your desktop or a window, or your camera — up to 4K, MP4 or WebM
> • Microphone and tab / system audio, camera bubble, countdown, pause / resume
> • Live tools: zoom, highlight, spotlight, draw on the screen, chapter markers, teleprompter
>
> VIDEO EDITOR
> • Trim, chapters, frame grabs
> • Annotate the video with timed drawings, text and callouts — with animations and effects
> • Privacy regions to blur or hide parts of the video
>
> FLOW CAPTURE
> • Click through a task and Pixora captures each step — also while recording video
> • Edit the guide and export PDF, HTML or ZIP
> • Passwords and sensitive fields are always masked
>
> PRIVATE BY DESIGN
> Your screenshots and recordings never leave your device unless you save or share them yourself.

### Images to upload (not in the release zip)

The originals are in `store-assets/`. The store needs exact sizes and no transparency, so upload the
copies in **`store-assets/upload/`**, made by `python scripts/store-images.py` (needs Pillow; it scales
screenshots onto a 1280×800 background, scales the promo tiles, removes transparency and also writes
the README pictures in `docs/images/`). Re-run it after replacing an original.

**Upload these 5 screenshots, in this order** (the store allows at most 5):
`screenshot-1-capture`, `screenshot-2-editor`, `screenshot-3-recording`, `screenshot-4-flow`,
`screenshot-6-collage`. (`screenshot-5-fullpage` is kept as a spare.)

Originals:

| File | Size | Required | What it should show |
| --- | --- | --- | --- |
| `store-assets/icon-128.png` | 128×128 | yes | Copy of `public/icons/icon-128.png` |
| `store-assets/screenshot-1-capture.png` | 1280×800 | yes (at least 1) | A web page with Pixora's popup open (Screenshot tab) |
| `store-assets/screenshot-2-editor.png` | 1280×800 | recommended | Screenshot editor with arrows, a callout, numbered steps and a blur |
| `store-assets/screenshot-3-recording.png` | 1280×800 | recommended | Video editor: timeline with annotation tracks, Annotate rail |
| `store-assets/screenshot-4-flow.png` | 1280×800 | recommended | Flow Editor with several steps |
| `store-assets/screenshot-5-fullpage.png` | 1280×800 | spare | A long full-page capture in the editor |
| `store-assets/screenshot-6-collage.png` | 1280×800 | recommended | Collage of several captures |
| `store-assets/promo-small.png` | 440×280 | yes | Logo, name and a short line, e.g. “Capture · Annotate · Record” |
| `store-assets/promo-marquee.png` | 1400×560 | optional | Wide banner (used if the store features the item) |

Screenshots must be PNG or JPEG, exactly 1280×800 (or 640×400), no transparency, and show the real
product. Don't put personal data (emails, names, accounts) in them.

## 3. Privacy practices tab

**Single purpose:**

> Pixora captures the user's screen — screenshots and video recordings of the current tab, a window or
> the desktop — and lets the user annotate, edit and save those captures locally.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `activeTab` | Capture the tab the user invoked Pixora on (toolbar button or shortcut) and add the capture helpers to it. |
| `scripting` | After a user action, inject the area selector, countdown, full-page scrolling helper, click / key highlights, live drawing and Flow Capture step tracker into that tab. |
| `tabCapture` | Record the current tab's video and audio when the user chooses "This tab". |
| `desktopCapture` | Show Chrome's screen / window picker when the user records or screenshots the desktop or a window. |
| `system.display` | Read monitor work areas so captures can leave out the taskbar and Pixora's windows are placed on screen. |
| `offscreen` | Run MediaRecorder and video processing in an offscreen document (a service worker cannot record). |
| `storage` | Save settings and the current recording / capture state. |
| `unlimitedStorage` | Keep long or 4K recordings and large screenshots in the extension's local storage. |
| `downloads` | Save screenshots and recordings as files, with "Save as" and "Show in folder". |
| `notifications` | Tell the user a capture was saved or failed, and prompt for scheduled recordings (can be turned off). |
| `alarms` | Start scheduled recordings and run the automatic clean-up of old captures. |
| `clipboardWrite` | Copy screenshots and recognised text to the clipboard when the user clicks Copy. |
| Optional host access `<all_urls>` | Never required. Asked only for something the user starts: (1) a Flow Capture that follows the user to other pages and sites; (2) "Add image › From a web address" — access to that one site only, to read the picture the user asked for. Declining keeps everything else working. |

**Remote code:** No, I am not using remote code. (All code, the OCR engine and its language data
are in the package. `wasm-unsafe-eval` is only for the bundled OCR WebAssembly.)

**Data usage** — tick **none** of the data types. Pixora does not collect or transmit any user data
to the developer or anyone else; captures, recordings and Flow Capture steps are created at the
user's request and stored only on the user's device. (A picture the user asks to add from a web
address is downloaded from that address to the device; nothing is sent.) Then certify all three
statements (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://rameshnr.github.io/Pixora-Screen-Capture-Studio/privacy/

(GitHub Pages publishes the repository's `docs/` folder from `main`; `docs/PRIVACY.md` sets that
address with `permalink: /privacy/`. Edits pushed to `main` go live within a few minutes. The store
requires a URL even when no data is collected.)

## 4. Account and distribution

- **Contact email** (Account tab): must be verified before publishing; it is shown as the support contact.
- **Visibility:** Public (or Unlisted for a first test). **Regions:** all. **Price:** free.
- Review usually takes a few days; `desktopCapture`, `tabCapture` and the optional `<all_urls>` can
  trigger a closer review, which the justifications above answer.
