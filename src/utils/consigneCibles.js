/**
 * LA CONSIGNE NOMME DES PASSAGES : ON VÉRIFIE QU'ILS ONT VRAIMENT CHANGÉ.
 *
 * Mesuré en production le 23/11/2026 (article evenement.com, MAJ ciblée,
 * consigne « Change les H2 et le chapô et l'introduction »), trois essais après
 * le correctif du prompt : introduction à 0,44 / 0,54 / 0,14 de proximité avec
 * l'original, H2 changés 0 / 4 / 1 sur 9. Le bloc de prompt aide, mais le modèle
 * ne tient pas la consigne de façon stable. Un prompt n'est jamais une garantie :
 * on MESURE le résultat, et on relance une fois quand il est resté trop proche.
 *
 * Ce module est PUR et AUTONOME (aucun import) : il détecte ce que la consigne
 * vise, mesure la proximité de chaque cible avec l'original, et rédige la
 * reprise. L'appel IA et la décision de relancer vivent dans `agentQat.js`.
 *
 * On ne mesure QUE ce que la consigne nomme : une consigne qui ne parle pas des
 * titres ne déclenche jamais de contrôle sur les titres. Une cible niée
 * (« garde les H2 ») n'est jamais contrôlée non plus — sinon on forcerait le
 * modèle à changer ce que l'équipe a demandé de laisser.
 */

/**
 * Relances maximales quand une cible reste trop proche. Mesuré le 24/11/2026 (3
 * articles réels, 1 relance) : 2 sur 3 conformes, le 3e gardait une introduction à
 * 0,63. Chaque relance coûte une génération (~1 min) : deux, pas plus.
 */
export const MAX_RELANCES_CONSIGNE = 2;
/** Au-dessus, un chapô ou une introduction est jugé reformulé à la marge. */
export const SEUIL_PROXIMITE_PARAGRAPHE = 0.40;
/** Au-dessus, un titre est jugé inchangé (apostrophes, accents, casse ignorés). */
export const SEUIL_TITRE_INCHANGE = 0.80;
/** Part minimale des titres H2 éligibles qui doivent avoir réellement changé. */
export const PART_MIN_TITRES_CHANGES = 0.6;
/** Un paragraphe plus court n'est ni un chapô ni une introduction (« Suivez … »). */
const MIN_CARS_PARAGRAPHE = 80;

/** Titres qui ne sont pas du contenu rédactionnel : on ne demande pas de les changer. */
const TITRE_STRUCTUREL = /^(faq|foire aux questions|questions? fr[ée]quentes?|en r[ée]sum[ée]|tl;?\s?dr|sommaire|table des mati[èe]res|conclusion)\b/i;

