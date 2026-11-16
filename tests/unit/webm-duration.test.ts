import { describe, expect, it } from 'vitest';
import { fixWebmDuration } from '@/recording/services/webm-duration';

/** Builds a minimal WebM header like Chrome's MediaRecorder output (unknown-size Segment, no Duration). */
function chromeLikeWebm(withDuration?: number): Uint8Array {
  const ebmlHeader = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77]; // id, size 4, DocType-ish payload
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const timecodeScale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]; // 1,000,000
  const muxingApp = [0x4d, 0x80, 0x84, 0x43, 0x68, 0x72, 0x6d]; // "Chrm"
  const duration: number[] = [];
  if (withDuration !== undefined) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, withDuration);
    duration.push(0x44, 0x89, 0x88, ...b);
  }
  const infoPayload = [...timecodeScale, ...muxingApp, ...duration];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoPayload.length, ...infoPayload];
  const tracks = [0x16, 0x54, 0xae, 0x6b, 0x82, 0xaa, 0xbb];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];
  return new Uint8Array([...ebmlHeader, ...segment, ...info, ...tracks, ...cluster]);
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function findDuration(buf: Uint8Array): number | null {
  for (let i = 0; i < buf.length - 11; i++) {
    if (buf[i] === 0x44 && buf[i + 1] === 0x89 && buf[i + 2] === 0x88) {
      return new DataView(buf.buffer, buf.byteOffset + i + 3, 8).getFloat64(0);
    }
  }
  return null;
}

describe('WebM duration patcher', () => {
  it('inserts a Duration element into Info', async () => {
    const original = chromeLikeWebm();
    const { blob, patched } = await fixWebmDuration(new Blob([original as BlobPart], { type: 'video/webm' }), 12_345);
    expect(patched).toBe(true);
    const out = await bytes(blob);
    expect(findDuration(out)).toBe(12_345);
    expect(blob.size).toBe(original.length + 11 + 7); // Duration element + 8-byte size vint (was 1 byte)
    expect(blob.type).toBe('video/webm');
    // Everything after Info (tracks, clusters) is untouched.
    expect(Array.from(out.slice(-22))).toEqual(Array.from(original.slice(-22)));
  });

  it('overwrites an existing Duration in place', async () => {
    const original = chromeLikeWebm(1);
    const { blob, patched } = await fixWebmDuration(new Blob([original as BlobPart]), 5000);
    expect(patched).toBe(true);
    expect(blob.size).toBe(original.length);
    expect(findDuration(await bytes(blob))).toBe(5000);
  });

  it('leaves non-WebM data untouched', async () => {
    const input = new Blob([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])]);
    const res = await fixWebmDuration(input, 1000);
    expect(res.patched).toBe(false);
    expect(res.blob).toBe(input);
  });

  it('rejects invalid durations', async () => {
    const res = await fixWebmDuration(new Blob([chromeLikeWebm() as BlobPart]), 0);
    expect(res.patched).toBe(false);
  });
});
