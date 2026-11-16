import { lazy, Suspense } from 'react';
import { mountPage } from '@/shared/mount';
import { Spinner } from '@/shared/components/Progress';

const FlowEditorApp = lazy(() => import('./FlowEditorApp').then((m) => ({ default: m.FlowEditorApp })));

mountPage(
  <Suspense fallback={<div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#1b1e24' }}><Spinner size={26} /></div>}>
    <FlowEditorApp />
  </Suspense>,
);
