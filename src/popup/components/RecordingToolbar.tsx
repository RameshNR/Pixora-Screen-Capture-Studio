import { useMemo } from 'react';
import { ChevronRight, FileVideo, MonitorPlay } from 'lucide-react';
import type { RecordingSettings, ResolutionPreset } from '@/shared/types';
import { Select } from '@/shared/components/Dropdown';
import { RESOLUTION_LABELS, RESOLUTION_SHORT_LABELS } from '@/shared/constants/media';
import styles from '../styles/popup.module.css';

interface Props {
  rec: RecordingSettings;
  update: (patch: Partial<RecordingSettings>) => void;
  onMore: () => void;
}

const RESOLUTION_HINTS: Record<ResolutionPreset, string> = {
  '480p': 'Smallest files',
  '720p': 'Good for quick shares',
  '1080p': 'Recommended',
  '1440p': 'Needs a 1440p+ source',
  '2160p': 'Needs a 4K display or tab · 30 fps recommended',
  '4320p': 'Needs an 8K display · depends on your hardware',
  original: 'Native source size, never upscaled',
};

export function nativeMp4Supported(): boolean {
  return typeof MediaRecorder !== 'undefined' && ['video/mp4;codecs=avc1', 'video/mp4;codecs=avc1.640033', 'video/mp4'].some((m) => MediaRecorder.isTypeSupported(m));
}

export function RecordingToolbar({ rec, update, onMore }: Props) {
  const mp4Native = useMemo(nativeMp4Supported, []);
  const resolutions: ResolutionPreset[] = ['480p', '720p', '1080p', '1440p', '2160p', '4320p', 'original'];
  return (
    <div className={styles.toolbar}>
      <Select
        label="Resolution"
        variant="inline"
        value={rec.resolution}
        minWidth={240}
        icon={<MonitorPlay size={17} />}
        onChange={(v) => update({ resolution: v })}
        renderValue={(o) => (o ? RESOLUTION_SHORT_LABELS[o.value] : '')}
        options={resolutions.map((r) => ({ value: r, label: RESOLUTION_LABELS[r], description: RESOLUTION_HINTS[r] }))}
      />
      <Select
        label="Output format"
        variant="inline"
        value={rec.container}
        minWidth={260}
        icon={<FileVideo size={17} />}
        onChange={(v) => update({ container: v })}
        options={[
          { value: 'webm', label: 'WebM', description: 'VP9 / VP8 + Opus · best quality per MB' },
          {
            value: 'mp4',
            label: 'MP4',
            description: mp4Native ? 'H.264, recorded natively by Chrome' : 'Recorded as WebM, converted to MP4 on the result page',
          },
        ]}
      />
      <button type="button" className={styles.moreBtn} onClick={onMore} aria-label="More recording settings">
        More <ChevronRight size={16} />
      </button>
    </div>
  );
}
