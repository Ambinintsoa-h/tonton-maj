// ─────────────────────────────────────────────────────────────────────────────
// backendMode.js — flag runtime du backend de données : 'firestore' | 'mysql'
// ─────────────────────────────────────────────────────────────────────────────
// Piloté côté serveur par la variable d'env DATA_BACKEND (proxy). Le client lit
// la valeur UNE fois au bootstrap via GET /api/backend et appelle setBackend().
//
// Défaut 'firestore' : si le flag n'est pas (encore) lu, ou en cas d'échec du
// fetch, on garde le comportement historique. La façade src/services/firebase.js
// interroge getBackend() pour aiguiller chaque appel.
//
// ⚠️ Interrupteur SIMPLE et GLOBAL : un seul backend actif à la fois pour toute
// l'équipe (lecture ET écriture). Le changement se fait côté serveur (env) +
// redémarrage ; les clients le prennent au prochain chargement de page.
// ─────────────────────────────────────────────────────────────────────────────

let backend = 'firestore';

export const getBackend = () => backend;

// ── Signal de RÉSOLUTION du flag ─────────────────────────────────────────────
// Le défaut 'firestore' est un pari, pas une vérité : tant que GET /api/backend
// n'a pas répondu, tout appel aiguillé partira vers Firestore. En production
// (DATA_BACKEND=mysql) Firebase n'est même pas initialisé, donc l'appel échoue
// SANS RIEN DIRE si l'appelant avale l'erreur.
//
// Constaté ainsi : la restauration du brouillon, lancée depuis un effet de
// composant, partait avant la réponse de /api/backend (mesurée à ~1,4 s) et
// tapait sur Firestore. Aucune requête /api/data n'était émise, aucune erreur
// affichée, et le rédacteur retrouvait un écran de lancement vide alors que son
// travail était intact sur le serveur. Une course, d'où l'intermittence.
//
// `backendReady()` permet d'attendre la résolution. Débloqué dans TOUS les cas
// — succès, échec du fetch, ou délai dépassé — pour qu'un appelant qui attend
// ne reste jamais bloqué.
let resolu = false;
let debloquer = () => {};
const attente = new Promise((r) => { debloquer = r; });

export const markBackendResolved = () => {
  if (!resolu) { resolu = true; debloquer(backend); }
  return backend;
};

export const isBackendResolved = () => resolu;

/** À attendre avant tout appel aiguillé émis hors du bootstrap. */
export const backendReady = () => attente;

export const setBackend = (value) => {
  if (value === 'firestore' || value === 'mysql') backend = value;
  markBackendResolved();
  return backend;
};

export const isMysql = () => backend === 'mysql';
