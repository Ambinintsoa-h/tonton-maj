import { repairStructureEl } from './diff';

export const exportAsText = (content) => {
  const div = document.createElement('div');
  div.innerHTML = content;
  // Remove deleted content spans
  div.querySelectorAll('.deleted-content').forEach(el => el.remove());
  // Replace updated spans with their text
  div.querySelectorAll('.updated-content').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent));
  });
  return div.textContent || div.innerText || '';
};

// Retire la taille de police PARASITE (0.8125rem) issue de WordPress / copier-coller.
// Un texte sans font-size inline adopte la taille uniforme du thème (en ligne) et de
// l'éditeur (TONTON) → plus de différences. On ne touche PAS aux tailles en px réglées
// intentionnellement via la barre d'outils (font-size: 16px, 18px…).
export const stripParasiticFontSize = (root) => {
  if (!root) return;
  root.querySelectorAll('[style*="font-size"]').forEach((el) => {
    if (el.style && el.style.fontSize === '0.8125rem') {
      el.style.removeProperty('font-size');
      if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    }
  });
};

// ── R3 — DOFOLLOW : aucun lien publié ne doit bloquer le suivi des moteurs ───
// Jetons rel qui bloquent le suivi et qui sont donc RETIRÉS : "nofollow", "ugc",
// "sponsored" — DÉCISION EXPLICITE d'Andrianina : « tous, internes et externes ».
//
// "sponsored" a d'abord été conservé par précaution (exigence Google sur les
// liens payants/affiliés). Erreur de lecture du contexte réel : LES LIENS
// EXTERNES DE CES ARTICLES SONT LES ARTICLES SPONSORISÉS — PAYANTS. Un plugin
// WordPress qui pose rel="sponsored" sur un lien qu'un client a payé pour
// obtenir en dofollow retire au client exactement ce qu'il a acheté en le
// conservant. Risque commercial assumé côté Google (lien payant non marqué =
// exposition à une pénalité) — arbitrage d'Andrianina, pas un oubli.
//
// Jetons CONSERVÉS, volontairement :
//   • "noopener" / "noreferrer" — garde-fous navigateur, PAS des directives de
//     suivi. Les verrous liens externes attendent d'ailleurs rel="noopener" à
//     l'identique (externalLinks.test.js, sanitizeFullArticle.test.js).
//   • tout autre jeton (me, author, tag, alternate…) — hors du périmètre R3.
// L'attribut rel est SUPPRIMÉ s'il ne reste plus aucun jeton.
// Si rien n'est à retirer, l'attribut n'est PAS réécrit : casse, ordre et
// espacement d'origine restent intacts (aucune churn sur le HTML publié).
// Ne cible QUE les <a> : le rel d'un <link> (stylesheet, canonical…) est
// structurant et n'a rien à voir avec le suivi des liens de contenu.
const FOLLOW_BLOCKERS = new Set(['nofollow', 'ugc', 'sponsored']);

/** Hôte d'une URL, sans `www.`. `null` si non analysable. */
const hostDe = (u = '') => {
  try { return new URL(String(u), 'https://x.invalid').hostname.replace(/^www\./, '') || null; }
  catch { return null; }
};

/**
 * POLITIQUE DE SUIVI DES LIENS — appliquée au point de sortie unique.
 *
 * INTERNE  (même domaine, ou href relatif) → DOFOLLOW : les jetons qui bloquent
 *          le suivi sont retirés. C'est du maillage interne, il doit transmettre.
 * EXTERNE  (autre domaine) → NOFOLLOW : le jeton est AJOUTÉ s'il manque.
 *          Décision Andrianina : les liens externes de ces articles sont les
 *          articles sponsorisés payants, et un lien payant suivi expose le site
 *          à une pénalité Google.
 *
 * `noopener` / `noreferrer` sont conservés des deux côtés : ce sont des
 * garde-fous navigateur, pas des directives de suivi. `sponsored` / `ugc`
 * présents sur un lien externe sont conservés (ils vont dans le même sens).
 *
 * Sans `articleUrl` exploitable, tout href ABSOLU est traité comme externe :
 * c'est la protection maximale, et c'est déjà la convention de `diff.js`.
 */
