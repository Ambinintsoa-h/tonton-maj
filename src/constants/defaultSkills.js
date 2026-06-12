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
<p>Consignes transversales à respecter dans toutes les mises à jour, en complément des skills métier et de la base de connaissances.</p>

<h3>1. Intégrité factuelle</h3>
<ul>
<li>Ne jamais inventer un chiffre, un prix, une statistique ou une date : chaque donnée nouvelle doit provenir d'une source web réelle citée dans le champ "source".</li>
<li>En cas de doute sur une information non sourçable, l'indiquer avec la mention [à vérifier] dans le champ "reason" plutôt que de l'affirmer.</li>
<li>Vérifier systématiquement prix, versions, statistiques et dates de l'article contre les sources avant de les conserver.</li>
</ul>

<h3>2. Respect du contenu existant</h3>
<ul>
<li>Préserver la voix, le ton et le style d'origine de l'article — ne pas réécrire ce qui n'a pas besoin de l'être.</li>
<li>Modifier au plus près : remplacer uniquement les passages obsolètes, ne pas restructurer un article qui fonctionne.</li>
<li>Conserver un HTML valide et minimal ; ne pas introduire de balises superflues.</li>
<li>Ne jamais toucher au titre, à l'auteur ni aux champs SEO sauf demande explicite.</li>
</ul>

<h3>3. Zéro redondance</h3>
<ul>
<li>Ne pas ajouter une information déjà présente dans l'article sous une autre forme.</li>
<li>Avant chaque ajout, vérifier que le passage n'existe pas déjà ailleurs dans le texte.</li>
</ul>

<h3>4. Liens internes</h3>
<ul>
<li>Viser au moins 3 liens internes pertinents vers d'autres articles du même site, quand le site en propose suffisamment.</li>
<li>Choisir des ancres courtes (2 à 5 mots) qui existent mot-pour-mot dans l'article, riches en mots-clés.</li>
<li>Privilégier les articles les plus proches thématiquement et les plus récents.</li>
</ul>

<h3>5. Priorité absolue</h3>
<ul>
<li>Les skills métier et la base de connaissances priment sur ces règles en cas de conflit.</li>
<li>Appliquer la base de connaissances ligne par ligne et citer le document source de chaque correction qui en découle.</li>
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
