/**
 * articleLiveness.js — L'ARTICLE EXISTE-T-IL ENCORE, AVANT DE LANCER L'ANALYSE ?
 *
 * Retour terrain : des QA lancent une analyse sur un article déjà supprimé ou
 * déplacé côté site. Aujourd'hui l'échec n'arrive qu'après plusieurs secondes
 * de scraping/appel WordPress, avec un message générique — tout ce travail est
 * perdu pour rien puisque la page n'existe plus.
 *
 * Un seul endroit pour ce contrôle : lancement initial (Articles.jsx) ET
 * ré-audit depuis une revue déjà ouverte (ArticleResult.jsx) doivent voir la
 * MÊME réponse à « cette URL est-elle vraiment morte ? ».
 *
 * Réutilise `/api/check-links` (déjà servi par `checkLinksLive`, agent.js) —
 * même garde-fou que le tissage de liens : `dead` UNIQUEMENT sur un vrai 4xx
 * de la cible, `unknown` sur toute panne de VÉRIFICATION (timeout, DNS, site
 * qui bloque les robots, 5xx). On ne bloque donc jamais une analyse pour un
 * problème de vérification plutôt que de destination — l'analyse continue
 * normalement dans tous les cas ambigus.
 */
import { checkLinksLive } from '../services/agent';

/**
 * Casse un éventuel cache CDN ou plugin de cache WordPress qui servirait
 * encore une page 200 périmée (ou, à l'inverse, un 404 caché après une
 * restauration) : la vérification doit porter sur l'état RÉEL, maintenant.
 */
export const withNocache = (url) => {
  try {
    const u = new URL(url);
    u.searchParams.set('nocache', String(Date.now()));
    return u.toString();
  } catch {
    return url;
  }
};

export const ARTICLE_INTROUVABLE_MESSAGE =
  'Cette page n\'existe plus (404) — impossible de lancer l\'analyse. '
  + 'Si vous arrivez encore à voir l\'article (cache, aperçu, l\'URL a changé...), '
  + 'relancez la MAJ depuis « Copier-coller » (page Articles).';

/**
 * `true` seulement sur un 404 confirmé — jamais sur une simple incertitude.
 */
export const isArticleUrlDead = async (url) => {
  const u = String(url || '').trim();
  if (!u) return false;
  const cible = withNocache(u);
  const statuts = await checkLinksLive([cible]);
  return statuts[cible] === 'dead';
};
