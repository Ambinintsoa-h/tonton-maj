// Tests des fonctions pures du mode « Audit QAT + Refonte ».
// resolveQatDepth porte l'arbitrage produit : l'audit propose l'ampleur, un
// choix explicite du rédacteur prime toujours (item 11).
/* eslint-env jest */
import { parseJsonLoose, resolveQatDepth } from './agentQat';

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
