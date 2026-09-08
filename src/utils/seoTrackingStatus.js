/**
 * seoTrackingStatus.js — statut de suivi de position (Haloscan) résumé, pour
 * la page dédiée SuiviPositions.jsx (liste de tous les trackings actifs).
 *
 * Pure lecture de `seoTracking` (même forme que celle déjà construite par
 * `seoTrackingToObj`, data-api.js) — aucun appel réseau ici.
 */

export const SEO_STATUT_ATTENTE_J7  = 'attente_j7';
export const SEO_STATUT_ATTENTE_J30 = 'attente_j30';
export const SEO_STATUT_EVOLUTION   = 'evolution';
export const SEO_STATUT_PARTIEL     = 'partiel';    // avant connu, rien après
export const SEO_STATUT_SANS_DONNEE = 'sans_donnee'; // tracking actif, aucune position encore

const positionValide = (p) => p != null && p !== 'NA';

/**
 * @returns {null|{statut:string, beforePos:?string, latestPos:?string, diff:?number}}
 * `null` si le suivi n'est pas actif.
 */
export const seoTrackingStatus = (seoTracking) => {
  if (!seoTracking?.enabled) return null;
  const snapshots   = seoTracking.snapshots || [];
  const beforeSnap  = snapshots.find((s) => s.type === 'before');
  const after7Snap  = snapshots.find((s) => s.type === 'after_7d');
  const after30Snap = snapshots.find((s) => s.type === 'after_30d');
  const beforePosRaw = beforeSnap?.results?.[0]?.position;
  const latestPosRaw = (after30Snap || after7Snap)?.results?.[0]?.position;
  const beforePos = positionValide(beforePosRaw) ? beforePosRaw : null;
  const latestPos = positionValide(latestPosRaw) ? latestPosRaw : null;

  if (seoTracking.nextSnapshotType === 'after_7d') {
    return { statut: SEO_STATUT_ATTENTE_J7, beforePos, latestPos: null, diff: null };
  }
  if (seoTracking.nextSnapshotType === 'after_30d') {
    return { statut: SEO_STATUT_ATTENTE_J30, beforePos, latestPos: null, diff: null };
  }
  if (beforePos && latestPos) {
    // positif = gagné des positions (le classement a baissé numériquement)
    return { statut: SEO_STATUT_EVOLUTION, beforePos, latestPos, diff: Number(beforePos) - Number(latestPos) };
  }
  if (beforePos) {
    return { statut: SEO_STATUT_PARTIEL, beforePos, latestPos: null, diff: null };
  }
  return { statut: SEO_STATUT_SANS_DONNEE, beforePos: null, latestPos: null, diff: null };
};
