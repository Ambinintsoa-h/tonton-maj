/* eslint-env jest */
/**
 * Cache des historiques de position (proxy.js) — alimente le bilan « Effet des MAJ ».
 *
 * Même procédé que haloscanCron.test.js : proxy.js n'est pas importable depuis
 * jest (il démarre un serveur au chargement), on inspecte donc sa source. Ces
 * tests ne vérifient pas que le code « marche » — ils verrouillent les quelques
 * décisions qui coûtent cher à re-perdre : le budget Haloscan, l'historique
 * déjà payé, et la frontière entre la route et le calcul.
 */
import fs from 'fs';
import path from 'path';

const proxySrc = () => fs.readFileSync(path.join(__dirname, '..', '..', 'proxy.js'), 'utf8');
const corps = (nom) => {
  const m = proxySrc().match(new RegExp(`const ${nom} = async \\([^)]*\\) => \\{[\\s\\S]*?\\n\\};`));
  expect(m).not.toBeNull();
  return m[0];
};

describe('_seoCacheEcrire — un échec ne détruit jamais une courbe déjà payée', () => {
  test('la branche erreur ne met à jour QUE fetched_at et error', () => {
    const body = corps('_seoCacheEcrire');
    const brancheErreur = body.slice(0, body.indexOf('return;') + 7);
    // Si history=VALUES(history) apparaissait ici, un timeout passager
    // écraserait une courbe valide par NULL — et le dashboard afficherait
    // « page inconnue d'Haloscan » pour une page parfaitement suivie.
    expect(brancheErreur).toMatch(/ON DUPLICATE KEY UPDATE fetched_at=VALUES\(fetched_at\), error=VALUES\(error\)/);
    expect(brancheErreur).not.toMatch(/history=VALUES\(history\)/);
  });

  test('la branche succès efface l\'erreur précédente', () => {
    // Sans error=NULL, une URL réparée resterait marquée en échec pour toujours.
    expect(corps('_seoCacheEcrire')).toMatch(/fetched_at=VALUES\(fetched_at\), error=NULL/);
  });

  test('un échec écrit quand même la date — sinon le couple est rappelé à chaque passe', () => {
    const body = corps('_seoCacheEcrire');
    const brancheErreur = body.slice(0, body.indexOf('return;') + 7);
    expect(brancheErreur).toMatch(/Date\.now\(\)/);
  });
});

describe('_seoDashboardRefresh — le budget Haloscan est borné par le code', () => {
  test('un délai de 7 jours et un plafond par passe, tous deux nommés', () => {
    const s = proxySrc();
    expect(s).toMatch(/const SEO_CACHE_TTL_MS\s*=\s*7 \* 24 \* 60 \* 60 \* 1000;/);
    expect(s).toMatch(/const SEO_CACHE_PAR_PASSE\s*=\s*15;/);
  });

  test('la passe filtre sur le délai ET tronque au plafond', () => {
    const body = corps('_seoDashboardRefresh');
    expect(body).toMatch(/limite = Date\.now\(\) - SEO_CACHE_TTL_MS/);
    expect(body).toMatch(/\.filter\(\(c\) => \(vuLe\.get\(c\.hash\) \|\| 0\) <= limite\)/);
    expect(body).toMatch(/\.slice\(0, SEO_CACHE_PAR_PASSE\)/);
  });

  test('rien ne part sans clé Haloscan ni hors MySQL', () => {
    expect(corps('_seoDashboardRefresh')).toMatch(/if \(!haloscanKey \|\| DATA_BACKEND !== 'mysql'\) return;/);
  });

  test('les couples jamais relevés passent en premier', () => {
    // Sans ce tri, le premier balayage pourrait tourner indéfiniment sur les
    // mêmes couples et laisser une partie du parc sans historique.
    expect(corps('_seoDashboardRefresh')).toMatch(/\.sort\(\(a, b\) => \(vuLe\.get\(a\.hash\) \|\| 0\) - \(vuLe\.get\(b\.hash\) \|\| 0\)\)/);
  });
});

