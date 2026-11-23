import type { CameraBackground } from '@/shared/types';
import { logger } from '@/shared/utils/logger';
import { quietMediapipe } from '@/shared/utils/quiet-mediapipe';

/*
 * Camera background: blur it, remove it, or replace it with a colour or a picture — on this
 * computer. The person is found in each camera frame by Google's MediaPipe selfie segmenter
 * (Apache-2.0), bundled with the extension (engine in /mediapipe, model in /models): nothing is
 * downloaded and no camera picture leaves the device.
 */

export { CAMERA_BG_IMAGE_KEY } from '@/shared/constants/camera';

export const NO_BACKGROUND: CameraBackground = { mode: 'none', blur: 14, color: '#E8E4F5' };

type Segmenter = {
  segmentForVideo: (image: OffscreenCanvas, timestamp: number) => { confidenceMasks?: Array<{ getAsFloat32Array: () => Float32Array; close: () => void }>; close: () => void };
  close: () => void;
};

async function createSegmenter(): Promise<Segmenter | null> {
  try {
    quietMediapipe();
    const vision = await import('@mediapipe/tasks-vision');
    const files = await vision.FilesetResolver.forVisionTasks(chrome.runtime.getURL('mediapipe'));
    const seg = await vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: chrome.runtime.getURL('models/selfie_segmenter.tflite'), delegate: 'CPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    return seg as unknown as Segmenter;
  } catch (err) {
    logger.warn('camera background: segmenter unavailable', err);
    return null;
  }
}

/** Segmentation runs on a small copy of the frame (fast); the mask is scaled up smoothly. */
const SEG_WIDTH = 256;
/** A new mask about 15 times a second (the person moves little in between); frames in between reuse it. */
const SEG_EVERY_MS = 66;
/** Largest width processed: the bubble is small on the recording; Camera Only needs more. */
const MAX_WIDTH_BUBBLE = 640;
const MAX_WIDTH_FULL = 1280;

function canvas(w: number, h: number) {
  const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  return { c, ctx: c.getContext('2d')! };
}

/** Draws `img` covering `w` × `h` (cropped to fill, like CSS object-fit: cover). */
function cover(ctx: OffscreenCanvasRenderingContext2D, img: ImageBitmap, w: number, h: number): void {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * A camera track with its background changed. `settings()` is read for every frame, so a preview
 * follows the user's choice at once. With "remove", the background is transparent (the screen shows
 * through the camera bubble), or a plain colour when `opaque` (Camera Only).
 */
