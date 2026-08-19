/**
 * Verrou du signal d'expiration de session.
 *
 * Le défaut corrigé : DEUX couches réseau, deux comportements sur la même panne.
 * `axios` redirigeait sans prévenir (au milieu d'une génération, appel payé perdu),
 * la couche `fetch` de `/api/data` ne faisait RIEN — magasin vide, message FAUX
 * « Aucun skill cerveau actif », sondages en boucle. Mesuré en production le
 * 19 août 2026.
 */
import {
  isSessionExpired, signalSessionExpired, onSessionExpired,
  resetSessionExpiry, isAuthenticatedApiUrl,
} from './sessionExpiry';

beforeEach(() => {
  resetSessionExpiry();
  sessionStorage.setItem('tonton_auth_token', 'jeton-de-test');
});

describe('ce qui compte comme une expiration', () => {
  it('les appels AUTHENTIFIÉS de /api comptent', () => {
    expect(isAuthenticatedApiUrl('/api/data/skills')).toBe(true);
    expect(isAuthenticatedApiUrl('https://maj.stomos.net/api/settings')).toBe(true);
  });

  it('/api/auth/* est EXCLU — un mot de passe erroné n\'est pas une session perdue', () => {
    // Annoncer « session expirée » sur un échec de connexion serait un message faux
    // de plus, exactement le travers qu'on corrige ici.
    expect(isAuthenticatedApiUrl('/api/auth/mysql-login')).toBe(false);
    expect(isAuthenticatedApiUrl('/api/auth/2fa')).toBe(false);
  });

  it('ce qui n\'est pas une URL d\'API ne compte pas', () => {
    expect(isAuthenticatedApiUrl('/login')).toBe(false);
    expect(isAuthenticatedApiUrl('')).toBe(false);
    expect(isAuthenticatedApiUrl(undefined)).toBe(false);
  });
});

describe('le signal', () => {
  it('retire le JETON — sinon les sondages repartent avec un jeton mort', () => {
    signalSessionExpired();
    expect(sessionStorage.getItem('tonton_auth_token')).toBeNull();
    expect(isSessionExpired()).toBe(true);
  });

  it('est IDEMPOTENT : huit sondages simultanés → un seul avertissement', () => {
    // C'est le cas NORMAL : huit requêtes /api/data partent ensemble au chargement.
    const vu = jest.fn();
    onSessionExpired(vu);
    signalSessionExpired();
    signalSessionExpired();
    signalSessionExpired();
    expect(vu).toHaveBeenCalledTimes(1);
  });

  it('prévient un abonné arrivé APRÈS le 401', () => {
    // Un composant monté après la panne doit quand même l'apprendre, sinon le
    // bandeau ne s'affiche jamais.
    signalSessionExpired();
    const tardif = jest.fn();
    onSessionExpired(tardif);
    expect(tardif).toHaveBeenCalledTimes(1);
  });

  it('un abonné qui lève n\'empêche pas les autres d\'être prévenus', () => {
    const casse = () => { throw new Error('boum'); };
    const sain = jest.fn();
    onSessionExpired(casse);
    onSessionExpired(sain);
    expect(() => signalSessionExpired()).not.toThrow();
    expect(sain).toHaveBeenCalledTimes(1);
  });

  it('le désabonnement fonctionne', () => {
    const vu = jest.fn();
    const off = onSessionExpired(vu);
    off();
    signalSessionExpired();
    expect(vu).not.toHaveBeenCalled();
  });

  it('la remise à zéro permet de repartir après reconnexion', () => {
    // Sans elle, le bandeau resterait affiché après une reconnexion réussie.
    signalSessionExpired();
    expect(isSessionExpired()).toBe(true);
    resetSessionExpiry();
    expect(isSessionExpired()).toBe(false);
  });
});
