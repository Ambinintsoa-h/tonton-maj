// ── UN BROUILLON PÉRIMÉ NE DOIT JAMAIS ÉCRASER UNE ARCHIVE ROUVERTE ───────────
//
// Perte de travail signalée par Andrianina : « quand on rouvre un article en
// terminé, ça relance la génération de l'article en entier. Les modifs sont
// écrasées et on a travaillé pour rien. »
//
// Deux causes, deux verrous. Ce fichier couvre la seconde : l'arbitrage entre le
// brouillon d'autosave et un article qu'on vient délibérément de rouvrir.
//
// Mécanisme du bug : `clearDraft` n'était appelé NULLE PART dans l'éditeur. Le
// brouillon survivait au « Terminer », figé sur le dernier autosave d'AVANT
// l'archivage. À la réouverture du même article, l'effet de restauration
// d'Articles.jsx le retrouvait (même `currentArticleId`) et REMPLAÇAIT le HTML
// final par lui — puis l'autosave réécrivait cette version périmée en base.
/* eslint-env jest */
import reducer, { markArchiveOpened } from '../store/slices/agentSlice';

/**
 * La condition exacte de la branche « retour SPA » d'Articles.jsx. Reproduite ici
 * plutôt que de monter toute la page : c'est l'ARBITRAGE qu'on veut verrouiller,
 * et il tient en une expression.
 */
const brouillonRemplaceLArchive = (local, agent) =>
  agent.status === 'done'
  && !!local?.html
  && local.currentArticleId === agent.currentArticleId
  && (local.savedAt || 0) > (agent.archiveOpenedAt || 0)
  && (local.html !== agent.updatedContent || !!local.editorMeta);

const T = 1_700_000_000_000;

describe('arbitrage brouillon / archive rouverte', () => {
  const archiveRouverte = {
    status: 'done',
    currentArticleId: 'art-1',
    updatedContent: '<p>Version FINALE archivée.</p>',
    archiveOpenedAt: T + 5000,          // rouverte APRÈS le dernier autosave
  };

  test('un brouillon ANTÉRIEUR à la réouverture est ignoré', () => {
    const perime = { html: '<p>Version périmée.</p>', currentArticleId: 'art-1', savedAt: T };
    expect(brouillonRemplaceLArchive(perime, archiveRouverte)).toBe(false);
  });

  test('un brouillon POSTÉRIEUR est appliqué — c\'est le retour SPA légitime', () => {
    // Le rédacteur a édité, quitté l'écran puis est revenu : ses retouches ne
    // vivent que dans le brouillon. Il DOIT gagner.
    const recent = { html: '<p>Retouches en cours.</p>', currentArticleId: 'art-1', savedAt: T + 9000 };
    expect(brouillonRemplaceLArchive(recent, archiveRouverte)).toBe(true);
  });

  test('sans réouverture (archiveOpenedAt = 0), le comportement historique est intact', () => {
    // Règle 7 : le retour SPA ne doit pas régresser pour les sessions ordinaires.
    const agent = { ...archiveRouverte, archiveOpenedAt: 0 };
    const brouillon = { html: '<p>Autre.</p>', currentArticleId: 'art-1', savedAt: T };
    expect(brouillonRemplaceLArchive(brouillon, agent)).toBe(true);
  });

  test('le brouillon d\'un AUTRE article n\'est jamais appliqué', () => {
    const autre = { html: '<p>Autre article.</p>', currentArticleId: 'art-2', savedAt: T + 9000 };
    expect(brouillonRemplaceLArchive(autre, archiveRouverte)).toBe(false);
  });

  test('un brouillon identique au contenu chargé ne déclenche rien', () => {
    const identique = {
      html: archiveRouverte.updatedContent,
      currentArticleId: 'art-1',
      savedAt: T + 9000,
    };
    expect(brouillonRemplaceLArchive(identique, archiveRouverte)).toBe(false);
  });
});

describe('markArchiveOpened', () => {
  test('horodate la réouverture', () => {
    const s = reducer(undefined, markArchiveOpened(T));
    expect(s.archiveOpenedAt).toBe(T);
  });

  test('sans argument utilisable, retombe sur maintenant plutôt que sur 0', () => {
    // 0 signifierait « aucune réouverture » et laisserait le brouillon gagner :
    // le repli doit fermer le verrou, jamais l'ouvrir.
    const avant = Date.now();
    expect(reducer(undefined, markArchiveOpened(undefined)).archiveOpenedAt).toBeGreaterThanOrEqual(avant);
    expect(reducer(undefined, markArchiveOpened('pas un nombre')).archiveOpenedAt).toBeGreaterThanOrEqual(avant);
  });

  test('l\'état initial vaut 0 — aucune réouverture en cours', () => {
    expect(reducer(undefined, { type: 'init' }).archiveOpenedAt).toBe(0);
  });
});
