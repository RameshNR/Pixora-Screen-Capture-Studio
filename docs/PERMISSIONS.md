# Permissions

Pixora requires **no host permissions**. Page access comes from `activeTab`, which Chrome grants
for the current tab when you click the toolbar icon or press a Pixora keyboard shortcut (optional
site access is described below).

| Permission | Used for |
| --- | --- |
| `activeTab` | Capturing the visible tab, and injecting the overlay/full-page helpers into the tab you invoked Pixora on |
| `scripting` | Injecting the area selector, countdown, click effects, cursor tracking, live drawing and full-page scroll helpers, only after a user action |
| `tabCapture` | Recording "This Tab" and "Custom (This Tab)" |
| `desktopCapture` | Chrome's screen / window / tab picker for desktop recording, "Entire Screen & App Window" screenshots and the optional real browser header (tabs, address bar, bookmarks) on screenshots |
| `system.display` | Reads each monitor's work area so "without taskbar" screenshots and recordings can leave out the taskbar / dock, and places Pixora's small windows (countdown, optional control bar) on screen (no user-visible warning) |
| `offscreen` | A hidden document that runs MediaRecorder for tab recordings (service workers can't) and creates download URLs |
| `storage` | Settings, editor preferences and recording state |
| `unlimitedStorage` | Long or 4K recordings and large screenshots in IndexedDB without hitting the default quota |
| `downloads` | Saving files (with sub-folder and "Save as") and "Show in folder" |
| `notifications` | Capture saved / errors / scheduled-recording prompts (can be turned off in Settings) |
| `alarms` | Scheduled recordings and periodic retention clean-up |
| `clipboardWrite` | Copying screenshots and extracted text |
| `contextMenus` | The *Pixora* entry in the right-click menu of web pages (captures, recordings, Pixora's pages, *Annotate this image* on a picture). No permission warning; it reads nothing from the page (only a right-clicked picture's address, to fill it in for the editor). |

**Optional:** `<all_urls>` (`optional_host_permissions`) is never required. Parts of it are requested
only for something you start:

- **Flow Capture** asks for all sites, so a flow can follow you to other pages and sites (re-attach the
  tracker after page loads and capture those tabs). Declining keeps Flow Capture working on the
  starting site only.
- **Recording with click highlights** (or key combinations, cursor halo, styled cursor) asks for all
  sites, so the highlights come back on each page you open while recording (and in the tab you switch
  to during a screen or window recording, including embedded frames). Declining keeps them on the
  first page only. Clicks are only drawn on the page; nothing is stored or sent.
- **Add image › From a web address** asks for that one site (`https://example.com/*`), so Pixora can
  read the picture you named. The request is sent without cookies; declining just cancels that image.

Camera and microphone are **not** manifest permissions. They are web permissions for the extension's
origin, granted once on `permissions.html`, because Chrome can't show the prompt inside a popup or
offscreen document.

## Content Security Policy

`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. `wasm-unsafe-eval` is required to
instantiate the bundled Tesseract OCR WebAssembly. No remote code is loaded and there is no `eval`.
Everything, including the OCR engine and language model, ships inside the package.

## Data handling

- Screenshots and recordings stay in the extension's IndexedDB until you delete them, or until retention removes them.
- Nothing is uploaded. There are no analytics or trackers, and Pixora makes no network requests of its own; the only one is downloading a picture from a web address you type in *Add image*.
- Cursor positions from a recorded tab go only to Pixora's own recording host, only while that tab is recorded.
- Sensitive-text detection runs the bundled OCR on this device; nothing is hidden without confirmation.
- Keyboard highlights show only shortcut combinations (Ctrl/Alt/⌘ + key) and navigation keys. They never show typed text, and nothing is shown in password fields.
- "Save to a folder" (Settings › Storage) uses the browser's folder picker (File System Access). It is not a manifest permission: you pick the folder, Chrome asks you to allow access, and you can remove it in Settings at any time.

See also [PRIVACY.md](PRIVACY.md) (privacy policy for the store) and [STORE.md](STORE.md) (submission sheet and permission justifications).