export function processCameraTrack(track: MediaStreamTrack, settings: () => CameraBackground & { image?: string }, opaque = false): MediaStreamTrack {
  if (typeof MediaStreamTrackProcessor === 'undefined' || typeof MediaStreamTrackGenerator === 'undefined') return track;
  const processor = new MediaStreamTrackProcessor({ track: track as MediaStreamVideoTrack });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  let segmenter: Segmenter | null = null;
  let loading: Promise<void> | null = null;
  let lastTs = 0;
  let bg: { src: string; bmp: ImageBitmap } | null = null;
  let bgLoading = '';
  let seg: ReturnType<typeof canvas> | null = null;
  let mask: ReturnType<typeof canvas> | null = null;
  let maskData: ImageData | null = null;
  let person: ReturnType<typeof canvas> | null = null;
  let out: ReturnType<typeof canvas> | null = null;
  let lastSeg = -Infinity;
  const maxWidth = opaque ? MAX_WIDTH_FULL : MAX_WIDTH_BUBBLE;

  const pictureFor = (src: string | undefined) => {
    if (!src) return null;
    if (bg?.src === src) return bg.bmp;
    if (bgLoading !== src) {
      bgLoading = src;
      void fetch(src).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((bmp) => {
        if (bgLoading === src) bg = { src, bmp };
      }).catch(() => undefined);
    }
    return null;
  };

  const transform = new TransformStream<VideoFrame, VideoFrame>({
    transform(frame, controller) {
      const s = settings();
      if (s.mode === 'none') return controller.enqueue(frame);
      if (!segmenter) {
        if (!loading) loading = createSegmenter().then((x) => { segmenter = x; });
        return controller.enqueue(frame);
      }
      // Worked on at the size it is shown (a 1080p camera in a small bubble needs no 1080p work).
      const k = Math.min(1, maxWidth / frame.displayWidth);
      const w = Math.round(frame.displayWidth * k);
      const h = Math.round(frame.displayHeight * k);
      try {
        const sw = SEG_WIDTH;
        const sh = Math.max(1, Math.round((h / w) * SEG_WIDTH));
        if (!seg || seg.c.width !== sw || seg.c.height !== sh) {
          seg = canvas(sw, sh);
          mask = canvas(sw, sh);
          maskData = new ImageData(sw, sh);
        }
        if (!out || out.c.width !== w || out.c.height !== h) {
          out = canvas(w, h);
          person = canvas(w, h);
        }
        const now = performance.now();
        if (now - lastSeg >= SEG_EVERY_MS) {
          lastSeg = now;
          seg.ctx.drawImage(frame, 0, 0, sw, sh);
          const ts = Math.max(lastTs + 1, Math.round(now));
          lastTs = ts;
          const result = segmenter.segmentForVideo(seg.c, ts);
          const conf = result.confidenceMasks?.[0]?.getAsFloat32Array();
          if (!conf) {
            result.close();
            return controller.enqueue(frame);
          }
          const d = maskData!.data;
          for (let i = 0, j = 3; i < conf.length; i++, j += 4) d[j] = conf[i]! * 255;
          result.close();
          mask!.ctx.putImageData(maskData!, 0, 0);
        }

        // The person: the frame kept where the mask says "person", edges softened.
        const p = person!;
        p.ctx.globalCompositeOperation = 'source-over';
        p.ctx.clearRect(0, 0, w, h);
        p.ctx.drawImage(frame, 0, 0, w, h);
        p.ctx.globalCompositeOperation = 'destination-in';
        p.ctx.imageSmoothingEnabled = true;
        p.ctx.imageSmoothingQuality = 'high';
        p.ctx.filter = `blur(${Math.max(1, Math.round(w / 400))}px)`;
        p.ctx.drawImage(mask!.c, 0, 0, w, h);
        p.ctx.filter = 'none';
        p.ctx.globalCompositeOperation = 'source-over';

        // The new background, then the person over it.
        const o = out!;
        o.ctx.clearRect(0, 0, w, h);
        const picture = s.mode === 'image' ? pictureFor(s.image) : null;
        if (s.mode === 'blur') {
          o.ctx.filter = `blur(${Math.max(2, s.blur * (w / 640))}px)`;
          o.ctx.drawImage(frame, 0, 0, w, h);
          o.ctx.filter = 'none';
        } else if (s.mode === 'color' || (s.mode === 'remove' && opaque) || (s.mode === 'image' && !picture)) {
          o.ctx.fillStyle = s.color;
          o.ctx.fillRect(0, 0, w, h);
        } else if (picture) {
          cover(o.ctx, picture, w, h);
        }
        o.ctx.drawImage(p.c, 0, 0);
        const next = new VideoFrame(o.c, { timestamp: frame.timestamp, alpha: 'keep' });
        frame.close();
        controller.enqueue(next);
      } catch (err) {
        logger.warn('camera background: frame skipped', err);
        controller.enqueue(frame);
      }
    },
  });

  void processor.readable.pipeThrough(transform).pipeTo(generator.writable).catch(() => undefined);
  // Stopping the new track also stops the camera and frees the segmenter.
  const stop = generator.stop.bind(generator);
  generator.stop = () => {
    stop();
    track.stop();
    segmenter?.close();
    segmenter = null;
    bg?.bmp.close();
  };
  return generator;
}
