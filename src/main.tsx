import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import App from './App';
import './styles.css';
const TopologyEditor = lazy(() => import('./TopologyEditor'));
const isTopologyEditor = window.location.pathname.replace(/\/$/, '') === '/internal/topology';
createRoot(document.getElementById('root')!).render(
  isTopologyEditor ? (
    <Suspense fallback={<p role="status">Loading the topology editor…</p>}>
      <TopologyEditor />
    </Suspense>
  ) : (
    <App />
  ),
);
