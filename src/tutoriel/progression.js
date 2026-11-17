/**
 * progression.js — OÙ EN EST CE MEMBRE DANS LE TUTORIEL.
 *
 * Stocké dans le navigateur (localStorage), par membre et par parcours : c'est un
 * confort de lecture, pas une donnée métier. Rien n'est envoyé au serveur, rien
 * n'est évalué, personne n'est suivi.
 *
 * Toute lecture/écriture est ENTOURÉE d'un try/catch : navigation privée, données
 * de site bloquées ou quota plein font lever `localStorage`. Le tutoriel doit
 * alors s'afficher normalement, simplement sans mémoire.
 *
 * `storage` est INJECTÉ (par défaut `window.localStorage`) pour que les tests
 * n'aient pas besoin d'un navigateur.
 */

const PREFIXE = 'tonton_tuto_v1';

const stockageParDefaut = () => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

const cle = (membre, parcours, nature) => `${PREFIXE}:${membre || 'anonyme'}:${parcours}:${nature}`;

const lireListe = (storage, k) => {
  try {
    const brut = (storage || stockageParDefaut())?.getItem(k);
    if (!brut) return [];
    const v = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const ecrireListe = (storage, k, liste) => {
  try {
    (storage || stockageParDefaut())?.setItem(k, JSON.stringify(liste));
    return true;
  } catch {
    return false;
  }
};

const basculer = (liste, id) => (liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);

/** Chapitres marqués « lus » par ce membre. */
export const lireChapitresLus = (membre, parcours, storage) =>
  lireListe(storage, cle(membre, parcours, 'lus'));

/** Coche / décoche un chapitre ; rend la nouvelle liste (même si l'écriture échoue). */
export const basculerChapitreLu = (membre, parcours, id, storage) => {
  const suivante = basculer(lireChapitresLus(membre, parcours, storage), id);
  ecrireListe(storage, cle(membre, parcours, 'lus'), suivante);
  return suivante;
};

/** Étapes cochées d'une liste « À faire » (ex. : « Ma première MAJ »). */
export const lireCoches = (membre, listeId, storage) =>
  lireListe(storage, cle(membre, 'liste', listeId));

export const basculerCoche = (membre, listeId, etapeId, storage) => {
  const suivante = basculer(lireCoches(membre, listeId, storage), etapeId);
  ecrireListe(storage, cle(membre, 'liste', listeId), suivante);
  return suivante;
};
