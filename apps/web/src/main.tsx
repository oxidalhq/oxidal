import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// A deploy replaces the hashed chunks an open tab still points at. Reload once
// to pick up the new build instead of leaving a blank page.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    const last = Number(sessionStorage.getItem('oxidal.chunk-reload') ?? 0);
    if (Date.now() - last < 10000) return;
    sessionStorage.setItem('oxidal.chunk-reload', String(Date.now()));
  } catch {
    /* storage unavailable: still reload once per event */
  }
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
