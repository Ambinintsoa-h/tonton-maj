/* eslint-env jest */
/**
 * apiBudget — budget API Anthropic.
 *
 * Ces tests verrouillent surtout ce que le module REFUSE de faire : traiter un
 * cache non mesuré comme gratuit, décompter une consommation antérieure à la
 * première recharge, alerter en boucle toutes les 6 h, et — le piège propre à
 * ce projet — considérer un envoi SMTP RATÉ comme une alerte délivrée.
 */
// `require` et non `import` : le module est en CommonJS — même forme que
// linkFollowPolicy.parite.test.js pour les autres modules de src/server/.
const {
  calculerBudget, coutLigne, tarifPour, premiereRechargeMs, derniereRechargeMs,
  decisionAlerte, projection,
  SEUIL_ALERTE_USD, RAPPEL_ALERTE_MS, ALERTE_FRANCHISSEMENT, ALERTE_RAPPEL,
  MULT_CACHE_ECRITURE, MULT_CACHE_LECTURE,
} = require('./apiBudget');

const JOUR = 24 * 60 * 60 * 1000;
const GRILLE = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
};

// Minuit LOCAL, comme le module : construire la date en UTC ferait échouer les
// tests dans tout fuseau à l'est de Greenwich.
const minuit = (iso) => {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j, 0, 0, 0, 0).getTime();
};
const recharge = (montant, date) => ({ amount_usd: montant, recharged_on: date });
const appel = (o = {}) => ({
  article_id: o.article || 'a1',
  sub_pass: o.flux || 'refonte',
  model: o.model || 'claude-sonnet-5',
  input_tokens: o.input ?? 0,
  output_tokens: o.output ?? 0,
  cost_usd: o.cost ?? 0,
  cache_write_tokens: o.cw ?? null,
  cache_read_tokens: o.cr ?? null,
  logged_at: o.at,
});

describe('tarifPour', () => {
  it('retrouve le tarif par préfixe quand le modèle porte sa date', () => {
    // model_call_log journalise l'identifiant renvoyé par l'API, qui peut être
    // daté. Sans le repli par préfixe, toutes ces lignes seraient facturées au
    // tarif Haiku et le budget serait faux d'un facteur 3.
    expect(tarifPour('claude-sonnet-5-20250929', GRILLE)).toEqual({ input: 3.0, output: 15.0 });
  });

  it('prend le préfixe le PLUS LONG quand plusieurs correspondent', () => {
    const grille = {
      'claude-sonnet': { input: 99, output: 99 },
      'claude-sonnet-5': { input: 3, output: 15 },
    };
    expect(tarifPour('claude-sonnet-5-20250929', grille).input).toBe(3);
  });

  it('retombe sur Haiku — le moins cher — pour un modèle inconnu', () => {
    expect(tarifPour('modele-jamais-vu', GRILLE)).toEqual({ input: 1.0, output: 5.0 });
  });
});

describe('coutLigne — le cache est facturé, son absence est dite', () => {
  it('facture écriture à 1,25× et lecture à 0,1× le prix d\'entrée', () => {
    const r = coutLigne(appel({ input: 1e6, output: 0, cw: 1e6, cr: 1e6 }), GRILLE);
    // 3 (entrée) + 3×1,25 (écriture) + 3×0,1 (lecture)
    expect(r.usd).toBeCloseTo(3 + 3 * MULT_CACHE_ECRITURE + 3 * MULT_CACHE_LECTURE, 6);
    expect(r.cacheMesure).toBe(true);
  });

  it('une ligne ANTÉRIEURE à la migration reprend cost_usd, sans le recalculer', () => {
    // Recalculer sur les tarifs d'aujourd'hui une ligne facturée au tarif
    // d'hier réécrirait le passé à chaque mise à jour de la grille LiteLLM.
    const r = coutLigne(appel({ input: 1e6, output: 1e6, cost: 0.42, cw: null, cr: null }), GRILLE);
    expect(r.usd).toBe(0.42);
    expect(r.cacheMesure).toBe(false);
  });

  it('cache à ZÉRO n\'est pas la même chose que cache ABSENT', () => {
    // 0 est une mesure : la ligne est bien facturée au tarif courant.
    const r = coutLigne(appel({ input: 1e6, output: 0, cost: 999, cw: 0, cr: 0 }), GRILLE);
    expect(r.usd).toBeCloseTo(3, 6);
    expect(r.cacheMesure).toBe(true);
  });
});

