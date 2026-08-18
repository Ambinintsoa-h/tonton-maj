/**
 * auditSelection.test.js — VERROU : les cases pilotent les DEUX canaux.
 *
 * L'invariant protégé ici n'est pas « le filtre filtre » mais « aucune catégorie
 * décochée ne part au modèle ». L'audit voyageait par deux chemins simultanés
 * (le JSON de `summarizeAuditForRewrite` et la prose du textarea) : n'en filtrer
 * qu'un donnait des cases DÉCORATIVES — le pire résultat possible, puisque le
 * rédacteur voit disparaître de son écran une consigne qui part quand même.
 */
import {
  AUDIT_BLOCKS, SELECTABLE_FIELDS, FACTUAL_FIELDS, ALWAYS_SENT_FIELDS,
  defaultAuditSelection, filterAuditBySelection, isSelectionEmpty,
  unselectedFactualFields, selectedPriorities,
} from './auditSelection';
import { buildGenerationPrompt, buildFreshnessSuggestion } from './generationPrompt';
import { SCOPE_SIMPLE, SCOPE_REFONTE } from '../constants/majPhases';

const AUDIT = {
  ampleur: { decision: 'refonte_totale' },
  keyword_repositioning: { h1: 'quel ordre suivre god of war' },
  a_supprimer: [{ element: 'chiffre faux' }],
  sources_check: [{ affirmation: '76,5 millions de ventes' }],
  priority_actions: [
    { priority: 'P1', title: 'Intégrer le mot-clé dans le H1' },
    { priority: 'P2', title: 'Ajouter un bloc auteur EEAT' },
    { priority: 'P3', title: 'Ajouter un tableau comparatif' },
  ],
  recent_context: {
    donnees_obsoletes: [
      { element: 'Metascore Sons of Sparta', valeur_actuelle: '64/100', source: 'https://www.metacritic.com/x' },
    ],
    developpements_manquants: [
      {
        sujet: 'God of War: Laufey',
        description: 'sortie visée le 16 février 2027',
        nuance: 'à confirmer',
        source: 'https://www.playstation.com/fr-fr/god-of-war/',
      },
    ],
  },
  seo_geo_gaps: ['mot-clé absent du H1'],
  eeat_recommendations: ['encart auteur visible'],
  strategic_recommendation: ['remonter la section ordre'],
  tldr: ['trois ordres possibles'],
};

describe('périmètre des cases — le technique n\'y entre jamais', () => {
  // Décision Andrianina : les cases ne pilotent QUE le contenu. Si l'un de ces
  // noms entrait un jour dans la liste cochable, un verrou métier deviendrait
  // désactivable depuis l'interface. C'est ce que ce test empêche.
  it('aucun champ technique ni de cadrage n\'est cochable', () => {
    ['ampleur', 'keyword_repositioning', 'scores', 'pre_pub_checklist',
      'internal_linking', 'freshness_checks'].forEach((f) => {
      expect(SELECTABLE_FIELDS).not.toContain(f);
    });
    ALWAYS_SENT_FIELDS.forEach((f) => expect(SELECTABLE_FIELDS).not.toContain(f));
  });

  it('le bloc Factuel est distinct des améliorations', () => {
    // Les mêler dans une liste plate ferait décocher la véracité du même geste
    // distrait qu'une suggestion SEO.
    expect(FACTUAL_FIELDS).toEqual(['a_supprimer', 'sources_check']);
    const ameliorations = AUDIT_BLOCKS.find((b) => b.key === 'ameliorations').fields;
    FACTUAL_FIELDS.forEach((f) => expect(ameliorations).not.toContain(f));
  });
});

describe('pré-cochage par ampleur', () => {
  it('MAJ simple : fraîcheur SEULE — 200 mots ne portent pas trente consignes', () => {
    const sel = defaultAuditSelection(SCOPE_SIMPLE);
    expect(sel.recent_context).toBe(true);
    expect(selectedPriorities(sel)).toEqual([]);
    expect(sel.a_supprimer).toBe(false);
    expect(sel.sources_check).toBe(false);
    expect(isSelectionEmpty(sel)).toBe(false);
  });

  it('refonte : factuel et P1 pré-cochés, améliorations non', () => {
    const sel = defaultAuditSelection(SCOPE_REFONTE);
    expect(sel.a_supprimer).toBe(true);
    expect(sel.sources_check).toBe(true);
    expect(selectedPriorities(sel)).toEqual(['P1']);
    expect(sel.seo_geo_gaps).toBe(false);
    expect(sel.eeat_recommendations).toBe(false);
  });

  it('sur MAJ simple, l\'action « réduire la longueur » ne part pas', () => {
    // Le conflit historique : l'audit demandait « réduire de 3452 à 2500 mots »
    // pendant que le prompt exigeait « +200 mots minimum ». Le modèle a suivi
    // l'audit et RACCOURCI l'article de 935 mots. On n'arbitre plus ce conflit,
    // on ne le crée plus.
    const audit = {
      ...AUDIT,
      priority_actions: [{ priority: 'P1', title: 'Réduire la longueur de 3452 à 2500 mots' }],
    };
    const retenu = filterAuditBySelection(audit, defaultAuditSelection(SCOPE_SIMPLE));
    expect(retenu.priority_actions).toEqual([]);
  });
});

