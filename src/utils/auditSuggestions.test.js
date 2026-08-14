/**
 * Verrou du pré-remplissage du maillage par les suggestions de l'AUDIT.
 *
 * Le défaut corrigé : l'audit proposait déjà des paires ancre + URL, le panneau
 * QAT les affichait, et elles n'allaient nulle part — il fallait les recopier à
 * la main dans le champ de saisie. Le travail était fait, puis jeté.
 */
import { auditSuggestedLinkRows, mergeLinkRows, urlKey } from './auditSuggestions';
import { INTERNAL_LINK_ROWS_MAX } from '../constants/majMode';

// Audit réel (article isolation phonique), tel que le modèle le rend.
const AUDIT = {
  internal_linking: {
    liens_entrants: [
      { ancre: 'laine de roche comme alternative minérale',
        url: 'https://isolation-phonique.com/choix-isolant-phonique/materiaux-isolants/laine-de-roche/',
        contexte: 'Dans la section comparaison avec d\'autres isolants.' },
      { ancre: 'le polystyrène extrudé',
        url: 'https://isolation-phonique.com/choix-isolant-phonique/materiaux-isolants/polystyrene-extrude/',
        contexte: 'Lors de la comparaison des isolants synthétiques.' },
      { ancre: 'grille de prix de l\'isolation phonique',
        url: 'https://isolation-phonique.com/guide-isolation-phonique/prix-isolation-phonique/',
        contexte: 'Dans la section prix.' },
      { ancre: 'isoler efficacement vos combles',
        url: 'https://isolation-phonique.com/choix-isolant-phonique/isolation-combles/',
        contexte: 'Dans la section utilisations.' },
    ],
  },
};

describe('auditSuggestedLinkRows — les suggestions de l\'audit deviennent des lignes de saisie', () => {
  it('reprend les 4 paires, ancre et URL, dans l\'ordre', () => {
    const rows = auditSuggestedLinkRows(AUDIT);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      anchor: 'laine de roche comme alternative minérale',
      url: 'https://isolation-phonique.com/choix-isolant-phonique/materiaux-isolants/laine-de-roche/',
    });
    expect(rows[3].anchor).toBe('isoler efficacement vos combles');
  });

  it('n\'emporte PAS le contexte : le champ ne saisit qu\'ancre + URL', () => {
    expect(Object.keys(auditSuggestedLinkRows(AUDIT)[0]).sort()).toEqual(['anchor', 'url']);
  });

  it('ignore une suggestion sans ancre ou sans URL', () => {
    const rows = auditSuggestedLinkRows({ internal_linking: { liens_entrants: [
      { ancre: 'complet', url: '/ok' },
      { ancre: 'sans url' },
      { url: '/sans-ancre' },
      { ancre: '   ', url: '/vide' },
    ] } });
    expect(rows).toEqual([{ anchor: 'complet', url: '/ok' }]);
  });

  it('REFUSE un champ objet au lieu de le transformer en JSON', () => {
    const rows = auditSuggestedLinkRows({ internal_linking: { liens_entrants: [
      { ancre: { a: 1 }, url: '/x' },
    ] } });
    expect(rows).toEqual([]);
  });

  it('dédoublonne par URL — casse et slash final ne distinguent rien', () => {
    const rows = auditSuggestedLinkRows({ internal_linking: { liens_entrants: [
      { ancre: 'première', url: 'https://site.fr/Page/' },
      { ancre: 'seconde',  url: 'https://site.fr/page' },
    ] } });
    expect(rows).toHaveLength(1);
    expect(rows[0].anchor).toBe('première');
  });

  it('rend [] sur un audit absent, vide ou malformé', () => {
    expect(auditSuggestedLinkRows(null)).toEqual([]);
    expect(auditSuggestedLinkRows({})).toEqual([]);
    expect(auditSuggestedLinkRows({ internal_linking: {} })).toEqual([]);
    expect(auditSuggestedLinkRows({ internal_linking: { liens_entrants: 'pas un tableau' } })).toEqual([]);
  });

  it('plafonne au maximum de lignes du formulaire', () => {
    const beaucoup = Array.from({ length: INTERNAL_LINK_ROWS_MAX + 8 }, (_, i) => ({ ancre: `a${i}`, url: `/u${i}` }));
    expect(auditSuggestedLinkRows({ internal_linking: { liens_entrants: beaucoup } }))
      .toHaveLength(INTERNAL_LINK_ROWS_MAX);
  });

  it('n\'écarte PAS une URL hors domaine — ce filtre est en aval (règle 8)', () => {
    // Le pré-remplissage ne filtre pas : `cleanLinkRows`/`filterSameSiteLinks`
    // écartent, et le champ le DIT en rouge. Faire disparaître la ligne ici
    // priverait le rédacteur de l'explication.
    const rows = auditSuggestedLinkRows({ internal_linking: { liens_entrants: [
      { ancre: 'ailleurs', url: 'https://concurrent.fr/x' },
    ] } });
    expect(rows).toEqual([{ anchor: 'ailleurs', url: 'https://concurrent.fr/x' }]);
  });
});

