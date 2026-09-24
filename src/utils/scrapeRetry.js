/**
 * scrapeRetry.js — politique de réessai du scraping, UNE SEULE fois pour les
 * deux chemins qui scrapent un article : le flux interactif (services/
 * scraper.js, navigateur, "Faire une MAJ") et le pipeline headless
 * (server/pipeline.js, "MAJ en lot"). Extrait de services/scraper.js
 * (24 septembre 2026) : le pipeline headless appelait POST /scrape en
 * direct, SANS repasser par ce réessai -- constaté sur un lot réel où 3
 * articles sont morts en ~2 s sur un simple 503 transitoire du site source,
 * sans la moindre tentative de rattrapage, alors que le même incident côté
 * interactif se serait résolu tout seul.
 *
 * Décision Andrianina, 16 septembre 2026 (voir le commit d'origine de
 * services/scraper.js pour le détail de l'incident qui a motivé ces
 * valeurs) : 2 réessais, délais progressifs 4 s puis 12 s, restreints aux
 * échecs VRAIMENT transitoires (429/503/504/500-timeout) -- jamais
 * 403/404/400, qui redonneraient exactement la même réponse une minute plus
 * tard pour rien.
 */
export const SCRAPE_RETRY_DELAYS_MS = [4000, 12000];

/**
 * @param {Error & {response?: {status:number, data?:{error?:string}}}} err
 * @returns {boolean}
 */
export const scrapeRetryable = (err) => {
  if (!err?.response) return false;              // pas de réponse HTTP : proxy éteint / coupure réseau, pas un réessai de CE module
  const { status, data } = err.response;
  if (status === 429) return true;                // notre limiteur, ou celui d'un tiers
  if (status === 503 || status === 504) return true;
  // 500 porteur d'un timeout : la route a répondu, mais la récupération
  // distante n'a pas abouti dans le temps imparti.
  if (status === 500 && /timeout/i.test(String(data?.error || ''))) return true;
  return false;
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Rejoue `appel` tant que l'échec est transitoire (voir `scrapeRetryable`).
 * Relance la DERNIÈRE erreur si les essais sont épuisés : l'appelant doit
 * voir le vrai motif, pas une erreur générique de réessai.
 *
 * @param {() => Promise<any>} appel
 * @param {{onRetry?: (err: Error, delayMs: number, essai: number) => void}} [opts]
 *   `onRetry` reçoit l'erreur transitoire, le délai avant le prochain essai
 *   et le numéro de CE réessai (1-based) -- pour logger/informer l'appelant
 *   sans dupliquer la boucle.
 */
export const avecReessaiScrape = async (appel, opts = {}) => {
  const { onRetry } = opts;
  for (let i = 0; ; i++) {
    try {
      return await appel();
    } catch (err) {
      if (i >= SCRAPE_RETRY_DELAYS_MS.length || !scrapeRetryable(err)) throw err;
      const delay = SCRAPE_RETRY_DELAYS_MS[i];
      if (onRetry) onRetry(err, delay, i + 1);
      await attendre(delay);
    }
  }
};