describe('calculerBudget', () => {
  it('aucune recharge saisie → restant null, PAS zéro', () => {
    // Un 0 déclencherait l'alerte dès la première passe du cron, sur un budget
    // dont on ne sait simplement rien.
    const b = calculerBudget({ recharges: [], appels: [appel({ at: Date.now(), cost: 10 })], grille: GRILLE });
    expect(b.aucuneRecharge).toBe(true);
    expect(b.restant).toBeNull();
    expect(b.consomme).toBe(0);
  });

  it('ignore la consommation ANTÉRIEURE à la première recharge', () => {
    const debut = minuit('2026-11-10');
    const b = calculerBudget({
      recharges: [recharge(600, '2026-11-10')],
      appels: [
        appel({ at: debut - JOUR, input: 1e6, output: 1e6, cw: 0, cr: 0 }), // la veille
        appel({ at: debut + 3600e3, input: 1e6, output: 1e6, cw: 0, cr: 0 }), // le jour même
      ],
      grille: GRILLE,
    });
    expect(b.appelsComptes).toBe(1);
    expect(b.consomme).toBeCloseTo(3 + 15, 6);
    expect(b.restant).toBeCloseTo(600 - 18, 6);
  });

  it('compte à partir de MINUIT du jour de la recharge', () => {
    // Une recharge faite l'après-midi ne doit pas effacer la consommation du
    // matin : l'erreur se fait vers « on décompte un peu trop ».
    const b = calculerBudget({
      recharges: [recharge(600, '2026-11-10')],
      appels: [appel({ at: minuit('2026-11-10') + 60e3, input: 1e6, cw: 0, cr: 0 })],
      grille: GRILLE,
    });
    expect(b.appelsComptes).toBe(1);
  });

  it('additionne TOUTES les recharges mais ne repart pas de la dernière', () => {
    // Le piège de la formulation spontanée « somme des recharges − consommation
    // depuis la DERNIÈRE recharge » : elle gonflerait le restant à chaque
    // versement. Ici les 18 $ consommés AVANT la 2ᵉ recharge restent déduits.
    const debut = minuit('2026-11-10');
    const b = calculerBudget({
      recharges: [recharge(600, '2026-11-10'), recharge(200, '2026-11-20')],
      appels: [appel({ at: debut + JOUR, input: 1e6, output: 1e6, cw: 0, cr: 0 })],
      grille: GRILLE,
    });
    expect(b.totalRecharge).toBe(800);
    expect(b.restant).toBeCloseTo(800 - 18, 6);
  });

  it('compte les lignes dont le cache n\'a pas pu être facturé', () => {
    const debut = minuit('2026-11-10');
    const b = calculerBudget({
      recharges: [recharge(600, '2026-11-10')],
      appels: [
        appel({ at: debut + 1, cost: 0.5 }),                    // sans cache
        appel({ at: debut + 2, input: 1e6, cw: 0, cr: 0 }),      // avec cache
      ],
      grille: GRILLE,
    });
    expect(b.lignesSansCache).toBe(1);
    expect(b.coutSansCache).toBeCloseTo(0.5, 6);
  });

  it('ventile par jour, par modèle et par flux, et déduplique les articles', () => {
    const debut = minuit('2026-11-10');
    const b = calculerBudget({
      recharges: [recharge(600, '2026-11-10')],
      appels: [
        appel({ at: debut + 3600e3, article: 'a1', flux: 'audit_qat', model: 'claude-haiku-4-5', input: 1e6, cw: 0, cr: 0 }),
        appel({ at: debut + 7200e3, article: 'a1', flux: 'refonte', model: 'claude-sonnet-5', input: 1e6, cw: 0, cr: 0 }),
        appel({ at: debut + JOUR, article: 'a2', flux: 'refonte', model: 'claude-sonnet-5', input: 1e6, cw: 0, cr: 0 }),
      ],
      grille: GRILLE,
    });
    expect(b.articles).toBe(2);
    expect(b.parJour).toHaveLength(2);
    expect(b.parJour[0].usd).toBeCloseTo(1 + 3, 6);
    // Trié du plus cher au moins cher — c'est ce qu'on vient voir.
    expect(b.parModele[0].model).toBe('claude-sonnet-5');
    expect(b.parFlux[0].flux).toBe('refonte');
    expect(b.parFlux[0].appels).toBe(2);
  });
});

describe('premiereRechargeMs / derniereRechargeMs', () => {
  it('prennent la plus ancienne et la plus récente, quel que soit l\'ordre de saisie', () => {
    const rs = [recharge(200, '2026-11-20'), recharge(600, '2026-11-10')];
    expect(premiereRechargeMs(rs)).toBe(minuit('2026-11-10'));
    expect(derniereRechargeMs(rs)).toBe(minuit('2026-11-20'));
  });

  it('renvoient null sans recharge exploitable', () => {
    expect(premiereRechargeMs([])).toBeNull();
    expect(premiereRechargeMs([{ amount_usd: 600, recharged_on: 'pas une date' }])).toBeNull();
  });
});

