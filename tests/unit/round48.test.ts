import { describe, expect, it } from 'vitest';
import { planEncoding, type EncodingAnswer } from '@/recording/services/codec-service';

const all = () => true;
/** A graphics card that hardware-encodes H.264 up to `maxW` wide (VP9 only in software). */
const gpu = (maxW: number) => async (q: { contentType: string; width: number }): Promise<EncodingAnswer> => ({
  supported: true,
  smooth: true,
  powerEfficient: q.contentType.includes('avc1') && q.width <= maxW,
});
const opts = { container: 'mp4' as const, videoPref: 'auto' as const, fps: 30, bitrateKbps: 0, mayShrink: true };
const screen4k = { width: 3840, height: 2160 };

describe('recording: a format the graphics card can encode (the computer stays responsive)', () => {
  it('full size when it is hardware-encoded', async () => {
    expect(await planEncoding(screen4k, opts, all, gpu(4096))).toEqual({ size: screen4k, videoCodec: 'h264', efficient: true });
  });
  it('resolution "Original": a smaller size when only that is hardware-encoded (1440p, then 1080p)', async () => {
    expect(await planEncoding(screen4k, opts, all, gpu(2560))).toEqual({ size: { width: 2560, height: 1440 }, videoCodec: 'h264', efficient: true });
    expect(await planEncoding(screen4k, opts, all, gpu(1920))).toEqual({ size: { width: 1920, height: 1080 }, videoCodec: 'h264', efficient: true });
  });
  it('a resolution chosen by the user is never lowered', async () => {
    expect(await planEncoding(screen4k, { ...opts, mayShrink: false }, all, gpu(1920))).toEqual({ size: screen4k, videoCodec: 'auto', efficient: false });
  });
  it('no hardware encoder at all: the size is kept and it says so (efficient: false)', async () => {
    expect(await planEncoding(screen4k, opts, all, async () => ({ supported: true, smooth: false, powerEfficient: false }))).toEqual({ size: screen4k, videoCodec: 'auto', efficient: false });
  });
  it('another codec of the same container when that one is hardware-encoded', async () => {
    const vp9 = async (q: { contentType: string }) => ({ supported: true, smooth: true, powerEfficient: q.contentType.includes('vp09') });
    expect((await planEncoding(screen4k, opts, all, vp9)).videoCodec).toBe('vp9');
  });
  it('a codec chosen by the user is kept (only sizes are tried)', async () => {
    const plan = await planEncoding(screen4k, { ...opts, videoPref: 'vp9' }, all, gpu(4096));
    expect(plan.videoCodec).toBe('vp9');
    expect(plan.efficient).toBe(false);
  });
  it('a 1080p screen is never shrunk further; errors from the browser are ignored', async () => {
    const hd = { width: 1920, height: 1080 };
    expect(await planEncoding(hd, opts, all, async () => { throw new Error('unsupported query'); })).toEqual({ size: hd, videoCodec: 'auto', efficient: false });
  });
});
