// Paires ancre + URL SUGGÉRÉES PAR L'AUDIT (phase 1), reprises telles quelles
// pour pré-remplir le maillage de la phase 2.
//
// L'audit produit déjà `internal_linking.liens_entrants` et le panneau QAT les
// affiche (« Liens internes suggérés »). Elles n'allaient nulle part : le
// rédacteur devait les recopier à la main dans le champ de saisie, donc en
// pratique personne ne le faisait et le brief partait vide. Le travail était
// fait, puis jeté.
//
// Ce module ne décide rien et ne filtre aucun domaine : la règle 8 reste tenue
// en aval par `cleanLinkRows`/`filterSameSiteLinks` (qui écartent une URL hors
// domaine) et l'écart est DIT au rédacteur pendant la saisie. Pré-remplir une
// suggestion hors domaine est donc sans danger, et la voir barrée en rouge vaut
// mieux que de la faire disparaître en silence.
import { INTERNAL_LINK_ROWS_MAX } from '../constants/majMode';

/**
 * Coercition de sûreté : l'audit vient d'un JSON LIBRE produit par le modèle.
 * Rien ne garantit qu'un champ annoncé « string » n'arrive pas en objet. Même
 * précaution que `asText` dans QatAuditPanel — mais ici on REFUSE l'objet plutôt
 * que d'en faire du JSON : une ancre `{"a":1}` n'est pas une ancre.
 */
const texte = (v) => {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
};

/** Clé de dédoublonnage d'une URL : casse et slash final ne distinguent rien. */
export const urlKey = (url = '') =>
  String(url).trim().toLowerCase().replace(/\/+$/, '');

/**
 * Les suggestions de l'audit, converties en lignes de saisie `{ anchor, url }`.
 * Une suggestion sans ancre OU sans URL est ignorée : une ligne à moitié remplie
 * ne se place pas et ferait croire à une paire de plus.
 */
export const auditSuggestedLinkRows = (audit) => {
  const bruts = audit && audit.internal_linking && audit.internal_linking.liens_entrants;
  if (!Array.isArray(bruts)) return [];
  const vues = new Set();
  const rows = [];
  bruts.forEach((l) => {
    const anchor = texte(l && l.ancre);
    const url = texte(l && l.url);
    if (!anchor || !url) return;
    const k = urlKey(url);
    if (vues.has(k)) return;
    vues.add(k);
    rows.push({ anchor, url });
  });
  return rows.slice(0, INTERNAL_LINK_ROWS_MAX);
};

/**
 * Fusionne des suggestions dans les lignes déjà saisies.
 *
 * AJOUT SEULEMENT, jamais un remplacement : ce que le rédacteur a tapé prime, et
 * une URL déjà présente n'est pas ajoutée une seconde fois (peu importe l'ancre
 * choisie de part et d'autre). Idempotent — refusionner ne duplique rien, c'est
 * ce qui rend l'opération sûre à répéter quand l'audit est relu.
 *
 * Les lignes vides de placeholder sont retirées dès qu'il reste du contenu ;
 * s'il ne reste rien, on rend une ligne vide pour que le champ reste utilisable.
 */
export const mergeLinkRows = (rows = [], extras = []) => {
  const saisies = (rows || [])
    .map((r) => ({ anchor: String((r && r.anchor) || ''), url: String((r && r.url) || '') }))
    .filter((r) => r.anchor.trim() || r.url.trim());

  const vues = new Set(saisies.map((r) => urlKey(r.url)).filter(Boolean));
  const ajouts = [];
  (extras || []).forEach((e) => {
    const anchor = String((e && e.anchor) || '').trim();
    const url = String((e && e.url) || '').trim();
    if (!anchor || !url) return;
    const k = urlKey(url);
    if (vues.has(k)) return;
    vues.add(k);
    ajouts.push({ anchor, url });
  });

  const fusion = [...saisies, ...ajouts].slice(0, INTERNAL_LINK_ROWS_MAX);
  return fusion.length ? fusion : [{ anchor: '', url: '' }];
};