describe('_seoCouplesASuivre — les rejeux ne sont pas rachetés 29 fois', () => {
  test('les couples sont dédupliqués par hash URL + mot-clé', () => {
    const body = corps('_seoCouplesASuivre');
    expect(body).toMatch(/const couples = new Map\(\);/);
    expect(body).toMatch(/_coupleHash\(url, keyword\)/);
    expect(body).toMatch(/couples\.set\(hash,/);
  });

  test('la date retenue est la PREMIÈRE MAJ — c\'est elle qui fixe le début de l\'historique', () => {
    expect(corps('_seoCouplesASuivre')).toMatch(/prec\.firstMajAt = Math\.min\(prec\.firstMajAt, at\)/);
  });

  test('un suivi sans URL est écarté dès le SQL', () => {
    expect(corps('_seoCouplesASuivre')).toMatch(/article_url IS NOT NULL AND article_url <> ''/);
  });
});

describe('route /api/haloscan/dashboard', () => {
  test('réservée aux super admins', () => {
    expect(proxySrc()).toMatch(/app\.get\('\/api\/haloscan\/dashboard', requireAuth, requireRole\('super_admin'\)/);
  });

  test('la route ne calcule rien : pas de médiane ni de seuil côté serveur', () => {
    const s = proxySrc();
    const i = s.indexOf("app.get('/api/haloscan/dashboard'");
    const j = s.indexOf("app.post('/api/haloscan/dashboard/refresh'");
    const route = s.slice(i, j);
    // L'agrégation vit dans src/utils/seoEffect.js, testée sans base ni réseau.
    // La dupliquer ici créerait deux jeux de règles qui divergeraient en silence.
    expect(route).not.toMatch(/mediane|median|SEUIL|tauxProgression/);
  });

  test('`articles` n\'est lue que pour id/title/url — jamais SELECT * (le HTML complet)', () => {
    const s = proxySrc();
    const i = s.indexOf("app.get('/api/haloscan/dashboard'");
    const route = s.slice(i, i + 3000);
    expect(route).toMatch(/SELECT id, title, url FROM articles WHERE id IN/);
    expect(route).not.toMatch(/SELECT \* FROM articles/);
  });

  test('les relevés « before » du suivi existant sont servis — ils sont le repli quand l\'historique ne remonte pas', () => {
    const s = proxySrc();
    const i = s.indexOf("app.get('/api/haloscan/dashboard'");
    const j = s.indexOf("app.post('/api/haloscan/dashboard/refresh'");
    const route = s.slice(i, j);
    expect(route).toMatch(/FROM seo_snapshots WHERE type = 'before'/);
    expect(route).toMatch(/beforeSnapshots: avantRows\.map/);
  });

  test('le rafraîchissement manuel ne traite qu\'UN couple par appel', () => {
    const s = proxySrc();
    const i = s.indexOf("app.post('/api/haloscan/dashboard/refresh'");
    const route = s.slice(i, i + 1500);
    expect(route).toMatch(/requireRole\('super_admin'\)/);
    expect(route).toMatch(/if \(!articleUrl \|\| !keyword\)\s+return res\.status\(400\)/);
    // Un seul appel à _seoRafraichirCouple : pas de boucle, donc pas de
    // « tout rafraîchir » qui viderait le budget depuis un bouton.
    expect((route.match(/_seoRafraichirCouple\(/g) || []).length).toBe(1);
  });
});

describe('ordonnancement — le cron existant n\'est pas touché', () => {
  test('_seoSnapshotCheck garde son propre setTimeout à 30 s', () => {
    expect(proxySrc()).toMatch(/setTimeout\(\(\) => \{\n  _seoSnapshotCheck\(\);\n  setInterval\(_seoSnapshotCheck, 6 \* 60 \* 60 \* 1000\);\n\}, 30000\);/);
  });

  test('le rafraîchissement du dashboard a son propre ordonnanceur, décalé', () => {
    const s = proxySrc();
    expect(s).toMatch(/setTimeout\(\(\) => \{\n  _seoDashboardRefresh\(\);\n  setInterval\(_seoDashboardRefresh, 6 \* 60 \* 60 \* 1000\);\n\}, 90000\);/);
  });
});