export const applyLinkFollowPolicy = (root, articleUrl = '') => {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const siteHost = hostDe(articleUrl);
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;

    const absolu = /^(https?:)?\/\//i.test(href);
    const cible  = absolu ? hostDe(href.startsWith('//') ? `https:${href}` : href) : null;
    const externe = absolu && (!siteHost || !cible || cible !== siteHost);

    const tokens = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
    if (externe) {
      if (!tokens.some((t) => t.toLowerCase() === 'nofollow')) tokens.push('nofollow');
      a.setAttribute('rel', tokens.join(' '));
    } else {
      const kept = tokens.filter((t) => !FOLLOW_BLOCKERS.has(t.toLowerCase()));
      if (kept.length === tokens.length) return;      // rien à retirer : on ne réécrit pas
      if (kept.length === 0) a.removeAttribute('rel');
      else a.setAttribute('rel', kept.join(' '));
    }
  });
};

// Convertit les sections FAQ au format h2/h3/p → <details>/<summary> pour WordPress.
// Les sections déjà en <details>/<summary> (générées par l'IA) sont ignorées.
// WordPress ≥ 5.9 préserve <details>/<summary> via wp_kses_post : comportement accordéon
// natif du navigateur, aucun JS ni plugin requis, quel que soit le thème.
const convertFaqToAccordion = (div) => {
  const headings = Array.from(div.querySelectorAll('h1, h2, h3, h4'));
  for (const faqH of headings) {
    const text = faqH.textContent.toLowerCase().trim();
    if (
      !text.includes('faq') &&
      !text.includes('questions fréquentes') &&
      !text.includes('questions frequentes') &&
      !text.includes('foire aux questions')
    ) continue;

    const faqLevel = parseInt(faqH.tagName[1], 10);
    const qTag     = 'H' + (faqLevel + 1);

    // Section déjà convertie en accordéon → skip
    let probe = faqH.nextElementSibling;
    let hasDetails = false;
    while (probe) {
      const lvl = parseInt(probe.tagName?.[1], 10);
      if (!isNaN(lvl) && lvl <= faqLevel) break;
      if (probe.tagName === 'DETAILS') { hasDetails = true; break; }
      probe = probe.nextElementSibling;
    }
    if (hasDetails) continue;

    // Convertir chaque paire <qTag>question</qTag><p>réponse</p> en <details>/<summary>
    let node = faqH.nextElementSibling;
    while (node) {
      const lvl = parseInt(node.tagName?.[1], 10);
      if (!isNaN(lvl) && lvl <= faqLevel) break; // fin de section FAQ

      if (node.tagName === qTag) {
        const answerEl  = node.nextElementSibling;
        const hasAnswer = answerEl && answerEl.tagName === 'P';
        const nextStart = hasAnswer ? answerEl.nextElementSibling : node.nextElementSibling;

        const details = div.ownerDocument.createElement('details');
        const summary = div.ownerDocument.createElement('summary');
        // Le heading original (h3, h4…) est conservé DANS le <summary>.
        // Si WordPress < 6.4 supprime <details>/<summary>, le <h3> reste intact
        // et la structure h3/p d'origine est préservée — pas de régression.
        const qEl = div.ownerDocument.createElement(node.tagName);
        qEl.innerHTML = node.innerHTML;
        qEl.style.display = 'inline';
        summary.appendChild(qEl);
        details.appendChild(summary);
        if (hasAnswer) details.appendChild(answerEl); // déplace (pas clone) le <p>

        node.parentNode.insertBefore(details, node);
        node.remove();
        node = nextStart;
      } else {
        node = node.nextElementSibling;
      }
    }
  }
};

// ── Thème inline des accordéons FAQ pour le site de destination ───────────────
// Reproduit en styles INLINE le design de l'éditeur TONTON (index.css,
// .md-content details) : le HTML publié ne transporte ni classe ni feuille de
// style, seul l'inline survit sur WordPress. Structure sémantique imposée au
// passage : <summary><h3>Question</h3></summary> (SEO) et réponses englobées
// dans des <p>. L'éditeur, lui, garde son HTML nu + CSS (aucun changement).
const INLINE_TAGS = new Set(['B', 'STRONG', 'EM', 'I', 'U', 'S', 'A', 'SPAN', 'CODE', 'SMALL', 'SUB', 'SUP', 'MARK', 'ABBR', 'BR']);

