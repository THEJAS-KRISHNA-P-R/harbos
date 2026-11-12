import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@web/app/App.tsx';
import { I18nProvider } from '@web/i18n/index.tsx';
import '../index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root mount element in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
