/**
 * stylePatterns.js — détection des patterns d'écriture IA (PHASE 4).
 *
 * La liste vient du skill « Style d'écriture (équipe) », pas d'une invention
 * maison : verbes interdits, participe présent, voix passive, adverbes en -ment,
 * phrases trop longues, tirets cadratins, clichés, méta-commentaires,
 * parenthèses en excès, titres trop longs.
 *
 * Principe tenu à chaque phase : on MONTRE. Chaque anomalie remonte avec un
 * extrait du texte réel, pour que le rédacteur juge sur pièce au lieu de croire
 * un compteur. Rien n'est corrigé automatiquement — la phase 4 est humaine.
 *
 * Mesures relevées sur une refonte réelle (2026-08-10) qui ont motivé ce module :
 * 42 phrases sur 114 dépassaient 20 mots, et le verbe « offre » subsistait.
 */

const MAX_EXEMPLES = 6;

/** Texte brut d'un fragment HTML, balises retirées, espaces normalisés. */
export const texteDe = (html = '') =>
  String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&(?:lt|gt|quot|#\d+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Découpe en phrases exploitables (au moins trois mots). */
export const phrasesDe = (texte = '') =>
  texte.split(/(?<=[.!?…])\s+/).map(p => p.trim()).filter(p => p.split(/\s+/).length >= 3);

/** Contenu textuel des titres d'un fragment HTML. */
const titresDe = (html = '') => {
  const out = [];
  const re = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = texteDe(m[2]);
    if (t) out.push({ niveau: `H${m[1]}`, texte: t });
  }
  return out;
};

/** Paragraphes d'un fragment HTML. */
const paragraphesDe = (html = '') => {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = texteDe(m[1]);
    if (t) out.push(t);
  }
  return out;
};

// ── Les règles ────────────────────────────────────────────────────────────────
// Chaque verbe interdit est décliné : le skill nomme l'infinitif, le texte porte
// des formes conjuguées. On reste sur les formes courantes plutôt que sur une
// conjugaison complète, qui produirait des faux positifs (« restaurant »…).
const VERBES_INTERDITS = [
  'offrir', 'offre', 'offres', 'offrent', 'offrait', 'offraient', 'offert', 'offerte',
  'devenir', 'devient', 'deviennent', 'devenu', 'devenue', 'devenait',
  'résider', 'réside', 'résident', 'résidait',
  "s'imposer", "s'impose", "s'imposent", "s'imposait",
  'reposer', 'repose', 'reposent', 'reposait', 'reposaient',
  'rester', 'reste', 'restent', 'restait', 'restaient',
  'demeurer', 'demeure', 'demeurent', 'demeurait',
  'constituer', 'constitue', 'constituent', 'constituait',
];

const PARTICIPES = [
  'offrant', 'évitant', 'constituant', 'permettant', 'garantissant', 'proposant',
  'apportant', 'utilisant', 'disposant', 'assurant', 'facilitant', 'optimisant',
  'générant', 'améliorant', 'nécessitant', 'représentant', 'bénéficiant',
  'comportant', 'affichant', 'entraînant',
];

const CLICHES = [
  "à l'ère du numérique", 'il est crucial', 'plongeons dans', 'dans un monde où',
  'plus que jamais', 'force est de constater', 'il convient de', 'en conclusion',
  'à noter que', 'de nos jours', 'incontournable',
];

const META = [
  'il est important de noter', 'cet article', 'dans cet article', 'nous allons voir',
  'comme nous l\'avons vu', 'il faut savoir que', 'notons que',
];

/**
 * Plafond de longueur d'une phrase. EXPORTÉ depuis le 2026-08-17 : le même nombre
 * doit piloter la CONSIGNE donnée à la génération (agentQat.js) et la DÉTECTION
 * faite ensuite. Deux littéraux séparés auraient fini par divergerdiscrètement, et
 * on aurait signalé au rédacteur des phrases qu'on n'avait jamais interdites.
 */
export const MOTS_MAX_PHRASE = 20;
const MOTS_MAX_TITRE  = 10;

/**
 * Phrases dépassant le plafond, dans un fragment HTML. Sert à VÉRIFIER après la
 * génération ce que le prompt a exigé : une consigne qu'on n'a jamais mesurée est
 * une consigne dont on ne sait rien. Non bloquant — c'est un constat affiché au
 * rédacteur, jamais un motif de rejet de la génération.
 */
export const phrasesTropLongues = (html = '') =>
  phrasesDe(texteDe(html))
    .map((p) => ({ extrait: p, mots: p.split(/\s+/).length }))
    .filter((o) => o.mots > MOTS_MAX_PHRASE)
    .sort((a, b) => b.mots - a.mots);

const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Apostrophe droite ou typographique : le texte publié porte souvent la seconde.
const motif = (terme) => new RegExp(`(?<![\\p{L}])${echappe(terme).replace(/'/g, "['’]")}(?![\\p{L}])`, 'iu');

const chercheTermes = (phrases, termes) => {
  const trouves = new Map();
  phrases.forEach((phrase) => {
    termes.forEach((terme) => {
      if (!motif(terme).test(phrase)) return;
      if (!trouves.has(terme)) trouves.set(terme, []);
      const liste = trouves.get(terme);
      if (liste.length < 2) liste.push(phrase);
    });
  });
  return trouves;
};

