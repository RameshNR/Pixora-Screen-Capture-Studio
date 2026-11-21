import { expect, test } from './fixtures';

test('the right-click menu is there on install, with Pixora and its items', async ({ extPage }) => {
  // update() only succeeds for menu items that exist.
  const result = await extPage.evaluate(async () => {
    const ids = ['pixora', 'edit-image', 'capture-visible', 'capture-full', 'capture-area', 'capture-delay', 'capture-ocr', 'capture-desktop', 'record-tab', 'record-area', 'record-desktop', 'record-camera', 'open-editor', 'open-collage', 'open-history', 'open-settings'];
    const out: Record<string, boolean> = {};
    for (const id of ids) {
      out[id] = await chrome.contextMenus.update(id, {}).then(() => true, () => false);
    }
    out['not-ours'] = await chrome.contextMenus.update('not-ours', {}).then(() => true, () => false);
    return out;
  });
  for (const [id, ok] of Object.entries(result)) expect(ok, id).toBe(id !== 'not-ours');
});


test('Annotate an image: open a picture from a web address (also handed over by the right-click menu)', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1300, height: 850 });
  const url = await (async () => {
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    return editor.evaluate(async () => {
      const c = new OffscreenCanvas(150, 90);
      const x = c.getContext('2d')!;
      x.fillStyle = '#10b981';
      x.fillRect(0, 0, 150, 90);
      const b = await c.convertToBlob({ type: 'image/png' });
      return new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(b); });
    });
  })();
  const field = editor.getByRole('textbox', { name: 'Picture web address' });
  await expect(field).toBeVisible();
  // A bad address says why.
  await field.fill('javascript:alert(1)');
  await editor.getByRole('button', { name: 'Open from URL' }).click();
  await expect(editor.getByRole('alert')).toHaveText(/Only http and https/);
  // A picture opens in the editor.
  await field.fill(url);
  await editor.getByRole('button', { name: 'Open from URL' }).click();
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();

  // The right-click menu's "Annotate this image" fills the address in.
  const page2 = await context.newPage();
  await page2.goto(`chrome-extension://${extensionId}/editor.html?import=1&url=${encodeURIComponent('https://example.com/cat.png')}`);
  await expect(page2.getByRole('textbox', { name: 'Picture web address' })).toHaveValue('https://example.com/cat.png');
});
