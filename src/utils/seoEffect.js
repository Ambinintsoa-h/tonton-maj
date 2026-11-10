/**
 * seoEffect.js — « Est-ce que les MAJ font gagner des positions ? »
 *
 * Calcul PUR, aucun appel réseau : le serveur sert l'historique brut (cache
 * `seo_position_cache`, rempli depuis Haloscan /keywords/serp/pageEvolution),
 * ce module le transforme en verdict par page puis en bilan global.
 *
 * ── POURQUOI PAS `seo_snapshots` ───────────────────────────────────────────
 * Le suivi existant relève UNE position le jour J, puis à J+7 et J+30. Mesuré
 * en production le 09/11/2026 : 97 positions trouvées sur 988 relevés, soit
 * 9,8 %. Un taux de réussite calculé sur ces trois points porterait sur une
 * vingtaine d'articles tout en ressemblant à un bilan de 333. L'historique
 * Haloscan donne au contraire une courbe (13 points en moyenne, jusqu'à 82),
 * donc une MÉDIANE avant et une médiane après — robuste à un point aberrant,
 * là où un relevé unique ne l'est jamais.
 *
 * ── UNITÉ DE COMPTE : LA PAGE, PAS LA MAJ (décision Andrianina, 09/11/2026) ─
 * La base porte 333 suivis pour 155 URL distinctes : `toiture-en-bac-acier` y
 * figure 29 fois, un article God of War 26 fois — des rejeux de test. Compter
 * par MAJ ferait peser une seule page pour 19 % du bilan. Une page = une ligne,
 * quel que soit le nombre de passages. Pour une page reprise plusieurs fois on
 * compare donc AVANT LA PREMIÈRE MAJ et APRÈS LA DERNIÈRE : la trajectoire de
 * la page sous l'outil, pas la photo d'un passage.
 *
 * ── CE QUE CE MODULE REFUSE DE FAIRE ───────────────────────────────────────
 * Il ne remplace jamais une position manquante par une valeur de convenance.
 * Une page hors SERP n'est pas « #101 » : c'est un état distinct, nommé
 * (`entre_dans_serp` / `sort_du_serp`), parce que l'écraser en nombre
 * fabriquerait des gains et des pertes qui n'ont pas été mesurés. C'est très
 * exactement le défaut qui rend `seo_snapshots` illisible aujourd'hui, où un
 * timeout et une page hors SERP s'écrivent tous les deux `position: null`.
 */

const JOUR = 24 * 60 * 60 * 1000;

/** Fenêtre retenue avant la première MAJ : au-delà, la position décrit une autre époque. */
export const FENETRE_AVANT_JOURS = 90;

/**
 * Délai laissé à la MAJ pour produire son effet. Une position relevée le
 * lendemain d'une republication mesure surtout le temps de recrawl de Google.
 */
export const DELAI_EFFET_JOURS = 7;

/** Fenêtre retenue après ce délai. Symétrique de la fenêtre avant, pour que les deux médianes portent sur des durées comparables. */
export const FENETRE_APRES_JOURS = 90;

/**
 * En deçà, le mouvement est du bruit de SERP, pas un effet. Passer de #12 à #11
 * ne se distingue pas d'un jour de mesure différent.
 */
export const SEUIL_BRUIT = 1;

/**
 * Sous ce nombre de pages réellement mesurables, le bilan global n'est pas
 * présenté comme un verdict. Seuil affiché, jamais appliqué en silence.
 */
export const MESURABLES_MIN = 30;

export const EFFET_PROGRESSE      = 'progresse';
export const EFFET_RECULE         = 'recule';
export const EFFET_STABLE         = 'stable';
export const EFFET_ENTRE_SERP     = 'entre_dans_serp';
export const EFFET_SORT_SERP      = 'sort_du_serp';
export const EFFET_TROP_RECENT    = 'trop_recent';
export const EFFET_SANS_AVANT     = 'sans_avant';
export const EFFET_SANS_HISTORIQUE = 'sans_historique';
export const EFFET_ERREUR         = 'erreur';

