/**
 * Chrome's MediaRecorder writes WebM files without a Duration element (it streams and never seeks
 * back), which makes the files unseekable in many players. This patcher inserts / fixes the
 * Segment › Info › Duration element by rewriting only the first few hundred bytes; the rest of the
 * (possibly multi-GB) recording is reused as Blob slices and never loaded into memory.
 */
const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114d9b74;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;

const HEAD_BYTES = 64 * 1024;

interface Vint {
  length: number;
  value: number;
  unknown: boolean;
}

function readVint(buf: Uint8Array, pos: number): Vint | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (pos + length > buf.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { length, value, unknown: allOnes };
}

function readId(buf: Uint8Array, pos: number): { id: number; length: number } | null {
  const first = buf[pos];
  if (first === undefined) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 4 || pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i]!;
  return { id, length };
}

function encodeVint(value: number, length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  out[0]! |= 0x80 >> (length - 1);
  return out;
}

function readUint(buf: Uint8Array, pos: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[pos + i]!;
  return v;
}

function float64(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

export interface PatchResult {
  blob: Blob;
  patched: boolean;
  reason?: string;
}

export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<PatchResult> {
  if (!(durationMs > 0)) return { blob, patched: false, reason: 'invalid duration' };
  const head: Uint8Array<ArrayBuffer> = new Uint8Array(await blob.slice(0, Math.min(blob.size, HEAD_BYTES)).arrayBuffer());

  let pos = 0;
  const ebml = readId(head, pos);
  if (!ebml || ebml.id !== ID_EBML) return { blob, patched: false, reason: 'not EBML' };
  pos += ebml.length;
  const ebmlSize = readVint(head, pos);
  if (!ebmlSize) return { blob, patched: false, reason: 'bad header' };
  pos += ebmlSize.length + ebmlSize.value;

  const seg = readId(head, pos);
  if (!seg || seg.id !== ID_SEGMENT) return { blob, patched: false, reason: 'no segment' };
  pos += seg.length;
  const segSizePos = pos;
  const segSize = readVint(head, pos);
  if (!segSize) return { blob, patched: false, reason: 'bad segment' };
  pos += segSize.length;

  // Walk the top-level children of the Segment until Info is found.
  while (pos < head.length) {
    const child = readId(head, pos);
    if (!child) break;
    const sizePos = pos + child.length;
    const size = readVint(head, sizePos);
    if (!size) break;
    const dataStart = sizePos + size.length;

    if (child.id === ID_SEEKHEAD) {
      // SeekHead stores absolute offsets that would shift; Chrome does not write one, so bail out.
      return { blob, patched: false, reason: 'seekhead present' };
    }
    if (child.id === ID_CLUSTER) break;
    if (child.id === ID_INFO) {
      if (size.unknown || dataStart + size.value > head.length) return { blob, patched: false, reason: 'info too large' };
      const infoEnd = dataStart + size.value;
      let timecodeScale = 1_000_000;
      let p = dataStart;
      let durationAt = -1;
      let durationLen = 0;
      while (p < infoEnd) {
        const e = readId(head, p);
        if (!e) break;
        const es = readVint(head, p + e.length);
        if (!es) break;
        const ed = p + e.length + es.length;
        if (e.id === ID_TIMECODE_SCALE) timecodeScale = readUint(head, ed, es.value) || 1_000_000;
        if (e.id === ID_DURATION) {
          durationAt = ed;
          durationLen = es.value;
        }
        p = ed + es.value;
      }
      const durationUnits = (durationMs * 1_000_000) / timecodeScale;

      if (durationAt >= 0 && (durationLen === 8 || durationLen === 4)) {
        const copy = head.slice();
        const view = new DataView(copy.buffer);
        if (durationLen === 8) view.setFloat64(durationAt, durationUnits);
        else view.setFloat32(durationAt, durationUnits);
        return { blob: new Blob([copy, blob.slice(head.length)], { type: blob.type }), patched: true };
      }

      // Insert a new 8-byte float Duration element at the end of Info.
      const durationEl = new Uint8Array([0x44, 0x89, 0x88, ...float64(durationUnits)]);
      const newInfoSize = size.value + durationEl.length;
      const newInfoSizeBytes = encodeVint(newInfoSize, 8);
      const delta = durationEl.length + (8 - size.length);

      const prefix = head.slice(0, sizePos);
      if (!segSize.unknown) {
        const newSegSize = segSize.value + delta;
        if (newSegSize >= 2 ** (7 * segSize.length) - 1) return { blob, patched: false, reason: 'segment size overflow' };
        prefix.set(encodeVint(newSegSize, segSize.length), segSizePos);
      }
      const infoData = head.slice(dataStart, infoEnd);
      const parts: BlobPart[] = [prefix, newInfoSizeBytes, infoData, durationEl, blob.slice(infoEnd)];
      return { blob: new Blob(parts, { type: blob.type }), patched: true };
    }
    if (size.unknown) break;
    pos = dataStart + size.value;
  }
  return { blob, patched: false, reason: 'info not found' };
}
