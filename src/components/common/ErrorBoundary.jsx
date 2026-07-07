/**
 * ErrorBoundary — filet ultime contre la PAGE BLANCHE.
 *
 * Attrape toute erreur de rendu React (y compris un débordement de quota
 * localStorage qui remonterait malgré les garde-fous) et affiche un écran de
 * récupération au lieu d'un écran blanc. Deux issues :
 *   • Recharger la page
 *   • Vider le cache local & recharger (préserve le token de session → on reste
 *     connecté ; Firestore rechargera toutes les données au redémarrage).
 *
 * Styles INLINE volontairement : aucun composant/CSS applicatif n'est requis,
 * l'écran s'affiche même si le reste de l'app est cassé.
 */
import React from 'react';

const TOKEN_KEY = 'tonton_auth_token';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Erreur de rendu attrapée :', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearCache = () => {
    try {
      const token = sessionStorage.getItem(TOKEN_KEY);
      localStorage.clear();
      // Rester connecté : le token de session est préservé
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
    } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 24, background: '#eceef1',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          maxWidth: 440, width: '100%', background: '#fff', borderRadius: 20,
          padding: 32, textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
          borderTop: '4px solid #f59e0b',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 16, margin: '0 auto 16px',
            background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
          }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
            Un souci d'affichage est survenu
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, margin: '0 0 24px' }}>
            L'application a rencontré une erreur (souvent un cache local saturé).
            Vos données sont en sécurité dans le cloud — un rechargement les récupère.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 18px', borderRadius: 12, border: '1px solid #e5e7eb',
                background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Recharger la page
            </button>
            <button
              onClick={this.handleClearCache}
              style={{
                padding: '10px 18px', borderRadius: 12, border: 'none',
                background: '#f59e0b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Vider le cache local &amp; recharger
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 18 }}>
            « Vider le cache local » vous garde connecté et recharge tout depuis le cloud.
          </p>
        </div>
      </div>
    );
  }
}