describe('decisionAlerte', () => {
  const now = Date.parse('2026-12-01T10:00:00Z');

  it('ne dit rien au-dessus du seuil', () => {
    expect(decisionAlerte({ restant: SEUIL_ALERTE_USD, alertes: [], maintenant: now }).envoyer).toBe(false);
  });

  it('n\'alerte pas sur un budget INCONNU', () => {
    expect(decisionAlerte({ restant: null, alertes: [], maintenant: now }).envoyer).toBe(false);
  });

  it('alerte au premier passage sous le seuil', () => {
    const d = decisionAlerte({ restant: 42, alertes: [], maintenant: now });
    expect(d.envoyer).toBe(true);
    expect(d.kind).toBe(ALERTE_FRANCHISSEMENT);
  });

  it('ne renvoie PAS le même mail à la passe suivante du cron', () => {
    const alertes = [{ status: 'envoye', sent_at: now - 6 * 3600e3, kind: ALERTE_FRANCHISSEMENT }];
    expect(decisionAlerte({ restant: 42, alertes, maintenant: now }).envoyer).toBe(false);
  });

  it('un envoi RATÉ ne vaut pas alerte — on retente', () => {
    // Le piège documenté du projet : SMTP non configuré échoue en silence. Si
    // cette tentative comptait comme une alerte, personne ne serait prévenu et
    // le dispositif se croirait en règle.
    const alertes = [
      { status: 'smtp_absent', sent_at: now - 3600e3, kind: ALERTE_FRANCHISSEMENT },
      { status: 'echec', sent_at: now - 7200e3, kind: ALERTE_FRANCHISSEMENT },
    ];
    const d = decisionAlerte({ restant: 42, alertes, maintenant: now });
    expect(d.envoyer).toBe(true);
    expect(d.kind).toBe(ALERTE_FRANCHISSEMENT);
  });

  it('rappelle une fois par semaine si on reste sous le seuil', () => {
    const alertes = [{ status: 'envoye', sent_at: now - RAPPEL_ALERTE_MS, kind: ALERTE_FRANCHISSEMENT }];
    const d = decisionAlerte({ restant: 42, alertes, maintenant: now });
    expect(d.envoyer).toBe(true);
    expect(d.kind).toBe(ALERTE_RAPPEL);
  });

  it('ne rappelle pas AVANT la semaine', () => {
    const alertes = [{ status: 'envoye', sent_at: now - RAPPEL_ALERTE_MS + 1000, kind: ALERTE_FRANCHISSEMENT }];
    expect(decisionAlerte({ restant: 42, alertes, maintenant: now }).envoyer).toBe(false);
  });

  it('une recharge postérieure RÉARME le franchissement', () => {
    // Sans ce réarmement, un budget rechargé puis ré-épuisé n'alerterait plus
    // jamais : la seule alerte de l'histoire aurait été la première.
    const alertes = [{ status: 'envoye', sent_at: now - 2 * JOUR, kind: ALERTE_FRANCHISSEMENT }];
    const d = decisionAlerte({ restant: 42, alertes, derniereRechargeMs: now - JOUR, maintenant: now });
    expect(d.envoyer).toBe(true);
    expect(d.kind).toBe(ALERTE_FRANCHISSEMENT);
  });

  it('une recharge ANTÉRIEURE à la dernière alerte ne réarme rien', () => {
    const alertes = [{ status: 'envoye', sent_at: now - JOUR, kind: ALERTE_FRANCHISSEMENT }];
    expect(decisionAlerte({ restant: 42, alertes, derniereRechargeMs: now - 2 * JOUR, maintenant: now }).envoyer).toBe(false);
  });
});

describe('projection', () => {
  it('moyenne sur les jours écoulés, week-ends compris', () => {
    const now = minuit('2026-11-20');
    const p = projection({ consomme: 100, restant: 500, depuis: minuit('2026-11-10'), maintenant: now });
    expect(p.joursEcoules).toBe(10);
    expect(p.parJour).toBeCloseTo(10, 6);
    expect(p.jours).toBeCloseTo(50, 6);
  });

  it('ne divise pas par zéro quand rien n\'a été consommé', () => {
    const p = projection({ consomme: 0, restant: 600, depuis: minuit('2026-11-10'), maintenant: minuit('2026-11-11') });
    expect(p.jours).toBeNull();
  });

  it('sans date de départ, pas de projection inventée', () => {
    expect(projection({ consomme: 100, restant: 500, depuis: null }).jours).toBeNull();
  });
});
