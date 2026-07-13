// ── Analyse SEO locale — mêmes critères que Yoast SEO / SEOPress ─────────────
// Reproduit les contrôles que les plugins WordPress appliquent réellement,
// complétés par les règles internes de l'équipe (densité mot-clé, 50 % des
// titres, longueur d'article 800-1500, phrases ≤ 20 mots ≤ 12 %). Le verdict
// global est STRICT : vert uniquement si TOUS les critères critiques passent —
// c'est ce qui corrige le « l'outil montre vert alors que Yoast est rouge ».

// Normalisation façon Yoast : casse + accents ignorés pour chercher le mot-clé.
const norm = (s = '') =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const hasKw = (text, kw) => !!kw && norm(text).includes(norm(kw));

const countKw = (text, kw) => {
  if (!kw) return 0;
  const t = norm(text);
  const k = norm(kw);
  if (!k) return 0;
  let count = 0;
  let idx = t.indexOf(k);
  while (idx !== -1) { count++; idx = t.indexOf(k, idx + k.length); }
  return count;
};

const countWords = (text = '') => (text.trim().match(/\S+/g) || []).length;

const hostOf = (href) => {
  try { return new URL(href).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
};

/**
 * Analyse SEO du contenu FINAL + métas + mot-clé cible.
 * @param {object} p
 * @param {string} p.html            HTML final de l'article (sans marquage diff)
 * @param {string} p.focusKeyword    mot-clé cible
 * @param {string} p.metaTitle       meta title (balise SEO)
 * @param {string} p.metaDescription meta description
 * @param {string} p.articleUrl      URL de l'article (distinction liens internes/externes)
 * @returns {{ checks: Array<{id,label,status,detail}>, verdict: 'green'|'amber'|'red', stats: object }}
 *          status : 'green' | 'amber' | 'red' | 'gray' (non évaluable)
 */
export const analyzeSeo = ({ html = '', focusKeyword = '', metaTitle = '', metaDescription = '', articleUrl = '' }) => {
  const checks = [];
  const push = (id, label, status, detail) => checks.push({ id, label, status, detail });

  const kw = (focusKeyword || '').trim();
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (div) div.innerHTML = html || '';
  const text = div ? (div.textContent || '') : '';
  const words = countWords(text);

  // ── Mot-clé cible ───────────────────────────────────────────────────────────
  if (!kw) {
    push('kw', 'Mot-clé cible', 'red', 'Aucun mot-clé cible défini — toute l\'analyse SEO en dépend.');
  } else {
    push('kw', 'Mot-clé cible', 'green', `« ${kw} »`);
  }

  // ── Meta title ──────────────────────────────────────────────────────────────
  if (!metaTitle.trim()) {
    push('title-len', 'Longueur du meta title', 'red', 'Meta title vide.');
  } else if (metaTitle.length < 40) {
    push('title-len', 'Longueur du meta title', 'amber', `${metaTitle.length} caractères — visez 40 à 60.`);
  } else if (metaTitle.length <= 60) {
    push('title-len', 'Longueur du meta title', 'green', `${metaTitle.length}/60 caractères.`);
  } else {
    push('title-len', 'Longueur du meta title', 'red', `${metaTitle.length} caractères — sera tronqué par Google (max 60).`);
  }
  if (kw) {
    if (!hasKw(metaTitle, kw)) push('title-kw', 'Mot-clé dans le meta title', 'red', 'Absent — critère majeur Yoast/SEOPress.');
    else if (norm(metaTitle).indexOf(norm(kw)) > 30) push('title-kw', 'Mot-clé dans le meta title', 'amber', 'Présent mais loin du début — placez-le en tête.');
    else push('title-kw', 'Mot-clé dans le meta title', 'green', 'Présent en début de titre.');
  }

  // ── Meta description ────────────────────────────────────────────────────────
  if (!metaDescription.trim()) {
    push('desc-len', 'Longueur de la meta description', 'red', 'Meta description vide.');
  } else if (metaDescription.length < 120) {
    push('desc-len', 'Longueur de la meta description', 'amber', `${metaDescription.length} caractères — visez 120 à 155.`);
  } else if (metaDescription.length <= 155) {
    push('desc-len', 'Longueur de la meta description', 'green', `${metaDescription.length}/155 caractères.`);
  } else {
    push('desc-len', 'Longueur de la meta description', 'red', `${metaDescription.length} caractères — sera tronquée (max 155).`);
  }
  if (kw) {
    push('desc-kw', 'Mot-clé dans la meta description', hasKw(metaDescription, kw) ? 'green' : 'red',
      hasKw(metaDescription, kw) ? 'Présent.' : 'Absent — critère majeur Yoast/SEOPress.');
  }

  if (div) {
    // ── H1 ────────────────────────────────────────────────────────────────────
    const h1 = div.querySelector('h1');
    if (kw) {
      if (!h1) push('h1-kw', 'Mot-clé dans le titre (H1)', 'gray', 'Pas de H1 dans le contenu (titre géré par WordPress) — vérifiez-le côté WP.');
      else push('h1-kw', 'Mot-clé dans le titre (H1)', hasKw(h1.textContent, kw) ? 'green' : 'red',
        hasKw(h1.textContent, kw) ? 'Présent.' : `Absent de « ${(h1.textContent || '').trim().substring(0, 60)}… »`);
    }

    // ── Introduction (premier paragraphe significatif) ────────────────────────
    if (kw) {
      const firstP = Array.from(div.querySelectorAll('p')).find(p => countWords(p.textContent) >= 15);
      if (!firstP) push('intro-kw', 'Mot-clé dans l\'introduction', 'gray', 'Introduction non détectée.');
      else push('intro-kw', 'Mot-clé dans l\'introduction', hasKw(firstP.textContent, kw) ? 'green' : 'red',
        hasKw(firstP.textContent, kw) ? 'Présent dans le chapeau.' : 'Absent du premier paragraphe.');
    }

    // ── Densité dans le corps (règle équipe : 2 à 3 occurrences) ─────────────
    if (kw) {
      const occ = countKw(text, kw);
      const per1000 = words > 0 ? (occ * norm(kw).split(' ').length * 1000) / words : 0;
      if (occ === 0) push('body-kw', 'Occurrences du mot-clé dans le texte', 'red', 'Aucune occurrence.');
      else if (occ === 1) push('body-kw', 'Occurrences du mot-clé dans le texte', 'amber', '1 seule occurrence — visez 2 à 3.');
      else if (per1000 > 40) push('body-kw', 'Occurrences du mot-clé dans le texte', 'amber', `${occ} occurrences — sur-optimisation possible.`);
      else push('body-kw', 'Occurrences du mot-clé dans le texte', 'green', `${occ} occurrences.`);
    }

    // ── Sous-titres H2/H3 (règle équipe : 50 %) ───────────────────────────────
    if (kw) {
      const subs = Array.from(div.querySelectorAll('h2, h3'));
      if (!subs.length) push('subs-kw', 'Mot-clé dans les H2/H3', 'amber', 'Aucun sous-titre H2/H3 détecté.');
      else {
        const withKw = subs.filter(h => hasKw(h.textContent, kw)).length;
        const ratio = withKw / subs.length;
        if (ratio >= 0.5) push('subs-kw', 'Mot-clé dans les H2/H3 (≥ 50 %)', 'green', `${withKw}/${subs.length} sous-titres.`);
        else if (withKw >= 1) push('subs-kw', 'Mot-clé dans les H2/H3 (≥ 50 %)', 'amber', `${withKw}/${subs.length} — la règle équipe vise 50 %.`);
        else push('subs-kw', 'Mot-clé dans les H2/H3 (≥ 50 %)', 'red', `0/${subs.length} sous-titre ne contient le mot-clé.`);
      }
    }

    // ── Longueur de l'article (règle équipe : 800-1500) ──────────────────────
    if (words < 300) push('length', 'Longueur de l\'article', 'red', `${words} mots — trop court pour être positionné (min 300).`);
    else if (words < 800) push('length', 'Longueur de l\'article', 'amber', `${words} mots — la cible équipe est 800 à 1 500.`);
    else if (words <= 1500) push('length', 'Longueur de l\'article', 'green', `${words} mots.`);
    else push('length', 'Longueur de l\'article', 'amber', `${words} mots — au-delà de la cible équipe (1 500).`);

    // ── Maillage interne ──────────────────────────────────────────────────────
    const articleHost = articleUrl ? hostOf(articleUrl) : null;
    const links = Array.from(div.querySelectorAll('a[href]'));
    const internal = links.filter(a => {
      const href = a.getAttribute('href') || '';
      if (/^#|^mailto:/i.test(href)) return false;
      if (!/^https?:\/\//i.test(href)) return true;           // chemin relatif = interne
      const h = hostOf(href);
      return !!(h && articleHost && h === articleHost);
    }).length;
    if (internal === 0) push('links', 'Liens internes', 'red', 'Aucun lien interne — critère Yoast/SEOPress.');
    else if (internal < 3) push('links', 'Liens internes', 'amber', `${internal} lien${internal > 1 ? 's' : ''} — la règle équipe vise 3 minimum.`);
    else push('links', 'Liens internes', 'green', `${internal} liens internes.`);

    // ── Images : attribut ALT ─────────────────────────────────────────────────
    const imgs = Array.from(div.querySelectorAll('img'));
    if (imgs.length) {
      const noAlt = imgs.filter(i => !(i.getAttribute('alt') || '').trim()).length;
      if (noAlt === 0) push('alt', 'Textes ALT des images', 'green', `${imgs.length} image${imgs.length > 1 ? 's' : ''}, toutes avec ALT.`);
      else push('alt', 'Textes ALT des images', 'amber', `${noAlt}/${imgs.length} image${noAlt > 1 ? 's' : ''} sans attribut ALT.`);
    }

    // ── Lisibilité : phrases > 20 mots ≤ 12 % (règle équipe ; Yoast : 25 %) ──
    const sentences = text.split(/[.!?…]+(?:\s|$)/).map(s => s.trim()).filter(s => countWords(s) >= 3);
    if (sentences.length >= 5) {
      const long = sentences.filter(s => countWords(s) > 20).length;
      const pct = Math.round((long / sentences.length) * 100);
      if (pct <= 12) push('sentences', 'Phrases longues (> 20 mots)', 'green', `${pct} % — sous le plafond équipe de 12 %.`);
      else if (pct <= 25) push('sentences', 'Phrases longues (> 20 mots)', 'amber', `${pct} % — au-dessus du plafond équipe (12 %), sous le seuil Yoast (25 %).`);
      else push('sentences', 'Phrases longues (> 20 mots)', 'red', `${pct} % de phrases trop longues (Yoast passe au rouge à 25 %).`);
    }

    // ── Structure : jamais deux titres enchaînés sans texte (règle équipe) ───
    const headings = Array.from(div.querySelectorAll('h2, h3'));
    const stacked = headings.filter(h => {
      let n = h.nextElementSibling;
      return n && /^H[2-6]$/.test(n.tagName);
    }).length;
    if (headings.length) {
      push('intro-between', 'Phrase introductive après chaque titre', stacked === 0 ? 'green' : 'red',
        stacked === 0 ? 'Aucun titre enchaîné sans texte.' : `${stacked} titre${stacked > 1 ? 's' : ''} directement suivi${stacked > 1 ? 's' : ''} d'un autre titre.`);
    }
  }

  // ── Verdict global STRICT ─────────────────────────────────────────────────
  const evaluated = checks.filter(c => c.status !== 'gray');
  const reds = evaluated.filter(c => c.status === 'red').length;
  const ambers = evaluated.filter(c => c.status === 'amber').length;
  const verdict = reds > 0 ? 'red' : ambers > 0 ? 'amber' : 'green';

  return { checks, verdict, stats: { words, reds, ambers, greens: evaluated.length - reds - ambers } };
};
