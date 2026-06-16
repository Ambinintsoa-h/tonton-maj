// ─────────────────────────────────────────────────────────────────────────────
// Skill par défaut maintenu par Tonton AI lui-même.
//
// Ce fichier est la SOURCE DE VÉRITÉ du skill « Skills par Tonton AI » : son
// contenu provient toujours du code (jamais écrasé par localStorage/Firestore),
// si bien qu'une modification ici se propage à tous au prochain chargement.
//
// Il contient les règles opérationnelles que Tonton AI s'impose pour ses mises
// à jour d'articles — des consignes transversales non couvertes par les skills
// métier saisis par l'équipe. À éditer librement quand une consigne mérite d'y
// figurer durablement.
// ─────────────────────────────────────────────────────────────────────────────

export const TONTON_SKILL_ID = 'tonton-ai-core-skill';

export const DEFAULT_SKILLS = [
  {
    id:        TONTON_SKILL_ID,
    name:      'Skills par Tonton AI',
    createdAt: 1700000000000,
    isDefault: true,
    content: `<h2>Règles de fonctionnement — Tonton AI</h2>
<p>Consignes transversales à toutes les mises à jour, en complément des skills métier et de la base de connaissances.</p>

<h3>1. Intégrité factuelle</h3>
<ul>
<li>Ne jamais inventer un chiffre, prix, statistique ou date : toute donnée nouvelle vient d'une source web réelle, citée dans "source".</li>
<li>Donnée incertaine et non sourçable → mention [à vérifier] dans "reason" plutôt que de l'affirmer.</li>
<li>Vérifier prix, versions, statistiques et dates contre les sources avant de les conserver.</li>
<li>Devise et marché : garder la devise de l'article (€ pour un article France). Ne jamais introduire un prix en USD dans un article francophone — convertir, ou utiliser une source du même marché. Privilégier des sources du pays visé par l'article.</li>
</ul>

<h3>2. Respect du contenu</h3>
<ul>
<li>Préserver la voix, le ton et le style d'origine ; conserver un HTML valide et minimal.</li>
<li>Ne jamais toucher au titre, à l'auteur ni aux champs SEO sauf demande explicite.</li>
</ul>

<h3>3. Zéro redondance</h3>
<ul>
<li>Ne pas ajouter une information déjà présente sous une autre forme : vérifier avant chaque ajout.</li>
</ul>

<h3>4. Liens internes</h3>
<ul>
<li>Viser au moins 3 liens internes pertinents vers d'autres articles du site, si le site en a assez.</li>
<li>Ancres courtes (2-5 mots) présentes mot-pour-mot dans l'article ; cibles proches du sujet.</li>
</ul>

<h3>5. Priorité</h3>
<ul>
<li>Les skills métier et la base de connaissances priment sur ces règles en cas de conflit.</li>
<li>Appliquer la base de connaissances et citer le document source de chaque correction.</li>
</ul>`,
  },
];

const DEFAULT_SKILL_IDS = new Set(DEFAULT_SKILLS.map(s => s.id));

/** Vrai si l'id correspond à un skill par défaut maintenu par Tonton AI. */
export const isDefaultSkill = (id) => DEFAULT_SKILL_IDS.has(id);

/**
 * Fusionne les skills par défaut (issus du code) avec les skills personnalisés.
 * Les skills par défaut sont toujours en tête et leur contenu vient du code —
 * une éventuelle copie persistée (même id) est ignorée au profit de la version code.
 */
export const mergeDefaultSkills = (skills = []) => {
  const custom = skills.filter(s => !DEFAULT_SKILL_IDS.has(s.id));
  return [...DEFAULT_SKILLS, ...custom];
};

/** Nombre de skills personnalisés (hors skills par défaut). */
export const countCustomSkills = (skills = []) =>
  skills.filter(s => !DEFAULT_SKILL_IDS.has(s.id)).length;
