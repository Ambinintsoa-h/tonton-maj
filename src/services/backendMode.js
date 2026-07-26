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

export const setBackend = (value) => {
  if (value === 'firestore' || value === 'mysql') backend = value;
  return backend;
};

export const isMysql = () => backend === 'mysql';
