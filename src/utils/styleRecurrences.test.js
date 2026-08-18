/**
 * styleRecurrences.test.js — deux bugs relevés en production le 18 août 2026,
 * sur l'article God of War, verrouillés ici avec les phrases EXACTES qui ont lâché.
 *
 * Bug 1 — « affrontement » et « engouement » signalés comme adverbes, puis
 *         SUPPRIMÉS par le correctif mécanique : « Après un titanesque, ».
 * Bug 2 — « constitue » corrigé en « s'impose », lui-même verbe interdit.
 */
import { detectStylePatterns } from './stylePatterns';
import { proposeMechanicalFix } from './styleFixes';
import { buildStyleFixPrompt, normalizeStyleProposals } from './stylePrompt';

const adverbesDe = (html) => {
  const f = detectStylePatterns(html).findings.find((x) => x.id === 'adverbes');
  return f ? f.exemples.map((e) => e.terme) : [];
};

describe('bug 1 — un nom en -ment n\'est pas un adverbe', () => {
  it('écarte les noms précédés d\'un déterminant', () => {
    // Les trois phrases réelles. Aucune ne devait remonter.
    const html = [
      '<p>Après un affrontement titanesque, Kratos terrasse son ancien maître.</p>',
      '<p>L\'affrontement ultime avec Zeus voit Kratos se poignarder.</p>',
      '<p>L\'engouement autour des adaptations confirme cette tendance.</p>',
    ].join('');
    expect(adverbesDe(html)).toEqual([]);
  });

  it('détecte toujours les vrais adverbes', () => {
    // La règle ne doit pas se payer en silence : ces deux-là sont légitimes.
    const html = [
      '<p>Il retrouve brièvement sa fille Calliope, avant de la repousser.</p>',
      '<p>Aucun remplaçant n\'a été annoncé officiellement.</p>',
      '<p>Sorti le 12 février 2026 exclusivement sur PS5, le jeu change d\'époque.</p>',
    ].join('');
    const trouves = adverbesDe(html);
    expect(trouves).toContain('brièvement');
    expect(trouves).toContain('officiellement');
    expect(trouves).toContain('exclusivement');
  });

  it('l\'apostrophe typographique ne rouvre pas le trou', () => {
    // C'est la forme que porte le texte publié — « L’engouement », pas « L'engouement ».
    expect(adverbesDe('<p>L’engouement autour du secteur reste vif.</p>')).toEqual([]);
  });

  it('la correction mécanique n\'ampute plus la phrase', () => {
    // Le vrai dégât n'était pas le faux positif : c'était le bouton « Accepter ».
    const phrase = 'Après un affrontement titanesque, Kratos terrasse son ancien maître.';
    expect(adverbesDe(`<p>${phrase}</p>`)).toEqual([]);
    // Et si un nom passait malgré tout, la suppression resterait destructrice :
    // c'est pourquoi la garde est en DÉTECTION, pas en correction.
    expect(proposeMechanicalFix('adverbes', phrase, 'affrontement').apres)
      .toBe('Après un titanesque, Kratos terrasse son ancien maître.');
  });
});

describe('bug 2 — ne pas corriger un pattern par un autre', () => {
  const occ = [{ n: 1, id: 'verbes', terme: 'constitue', extrait: 'La franchise constitue un pilier du jeu vidéo depuis deux décennies.' }];

  it('le prompt NOMME les verbes proscrits', () => {
    // Le modèle ne peut pas éviter ce qu'il ne connaît pas.
    const p = buildStyleFixPrompt(occ);
    expect(p).toContain("s'impose");
    expect(p).toContain('constitue');
    expect(p).toContain('offre');
  });

  it('écarte la proposition qui réintroduit un verbe interdit', () => {
    // La proposition exacte vue en production.
    expect(normalizeStyleProposals(
      [{ n: 1, apres: "La franchise s'impose en pilier du jeu vidéo depuis deux décennies." }], occ,
    )).toEqual([]);
  });

  it('accepte une proposition réellement propre', () => {
    const out = normalizeStyleProposals(
      [{ n: 1, apres: 'La franchise domine le jeu vidéo depuis deux décennies.' }], occ,
    );
    expect(out).toHaveLength(1);
    expect(out[0].apres).toContain('domine');
  });

  it('ne rejette pas un pattern DÉJÀ présent dans l\'original', () => {
    // Sinon on perdrait la correction du participe présent sous prétexte que la
    // phrase porte encore « constitue », traité par sa propre occurrence.
    const o = [{ n: 1, id: 'participes', terme: 'permettant', extrait: 'Ce guide constitue une base, permettant de choisir un ordre.' }];
    const out = normalizeStyleProposals(
      [{ n: 1, apres: 'Ce guide constitue une base et aide à choisir un ordre.' }], o,
    );
    expect(out).toHaveLength(1);
  });

  it('écarte les notes de travail — jamais dans un article publié', () => {
    expect(normalizeStyleProposals(
      [{ n: 1, apres: 'La franchise domine le jeu vidéo depuis deux décennies [à vérifier].' }], occ,
    )).toEqual([]);
  });
});