describe('mergeLinkRows — AJOUT seulement, la saisie du rédacteur prime', () => {
  it('verse les suggestions à la suite des lignes saisies', () => {
    const out = mergeLinkRows([{ anchor: 'ma paire', url: '/a-moi' }], [{ anchor: 'audit', url: '/audit' }]);
    expect(out).toEqual([{ anchor: 'ma paire', url: '/a-moi' }, { anchor: 'audit', url: '/audit' }]);
  });

  it('remplace les lignes VIDES de placeholder', () => {
    const out = mergeLinkRows([{ anchor: '', url: '' }], [{ anchor: 'audit', url: '/audit' }]);
    expect(out).toEqual([{ anchor: 'audit', url: '/audit' }]);
  });

  it('n\'ajoute pas une URL déjà saisie, même sous une AUTRE ancre', () => {
    const out = mergeLinkRows(
      [{ anchor: 'mon ancre à moi', url: 'https://site.fr/page' }],
      [{ anchor: 'ancre de l\'audit', url: 'https://site.fr/page/' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].anchor).toBe('mon ancre à moi');
  });

  it('est IDEMPOTENT — refusionner ne duplique rien', () => {
    const sugg = auditSuggestedLinkRows(AUDIT);
    const une = mergeLinkRows([{ anchor: '', url: '' }], sugg);
    const deux = mergeLinkRows(une, sugg);
    expect(deux).toEqual(une);
    expect(deux).toHaveLength(4);
  });

  it('une ligne supprimée par le rédacteur ne revient pas si on refusionne le RESTE', () => {
    // Le garde-fou réel est le ref « déjà versé » dans ArticleResult ; ici on
    // vérifie au moins que la fusion ne réinvente pas une ligne absente des
    // suggestions passées.
    const out = mergeLinkRows([{ anchor: 'gardée', url: '/gardee' }], []);
    expect(out).toEqual([{ anchor: 'gardée', url: '/gardee' }]);
  });

  it('rend une ligne vide quand il n\'y a rien du tout — le champ reste utilisable', () => {
    expect(mergeLinkRows([], [])).toEqual([{ anchor: '', url: '' }]);
    expect(mergeLinkRows([{ anchor: '', url: '' }], [])).toEqual([{ anchor: '', url: '' }]);
  });

  it('plafonne au maximum de lignes', () => {
    const beaucoup = Array.from({ length: INTERNAL_LINK_ROWS_MAX + 5 }, (_, i) => ({ anchor: `a${i}`, url: `/u${i}` }));
    expect(mergeLinkRows([], beaucoup)).toHaveLength(INTERNAL_LINK_ROWS_MAX);
  });
});

describe('urlKey', () => {
  it('neutralise casse, espaces et slash final', () => {
    expect(urlKey('  https://Site.fr/Page//  ')).toBe('https://site.fr/page');
  });
});
