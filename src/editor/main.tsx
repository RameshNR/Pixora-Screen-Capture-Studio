import { lazy, Suspense } from 'react';
import { mountPage } from '@/shared/mount';
import { Spinner } from '@/shared/components/Progress';

// The editor bundle is loaded lazily so the shell paints immediately.
const EditorApp = lazy(() => import('./pages/EditorApp').then((m) => ({ default: m.EditorApp })));

mountPage(
  <Suspense
    fallback={
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#1b1e24', color: '#e6e9ef' }}>
        <Spinner size={26} />
      </div>
    }
  >
    <EditorApp />
  </Suspense>,
);
