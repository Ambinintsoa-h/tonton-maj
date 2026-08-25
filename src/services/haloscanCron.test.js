/* eslint-env jest */
/**
 * Cron Haloscan (_seoSnapshotCheck, proxy.js) — snapshots SEO automatiques J+7/J+30.
 *
 * Trouvé en explorant le code (25/08/2026), pas en test réel : le cron n'écrivait
 * QUE dans Firestore, jamais mis à jour lors de la bascule MySQL (prod, 2026-07-27).
 * Le J+0 est capturé correctement (il passe par firebase.mysql.js → POST
 * /articles/:id/seo/init, donc écrit bien dans `seo_tracking`), mais aucun code ne
 * relisait cette table pour les échéances suivantes : le tracking restait bloqué à
 * son premier snapshot pour toujours, sans erreur ni log — silence identique aux
 * autres pannes de cette classe déjà corrigées cette semaine (cascade modèle,
 * coûts non comptabilisés). Le commentaire du schéma SQL (migration/schema-mysql-v1.sql)
 * dit explicitement que la table est « requêtable par le cron » — elle ne l'était
 * simplement jamais devenue.
 */
import fs from 'fs';
import path from 'path';

const proxySrc = () => fs.readFileSync(path.join(__dirname, '..', '..', 'proxy.js'), 'utf8');

describe('_seoSnapshotCheck — branche MySQL ajoutée (25/08/2026)', () => {
  test('le cron a une branche MySQL qui interroge seo_tracking, pas seulement Firestore', () => {
    const s = proxySrc();
    const fnMatch = s.match(/const _seoSnapshotCheck = async \(\) => \{[\s\S]*?\n\};/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch[0];
    expect(body).toMatch(/if \(DATA_BACKEND === 'mysql'\) \{/);
    expect(body).toMatch(/FROM seo_tracking/);
    expect(body).toMatch(/WHERE enabled = 1 AND completed = 0 AND next_snapshot_at <= \?/);
  });

  test('la garde ne dépend plus de firebaseAdmin (seule la branche Firestore en a besoin)', () => {
    const s = proxySrc();
    const fnMatch = s.match(/const _seoSnapshotCheck = async \(\) => \{[\s\S]*?\n\};/);
    // L'ancienne garde `if (!haloscanKey || !firebaseAdmin) return;` bloquait
    // TOUTE exécution du cron sur un déploiement sans Firebase Admin configuré,
    // y compris la branche MySQL qui n'en a pas besoin.
    expect(fnMatch[0]).toMatch(/if \(!haloscanKey\) return;/);
    expect(fnMatch[0]).not.toMatch(/if \(!haloscanKey \|\| !firebaseAdmin\) return;/);
  });

  test('la branche MySQL écrit dans seo_snapshots ET seo_tracking, dans une transaction', () => {
    const s = proxySrc();
    const fnMatch = s.match(/const _seoSnapshotCheck = async \(\) => \{[\s\S]*?\n\};/);
    const body = fnMatch[0];
    expect(body).toMatch(/INSERT INTO seo_snapshots/);
    expect(body).toMatch(/UPDATE seo_tracking SET last_snapshot_at=/);
    expect(body).toMatch(/beginTransaction\(\)/);
    expect(body).toMatch(/conn\.commit\(\)/);
    expect(body).toMatch(/conn\.rollback\(\)/);
  });

  test('la branche Firestore existante reste intacte (déploiement Firestore non cassé)', () => {
    const s = proxySrc();
    const fnMatch = s.match(/const _seoSnapshotCheck = async \(\) => \{[\s\S]*?\n\};/);
    const body = fnMatch[0];
    expect(body).toMatch(/if \(!firebaseAdmin\) return;/);
    expect(body).toMatch(/db\.collection\('articles'\)/);
    expect(body).toMatch(/firebaseAdmin\.firestore\.FieldValue\.arrayUnion\(snapshot\)/);
  });

  test('les deux branches partagent le même calcul de position par mot-clé (_computeKeywordPositions), plus de logique dupliquée', () => {
    const s = proxySrc();
    expect(s).toMatch(/const _computeKeywordPositions = async \(keywords, articleUrl, haloscanKey, period = '1 month'\) =>/);
    // Trois appelants : /api/haloscan/check, la branche mysql, la branche firestore.
    expect((s.match(/_computeKeywordPositions\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
