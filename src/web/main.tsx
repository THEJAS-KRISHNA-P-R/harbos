import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@web/app/App.tsx';
import '../index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root mount element in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
