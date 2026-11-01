import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Expose internals for automated browser tests in development.
if (import.meta.env.DEV) {
  void Promise.all([import('./engine/studio'), import('./engine/store'), import('./geometry/demo'), import('three')]).then(([s, st, d, three]) => {
    Object.assign(window, { __studio: s.studio, __store: st, __demo: d, __three: three });
  });
}
