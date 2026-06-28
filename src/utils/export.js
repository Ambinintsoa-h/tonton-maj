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

export const exportAsHtml = (content) => {
  const div = document.createElement('div');
  div.innerHTML = content;

  // Réparer une structure cassée par un déplacement/collage (#2) : blocs sortis
  // d'un <p>, marqueurs de diff vides, <p> vidés → HTML publié toujours valide.
  repairStructureEl(div);

  // Remove deleted content entirely
  div.querySelectorAll('.deleted-content, del').forEach(el => el.remove());

  // Unwrap diff marks: keep inner HTML, discard the <mark> wrapper.
  // Les <mark class="manual-highlight"> (surlignages manuels) sont préservés pour WordPress.
  div.querySelectorAll('.updated-content, mark:not(.manual-highlight)').forEach(el => {
    const frag = document.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    if (el.parentNode) el.parentNode.replaceChild(frag, el);
  });

  // Unwrap added paragraphs: keep inner HTML, discard the <ins class="added-content"> wrapper
  div.querySelectorAll('ins.added-content').forEach(el => {
    const frag = document.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    if (el.parentNode) el.parentNode.replaceChild(frag, el);
  });

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

  // Dépublier les surlignages de liens internes non appliqués : remplacer le <span>
  // par son contenu texte brut (le lien n'a pas été validé par l'utilisateur).
  div.querySelectorAll('[data-il-idx]').forEach(span => {
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

  // FAQ en accordéon : conserver les <details>/<summary> natifs (acceptés par
  // WordPress ≥ 5.9) mais retirer toute classe/couleur/style inline → apparence
  // NEUTRE, gérée par le thème. Uniformise le rendu TONTON ↔ WordPress.
  div.querySelectorAll('details, summary').forEach((el) => {
    el.removeAttribute('class');
    el.removeAttribute('style');
  });

  // Uniformiser la typo : retirer les tailles de police parasites (0.8125rem)
  // → WordPress applique la taille du thème à tout le contenu.
  stripParasiticFontSize(div);

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
  html = html.replace(/<ins\b[^>]*class="added-content"[^>]*>([\s\S]*?)<\/ins>/gi, '$1');
  return html;
};

export const exportAsMarkdown = (content) => {
  const html = exportAsHtml(content);
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
