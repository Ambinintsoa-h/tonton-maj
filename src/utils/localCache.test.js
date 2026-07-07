// Tests du cache local robuste (quota-safe) — localCache
/* eslint-env jest */
import {
  slimHistoryForCache, slimPendingForCache, safeSetItem, persistHistory,
} from './localCache';
import { STORAGE_KEYS } from '../constants/storage';

const BIG_HTML = '<p>' + 'x'.repeat(50) + '</p>';

const historyEntry = (id) => ({
  id,
  title: `Article ${id}`,
  url: `https://site.com/${id}`,
  keyword: 'kw',
  updatedContentUrl: `https://storage/${id}/updated.html`,
  originalContent: BIG_HTML,
  updatedContent: BIG_HTML,
  audit: 'A'.repeat(200),
  analysis: 'B'.repeat(200),
  updates: [{ applied: true, pass: 1, original: 'o'.repeat(100), updated: 'u'.repeat(100) }],
  lastModifiedAt: 123,
  lastModifiedBy: 'Andrianina',
});

beforeEach(() => { localStorage.clear(); });

describe('slimHistoryForCache', () => {
  it('retire le HTML et les gros textes, garde les métadonnées + URLs', () => {
    const [e] = slimHistoryForCache([historyEntry('1')]);
    expect(e.originalContent).toBeUndefined();
    expect(e.updatedContent).toBeUndefined();
    expect(e.audit).toBeUndefined();
    expect(e.analysis).toBeUndefined();
    expect(e.title).toBe('Article 1');
    expect(e.updatedContentUrl).toBe('https://storage/1/updated.html');
    expect(e.lastModifiedBy).toBe('Andrianina');
  });

  it('réduit les updates à { applied, pass } (compteurs préservés, textes retirés)', () => {
    const [e] = slimHistoryForCache([historyEntry('1')]);
    expect(e.updates).toEqual([{ applied: true, pass: 1 }]);
    expect(JSON.stringify(e)).not.toContain('oooo');
  });

  it('plafonne à 150 entrées (les plus récentes en tête)', () => {
    const big = Array.from({ length: 300 }, (_, i) => historyEntry(String(i)));
    const slim = slimHistoryForCache(big);
    expect(slim.length).toBe(150);
    expect(slim[0].id).toBe('0');
  });
});

describe('slimPendingForCache', () => {
  it('retire le HTML de majResult, garde le reste + marqueur contentInHistory', () => {
    const [e] = slimPendingForCache([{
      id: 'p1', status: 'a_valider',
      majResult: { articleTitle: 'T', originalContent: BIG_HTML, updatedContent: BIG_HTML, audit: 'x', updates: [{ applied: true }] },
    }]);
    expect(e.majResult.originalContent).toBeUndefined();
    expect(e.majResult.updatedContent).toBeUndefined();
    expect(e.majResult.audit).toBeUndefined();
    expect(e.majResult.articleTitle).toBe('T');
    expect(e.majResult.contentInHistory).toBe(true);
    expect(e.status).toBe('a_valider');
  });

  it('laisse intacts les items sans majResult', () => {
    const item = { id: 'p2', status: 'pending' };
    expect(slimPendingForCache([item])[0]).toEqual(item);
  });
});

describe('safeSetItem — tolérance au quota', () => {
  it('écrit normalement et retourne true', () => {
    expect(safeSetItem('k', { a: 1 })).toBe(true);
    expect(JSON.parse(localStorage.getItem('k'))).toEqual({ a: 1 });
  });

  it('ne lève jamais et retourne false si le quota est saturé', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = jest.fn(() => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; });
    try {
      let res;
      expect(() => { res = safeSetItem('k', 'v'); }).not.toThrow();
      expect(res).toBe(false);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});

describe('persistHistory — écriture dégressive quota-safe', () => {
  it('persiste une version allégée (sans HTML) sous la bonne clé', () => {
    persistHistory([historyEntry('1'), historyEntry('2')]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.history));
    expect(stored.length).toBe(2);
    expect(stored[0].updatedContent).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('<p>');
  });

  it('réduit le nombre d\'entrées quand le quota déborde, sans jamais lever', () => {
    const orig = Storage.prototype.setItem;
    let calls = 0;
    // Échoue tant que la charge dépasse ~400 caractères → force le dégressif
    Storage.prototype.setItem = jest.fn(function (key, val) {
      calls += 1;
      if (val && val.length > 400) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return orig.call(this, key, val);
    });
    try {
      const big = Array.from({ length: 40 }, (_, i) => historyEntry(String(i)));
      let ok;
      expect(() => { ok = persistHistory(big); }).not.toThrow();
      expect(ok).toBe(true);
      expect(calls).toBeGreaterThan(1); // au moins un échec puis réduction
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.history));
      expect(stored.length).toBeLessThan(40);
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
