import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Note : le suppresseur d'AbortError/CanceledError est dans public/index.html
// (script inline en capture phase) car il doit s'exécuter AVANT le HMR de CRA.

// ─── Suppression du faux-positif ResizeObserver ───────────────────────────────
// Framer Motion déclenche "ResizeObserver loop completed with undelivered
// notifications" pendant les animations — c'est bénin (comportement navigateur
// normal), mais l'overlay CRA l'affiche comme une erreur bloquante en dev.
// stopImmediatePropagation() empêche le handler CRA d'y réagir.
window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation();
  }
}, true);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