const sansAccents = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Minuscules, sans accents, apostrophes en espaces, sans ponctuation. */
const motsDe = (s = '') => new Set(
  sansAccents(s).toLowerCase().replace(/[’'`]/g, ' ').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean),
);

/** Indice de Jaccard sur les ensembles de mots : 0 = rien en commun, 1 = identique. */
export const proximite = (a, b) => {
  const A = motsDe(a);
  const B = motsDe(b);
  if (!A.size && !B.size) return 1;
  let commun = 0;
  A.forEach((m) => { if (B.has(m)) commun += 1; });
  return commun / (A.size + B.size - commun);
};

/* ───────────────────────── Détection dans la consigne ───────────────────────── */

const NEGATION = /\b(?:garde\w*|conserve\w*|laisse\w*|inchang\w*|ne\s+touche\w*|sans\s+toucher|ne\s+\w+\s+(?:pas|plus|jamais)|n\s+\w+\s+(?:pas|plus|jamais))\b/;
const VERBE_CHANGE = /\b(?:chang\w*|modifi\w*|reecri\w*|reformul\w*|refai\w*|renouvel\w*|retravaill\w*|repens\w*|actualis\w*|mets?\s+a\s+jour|mettez\s+a\s+jour|rend\w*|rework\w*|nouveau\w*|nouvelle\w*|different\w*)\b/;

/** Une cible par motif ; « titre SEO » / « meta titre » ne visent pas les H2. */
const CIBLES = [
  { cle: 'titres', re: /\b(?:h2|h3|intertitres?|sous\s+titres?|titres?)\b/ },
  { cle: 'chapo', re: /\b(?:chapo|chapeau)\b/ },
  { cle: 'intro', re: /\b(?:intro|introduction)\b/ },
];

/**
 * Ce que la consigne demande de CHANGER parmi : titres H2, chapô, introduction.
 * Les négations (« garde les H2 », « ne change pas l'intro ») retirent la cible.
 * @returns {Array<'titres'|'chapo'|'intro'>}
 */
export const detecterCibles = (consigne = '') => {
  const texte = sansAccents(String(consigne || '')).toLowerCase()
    .replace(/[’'`]/g, ' ')
    // « titre SEO », « meta titre », « title » : le titre de la page, pas un H2.
    .replace(/\b(?:meta\s+)?titre\s+(?:seo|de\s+la\s+page|h1)\b/g, ' ')
    .replace(/\bh1\b/g, ' ');
  const trouvees = new Set();
  texte.split(/[.;,\n]|\bmais\b/).forEach((proposition) => {
    let nie = false;
    proposition.split(/\bet\b/).forEach((segment) => {
      if (NEGATION.test(segment)) nie = true;
      else if (VERBE_CHANGE.test(segment)) nie = false;
      CIBLES.forEach(({ cle, re }) => {
        if (re.test(segment) && !nie) trouvees.add(cle);
      });
    });
  });
  return ['titres', 'chapo', 'intro'].filter((c) => trouvees.has(c));
};

/* ─────────────────────────── Extraction dans le HTML ─────────────────────────── */

const racine = (html) => {
  if (!html || typeof document === 'undefined') return null;
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

const titresH2 = (root) => [...root.querySelectorAll('h2')]
  .map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);

/**
 * Les deux premiers paragraphes rédigés avant le premier H2 : chapô puis
 * introduction. Les paragraphes courts (« Suivez … », boutons) et ceux qui
 * vivent dans une figure, un tableau, une liste ou une citation sont écartés.
 * @returns {{chapo:string|null, intro:string|null}}
 */
const chapoEtIntro = (root) => {
  const premierH2 = root.querySelector('h2');
  const retenus = [];
  root.querySelectorAll('p').forEach((p) => {
    // 4 = DOCUMENT_POSITION_FOLLOWING : p vient APRÈS le premier H2 → écarté.
    if (premierH2 && (premierH2.compareDocumentPosition(p) & 4)) return;
    if (p.closest('figure, table, ul, ol, blockquote, details, aside, nav')) return;
    const t = p.textContent.replace(/\s+/g, ' ').trim();
    if (t.length >= MIN_CARS_PARAGRAPHE) retenus.push(t);
  });
  return { chapo: retenus[0] || null, intro: retenus[1] || null };
};

/* ─────────────────────────────────── Mesure ─────────────────────────────────── */

/**
 * Compare l'article généré à l'original pour les seules cibles demandées.
 *
 * @returns {{
 *   cibles: string[],
 *   mesures: {chapo?:number, intro?:number, titres?:{eligibles:number, changes:number}},
 *   insuffisantes: string[],
 *   originaux: {chapo?:string, intro?:string, titres?:string[]},
 *   score: number
 * }} `score` : plus il est bas, plus l'article s'éloigne de l'original (sert à
 * choisir entre deux générations).
 */
export const mesurerCibles = (originalHtml, nouveauHtml, cibles = []) => {
  const vide = { cibles: [], mesures: {}, insuffisantes: [], originaux: {}, score: 0 };
  if (!cibles.length) return vide;
  const o = racine(originalHtml);
  const n = racine(nouveauHtml);
  if (!o || !n) return vide;

  const res = { cibles: [...cibles], mesures: {}, insuffisantes: [], originaux: {}, score: 0 };

  if (cibles.includes('chapo') || cibles.includes('intro')) {
    const po = chapoEtIntro(o);
    const pn = chapoEtIntro(n);
    ['chapo', 'intro'].forEach((cle) => {
      if (!cibles.includes(cle) || !po[cle] || !pn[cle]) return; // ambigu : on ne tranche pas
      const p = proximite(po[cle], pn[cle]);
      res.mesures[cle] = Number(p.toFixed(2));
      res.originaux[cle] = po[cle];
      res.score += p;
      if (p > SEUIL_PROXIMITE_PARAGRAPHE) res.insuffisantes.push(cle);
    });
  }

  if (cibles.includes('titres')) {
    const to = titresH2(o).filter((t) => !TITRE_STRUCTUREL.test(sansAccents(t).trim()));
    const tn = titresH2(n);
    if (to.length >= 3 && tn.length) {
      const changes = to.filter((t) => !tn.some((x) => proximite(t, x) >= SEUIL_TITRE_INCHANGE)).length;
      res.mesures.titres = { eligibles: to.length, changes };
      res.originaux.titres = to;
      res.score += 1 - changes / to.length;
      if (changes / to.length < PART_MIN_TITRES_CHANGES) res.insuffisantes.push('titres');
    }
  }
  return res;
};

/* ─────────────────────────────── Reprise du prompt ─────────────────────────────── */

const LIBELLE = { chapo: 'le CHAPÔ', intro: "l'INTRODUCTION", titres: 'les TITRES H2' };

/**
 * Bloc ajouté au message utilisateur de la relance : il nomme ce qui est resté
 * trop proche, donne le texte d'origine à NE PAS reprendre, et rappelle que le
 * reste de la génération (liens, structure) ne bouge pas.
 */
export const repriseConsigne = (mesure) => {
  const lignes = (mesure.insuffisantes || []).map((cle) => {
    if (cle === 'titres') {
      const { eligibles, changes } = mesure.mesures.titres;
      return `- les TITRES H2 : seulement ${changes} titre(s) sur ${eligibles} ont changé. Titres d'origine à ne PAS reprendre :\n${mesure.originaux.titres.map((t) => `    « ${t} »`).join('\n')}`;
    }
    return `- ${LIBELLE[cle]} : trop proche de l'original (${Math.round(mesure.mesures[cle] * 100)} % de mots communs). Texte d'origine à ne PAS reprendre :\n    « ${mesure.originaux[cle]} »`;
  });
  return `

## ═══ REPRISE — LA CONSIGNE DE L'ÉQUIPE N'A PAS ÉTÉ APPLIQUÉE ═══
La génération précédente a été REJETÉE : la consigne demandait de changer des
passages précis, et ils sont restés quasiment identiques à l'original.
Reprends la rédaction et RÉÉCRIS POUR DE BON :
${lignes.join('\n')}

Réécrire, ce n'est pas remplacer quelques mots par des synonymes : nouvelle
formulation, nouvelle accroche, nouvelles phrases, nouvel angle (les faits, les
chiffres et les liens restent exacts). Le reste de l'article suit les mêmes
règles qu'avant.`;
};