const applyFaqInlineTheme = (div) => {
  div.querySelectorAll('details').forEach((details) => {
    // Repartir de zéro : les styles/classes hérités d'anciennes publications
    // sont remplacés par le thème (comportement historique : neutralisation).
    details.removeAttribute('class');
    details.removeAttribute('style');
    details.style.border = '1px solid #e5e7eb';
    details.style.borderRadius = '8px';
    details.style.margin = '0.5em 0';
    details.style.background = '#fff';
    details.style.overflow = 'hidden';

    const summary = Array.from(details.children).find(el => el.tagName === 'SUMMARY');
    if (summary) {
      summary.removeAttribute('class');
      summary.removeAttribute('style');
      summary.style.cursor = 'pointer';
      summary.style.padding = '0.7em 1em';
      summary.style.fontWeight = '600';
      summary.style.color = '#1f2937';
      // Question en heading (h3 par défaut) — inline pour rester alignée avec
      // le marqueur natif ▶ du <summary>.
      let h = summary.querySelector('h1, h2, h3, h4, h5, h6');
      if (!h) {
        h = document.createElement('h3');
        while (summary.firstChild) h.appendChild(summary.firstChild);
        summary.appendChild(h);
      }
      h.style.display = 'inline';
      h.style.margin = '0';
      h.style.padding = '0';
      h.style.fontSize = '1.05em';
      h.style.fontWeight = '600';
    }

    // Réponses : envelopper les nœuds texte / éléments inline orphelins dans
    // des <p> (runs consécutifs regroupés dans le même paragraphe).
    let run = [];
    const flushRun = (before) => {
      if (!run.length) return;
      const hasText = run.some(n => (n.textContent || '').trim());
      if (hasText) {
        const p = document.createElement('p');
        details.insertBefore(p, before);
        run.forEach(n => p.appendChild(n));
      } else {
        run.forEach(n => n.remove());
      }
      run = [];
    };
    for (const node of Array.from(details.childNodes)) {
      if (node === summary) { flushRun(node); continue; }
      const isInlineNode =
        node.nodeType === Node.TEXT_NODE ||
        (node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(node.tagName));
      if (isInlineNode) run.push(node);
      else flushRun(node);
    }
    flushRun(null);

    // Espacement des blocs de réponse (équivalent du CSS éditeur :
    // details > *:not(summary) { padding: 0.2em 1em } + 0.8em en bas du dernier)
    const blocks = Array.from(details.children).filter(el => el.tagName !== 'SUMMARY');
    blocks.forEach((el, i) => {
      el.style.margin = '0';
      el.style.padding = i === blocks.length - 1 ? '0.2em 1em 0.8em' : '0.2em 1em';
    });
  });
};

