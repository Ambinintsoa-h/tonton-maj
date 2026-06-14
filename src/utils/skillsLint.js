// ─────────────────────────────────────────────────────────────────────────────
// Linter & budget des entrées Skills / Base de connaissances.
// Applique le standard défini dans .claude/skills-standard.md :
// chaque entrée est injectée dans le system prompt de l'agent, donc on signale
// les anti-patterns (redéfinition de rôle/sortie, longueur, filler…) et on mesure
// le budget de contexte consommé par les entrées actives.
// ─────────────────────────────────────────────────────────────────────────────
import { markdownToPlain } from './markdown';

// Budgets de caractères (texte brut) — cf. standard §2.
export const BUDGET = {
  skill:       1500,   // par skill
  bdc:         1000,   // par entrée BDC
  skillsTotal: 6000,   // total des skills actifs
};

/** Une entrée est active sauf si explicitement désactivée (rétro-compat : undefined = actif). */
export const isActive = (entry) => entry?.active !== false;

/** Longueur en texte brut (ce qui compte réellement dans le prompt). */
export const plainLength = (content) => markdownToPlain(content || '').length;

// ── Règles de lint ────────────────────────────────────────────────────────────
// Chaque règle : { code, level, test(plain, entry, kind) -> bool, message }
const RULES = [
  {
    code: 'role',
    level: 'error',
    message: 'Redéfinit un rôle (« Tu es un… »). Le rôle appartient au pipeline — écris une règle, pas un agent.',
    test: (p) => /\btu es\s+(un|une|le|la)\b/i.test(p) || /^\s*name\s*:/i.test(p),
  },
  {
    code: 'output',
    level: 'error',
    message: 'Redéfinit le format de sortie (« réponds uniquement… », « structure de l\'output… »). C\'est piloté par le pipeline.',
    test: (p) => /(r[ée]ponds?|retourne)\s+(uniquement|seulement)|structure de l'?output|format de (la )?sortie|sans balise|au format json/i.test(p),
  },
  {
    code: 'filler',
    level: 'warning',
    message: 'Contient du langage parlé / filler (« bonjour tout le monde », « j\'espère… », « Ciao »). Garder uniquement la règle.',
    test: (p) => /bonjour tout le monde|hello,? hello|j'esp[èe]re que cette|[àa] bient[ôo]t|\bciao\b|cette (petite )?vid[ée]o|vous allez voir/i.test(p),
  },
  {
    code: 'ui',
    level: 'warning',
    message: 'Décrit une procédure d\'interface (clics, cocher, menu…) plutôt qu\'une règle de rédaction.',
    test: (p) => /\b(cliqu(e|er|ez)|cocher|d[ée]cocher|le bouton|enregistrer les modifications|dans le menu|l'onglet)\b/i.test(p),
  },
  {
    code: 'length',
    level: 'warning',
    message: 'Dépasse le budget de caractères — à distiller ou scinder.',
    test: (p, _e, kind) => p.length > (kind === 'bdc' ? BUDGET.bdc : BUDGET.skill),
  },
];

/**
 * Analyse une entrée et retourne la liste des problèmes détectés.
 * @param {object} entry  { name, content, ... }
 * @param {'skill'|'bdc'} kind
 * @returns {Array<{code,level,message}>}
 */
export const lintEntry = (entry, kind = 'skill') => {
  const plain = markdownToPlain(entry?.content || '');
  if (!plain) return [];
  return RULES.filter(r => r.test(plain, entry, kind))
    .map(({ code, level, message }) => ({ code, level, message }));
};

/** Niveau le plus grave d'une entrée : 'error' | 'warning' | null. */
export const lintLevel = (entry, kind = 'skill') => {
  const issues = lintEntry(entry, kind);
  if (issues.some(i => i.level === 'error')) return 'error';
  if (issues.length) return 'warning';
  return null;
};

/**
 * Budget de contexte consommé par une liste d'entrées (entrées actives seulement).
 * @returns {{ activeCount, total, perEntryOver }}
 */
export const contextBudget = (entries = [], kind = 'skill') => {
  const active = entries.filter(isActive);
  const total = active.reduce((sum, e) => sum + plainLength(e.content), 0);
  const cap = kind === 'bdc' ? BUDGET.bdc : BUDGET.skill;
  const perEntryOver = active.filter(e => plainLength(e.content) > cap).length;
  return { activeCount: active.length, total, perEntryOver };
};

/** Couleur d'état du budget total des skills actifs. */
export const budgetLevel = (total) => {
  if (total <= BUDGET.skillsTotal) return 'ok';
  if (total <= BUDGET.skillsTotal * 1.5) return 'warn';
  return 'over';
};
