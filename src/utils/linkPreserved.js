/**
 * linkPreserved.js — un lien de l'ORIGINAL doit survivre À L'IDENTIQUE (même
 * href, même texte d'ancre) dans une réécriture.
 *
 * Utilisé par le bouton « Réécrire » manuel (ArticleResult.jsx) quand la
 * sélection contient un lien. Volontairement STRICT et INDIFFÉRENT au domaine
 * (interne ET externe) : contrairement à `enforceExternalLinkPolicy`
 * (diff.js), qui ne couvre QUE l'externe et ré-enveloppe l'ancre en best-effort
 * quand le href a disparu, ici pas de retry ni de repli — c'est un rédacteur
 * qui relit un seul petit passage, il peut relancer lui-même la génération.
 * Le contrat est donc plus simple et plus dur : soit le lien ressort
 * EXACTEMENT tel quel, soit la réécriture entière est refusée.
 */

const extraireLiens = (html) => {
  if (typeof document === 'undefined' || !html) return [];
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return Array.from(tmp.querySelectorAll('a[href]')).map((a) => ({
    href: a.getAttribute('href') || '',
    texte: (a.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
};

/**
 * @returns {Array<{href:string, texte:string}>} les liens de `originalHtml`
 * absents (href ET texte d'ancre) de `updatedHtml`. Vide = rien perdu.
 */
export const liensManquants = (originalHtml, updatedHtml) => {
  const avant = extraireLiens(originalHtml);
  if (!avant.length) return [];
  const apres = extraireLiens(updatedHtml);
  return avant.filter((l) => !apres.some((a) => a.href === l.href && a.texte === l.texte));
};
