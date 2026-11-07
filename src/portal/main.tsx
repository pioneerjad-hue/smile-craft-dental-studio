import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from './ui/PortalApp';
import './portal.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
);
