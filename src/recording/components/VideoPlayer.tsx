import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import type { Marker } from '@/shared/types';
import { Maximize, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from '@/shared/components/Button';
import { Select } from '@/shared/components/Dropdown';
import { Tooltip } from '@/shared/components/Tooltip';
import { formatMediaTime } from '@/shared/utils/format';
import styles from './VideoPlayer.module.css';

export interface TrimRange {
  start: number;
  end: number;
}

export interface VideoPlayerHandle {
  previewRange: () => void;
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  element: () => HTMLVideoElement | null;
}

interface Props {
  src: string;
  knownDurationSec: number | null;
  trim: TrimRange | null;
  onTrimChange: (range: TrimRange) => void;
  onDuration: (seconds: number) => void;
  /** false = the file has no sound: audio controls are disabled and say so. */
  hasAudio?: boolean;
  /** Chapters shown as ticks on the timeline (click to jump). */
  markers?: Marker[];
  onTime?: (seconds: number, playing: boolean) => void;
  /** Drawn exactly over the video picture (e.g. privacy-region previews). */
  overlay?: (box: { width: number; height: number }) => ReactNode;
}

/** Custom player: play/pause, seek, volume, speed, fullscreen and an optional trim range. */
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer({ src, knownDurationSec, trim, onTrimChange, onDuration, hasAudio = true, markers = [], onTime, overlay }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDurationSec ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const stopAt = useRef<number | null>(null);
  const [picture, setPicture] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Where the picture sits inside the (letterboxed) video element, for the overlay layer.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const measure = () => {
      const w = v.clientWidth;
      const h = v.clientHeight;
      if (!v.videoWidth || !w || !h) return setPicture(null);
      const scale = Math.min(w / v.videoWidth, h / v.videoHeight);
      const pw = v.videoWidth * scale;
      const ph = v.videoHeight * scale;
      setPicture({ left: v.offsetLeft + (w - pw) / 2, top: v.offsetTop + (h - ph) / 2, width: pw, height: ph });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    v.addEventListener('loadedmetadata', measure);
    measure();
    return () => {
      ro.disconnect();
      v.removeEventListener('loadedmetadata', measure);
    };
  }, [src]);

  useEffect(() => {
    onTime?.(time, playing);
  }, [time, playing, onTime]);

  const resolveDuration = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
      onDuration(v.duration);
    } else if (knownDurationSec) {
      setDuration(knownDurationSec);
      onDuration(knownDurationSec);
    }
  }, [knownDurationSec, onDuration]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, duration || v.duration || 0));
    setTime(v.currentTime);
  }, [duration]);

  useImperativeHandle(ref, () => ({
    previewRange: () => {
      const v = videoRef.current;
      if (!v || !trim) return;
      v.currentTime = trim.start;
      stopAt.current = trim.end;
      void v.play();
    },
    seek,
    play: () => void videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
    toggle,
    element: () => videoRef.current,
  }), [trim, seek, toggle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowRight') seek(time + 5);
      if (e.key === 'ArrowLeft') seek(time - 5);
      if (e.key === 'f') void toggleFullscreen();
      if (e.key === 'm' && hasAudio) setMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted || !hasAudio;
      videoRef.current.playbackRate = rate;
    }
  }, [volume, muted, rate, hasAudio]);

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapRef.current?.requestFullscreen();
  }

  const posToTime = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };

  const startDrag = (kind: 'seek' | 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Scrubbing pauses a playing video and resumes it when the button is released.
    const v = videoRef.current;
    const resume = kind === 'seek' && !!v && !v.paused && !v.ended;
    if (resume) v.pause();
    const apply = (clientX: number) => {
      const t = posToTime(clientX);
      if (kind === 'seek') seek(t);
      else if (trim && kind === 'start') onTrimChange({ start: Math.min(t, trim.end - 0.2), end: trim.end });
      else if (trim && kind === 'end') onTrimChange({ start: trim.start, end: Math.max(t, trim.start + 0.2) });
    };
    apply(e.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (resume && v && !v.ended) void v.play().catch(() => undefined);
    };
    window.addEventListener('pointercancel', up);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : '0%');

  return (
    <div ref={wrapRef} data-player className={`${styles.player} ${fullscreen ? styles.fs : ''}`}>
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        title={hasAudio ? undefined : 'This video has no audio'}
        preload="metadata"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={resolveDuration}
        onDurationChange={resolveDuration}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setTime(t);
          if (stopAt.current !== null && t >= stopAt.current) {
            e.currentTarget.pause();
            stopAt.current = null;
          }
        }}
      />
      {overlay && picture && (
        <div className={styles.overlay} style={picture}>
          {overlay({ width: picture.width, height: picture.height })}
        </div>
      )}
      {!hasAudio && (
        <div className={styles.noAudioBadge} role="note" aria-label="This video has no audio">
          <VolumeX size={14} /> No audio
        </div>
      )}
      <div className={styles.controls}>
        <div ref={trackRef} className={styles.track} onPointerDown={startDrag('seek')} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={0}>
          {trim && (
            <>
              <div className={styles.dim} style={{ left: 0, width: pct(trim.start) }} />
              <div className={styles.dim} style={{ left: pct(trim.end), right: 0 }} />
              <div className={styles.range} style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
              <div className={styles.handle} style={{ left: pct(trim.start) }} onPointerDown={startDrag('start')} role="slider" aria-label="Trim start" aria-valuenow={Math.round(trim.start)} tabIndex={0} />
              <div className={`${styles.handle} ${styles.handleEnd}`} style={{ left: pct(trim.end) }} onPointerDown={startDrag('end')} role="slider" aria-label="Trim end" aria-valuenow={Math.round(trim.end)} tabIndex={0} />
            </>
          )}
          <div className={styles.played} style={{ width: pct(time) }} />
          {markers.map((m) => (
            <button
              key={m.id}
              type="button"
              className={styles.markerTick}
              style={{ left: pct(m.timeMs / 1000) }}
              title={`${formatMediaTime(m.timeMs / 1000)} · ${m.name}`}
              aria-label={`Chapter ${m.name} at ${formatMediaTime(m.timeMs / 1000)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); seek(m.timeMs / 1000); }}
            />
          ))}
          <div className={styles.playhead} style={{ left: pct(time) }} />
        </div>
        <div className={styles.row}>
          <IconButton tone="dark" label={playing ? 'Pause' : 'Play'} shortcut="Space" icon={playing ? <Pause size={18} /> : <Play size={18} />} onClick={toggle} />
          <span className={styles.time}>
            {formatMediaTime(time)} / {formatMediaTime(duration)}
          </span>
          <div className={styles.spacer} />
          {hasAudio ? (
            <>
              <IconButton tone="dark" label={muted ? 'Unmute' : 'Mute'} shortcut="M" icon={muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />} onClick={() => setMuted(!muted)} />
              <input className={styles.volume} type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume" onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} />
            </>
          ) : (
            <Tooltip content="This video has no audio">
              <span className={styles.noAudio} tabIndex={0} aria-label="No audio: this video has no sound">
                <VolumeX size={17} />
                <input className={styles.volume} type="range" min={0} max={1} value={0} disabled aria-label="Volume (no audio)" readOnly />
              </span>
            </Tooltip>
          )}
          <Select
            label="Playback speed"
            variant="dark"
            value={rate}
            placement="above"
            minWidth={110}
            onChange={setRate}
            options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ value: r, label: `${r}×` }))}
          />
          <IconButton tone="dark" label={fullscreen ? 'Exit full screen' : 'Full screen'} shortcut="F" icon={fullscreen ? <Minimize2 size={18} /> : <Maximize size={18} />} onClick={() => void toggleFullscreen()} />
        </div>
      </div>
    </div>
  );
});
