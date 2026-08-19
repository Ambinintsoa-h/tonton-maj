/**
 * sessionExpiry.js — UN SEUL point d'entrée pour « la session a expiré ».
 *
 * Décision d'Andrianina, 19 août 2026 : bandeau, pas redirection immédiate.
 *
 * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────────────
 * Deux couches réseau coexistent, et elles ne traitaient pas le 401 de la même
 * façon :
 *   • `axios` (App.js) redirigeait vers /login sans prévenir ;
 *   • la couche `fetch` de `/api/data` (firebase.mysql.js) ne faisait RIEN.
 *
 * Conséquences mesurées en production le 19 août 2026, toutes silencieuses :
 *   • 8 requêtes `/api/data/*` échouent en 401 au chargement, le magasin Redux
 *     reste vide, et RIEN ne le recharge après reconnexion ;
 *   • l'écran affiche « Aucun skill cerveau (SKILL.md) actif » et REFUSE de lancer
 *     l'analyse — alors que l'API renvoie bien 4 skills dont le cerveau. Le message
 *     est FAUX et envoie chercher le problème dans un menu où le skill est présent ;
 *   • les sondages bouclent indéfiniment et l'autosave retombe en local.
 * Même classe de défaut que « audit vide affiché comme phase 1 faite » (règle 11) :
 * une liste vide et une liste INCONNUE ne doivent pas se ressembler.
 *
 * ── POURQUOI UN BANDEAU ET NON UNE REDIRECTION ──────────────────────────────
 * Une redirection immédiate tue une génération en cours. Un 401 venu d'un sondage
 * secondaire — notifications, file d'attente — ferait perdre un appel payé et
 * plusieurs minutes de travail. Le bandeau laisse le rédacteur finir, ou
 * reconnecter quand il le décide.
 *
 * ── CE QUI N'EST PAS UNE EXPIRATION ─────────────────────────────────────────
 * `/api/auth/*` est EXCLU. Un mot de passe erroné répond 401 lui aussi : signaler
 * « session expirée » sur un échec de connexion serait un message faux de plus,
 * exactement le travers qu'on corrige ici.
 */

const TOKEN_KEY = 'tonton_auth_token';

let expiree = false;
const abonnes = new Set();

/** Vrai depuis qu'un 401 a été constaté sur un appel authentifié. */
export const isSessionExpired = () => expiree;

/**
 * L'URL relève-t-elle d'une session expirée ?
 *
 * Seuls les appels AUTHENTIFIÉS comptent. Un 401 sur `/api/auth/mysql-login` est
 * un mot de passe refusé, pas une session perdue.
 */
export const isAuthenticatedApiUrl = (url = '') => {
  const u = String(url || '');
  return u.includes('/api/') && !u.includes('/api/auth/');
};

/**
 * SIGNALE l'expiration. Idempotent : plusieurs 401 simultanés — c'est le cas
 * normal, huit sondages partent ensemble — ne produisent qu'un seul signal, donc
 * un seul bandeau et un seul arrêt des sondages.
 *
 * Le jeton est retiré ICI : le garder ferait repartir chaque sondage avec un
 * jeton mort, et le serveur répondrait 401 en boucle.
 */
export const signalSessionExpired = () => {
  if (expiree) return;
  expiree = true;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ }
  abonnes.forEach((fn) => { try { fn(); } catch { /* un abonné ne doit pas bloquer les autres */ } });
};

/** S'abonne à l'expiration. Rend la fonction de désabonnement. */
export const onSessionExpired = (fn) => {
  if (typeof fn !== 'function') return () => {};
  abonnes.add(fn);
  // Déjà expirée au moment de l'abonnement : on prévient tout de suite, sinon un
  // composant monté après le 401 ne saurait jamais.
  if (expiree) { try { fn(); } catch { /* idem */ } }
  return () => abonnes.delete(fn);
};

/**
 * Remet à zéro. Appelé au moment de se reconnecter — sans ça, le bandeau
 * resterait affiché après une reconnexion réussie.
 */
export const resetSessionExpiry = () => { expiree = false; };
