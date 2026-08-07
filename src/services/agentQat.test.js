// Tests des fonctions pures du mode « Audit QAT + Refonte ».
// resolveQatDepth porte l'arbitrage produit : l'audit propose l'ampleur, un
// choix explicite du rédacteur prime toujours (item 11).
/* eslint-env jest */
import { parseJsonLoose, repairTruncatedJson, repairJsonStructure, resolveQatDepth } from './agentQat';

describe('parseJsonLoose', () => {
  test('JSON nu', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  test('JSON entouré de backticks ```json', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('JSON précédé et suivi de bavardage', () => {
    expect(parseJsonLoose('Voici le rapport :\n{"a":1}\nVoilà.')).toEqual({ a: 1 });
  });

  test('objet imbriqué : on ne coupe pas au premier }', () => {
    expect(parseJsonLoose('bla {"a":{"b":2},"c":3} bla')).toEqual({ a: { b: 2 }, c: 3 });
  });

  test('chaîne vide ou JSON irrécupérable → null', () => {
    expect(parseJsonLoose('')).toBeNull();
    expect(parseJsonLoose('pas de json ici')).toBeNull();
    expect(parseJsonLoose('{"a":')).toBeNull();
  });

  test('JSON tronqué → null par défaut, récupéré avec salvage:true', () => {
    // Réponse coupée par la limite de tokens, au milieu d'un tableau.
    const cut = '{"scores":{"ia":6,"geo":5},"executive_summary":"Article daté.","priority_actions":[{"priority":"P1","title":"Réécrire"},{"priority":"P1","tit';
    expect(parseJsonLoose(cut)).toBeNull();
    const saved = parseJsonLoose(cut, { salvage: true });
    expect(saved.scores).toEqual({ ia: 6, geo: 5 });
    expect(saved.executive_summary).toBe('Article daté.');
    // La coupure se fait au dernier champ COMPLET, y compris à l'intérieur du
    // dernier élément : celui-ci survit donc partiellement (ici sans `title`).
    // C'est voulu — mieux vaut une action de trop, incomplète et rendue vide par
    // l'affichage, que perdre tout l'audit.
    expect(saved.priority_actions).toEqual([
      { priority: 'P1', title: 'Réécrire' },
      { priority: 'P1' },
    ]);
  });
});

describe('repairJsonStructure — accolade fermante parasite', () => {
  // Cas RÉEL observé en production : audit de 10 107 tokens (donc non tronqué),
  // le modèle ferme l'objet racine au tiers du document après
  // « executive_summary ». Deux tiers de l'audit étaient perdus.
  const reel = `\`\`\`json
{
  "scores": { "ia": 4.2, "global": 4.3, "justification": "Lacunes majeures." },
  "executive_summary": "L'article décrit Open Spoken AI mais s'éloigne du mot-clé."
  },
  "qat_assessment": {
    "quality": { "score": 4.0, "tldr_present": true, "detail": "TL;DR non balisé." }
  },
  "priority_actions": [
    { "priority": "P1", "title": "Recentrer sur le mot-clé", "detail": "…", "snippet": null }
  ],
  "ampleur": { "decision": "refonte_totale", "justification": "Score 4,3/10." }
}
\`\`\``;

  test('récupère la TOTALITÉ de l\'audit, pas seulement le début', () => {
    const strict = parseJsonLoose(reel.replace(/```json|```/g, ''));
    // La réparation est intégrée à parseJsonLoose : le résultat doit être complet.
    expect(strict).not.toBeNull();
    expect(strict.scores.global).toBe(4.3);
    expect(strict.qat_assessment.quality.score).toBe(4.0);      // APRÈS la parasite
    expect(strict.priority_actions).toHaveLength(1);
    expect(strict.ampleur.decision).toBe('refonte_totale');     // la décision clé
  });

  test('fonctionne aussi à travers les backticks ```json', () => {
    const r = parseJsonLoose(reel);
    expect(r.ampleur.decision).toBe('refonte_totale');
  });

  test('JSON valide → aucune réparation, retour null (on ne touche à rien)', () => {
    expect(repairJsonStructure('{"a":1,"b":{"c":2}}')).toBeNull();
  });

  test('crochet fermant parasite dans un tableau racine imbriqué', () => {
    const cut = '{"a":[1,2],"b":"x"],"c":3}';
    expect(repairJsonStructure(cut)).toEqual({ a: [1, 2], b: 'x', c: 3 });
  });

  test('texte de conclusion après un JSON VALIDE → pas de faux positif', () => {
    // Ici la dernière accolade est légitime : la réparation doit échouer
    // proprement et laisser les autres stratégies faire leur travail.
    expect(parseJsonLoose('{"a":1,"b":2}\nVoilà le rapport.')).toEqual({ a: 1, b: 2 });
  });
});

describe('repairTruncatedJson', () => {
  test('coupure au milieu d\'une chaîne contenant une accolade', () => {
    const cut = '{"a":1,"b":"texte avec { et } dedans","c":"coupé au mi';
    const r = repairTruncatedJson(cut);
    expect(r).toEqual({ a: 1, b: 'texte avec { et } dedans' });
  });

  test('objets imbriqués refermés dans le bon ordre', () => {
    const cut = '{"x":{"y":{"z":1},"w":2},"v":[1,2,3],"u":{"t":';
    expect(repairTruncatedJson(cut)).toEqual({ x: { y: { z: 1 }, w: 2 }, v: [1, 2, 3] });
  });

  test('moins de deux champs exploitables → null (inutilisable comme audit)', () => {
    expect(repairTruncatedJson('{"scores":{"ia":6},"exec')).toBeNull();
  });

  test('entrée sans accolade → null', () => {
    expect(repairTruncatedJson('Voici votre audit :')).toBeNull();
  });
});

describe('resolveQatDepth — l\'audit propose, le rédacteur tranche', () => {
  const refonte = { ampleur: { decision: 'refonte_totale' } };
  const ciblee  = { ampleur: { decision: 'maj_ciblee' } };
  const restru  = { ampleur: { decision: 'restructuration' } };

  test('auto + audit restructuration → restructuration (fond conservé, plan refait)', () => {
    expect(resolveQatDepth('auto', restru)).toEqual({ depth: 'restructuration', source: 'audit', overridden: false });
  });

  test('le rédacteur peut imposer refonte ou ciblée contre une restructuration', () => {
    expect(resolveQatDepth('refonte', restru)).toEqual({ depth: 'refonte', source: 'redacteur', overridden: true });
    expect(resolveQatDepth('legere', restru)).toEqual({ depth: 'ciblee', source: 'redacteur', overridden: true });
  });

  test('decision inconnue → refonte prudente, pas de crash', () => {
    expect(resolveQatDepth('auto', { ampleur: { decision: 'n_importe_quoi' } }).depth).toBe('refonte');
  });

  test('auto + audit refonte → refonte, décidée par l\'audit', () => {
    expect(resolveQatDepth('auto', refonte)).toEqual({ depth: 'refonte', source: 'audit', overridden: false });
  });

  test('auto + audit MAJ ciblée → ciblée, décidée par l\'audit', () => {
    expect(resolveQatDepth('auto', ciblee)).toEqual({ depth: 'ciblee', source: 'audit', overridden: false });
  });

  test('choix explicite du rédacteur qui CONTREDIT l\'audit → le rédacteur gagne, flag overridden', () => {
    expect(resolveQatDepth('legere', refonte)).toEqual({ depth: 'ciblee', source: 'redacteur', overridden: true });
    expect(resolveQatDepth('refonte', ciblee)).toEqual({ depth: 'refonte', source: 'redacteur', overridden: true });
  });

  test('choix explicite du rédacteur ALIGNÉ sur l\'audit → pas de flag', () => {
    expect(resolveQatDepth('refonte', refonte)).toEqual({ depth: 'refonte', source: 'redacteur', overridden: false });
    expect(resolveQatDepth('legere', ciblee)).toEqual({ depth: 'ciblee', source: 'redacteur', overridden: false });
  });

  test('audit absent ou ampleur manquante → refonte prudente', () => {
    expect(resolveQatDepth('auto', null).depth).toBe('refonte');
    expect(resolveQatDepth('auto', {}).depth).toBe('refonte');
    expect(resolveQatDepth(undefined, null).depth).toBe('refonte');
  });
});
