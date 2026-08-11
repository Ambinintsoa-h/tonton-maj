// Le flag de backend a un DÉFAUT ('firestore') qui n'est pas une vérité : tant que
// GET /api/backend n'a pas répondu, tout appel aiguillé part vers Firestore, non
// initialisé en production. Ces tests verrouillent le signal de résolution qui
// permet d'attendre — et surtout le fait qu'il se débloque dans TOUS les cas,
// sinon un appelant qui attend resterait bloqué pour toujours.
/* eslint-env jest */

describe('backendMode — signal de résolution', () => {
  // Module à état global : on le recharge à chaque test pour repartir de zéro.
  let m;
  beforeEach(() => {
    jest.resetModules();
    m = require('./backendMode');
  });

  test('avant toute lecture : défaut firestore, et NON résolu', () => {
    expect(m.getBackend()).toBe('firestore');
    expect(m.isBackendResolved()).toBe(false);
  });

  test('setBackend fixe la valeur ET marque la résolution', () => {
    m.setBackend('mysql');
    expect(m.getBackend()).toBe('mysql');
    expect(m.isMysql()).toBe(true);
    expect(m.isBackendResolved()).toBe(true);
  });

  test('backendReady se résout quand le flag est lu', async () => {
    const attente = m.backendReady();
    m.setBackend('mysql');
    await expect(attente).resolves.toBe('mysql');
  });

  test('ÉCHEC du fetch : markBackendResolved débloque sur le défaut', async () => {
    // C'est le cas critique : sans ça, un /api/backend en échec laisserait la
    // restauration du brouillon attendre indéfiniment.
    const attente = m.backendReady();
    m.markBackendResolved();
    await expect(attente).resolves.toBe('firestore');
    expect(m.isBackendResolved()).toBe(true);
  });

  test('une valeur inconnue ne change pas le backend mais résout quand même', () => {
    m.setBackend('postgres');
    expect(m.getBackend()).toBe('firestore');
    expect(m.isBackendResolved()).toBe(true);
  });

  test('résolutions répétées : idempotent, la première valeur tient', async () => {
    const attente = m.backendReady();
    m.setBackend('mysql');
    m.markBackendResolved();
    m.markBackendResolved();
    await expect(attente).resolves.toBe('mysql');
    expect(m.getBackend()).toBe('mysql');
  });

  test('attendre APRÈS la résolution ne bloque pas', async () => {
    m.setBackend('mysql');
    await expect(m.backendReady()).resolves.toBe('mysql');
  });
});