const exemplesDeTermes = (trouves) => {
  const out = [];
  for (const [terme, phrases] of trouves) {
    phrases.forEach((p) => { if (out.length < MAX_EXEMPLES) out.push({ terme, extrait: p }); });
  }
  return out;
};

/**
 * Analyse un article et renvoie les anomalies de style, chacune avec son
 * décompte et des extraits du texte réel.
 *
 * @returns {{ total:number, phrases:number, findings:Array }}
 */
export const detectStylePatterns = (html = '') => {
  const texte   = texteDe(html);
  const phrases = phrasesDe(texte);
  const titres  = titresDe(html);
  const paras   = paragraphesDe(html);
  const findings = [];

  const ajoute = (id, label, hint, count, exemples) => {
    if (count > 0) findings.push({ id, label, hint, count, exemples: exemples.slice(0, MAX_EXEMPLES) });
  };

  // 1. Verbes interdits
  const verbes = chercheTermes(phrases, VERBES_INTERDITS);
  ajoute('verbes', 'Verbes interdits', 'À remplacer par un verbe précis et concret.',
    verbes.size, exemplesDeTermes(verbes));

  // 2. Participe présent
  const participes = chercheTermes(phrases, PARTICIPES);
  ajoute('participes', 'Participe présent', 'Reformuler en verbe conjugué (« qui permet », « il évite »).',
    participes.size, exemplesDeTermes(participes));

  // 3. Voix passive — on exige l'agent introduit par « par », comme dans l'exemple
  //    du skill (« la page est indexée par Google »). Sans lui, la détection
  //    confondrait tout attribut (« le prix est élevé ») avec une passive.
  const passives = phrases.filter(p =>
    /\b(?:est|sont|était|étaient|a été|ont été|sera|seront)\s+\p{L}+(?:é|ée|és|ées|i|ie|is|ies|u|ue|us|ues)\s+par\b/iu.test(p));
  ajoute('passive', 'Voix passive', 'Mettre le sujet en action : « Google indexe la page ».',
    passives.length, passives.map(p => ({ extrait: p })));

  // 4. Adverbes en -ment
  const adverbes = new Map();
  phrases.forEach((p) => {
    (p.match(/\b\p{L}{5,}ment\b/giu) || []).forEach((a) => {
      const cle = a.toLowerCase();
      if (/^(?:document|moment|ciment|instrument|argument|element|élément|vetement|vêtement|batiment|bâtiment|traitement|equipement|équipement|logement|paiement|abonnement|environnement|gouvernement|complement|complément|supplement|supplément|remplacement|amenagement|aménagement|revetement|revêtement|isolement|placement|classement|financement)$/.test(cle)) return;
      if (!adverbes.has(cle)) adverbes.set(cle, []);
      const l = adverbes.get(cle);
      if (l.length < 2) l.push(p);
    });
  });
  ajoute('adverbes', 'Adverbes en -ment', 'À éviter : préférer un mot plus précis ou supprimer.',
    adverbes.size, exemplesDeTermes(adverbes));

  // 5. Phrases trop longues
  const longues = phrases
    .map(p => ({ extrait: p, mots: p.split(/\s+/).length }))
    .filter(o => o.mots > MOTS_MAX_PHRASE)
    .sort((a, b) => b.mots - a.mots);
  ajoute('phrases', `Phrases de plus de ${MOTS_MAX_PHRASE} mots`,
    `${longues.length} sur ${phrases.length} phrases. Couper en deux, ou raccourcir.`,
    longues.length, longues);

  // 6. Tirets cadratins et demi-cadratins
  const cadratins = phrases.filter(p => /[—–]/.test(p));
  ajoute('cadratins', 'Tirets cadratins', 'Remplacer par une virgule, deux points, ou deux phrases.',
    cadratins.length, cadratins.map(p => ({ extrait: p })));

  // 7. Clichés
  const cliches = chercheTermes(phrases, CLICHES);
  ajoute('cliches', 'Clichés bannis', 'Formules vides à supprimer.',
    cliches.size, exemplesDeTermes(cliches));

  // 8. Méta-commentaires
  const metas = chercheTermes(phrases, META);
  ajoute('meta', 'Méta-commentaires', 'Ne pas présenter l\'article ni annoncer le plan.',
    metas.size, exemplesDeTermes(metas));

  // 9. Parenthèses : une au maximum par paragraphe
  const tropParentheses = paras
    .map(p => ({ extrait: p, n: (p.match(/\(/g) || []).length }))
    .filter(o => o.n > 1);
  ajoute('parentheses', 'Paragraphes à plusieurs parenthèses', 'Une parenthèse au maximum par paragraphe.',
    tropParentheses.length, tropParentheses);

  // 10. Titres trop longs
  const titresLongs = titres
    .map(t => ({ extrait: `${t.niveau} — ${t.texte}`, mots: t.texte.split(/\s+/).length }))
    .filter(o => o.mots > MOTS_MAX_TITRE);
  ajoute('titres', `Titres de plus de ${MOTS_MAX_TITRE} mots`, 'Raccourcir le sous-titre.',
    titresLongs.length, titresLongs);

  return {
    total: findings.reduce((n, f) => n + f.count, 0),
    phrases: phrases.length,
    findings,
  };
};
