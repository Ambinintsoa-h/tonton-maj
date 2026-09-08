import {
  seoTrackingStatus, SEO_STATUT_ATTENTE_J7, SEO_STATUT_ATTENTE_J30,
  SEO_STATUT_EVOLUTION, SEO_STATUT_PARTIEL, SEO_STATUT_SANS_DONNEE,
} from './seoTrackingStatus';

const snap = (type, position) => ({ type, results: [{ position }] });

describe('seoTrackingStatus', () => {
  it('null quand le suivi n\'est pas actif', () => {
    expect(seoTrackingStatus(null)).toBeNull();
    expect(seoTrackingStatus({ enabled: false })).toBeNull();
  });

  it('en attente J+7, avec la position "avant" si disponible', () => {
    const st = seoTrackingStatus({
      enabled: true, nextSnapshotType: 'after_7d',
      snapshots: [snap('before', '12')],
    });
    expect(st).toEqual({ statut: SEO_STATUT_ATTENTE_J7, beforePos: '12', latestPos: null, diff: null });
  });

  it('en attente J+30', () => {
    const st = seoTrackingStatus({
      enabled: true, nextSnapshotType: 'after_30d',
      snapshots: [snap('before', '12'), snap('after_7d', '9')],
    });
    expect(st.statut).toBe(SEO_STATUT_ATTENTE_J30);
  });

  it('évolution connue — diff positif = a gagné des positions', () => {
    const st = seoTrackingStatus({
      enabled: true, nextSnapshotType: null,
      snapshots: [snap('before', '12'), snap('after_30d', '5')],
    });
    expect(st).toEqual({ statut: SEO_STATUT_EVOLUTION, beforePos: '12', latestPos: '5', diff: 7 });
  });

  it('préfère after_30d à after_7d quand les deux existent', () => {
    const st = seoTrackingStatus({
      enabled: true, nextSnapshotType: null,
      snapshots: [snap('before', '12'), snap('after_7d', '9'), snap('after_30d', '6')],
    });
    expect(st.latestPos).toBe('6');
  });

  it('partiel — seul le "avant" est disponible', () => {
    const st = seoTrackingStatus({
      enabled: true, nextSnapshotType: null,
      snapshots: [snap('before', '12')],
    });
    expect(st).toEqual({ statut: SEO_STATUT_PARTIEL, beforePos: '12', latestPos: null, diff: null });
  });

  it('sans donnée — tracking actif mais rien d\'exploitable', () => {
    expect(seoTrackingStatus({ enabled: true, nextSnapshotType: null, snapshots: [] }))
      .toEqual({ statut: SEO_STATUT_SANS_DONNEE, beforePos: null, latestPos: null, diff: null });
  });

  it('une position "NA" est traitée comme absente', () => {
    const st = seoTrackingStatus({
      enabled: true, nextSnapshotType: null,
      snapshots: [snap('before', 'NA')],
    });
    expect(st.statut).toBe(SEO_STATUT_SANS_DONNEE);
  });
});
