/**
 * Verrou : la progression du tutoriel est un confort, jamais un point de panne.
 * Le navigateur peut refuser localStorage (navigation privée, quota, site bloqué) :
 * le tutoriel doit alors s'afficher quand même, simplement sans mémoire.
 */
import {
  lireChapitresLus, basculerChapitreLu, lireCoches, basculerCoche,
} from './progression';

const faux = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _m: m,
  };
};

describe('chapitres lus', () => {
  it('commence vide', () => {
    expect(lireChapitresLus('u1', 'redacteur', faux())).toEqual([]);
  });

  it('coche puis décoche', () => {
    const s = faux();
    expect(basculerChapitreLu('u1', 'redacteur', 'bienvenue', s)).toEqual(['bienvenue']);
    expect(lireChapitresLus('u1', 'redacteur', s)).toEqual(['bienvenue']);
    expect(basculerChapitreLu('u1', 'redacteur', 'bienvenue', s)).toEqual([]);
  });

  it('est cloisonnée par membre : la progression d\'un collègue n\'est jamais la vôtre', () => {
    const s = faux();
    basculerChapitreLu('u1', 'redacteur', 'bienvenue', s);
    expect(lireChapitresLus('u2', 'redacteur', s)).toEqual([]);
  });

  it('est cloisonnée par parcours', () => {
    const s = faux();
    basculerChapitreLu('u1', 'admin', 'admin-apercu', s);
    expect(lireChapitresLus('u1', 'redacteur', s)).toEqual([]);
    expect(lireChapitresLus('u1', 'admin', s)).toEqual(['admin-apercu']);
  });

  it('un membre inconnu partage une clé « anonyme » plutôt que de planter', () => {
    const s = faux();
    basculerChapitreLu(undefined, 'redacteur', 'bienvenue', s);
    expect([...s._m.keys()][0]).toContain(':anonyme:');
  });
});

describe('listes « À faire »', () => {
  it('coche et décoche une étape', () => {
    const s = faux();
    expect(basculerCoche('u1', 'premiere-maj', 'url', s)).toEqual(['url']);
    expect(basculerCoche('u1', 'premiere-maj', 'mot-cle', s)).toEqual(['url', 'mot-cle']);
    expect(basculerCoche('u1', 'premiere-maj', 'url', s)).toEqual(['mot-cle']);
    expect(lireCoches('u1', 'premiere-maj', s)).toEqual(['mot-cle']);
  });
});

describe('un stockage défaillant ne casse rien', () => {
  const casse = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
  };

  it('la lecture rend une liste vide', () => {
    expect(lireChapitresLus('u1', 'redacteur', casse)).toEqual([]);
    expect(lireCoches('u1', 'x', casse)).toEqual([]);
  });

  it('l\'écriture ne lève pas et rend quand même la nouvelle liste', () => {
    expect(basculerChapitreLu('u1', 'redacteur', 'bienvenue', casse)).toEqual(['bienvenue']);
    expect(basculerCoche('u1', 'x', 'a', casse)).toEqual(['a']);
  });
});

describe('une valeur corrompue est ignorée', () => {
  it('du JSON invalide', () => {
    const s = faux();
    s.setItem('tonton_tuto_v1:u1:redacteur:lus', '{pas du json');
    expect(lireChapitresLus('u1', 'redacteur', s)).toEqual([]);
  });

  it('un JSON qui n\'est pas une liste', () => {
    const s = faux();
    s.setItem('tonton_tuto_v1:u1:redacteur:lus', '{"a":1}');
    expect(lireChapitresLus('u1', 'redacteur', s)).toEqual([]);
  });

  it('une liste contenant autre chose que du texte : seuls les textes sont gardés', () => {
    const s = faux();
    s.setItem('tonton_tuto_v1:u1:redacteur:lus', '["bienvenue", 3, null, {"x":1}]');
    expect(lireChapitresLus('u1', 'redacteur', s)).toEqual(['bienvenue']);
  });
});
