/** Session key the popup reads to show a running full-page capture (progress + Stop). */
export const FULLPAGE_STATE_KEY = 'glint.fullpage';

export interface FullPageProgress {
  running: boolean;
  progress: number;
  title: string;
}