// `articleUrl` est OPTIONNEL : sans lui, la politique de suivi ne peut pas
// distinguer interne d'externe et traite tout absolu comme externe (protection
// maximale). Paramètre ajouté en second pour que les appels existants restent
// valides tels quels.
export const exportAsHtml = (content, articleUrl = '') => {
  const div = document.createElement('div');
  div.innerHTML = content;

  // Réparer une structure cassée par un déplacement/collage (#2) : blocs sortis
  // d'un <p>, marqueurs de diff vides, <p> vidés → HTML publié toujours valide.
  repairStructureEl(div);

  // Nettoyer les vestiges ez-toc (spans ajoutés par WordPress à chaque publication).
  // Si le contenu de l'éditeur contient déjà ces spans d'une publication précédente,
  // ils provoqueraient une accumulation à la prochaine publication. On débalise
  // sans perdre le texte (replaceChild par un fragment de leurs enfants).
  div.querySelectorAll('span.ez-toc-section, span.ez-toc-section-end').forEach(span => {
    const frag = document.createDocumentFragment();
    while (span.firstChild) frag.appendChild(span.firstChild);
    if (span.parentNode) span.parentNode.replaceChild(frag, span);
  });

  // ── Diffs encore EN ATTENTE : rien de non-accepté ne sort ────────────────────
  // Un remplacement en attente = paire <del>ancien</del><mark>nouveau</mark>
  // (insérée adjacente par applyDiff) → on restaure l'ANCIEN texte : le <mark>
  // jumeau est supprimé, le <del> débalisé. Un <del> seul (suppression en
  // attente) est débalisé aussi : son texte est conservé.
  div.querySelectorAll('del').forEach(del => {
    const twin = del.nextElementSibling;
    if (twin && twin.tagName === 'MARK' && !twin.classList.contains('manual-highlight')) twin.remove();
    const frag = document.createDocumentFragment();
    while (del.firstChild) frag.appendChild(del.firstChild);
    if (del.parentNode) del.parentNode.replaceChild(frag, del);
  });
  // Résidus barrés dégénérés (span.deleted-content inline-isé par Chrome…) :
  // le barré ne doit jamais être publié.
  div.querySelectorAll('.deleted-content').forEach(el => el.remove());

  // <mark> de diff ORPHELINS (sans <del> jumeau) : débalisés — on ne supprime
  // jamais du texte affiché sans son original à restaurer.
  // Les <mark class="manual-highlight"> (surlignages manuels) sont préservés pour WordPress.
  div.querySelectorAll('.updated-content, mark:not(.manual-highlight)').forEach(el => {
    const frag = document.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    if (el.parentNode) el.parentNode.replaceChild(frag, el);
  });

  // Blocs AJOUTÉS non acceptés (<ins class="added-content">) : jamais publiés
  div.querySelectorAll('ins.added-content').forEach(el => el.remove());

  // Nettoyer la classe interne "manual-highlight" des <mark> → sortie propre pour WordPress
  // Le <mark style="background-color:..."> nu est le format Gutenberg natif (wp_kses_post OK).
  div.querySelectorAll('mark.manual-highlight').forEach(el => {
    el.classList.remove('manual-highlight');
    if (!el.getAttribute('class')?.trim()) el.removeAttribute('class');
  });

  // Supprimer les overlays éditeur (data-media-overlay) — éléments UI uniquement,
  // ne doivent jamais être publiés dans WordPress
  div.querySelectorAll('[data-media-overlay]').forEach(el => el.remove());

  // Espacement des titres : retirer toute marge inline sur h1-h6 → c'est le THÈME
  // WordPress qui gère l'espacement des titres une fois publié (pas TONTON).
  div.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    if (!h.style) return;
    h.style.removeProperty('margin');
    h.style.removeProperty('margin-top');
    h.style.removeProperty('margin-bottom');
    h.style.removeProperty('padding');
    h.style.removeProperty('padding-top');
    h.style.removeProperty('padding-bottom');
    if (!h.getAttribute('style')?.trim()) h.removeAttribute('style');
  });
  div.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    h.innerHTML = h.innerHTML.replace(/\s*\(TL[;:]?DR\)/gi, '');
  });

  // Dépublier les surlignages de liens internes non appliqués : remplacer le <span>
  // par son contenu texte brut (le lien n'a pas été validé par l'utilisateur).
  div.querySelectorAll('[data-il-idx]').forEach(span => {
    const frag = document.createDocumentFragment();
    while (span.firstChild) frag.appendChild(span.firstChild);
    if (span.parentNode) span.parentNode.replaceChild(frag, span);
  });

  // R2 — MARQUE des clauses RÉDIGÉES PAR LE CODE (data-lien-redige, voir
  // src/utils/internalWeave.js) : elle sert au rédacteur dans l'éditeur, elle n'a
  // rien à faire sur le site. Même traitement que [data-il-idx] juste au-dessus :
  // le <span> porteur est débalisé, donc la classe, l'infobulle et le
  // data-attribut partent — mais le TEXTE et le <a> restent. Le lien du brief est
  // obligatoire (R2) : il doit survivre à la publication, contrairement à sa
  // marque de relecture.
  div.querySelectorAll('[data-lien-redige]').forEach(span => {
    const frag = document.createDocumentFragment();
    while (span.firstChild) frag.appendChild(span.firstChild);
    if (span.parentNode) span.parentNode.replaceChild(frag, span);
  });

  // Convertir les wrappers vidéo (iframes YouTube) en URL brute pour WordPress oEmbed.
  // WordPress strip les <iframe> via wp_kses ; une URL YouTube seule sur sa propre ligne
  // est auto-convertie en lecteur embarqué par le mécanisme oEmbed natif de WordPress.
  div.querySelectorAll('[data-media-type="video"]').forEach(wrapper => {
    const iframe = wrapper.querySelector('iframe');
    const src = iframe ? (iframe.getAttribute('src') || '') : '';
    const match = src.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) {
      const p = document.createElement('p');
      p.textContent = `https://www.youtube.com/watch?v=${match[1]}`;
      wrapper.parentNode?.replaceChild(p, wrapper);
    } else {
      // Vidéo non-YouTube : garder la balise <video> seule, supprimer le wrapper
      const video = wrapper.querySelector('video');
      if (video && wrapper.parentNode) wrapper.parentNode.replaceChild(video, wrapper);
    }
  });

  // Convertir les FAQ en h2/h3/p vers <details>/<summary> avant publication.
  // Les sections déjà en accordéon (générées par l'IA) sont ignorées.
  convertFaqToAccordion(div);

  // FAQ en accordéon : conserver les <details>/<summary> natifs (acceptés par
  // WordPress ≥ 5.9) et leur appliquer le thème TONTON en styles INLINE
  // (carte bordée arrondie, question en <h3>, réponses en <p>) → le site de
  // destination affiche le même design que l'éditeur, sans CSS ni plugin.
  applyFaqInlineTheme(div);

  // Uniformiser la typo : retirer les tailles de police parasites (0.8125rem)
  // → WordPress applique la taille du thème à tout le contenu.
  stripParasiticFontSize(div);

  // Lier les ancres du sommaire aux headings correspondants.
  // L'IA génère <a href="#slug"> sans mettre d'id sur les <h2>. WordPress/ez-toc
  // ajoute ses propres ids (différents) → les ancres pointaient dans le vide.
  // Fix : matcher chaque lien de liste interne au heading dont le texte correspond,
  // et injecter l'id directement sur le <h2>/<h3>.
  const normToc = t => t.toLowerCase().replace(/\s*\(TL[;:]?DR\)/gi, '').replace(/\s+/g, ' ').trim();
  div.querySelectorAll('li a[href^="#"]').forEach(link => {
    const targetId = link.getAttribute('href').slice(1);
    if (!targetId) return;
    const linkText = normToc(link.textContent);
    if (!linkText) return;
    for (const h of div.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (!h.id && normToc(h.textContent) === linkText) {
        h.setAttribute('id', targetId);
        break;
      }
    }
  });

  // R3 — DOFOLLOW : dernier filet avant publication. exportAsHtml est le point de
  // passage OBLIGATOIRE et UNIQUE de tout ce qui sort (publication REST, export
  // fichier, markdown) : cette passe couvre donc AUSSI les chemins d'écriture qui
  // contournent les verrous amont (phases 3 et 4 d'obsolescence/relecture,
  // "Appliquer" une suggestion en attente, collage, lien posé à la main).
  // INTERNE → dofollow (jetons bloquants retirés) ; EXTERNE → nofollow AJOUTÉ.
  applyLinkFollowPolicy(div, articleUrl);

  // Filet de sécurité regex — élimine tout résidu <del>/<mark>/<ins> non capturé par le DOM
  let html = div.innerHTML;
  html = html.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '');
  // Débaliser les <mark> résiduels SANS attribut style (diff non capturés par le DOM).
  // Les <mark style="..."> (surlignages manuels, class déjà nettoyée) sont préservés.
  let prev = '';
  while (prev !== html) {
    prev = html;
    html = html.replace(/<mark\b(?![^>]*\bstyle\s*=)[^>]*>([\s\S]*?)<\/mark>/gi, '$1');
  }
  // <ins class="added-content"> résiduel = ajout non accepté → supprimé, jamais publié
  html = html.replace(/<ins\b[^>]*class="added-content"[^>]*>[\s\S]*?<\/ins>/gi, '');

  // ── Anti-<br> parasites de WordPress (wpautop) ──────────────────────────────
  // WordPress applique wpautop sur the_content : tout saut de ligne ENTRE des
  // balises est converti en <br> au rendu → des <br> apparaissent partout (et
  // un gros paquet au-dessus des tableaux). Comme notre HTML est déjà
  // strictement structuré en blocs, on retire les retours à la ligne situés
  // aux FRONTIÈRES de blocs → wpautop n'a plus rien à convertir.
  // On ne touche PAS aux espaces/retours entre éléments INLINE (ex. </strong>
  // <em>) : la séparation entre mots reste intacte.
  const BLOCK = 'p|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|div|figure|figcaption|details|summary|section|article|blockquote|hr';
  html = html
    .replace(new RegExp(`(</(?:${BLOCK})>)\\s*\\n[\\s\\n]*`, 'gi'), '$1')       // après une fermeture de bloc
    .replace(new RegExp(`\\n[\\s\\n]*(<(?:${BLOCK})[\\s>/])`, 'gi'), '$1')       // avant une ouverture de bloc
    .replace(new RegExp(`(<(?:${BLOCK})[^>]*>)\\s*\\n[\\s\\n]*`, 'gi'), '$1');   // juste après l'ouverture (ex. <div wrap>\n<table>)
  return html;
};

export const exportAsMarkdown = (content, articleUrl = '') => {
  const html = exportAsHtml(content, articleUrl);
  // Basic HTML to Markdown conversion
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const copyToClipboard = async (text) => {
  await navigator.clipboard.writeText(text);
};