/** `'NA'`, `null`, `''` et les non-nombres signifient tous « pas dans la SERP relevée ». */
const positionNombre = (p) => {
  if (p == null || p === 'NA' || p === '') return null;
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 'YYYY-MM-DD' → ms UTC. Les dates Haloscan n'ont pas d'heure ; on fige midi UTC pour qu'aucun fuseau ne fasse basculer un point d'un jour à l'autre. */
const dateMs = (d) => {
  if (typeof d !== 'string') return null;
  const t = Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
};

/** Médiane (et non moyenne : une seule mesure aberrante ne doit pas emporter la page). */
export const mediane = (nombres) => {
  if (!nombres.length) return null;
  const tri = [...nombres].sort((a, b) => a - b);
  const m = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[m] : (tri[m - 1] + tri[m]) / 2;
};

/**
 * Points d'historique d'une fenêtre temporelle, séparés en positions lisibles
 * et points hors SERP — les seconds sont COMPTÉS, jamais convertis en nombre.
 */
const fenetre = (history, debut, fin) => {
  const positions = [];
  let horsSerp = 0;
  for (const pt of history || []) {
    const t = dateMs(pt?.search_date);
    if (t == null || t < debut || t > fin) continue;
    const n = positionNombre(pt.position);
    if (n == null) horsSerp += 1;
    else positions.push(n);
  }
  return { positions, horsSerp };
};

/**
 * Verdict d'UNE page (un couple URL + mot-clé).
 *
 * @param {object} couple
 * @param {string} couple.url
 * @param {string} couple.keyword
 * @param {number} couple.firstMajAt  ms — première MAJ de cette page par l'outil
 * @param {number} couple.lastMajAt   ms — dernière MAJ
 * @param {Array}  couple.history     [{ search_date, position }] brut Haloscan
 * @param {?string} couple.error      dernier échec d'appel, s'il y en a eu un
 * @param {number} [maintenant]       injectable pour les tests
 */
export const effetSurUnePage = (couple, maintenant = Date.now()) => {
  const { firstMajAt, lastMajAt, history, error } = couple || {};
  const premiere = Number(firstMajAt) || null;
  const derniere = Number(lastMajAt) || premiere;

  const base = {
    url: couple?.url || '',
    keyword: couple?.keyword || '',
    title: couple?.title || '',
    firstMajAt: premiere,
    lastMajAt: derniere,
    majCount: Number(couple?.majCount) || 0,
    fetchedAt: Number(couple?.fetchedAt) || null,
    avant: null, apres: null, diff: null, avantSource: null,
    pointsAvant: 0, pointsApres: 0,
    horsSerpAvant: 0, horsSerpApres: 0,
    statut: EFFET_SANS_HISTORIQUE,
  };

  // Un appel raté ne vaut PAS « Haloscan ne connaît pas cette page » : la
  // différence décide s'il faut corriger l'URL ou simplement réessayer.
  if (error) return { ...base, statut: EFFET_ERREUR, erreur: error };
  if (!premiere || !Array.isArray(history) || !history.length) return base;

  const avantFen = fenetre(history, premiere - FENETRE_AVANT_JOURS * JOUR, premiere - 1);
  const debutApres = derniere + DELAI_EFFET_JOURS * JOUR;
  const apresFen = fenetre(history, debutApres, debutApres + FENETRE_APRES_JOURS * JOUR);

  const apres = mediane(apresFen.positions);

  // ── REPLI SUR LE RELEVÉ J+0 ────────────────────────────────────────────────
  // L'historique Haloscan ne remonte pas toujours avant la MAJ. Quand il ne le
  // fait pas, le relevé « before » du suivi existant, lui, a été pris le jour
  // même : c'est UNE mesure au lieu d'une médiane, moins robuste, mais prise au
  // bon moment. Le jeter reviendrait à déclarer « pas de position avant » une
  // page dont on a justement la position d'avant. La provenance est donc
  // conservée (`avantSource`) et affichée, pour qu'un point unique ne se fasse
  // jamais passer pour une médiane.
  const avantHist = mediane(avantFen.positions);
  const avantReleve = avantHist == null ? positionNombre(couple?.avantSnapshot) : null;
  const avant = avantHist != null ? avantHist : avantReleve;

  const chiffres = {
    ...base,
    avant, apres,
    avantSource: avantHist != null ? 'historique' : (avantReleve != null ? 'releve_j0' : null),
    pointsAvant: avantFen.positions.length,
    pointsApres: apresFen.positions.length,
    horsSerpAvant: avantFen.horsSerp,
    horsSerpApres: apresFen.horsSerp,
  };

  // La MAJ est trop fraîche pour avoir produit quoi que ce soit : on le DIT,
  // au lieu de la compter comme un échec et d'alourdir le bilan d'un reproche
  // qui n'a pas de sens.
  if (maintenant < debutApres) return { ...chiffres, statut: EFFET_TROP_RECENT };

  if (avant != null && apres != null) {
    const diff = avant - apres; // positif = la page est montée
    const statut = diff > SEUIL_BRUIT ? EFFET_PROGRESSE
      : diff < -SEUIL_BRUIT ? EFFET_RECULE
        : EFFET_STABLE;
    return { ...chiffres, diff, statut };
  }

  // Les deux bascules SERP : mesurées, nommées, jamais converties en nombre.
  if (avant == null && apres != null && avantFen.horsSerp > 0) return { ...chiffres, statut: EFFET_ENTRE_SERP };
  if (avant != null && apres == null && apresFen.horsSerp > 0) return { ...chiffres, statut: EFFET_SORT_SERP };

  if (avant == null && avantFen.horsSerp === 0) return { ...chiffres, statut: EFFET_SANS_AVANT };
  return { ...chiffres, statut: EFFET_TROP_RECENT };
};

/** Les statuts qui portent une comparaison chiffrée avant/après. */
const MESURABLE = new Set([EFFET_PROGRESSE, EFFET_RECULE, EFFET_STABLE]);

/**
 * Bilan global.
 *
 * `mesurables` est volontairement le premier chiffre : un taux de réussite sans
 * son dénominateur est le travers que ce dashboard existe pour corriger.
 * `fiable` est FALSE tant que l'échantillon est mince — l'interface s'en sert
 * pour présenter le bilan comme une tendance, pas comme un verdict.
 */
export const bilanGlobal = (pages) => {
  const parStatut = {};
  const diffs = [];
  for (const p of pages || []) {
    parStatut[p.statut] = (parStatut[p.statut] || 0) + 1;
    if (MESURABLE.has(p.statut) && p.diff != null) diffs.push(p.diff);
  }
  const mesurables = diffs.length;
  const progresse = parStatut[EFFET_PROGRESSE] || 0;
  const recule = parStatut[EFFET_RECULE] || 0;

  return {
    total: (pages || []).length,
    mesurables,
    progresse,
    recule,
    stable: parStatut[EFFET_STABLE] || 0,
    entreDansSerp: parStatut[EFFET_ENTRE_SERP] || 0,
    sortDuSerp: parStatut[EFFET_SORT_SERP] || 0,
    tropRecent: parStatut[EFFET_TROP_RECENT] || 0,
    sansAvant: parStatut[EFFET_SANS_AVANT] || 0,
    sansHistorique: parStatut[EFFET_SANS_HISTORIQUE] || 0,
    erreur: parStatut[EFFET_ERREUR] || 0,
    // Part de pages en progression PARMI LES MESURABLES, jamais parmi le total :
    // diviser par 155 quand 20 pages seulement sont comparables afficherait 13 %
    // et donnerait à l'outil l'air de rater ce qu'il n'a pas même pu mesurer.
    tauxProgression: mesurables ? Math.round((progresse / mesurables) * 100) : null,
    gainMedian: mediane(diffs),
    fiable: mesurables >= MESURABLES_MIN,
  };
};

/**
 * Regroupe les suivis bruts (une ligne par MAJ) en couples page + mot-clé
 * (une ligne par page), et y rattache l'historique mis en cache.
 *
 * @param {Array} trackings [{ articleId, title, url, keywords[], createdAt }]
 * @param {Array} cache     [{ articleUrl, keyword, history, error, fetchedAt }]
 * @param {Array} [releves] snapshots « before » : [{ articleId, results: [{ keyword, position }] }]
 */
export const regrouperParPage = (trackings, cache, releves) => {
  const parCouple = new Map();
  const cle = (url, kw) => `${url}\u0000${kw}`;

  for (const t of trackings || []) {
    const url = (t?.url || '').trim();
    const at = Number(t?.createdAt) || null;
    if (!url || !at) continue;
    for (const kwBrut of t?.keywords || []) {
      const keyword = String(kwBrut || '').trim();
      if (!keyword) continue;
      const k = cle(url, keyword);
      const prec = parCouple.get(k);
      if (!prec) {
        parCouple.set(k, {
          url, keyword, title: t.title || '', firstMajAt: at, lastMajAt: at, majCount: 1,
          // Article du PREMIER passage : c'est son relevé J+0 qui décrit l'état
          // d'avant. Celui d'un rejeu plus tardif mesurerait un article déjà
          // retravaillé, et serait présenté comme un « avant » — faux.
          firstArticleId: t.articleId || null,
        });
      } else {
        if (at < prec.firstMajAt) { prec.firstMajAt = at; prec.firstArticleId = t.articleId || null; }
        prec.lastMajAt = Math.max(prec.lastMajAt, at);
        prec.majCount += 1;
        if (!prec.title && t.title) prec.title = t.title;
      }
    }
  }

  const parCle = new Map();
  for (const c of cache || []) parCle.set(cle((c?.articleUrl || '').trim(), (c?.keyword || '').trim()), c);

  const relevesParArticle = new Map();
  for (const r of releves || []) if (r?.articleId) relevesParArticle.set(r.articleId, r.results || []);

  return [...parCouple.values()].map((couple) => {
    const c = parCle.get(cle(couple.url, couple.keyword));
    const res = relevesParArticle.get(couple.firstArticleId) || [];
    // Appariement par mot-clé et non par index : un relevé porte un résultat
    // par mot-clé, et deux mots-clés d'une même page n'ont pas la même position.
    const releve = res.find((x) => String(x?.keyword || '').trim() === couple.keyword);
    return {
      ...couple,
      history: c?.history || null,
      error: c?.error || null,
      fetchedAt: c?.fetchedAt || null,
      avantSnapshot: releve?.position ?? null,
    };
  });
};

/** Chaîne complète : suivis bruts + cache + relevés J+0 → lignes de page + bilan. */
export const calculerEffetDesMaj = (trackings, cache, releves, maintenant = Date.now()) => {
  const pages = regrouperParPage(trackings, cache, releves).map((c) => effetSurUnePage(c, maintenant));
  return { pages, bilan: bilanGlobal(pages) };
};
