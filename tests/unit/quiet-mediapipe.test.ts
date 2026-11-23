import { describe, expect, it } from 'vitest';
import { isMediapipeNote } from '@/shared/utils/quiet-mediapipe';

describe('MediaPipe start-up notes', () => {
  it('are recognised (also "OpenGL error checking is disabled", which is only a note)', () => {
    expect(isMediapipeNote('W1122 10:42:06.734000 1922656 gl_context.cc:1072] OpenGL error checking is disabled')).toBe(true);
    expect(isMediapipeNote('W1122 03:07:09.925000 1922656 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.')).toBe(true);
    expect(isMediapipeNote('INFO: Created TensorFlow Lite XNNPACK delegate for CPU.')).toBe(true);
  });
  it('real errors are not hidden', () => {
    expect(isMediapipeNote('E1122 10:42:06.734000 1922656 graph.cc:12] Failed to load model')).toBe(false);
    expect(isMediapipeNote('TypeError: x is undefined')).toBe(false);
    expect(isMediapipeNote(new Error('boom'))).toBe(false);
  });
});
