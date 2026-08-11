/**
 * scrapeClean.js — retire du contenu scrapé ce qui n'est PAS de l'éditorial.
 *
 * Pourquoi ce filtre existe. Le scraping capte le widget « Suivre sur Google
 * Discover » présent dans les pages de l'équipe : deux liens vers
 * `profile.google.com/cp/…` et `google.com/preferences/source?q=…`, avec les
 * ancres « Discover » et « Ajouter comme source préférée ».
 *
 * Le verrou liens externes (règle 8) impose de reproduire À L'IDENTIQUE tout lien
 * externe présent dans l'article d'origine. Il exigeait donc que l'IA replace ces
 * boutons de suivi Google dans un article de couverture. Conséquences observées
 * en production, par ordre de gravité croissante :
 *   • l'IA s'y plie en inventant une phrase (« … en cliquant sur Discover ou
 *     Ajouter comme source préférée »), publiée telle quelle ;
 *   • puis elle REFUSE, et le verrou rejette les 3 tentatives : « Verrou liens
 *     externes : 2 lien(s) externe(s) de l'article d'origine absent(s) de la
 *     réécriture après 3 essais » → génération impossible sur cet article.
 *
 * Le verrou n'est PAS en cause et ne doit pas être touché : il se comporte comme
 * prévu. C'est le PÉRIMÈTRE du scraping qu'il faut corriger, en amont.
 *
 * Périmètre volontairement étroit : uniquement ces deux motifs Google. Tout autre
 * lien externe — y compris commercial — est de l'éditorial et reste intact.
 */

/** Boutons de suivi Google, jamais du contenu d'article. */
export const NON_EDITORIAL_LINK_PATTERNS = [
  // « Suivre » / fiche éditeur Google Discover
  /^https?:\/\/profile\.google\.com\/cp\//i,
  // « Ajouter comme source préférée » dans la recherche Google
  /^https?:\/\/(?:www\.)?google\.[a-z.]{2,6}\/preferences\/source/i,
];

export const isNonEditorialLink = (href) => {
  const u = String(href || '').trim();
  if (!u) return false;
  return NON_EDITORIAL_LINK_PATTERNS.some((re) => re.test(u));
};

/**
 * Retire les liens non éditoriaux d'un fragment HTML.
 *
 * L'ancre est supprimée AVEC son texte : « Discover » et « Ajouter comme source
 * préférée » sont des libellés de widget, pas de la prose. Un `<p>` ou un `<div>`
 * qui ne contenait que ces boutons est retiré à son tour, pour ne pas laisser un
 * bloc vide dans l'article.
 *
 * @returns {{ html: string, removed: string[] }} le HTML nettoyé et les URL retirées
 */
export const stripNonEditorialLinks = (html) => {
  const src = typeof html === 'string' ? html : '';
  if (!src || typeof document === 'undefined') return { html: src, removed: [] };

  const box = document.createElement('div');
  box.innerHTML = src;
  const removed = [];

  Array.from(box.querySelectorAll('a[href]')).forEach((a) => {
    const href = a.getAttribute('href');
    if (!isNonEditorialLink(href)) return;
    removed.push(href);
    const parent = a.parentElement;
    a.remove();
    // Conteneur devenu vide (le widget n'était que ces boutons) → on l'enlève
    // aussi, en s'arrêtant au conteneur racine.
    let n = parent;
    while (n && n !== box && !n.textContent.trim() && !n.querySelector('img, table, iframe, video')) {
      const suivant = n.parentElement;
      n.remove();
      n = suivant;
    }
  });

  return { html: removed.length ? box.innerHTML : src, removed };
};

/**
 * Même filtre sur du texte brut (repli Jina, qui ne rend pas de HTML) : on retire
 * les URL nues correspondantes.
 *
 * La ponctuation est retirée AUX DEUX BOUTS avant comparaison : une URL entre
 * parenthèses arrive sous la forme `(https://…).`, et ne tester que la fin la
 * laissait passer.
 */
const PONCTUATION_DEBUT = /^[([<«"'‘“]+/;
const PONCTUATION_FIN   = /[)\]>»"'’”,.;:!?]+$/;

// Lien markdown `[libellé](url)` — la forme rendue par le repli Jina. Une passe
// dédiée est nécessaire : découpé en mots, `[Discover](https://…)` ne commence
// pas par `http`, donc le filtre d'URL nues le laissait passer.
const LIEN_MARKDOWN = /\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)/g;

export const stripNonEditorialUrlsFromText = (texte) => {
  const s = typeof texte === 'string' ? texte : '';
  if (!s) return s;
  const sansMarkdown = s.replace(LIEN_MARKDOWN, (tout, url) => (isNonEditorialLink(url) ? '' : tout));
  return sansMarkdown
    .split(/\s+/)
    .filter((mot) => !isNonEditorialLink(mot.replace(PONCTUATION_DEBUT, '').replace(PONCTUATION_FIN, '')))
    .join(' ')
    .trim();
};
