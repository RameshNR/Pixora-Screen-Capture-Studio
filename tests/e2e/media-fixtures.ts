import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Generates a small Y4M video (moving gradient) and a WAV tone for Chrome's file-based fake capture
 * devices, which are far more reliable in automation than the synthetic default device.
 */
export function ensureFakeMedia(): { video: string; audio: string } {
  const dir = join(tmpdir(), 'glint-e2e-media');
  mkdirSync(dir, { recursive: true });
  const video = join(dir, 'camera-640x360.y4m');
  const audio = join(dir, 'tone.wav');
  if (!existsSync(video)) {
    const w = 640;
    const h = 360;
    const frames = 60;
    const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`);
    const parts: Buffer[] = [header];
    for (let f = 0; f < frames; f++) {
      parts.push(Buffer.from('FRAME\n'));
      const y = Buffer.alloc(w * h);
      for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) y[row * w + col] = (col + row + f * 8) & 0xff;
      const u = Buffer.alloc((w / 2) * (h / 2), 90 + f);
      const v = Buffer.alloc((w / 2) * (h / 2), 160 - f);
      parts.push(y, u, v);
    }
    writeFileSync(video, Buffer.concat(parts));
  }
  if (!existsSync(audio)) {
    const rate = 48000;
    const seconds = 2;
    const n = rate * seconds;
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24);
    hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
    writeFileSync(audio, Buffer.concat([hdr, data]));
  }
  return { video, audio };
}