describe('filtrage', () => {
  it('ne garde que les priorités cochées', () => {
    const sel = { ...defaultAuditSelection(SCOPE_REFONTE), priority_actions: ['P1', 'P3'] };
    const p = filterAuditBySelection(AUDIT, sel).priority_actions.map((a) => a.priority);
    expect(p).toEqual(['P1', 'P3']);
  });

  it('une catégorie décochée est ABSENTE, pas vide', () => {
    // « seo_geo_gaps : null » se lirait « l'audit n'a rien trouvé » — faux, et le
    // modèle pourrait combler de lui-même.
    const retenu = filterAuditBySelection(AUDIT, defaultAuditSelection(SCOPE_REFONTE));
    expect('seo_geo_gaps' in retenu).toBe(false);
    expect('eeat_recommendations' in retenu).toBe(false);
  });

  it('les champs de cadrage traversent le filtre intacts', () => {
    const retenu = filterAuditBySelection(AUDIT, {});
    ALWAYS_SENT_FIELDS.forEach((f) => expect(retenu[f]).toEqual(AUDIT[f]));
  });

  it('sans sélection, l\'audit part entier — aucun changement pour l\'existant', () => {
    expect(filterAuditBySelection(AUDIT, null)).toBe(AUDIT);
  });

  it('n\'altère pas l\'audit d\'origine, qui est affiché et enregistré', () => {
    const copie = JSON.parse(JSON.stringify(AUDIT));
    filterAuditBySelection(AUDIT, defaultAuditSelection(SCOPE_SIMPLE));
    expect(AUDIT).toEqual(copie);
  });
});

describe('tout décoché n\'est pas « audit indisponible »', () => {
  const vide = {
    a_supprimer: false, sources_check: false, recent_context: false,
    priority_actions: [], seo_geo_gaps: false, eeat_recommendations: false,
    strategic_recommendation: false, tldr: false,
  };

  it('isSelectionEmpty distingue le décochage total de l\'absence de sélection', () => {
    expect(isSelectionEmpty(vide)).toBe(true);
    expect(isSelectionEmpty(null)).toBe(false);   // pas de sélection ≠ sélection vide
  });

  it('le prompt ne parle pas de « refonte totale prudente »', () => {
    const txt = buildGenerationPrompt({
      audit: AUDIT, selection: vide, scope: SCOPE_REFONTE, template: 'Tutoie le lecteur.',
    });
    expect(txt).toContain('écarté par le rédacteur');
    expect(txt).not.toMatch(/refonte totale prudente/i);
    expect(txt).toContain('Tutoie le lecteur.');   // ses directives survivent
  });
});

describe('avertissement de publication', () => {
  it('signale le factuel décoché, et seulement s\'il était rempli', () => {
    expect(unselectedFactualFields(defaultAuditSelection(SCOPE_SIMPLE), AUDIT))
      .toEqual(['a_supprimer', 'sources_check']);
    expect(unselectedFactualFields(defaultAuditSelection(SCOPE_REFONTE), AUDIT)).toEqual([]);
    // Rien à signaler si l'audit n'a lui-même rien trouvé.
    expect(unselectedFactualFields(
      defaultAuditSelection(SCOPE_SIMPLE), { a_supprimer: [], sources_check: [] },
    )).toEqual([]);
  });
});

describe('suggestion de fraîcheur pré-remplie', () => {
  it('reprend les faits de l\'audit et NOMME les sources', () => {
    const s = buildFreshnessSuggestion(AUDIT);
    expect(s).toContain('64/100');
    expect(s).toContain('16 février 2027');
    expect(s).toContain('playstation.com');
    expect(s).toContain('metacritic.com');
  });

  it('reprend la nuance et exige le conditionnel', () => {
    // Le point qui a lâché en production : « à confirmer » noyé dans un JSON de
    // dix champs, et le modèle a inventé « confirmé au Comic-Con le 24 juillet ».
    const s = buildFreshnessSuggestion(AUDIT);
    expect(s).toContain('à confirmer');
    expect(s).toContain('conditionnel');
  });

  it('rien à suggérer ne produit rien — aucun texte fabriqué', () => {
    expect(buildFreshnessSuggestion(null)).toBe('');
    expect(buildFreshnessSuggestion({ recent_context: {} })).toBe('');
  });

  it('n\'apparaît qu\'en MAJ simple, et sous les directives permanentes', () => {
    const simple = buildGenerationPrompt({
      audit: AUDIT, scope: SCOPE_SIMPLE, template: 'Tutoie le lecteur.',
      selection: defaultAuditSelection(SCOPE_SIMPLE),
    });
    expect(simple.indexOf('Tutoie le lecteur.')).toBeLessThan(simple.indexOf('Ajout de fraîcheur'));
    const refonte = buildGenerationPrompt({
      audit: AUDIT, scope: SCOPE_REFONTE, template: 'Tutoie le lecteur.',
      selection: defaultAuditSelection(SCOPE_REFONTE),
    });
    expect(refonte).not.toContain('Ajout de fraîcheur');
  });

  it('ne dépasse pas le plafond de l\'instruction', () => {
    // Sinon `runQatRewrite` la tronque par la fin, et ce sont les sources qui
    // sautent — précisément ce qu'on veut faire tenir.
    const gros = {
      ...AUDIT,
      recent_context: {
        donnees_obsoletes: Array.from({ length: 12 }, (_, i) => ({
          element: `donnée ${i} `.repeat(12), valeur_actuelle: 'x'.repeat(120), source: 'https://exemple.fr/a',
        })),
        developpements_manquants: Array.from({ length: 12 }, (_, i) => ({
          sujet: `sujet ${i} `.repeat(12), description: 'y'.repeat(120), source: 'https://exemple.fr/b',
        })),
      },
    };
    const txt = buildGenerationPrompt({
      audit: gros, scope: SCOPE_SIMPLE, selection: defaultAuditSelection(SCOPE_SIMPLE),
    });
    expect(txt.length).toBeLessThanOrEqual(1500);
  });
});
