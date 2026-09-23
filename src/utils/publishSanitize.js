// ── Filet de sécurité avant publication WordPress ───────────────────────────
//
// Bug constaté le 17/09/2026 sur guiderenovation.fr (et probablement d'autres
// sites du parc) : un bloc JSON-LD de FAQ (schema.org FAQPage) atterrit dans
// `post_content` en TEXTE VISIBLE au lieu d'être enveloppé dans
// `<script type="application/ld+json">…</script>`, ET les échappements
// unicode (è, ’…) ont perdu leur backslash (« connau00eetre » au
// lieu de « connaître » → affiché « connaître » une fois dans le
// script). Résultat : le JSON brut s'affiche comme un paragraphe illisible
// au-dessus de la FAQ, et les guillemets droits deviennent des guillemets
// français au rendu (wptexturize sur du texte de contenu, jamais sur un
// <script>) — signe que WordPress traite ce JSON comme du contenu normal.
//
// La cause exacte (prompt du skill IA ? réparation JSON trop agressive en
// amont ?) reste à confirmer côté génération. En attendant — et parce qu'un
// filet de sécurité au point de publication protège TOUS les chemins qui
// mènent à `postData.content`, quelle qu'en soit l'origine — ce module
// repère un objet JSON de type schema.org laissé nu dans le contenu, le
// répare si besoin (ré-insère les backslash manquants devant \uXXXX) et le
// réenveloppe proprement dans un <script> avant l'appel à l'API REST WP.
//
// Volontairement conservateur : ne touche QUE ce qui ressemble à du JSON-LD
// schema.org hors <script> ; le reste du contenu (prose, tableaux, FAQ en
// <details>) n'est jamais modifié.

/** Repère un `{` schema.org de départ plausible et retourne l'objet `{…}`
 *  correspondant en comptant les accolades (tolère des accolades dans les
 *  chaînes, comme repairJsonStructure côté agentQat.js). */
const extractBalancedObject = (text, start) => {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // jamais refermé -> pas exploitable
};

/**
 * Ré-insère un backslash devant les séquences `uXXXX` qui ont visiblement
 * perdu le leur (cas réel : è -> u00e8). Ne touche QUE l'intérieur du
 * candidat JSON déjà isolé (jamais la prose de l'article) : un « u » suivi
 * de 4 car. hex n'apparaît normalement jamais dans du texte français, les
 * chiffres ne s'y trouvant pas accolés à une lettre.
 */
const repairMissingBackslashes = (jsonLike) =>
  jsonLike.replace(/(^|[^\\])u([0-9a-fA-F]{4})/g, '$1\\u$2');

/**
 * Cherche dans `html` un objet JSON schema.org (FAQPage, Article, BreadcrumbList…)
 * qui N'EST PAS déjà à l'intérieur d'un <script type="application/ld+json">, et
 * le réenveloppe correctement. Idempotent : n'a aucun effet si tout le JSON-LD
 * du contenu est déjà bien formé et déjà dans un <script>.
 *
 * @returns {{ html: string, fixed: number, unresolved: number }}
 *   fixed      — nombre de blocs orphelins réparés et enveloppés
 *   unresolved — nombre de blocs détectés mais non réparables (laissés tels
 *                quels ; à investiguer manuellement — jamais publiés en silence)
 */
export const wrapOrphanJsonLd = (html = '') => {
  let out = String(html || '');
  let fixed = 0;
  let unresolved = 0;

  // Découpe par blocs <script>…</script> déjà présents pour ne JAMAIS
  // retoucher un JSON-LD déjà correctement enveloppé.
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  const segments = [];
  let lastIndex = 0;
  let m;
  while ((m = scriptRe.exec(out))) {
    segments.push({ text: out.slice(lastIndex, m.index), isScript: false });
    segments.push({ text: m[0], isScript: true });
    lastIndex = m.index + m[0].length;
  }
  segments.push({ text: out.slice(lastIndex), isScript: false });

  const SCHEMA_HINT = /"@context"\s*:\s*"https?:\/\/schema\.org"/;

  const processed = segments.map((seg) => {
    if (seg.isScript || !SCHEMA_HINT.test(seg.text)) return seg.text;

    let text = seg.text;
    let searchFrom = 0;
    let result = '';
    let cursor = 0;
    while (true) {
      const hintIdx = text.slice(searchFrom).search(SCHEMA_HINT);
      if (hintIdx === -1) break;
      const absHint = searchFrom + hintIdx;
      const braceStart = text.lastIndexOf('{', absHint);
      if (braceStart === -1) { searchFrom = absHint + 1; continue; }
      const candidate = extractBalancedObject(text, braceStart);
      if (!candidate) { searchFrom = absHint + 1; continue; }

      // On tente D'ABORD la version réparée (ré-insertion des backslash
      // manquants devant \uXXXX) : un texte "connau00eetre" est un JSON
      // SYNTAXIQUEMENT VALIDE (u00e8 n'est qu'une suite de lettres ordinaires
      // dans une chaîne) — JSON.parse ne lève AUCUNE erreur dessus, il n'y a
      // donc rien à « réparer » du point de vue du parseur. Le correctif doit
      // s'appliquer AVANT le parse, pas après un échec qui ne viendra jamais.
      // repairMissingBackslashes est un no-op sur un \uXXXX déjà correctement
      // échappé (le backslash existant bloque le remplacement) : sans risque
      // de casser un bloc déjà valide.
      let parsed = null;
      try { parsed = JSON.parse(repairMissingBackslashes(candidate)); } catch { /* on tente le candidat brut */ }
      if (!parsed) {
        try { parsed = JSON.parse(candidate); } catch { /* échec définitif */ }
      }

      result += text.slice(cursor, braceStart);
      if (parsed) {
        result += `<script type="application/ld+json">${JSON.stringify(parsed)}</script>`;
        fixed++;
      } else {
        // Non réparable : on laisse le texte original intact plutôt que de
        // publier un <script> cassé ou de faire disparaître la donnée.
        result += candidate;
        unresolved++;
      }
      cursor = braceStart + candidate.length;
      searchFrom = cursor;
    }
    result += text.slice(cursor);
    return result;
  });

  out = processed.join('');
  return { html: out, fixed, unresolved };
};
