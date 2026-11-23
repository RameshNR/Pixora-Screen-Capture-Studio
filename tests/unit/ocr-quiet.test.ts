import { describe, expect, it, vi } from 'vitest';
import { quietOcr } from '@/screenshot/services/ocr-service';

describe('quietOcr', () => {
  it('sends Tesseract notes ("Estimating resolution as …") nowhere, without fixing a DPI', async () => {
    const setParameters = vi.fn(async () => ({}));
    await quietOcr({ setParameters });
    expect(setParameters).toHaveBeenCalledWith({ debug_file: '/dev/null' });
    // A fixed DPI would change the text read; Tesseract's own estimate is kept.
    expect(setParameters.mock.calls[0]).not.toContainEqual(expect.objectContaining({ user_defined_dpi: expect.anything() }));
  });

  it('never fails the OCR if the parameter cannot be set', async () => {
    await expect(quietOcr({ setParameters: async () => { throw new Error('no'); } })).resolves.toBeUndefined();
  });
});
