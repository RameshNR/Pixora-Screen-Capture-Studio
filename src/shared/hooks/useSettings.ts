import { useCallback, useEffect, useState } from 'react';
import type { DeepPartial, Settings } from '../types';
import { loadSettings, subscribeSettings, updateSettings } from '@/settings/settings-service';

/** Settings with live updates from every other extension page. */
export function useSettings(): { settings: Settings | null; update: (patch: DeepPartial<Settings>) => Promise<void> } {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => alive && setSettings(s));
    const unsubscribe = subscribeSettings((s) => setSettings(s));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const update = useCallback(async (patch: DeepPartial<Settings>) => {
    // Optimistic update keeps controls responsive; storage.onChanged confirms it.
    setSettings((prev) => (prev ? deepAssign(prev, patch) : prev));
    await updateSettings(patch);
  }, []);

  return { settings, update };
}

function deepAssign<T>(base: T, patch: unknown): T {
  if (typeof base !== 'object' || base === null || typeof patch !== 'object' || patch === null) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    out[k] = typeof cur === 'object' && cur !== null && !Array.isArray(cur) ? deepAssign(cur, v) : v;
  }
  return out as T;
}
