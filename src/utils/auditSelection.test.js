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
  unselectedFactualFields, selectedPriorities, auditItemLines, sourceHost,
  defaultSelectionScope, isDefaultSelection, matchesScopeDefault,
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

describe('les cases MONTRENT les faits, pas seulement leur nombre', () => {
  // Le defaut vidait le dispositif de son sens : on demandait de TRANCHER sur un
  // compteur (« 4 »). Decider sans voir de quoi il s'agit, ce n'est pas decider.
  it('recent_context : les deux listes sont listees et DISTINGUEES', () => {
    const l = auditItemLines(AUDIT, 'recent_context');
    expect(l).toHaveLength(2);
    // Une donnee perimee n'est pas un developpement manquant : les fondre sans le
    // dire ferait lire « 4 » comme quatre choses de meme nature.
    expect(l[0].prefixe).toBe('Périmé');
    expect(l[1].prefixe).toBe('Manquant');
    expect(l[0].text).toContain('64/100');
    expect(l[1].text).toContain('16 février 2027');
  });

  it('la NUANCE et la SOURCE sont portees par la ligne', () => {
    // La nuance est le point EXACT qui a lache en production : « a confirmer »
    // noye dans un JSON, et le modele a ecrit « date confirmee au Comic-Con ».
    const l = auditItemLines(AUDIT, 'recent_context');
    expect(l[1].nuance).toBe('à confirmer');
    expect(l[1].source).toBe('playstation.com');
    expect(l[0].source).toBe('metacritic.com');
  });

  it('les listes de chaines simples passent telles quelles', () => {
    expect(auditItemLines(AUDIT, 'seo_geo_gaps')).toEqual([
      { text: 'mot-clé absent du H1', nuance: '', source: '' },
    ]);
    expect(auditItemLines(AUDIT, 'tldr')[0].text).toBe('trois ordres possibles');
  });

  it('les objets factuels sont rendus lisibles', () => {
    expect(auditItemLines(AUDIT, 'a_supprimer')[0].text).toBe('chiffre faux');
    expect(auditItemLines(AUDIT, 'sources_check')[0].text).toBe('76,5 millions de ventes');
  });

  it('une forme INATTENDUE est montree, jamais silencieusement ignoree', () => {
    // Le modele rend parfois du texte libre la ou le schema prevoit un objet.
    // L'ignorer afficherait « 4 » avec deux lignes en dessous : pire qu'imparfait.
    const l = auditItemLines({ seo_geo_gaps: [{ inattendu: 'un manque decrit autrement' }] }, 'seo_geo_gaps');
    expect(l[0].text).toBe('un manque decrit autrement');
  });

  it('rien a montrer ne fabrique rien', () => {
    expect(auditItemLines(null, 'recent_context')).toEqual([]);
    expect(auditItemLines({}, 'a_supprimer')).toEqual([]);
    expect(auditItemLines({ recent_context: {} }, 'recent_context')).toEqual([]);
  });

  it('sourceHost reduit l\'URL a son hote, et encaisse une URL cassee', () => {
    expect(sourceHost('https://www.metacritic.com/game/x?a=1')).toBe('metacritic.com');
    expect(sourceHost('pas-une-url')).toBe('');
    expect(sourceHost(null)).toBe('');
  });
});

/**
 * VERROU : les cases SUIVENT l'ampleur.
 *
 * Défaut du 20 août 2026 — `selectionTouchee` passait à vrai sur la simple
 * RELECTURE de la sélection enregistrée. Comme l'autosave tourne en continu,
 * choisir « MAJ simple » ne redécochait plus les actions P1 dès le premier
 * enregistrement : les trente consignes d'une refonte partaient sur une mise à
 * jour de 200 mots. Le conflit exact que le pré-cochage par ampleur existe pour
 * ne pas créer (une action « réduire à 2 500 mots » avait RACCOURCI un article
 * de 935 mots).
 */
describe('une selection qui n exprime aucun choix propre', () => {
  it('reconnait le pre-cochage de chaque ampleur', () => {
    expect(defaultSelectionScope(defaultAuditSelection(SCOPE_SIMPLE))).toBe(SCOPE_SIMPLE);
    expect(defaultSelectionScope(defaultAuditSelection(SCOPE_REFONTE))).toBe(SCOPE_REFONTE);
    expect(isDefaultSelection(defaultAuditSelection(SCOPE_SIMPLE))).toBe(true);
  });

  it('une selection ARBITREE n est le pre-cochage d aucune ampleur', () => {
    const arbitree = { ...defaultAuditSelection(SCOPE_SIMPLE), tldr: true };
    expect(defaultSelectionScope(arbitree)).toBeNull();
    expect(isDefaultSelection(arbitree)).toBe(false);
  });

  it('l ordre des priorites est indifferent — P1,P2 vaut P2,P1', () => {
    const a = { ...defaultAuditSelection(SCOPE_REFONTE), priority_actions: ['P2', 'P1'] };
    const b = { ...defaultAuditSelection(SCOPE_REFONTE), priority_actions: ['P1', 'P2'] };
    // Ni l un ni l autre n est un pre-cochage (le defaut refonte est ['P1'] seul),
    // mais ils doivent etre juges IDENTIQUEMENT.
    expect(defaultSelectionScope(a)).toBe(defaultSelectionScope(b));
  });

  it('un tableau vide et un faux sont le MEME choix : rien de coche', () => {
    // `priority_actions: []` et `priority_actions: false` disent tous deux
    // « aucune action ». Les distinguer ferait passer une selection par defaut
    // pour un arbitrage.
    const avecFaux = { ...defaultAuditSelection(SCOPE_SIMPLE), priority_actions: false };
    expect(defaultSelectionScope(avecFaux)).toBe(SCOPE_SIMPLE);
  });

  it('CAS REEL : le pre-cochage d une REFONTE sur un ecran en MAJ simple', () => {
    // Ce qu Andrianina voyait : cases de refonte, ampleur MAJ simple, note
    // « + 9 points d audit non repris ».
    const heritee = defaultAuditSelection(SCOPE_REFONTE);
    expect(matchesScopeDefault(heritee, SCOPE_SIMPLE)).toBe(false);   // ne suit pas l ampleur
    expect(isDefaultSelection(heritee)).toBe(true);                   // donc rejouable sans rien ecraser
  });

  it('matchesScopeDefault repond faux sur une selection absente', () => {
    expect(matchesScopeDefault(null, SCOPE_SIMPLE)).toBe(false);
  });

  it('les P1 REDEVIENNENT decochees en MAJ simple — la promesse du dispositif', () => {
    // Bout en bout : on part du pre-cochage refonte, on rejoue celui de la MAJ
    // simple, et l audit filtre ne porte plus aucune action.
    const rejoue = defaultAuditSelection(SCOPE_SIMPLE);
    expect(filterAuditBySelection(AUDIT, rejoue).priority_actions).toEqual([]);
    expect(filterAuditBySelection(AUDIT, defaultAuditSelection(SCOPE_REFONTE)).priority_actions)
      .toHaveLength(1);
  });
});
