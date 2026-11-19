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

**Additional fields:**

| Field | Value |
| --- | --- |
| Official URL | empty (needs a site verified in Google Search Console; optional) |
| Homepage URL | https://rameshnr.github.io/Pixora-Screen-Capture-Studio/ |
| Support URL | https://github.com/RameshNR/Pixora-Screen-Capture-Studio/issues |
| Mature content | off |
| Item support | optional — on adds a Support tab to the listing (answer in the dashboard) |

**Description:**

> Pixora is a complete screen capture studio that works entirely on your computer — no account, no
> uploads, no tracking.
>
> NEW IN 1.1
> • Themes for every window: 9 dark and 9 light themes, easy on the eyes (or match your computer)
> • Optional real browser header — tabs, address bar and bookmarks — in your screenshots
> • Turn frames of a recording into a step-by-step guide
> • Full pages open in the editor straight away; exports show their progress
> • Video editor: undo, redo, history and reset; annotations keep their size at any export resolution
> • Lock annotations, cut a highlight with a shape, move callout text and numbers anywhere
>
> SCREENSHOTS
> • Visible part, full page, selected area, delayed, or your whole screen / an app window
> • Full pages of any length: sticky headers handled, panels that scroll on their own included, very long pages saved as several full-resolution images — with progress and Stop in the popup
> • Optionally include the browser's tabs, address bar and bookmarks bar
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
> • Trim, chapters, frame grabs, and a step-by-step guide made from frames you pick
> • Annotate the video with timed drawings, text and callouts — with animations and effects
> • Privacy regions to blur or hide parts of the video
>
> FLOW CAPTURE
> • Click through a task and Pixora captures each step — also while recording video
> • Edit the guide and export PDF, Word, HTML or ZIP
> • Passwords and sensitive fields are always masked
>
> THEMES
> • 9 dark and 9 light themes for the popup, editors and settings — or follow your computer's light / dark mode
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
`screenshot-5-themes`. (`screenshot-6-collage` is kept as a spare — swap it in if you prefer.)

The originals are taken from the real extension on a made-up demo page ("Northwind Travel Desk"),
so they show no real website, account or browser profile; the same pictures are on the website
(`docs/images/`).

Originals:

| File | Size | Required | What it should show |
| --- | --- | --- | --- |
| `store-assets/icon-128.png` | 128×128 | yes | Copy of `public/icons/icon-128.png` |
| `store-assets/screenshot-1-capture.png` | 1280×800 | yes (at least 1) | A web page with Pixora's popup open (Screenshot tab) |
| `store-assets/screenshot-2-editor.png` | 1280×800 | recommended | Screenshot editor with arrows, a callout, numbered steps and a blur |
| `store-assets/screenshot-3-recording.png` | 1280×800 | recommended | Video editor: timeline with annotation tracks, Annotate rail |
| `store-assets/screenshot-4-flow.png` | 1280×800 | recommended | Flow Editor with several steps |
| `store-assets/screenshot-5-themes.png` | 1280×800 | recommended | Settings › General › Theme (Dark / System / Light, theme cards) |
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
| `desktopCapture` | Show Chrome's screen / window picker when the user records or screenshots the desktop or a window, or (optional setting) adds the real browser header — tabs, address bar, bookmarks — to a screenshot. |
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

**Data usage** — Google requires disclosing data an extension *handles*, even when it is only
processed and stored on the user's device ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq):
“Extensions are required to disclose how they handle user data, even when data is processed or
stored locally on a user's device”; screenshots are its own example). Tick:

- ☑ **Website content** — screenshots, recordings, recognised text
- ☑ **User activity** — Flow Capture clicks / steps; clicks and mouse position for click effects and zoom while recording
- ☑ **Web history** — the page address, title and time stored with each capture and Flow Capture step

Leave unticked: personally identifiable information, health, financial and payment, authentication
(passwords are masked and never stored), personal communications, location.

Then certify all three statements (not sold or transferred, not used for unrelated purposes, not used
for creditworthiness). The privacy policy describes the same three kinds of data, kept on the device.

**Privacy policy URL:** https://rameshnr.github.io/Pixora-Screen-Capture-Studio/privacy/

(GitHub Pages publishes the repository's `docs/` folder from `main`; `docs/PRIVACY.md` sets that
address with `permalink: /privacy/`. Edits pushed to `main` go live within a few minutes. The store
requires a URL even when no data is collected.)

## 4. Updating to a new version

Package → **Upload new package** with the new `release/pixora-<version>.zip`, then check each tab:

- **Store listing** — description (section 2), screenshots if the look changed, and "What's new" text
  from [RELEASE_NOTES.md](RELEASE_NOTES.md) (the store has no separate field: put a short
  "New in x.y" block at the top of the description, as above).
- **Privacy practices** — only if permissions, data handling or a justification changed: compare
  `git diff <last published tag or commit> -- public/manifest.json docs/STORE.md`.
- **Privacy policy** — date current and covers any new kind of data (`docs/PRIVACY.md`, live on
  GitHub Pages).
- Submit for review. The listing keeps showing the old version until the new one is approved.

### 1.1.1 (over the published 1.0.0)

1.1.0 was never published (its submission was cancelled), so 1.1.1 carries everything since 1.0.0:

- Permissions: **unchanged** (only `version` changed in the manifest).
- `desktopCapture` justification: **use the text in section 3** (it covers the optional browser header).
- Data usage: unchanged. Privacy policy: updated 18 November 2026.
- Description: section 2 text, with the "NEW IN 1.1" block.
- Screenshots: the five in `store-assets/upload/` (screenshot-1 … screenshot-5).
- Upload `release/pixora-1.1.1.zip`; if a submission is still pending, cancel it first.

### 1.1.0 (over 1.0.0)

- Permissions: **unchanged** (only `version` changed in the manifest), so users are not asked to
  approve anything new.
- `desktopCapture` justification: **changed** — it now also covers the optional browser header
  (use the text in section 3).
- Data usage: unchanged (the browser header is website content / web history kept on the device).
- Privacy policy: updated 18 November 2026 (browser header, theme setting).
- Description: new "NEW IN 1.1", browser header, themes and Flow-from-video lines.
- Screenshots: all five replaced (new look; themes).

## 5. Account and distribution

- **Contact email** (Account tab): must be verified before publishing; it is shown as the support contact.
- **Visibility:** Public (or Unlisted for a first test). **Regions:** all. **Price:** free.
- Review usually takes a few days; `desktopCapture`, `tabCapture` and the optional `<all_urls>` can
  trigger a closer review, which the justifications above answer.
