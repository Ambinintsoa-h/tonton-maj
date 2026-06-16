// ─── Parser de fichiers SKILL.md (format Agent Skills de Claude) ──────────────
//
// Un skill au format Claude = un fichier SKILL.md avec :
//   • un frontmatter YAML minimal (au moins `name` + `description`)
//   • un corps en markdown (les instructions de l'agent)
//   • d'éventuelles ressources jointes (autres fichiers .md chargés à la demande)
//
// Ce parser n'embarque pas de lib YAML complète : il extrait `name` et
// `description` (valeur simple, entre quotes, ou scalaire plié/littéral
// `>`, `>-`, `|`, `|-`) et renvoie le corps. Suffisant pour le frontmatter
// d'un SKILL.md ; tolérant aux variations d'indentation.

/**
 * Parse le texte d'un SKILL.md.
 * @returns {{ name: string, description: string, body: string }}
 */
export function parseSkillMd(raw = '') {
  const text = String(raw).replace(/\r\n/g, '\n').replace(/^﻿/, '');

  // Frontmatter délimité par --- en tête et --- de fermeture.
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fm) {
    return { name: '', description: '', body: text.trim() };
  }

  const front = fm[1];
  const body = (fm[2] || '').trim();
  const lines = front.split('\n');
  const fields = {};

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let val = m[2];

    const block = val.match(/^([|>])[+-]?\s*$/);
    if (block) {
      // Scalaire multi-ligne : récupérer les lignes plus indentées qui suivent.
      const fold = block[1] === '>'; // '>' = plié (newlines → espaces), '|' = littéral
      const collected = [];
      let baseIndent = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const ln = lines[j];
        if (ln.trim() === '') { collected.push(''); continue; }
        const indent = ln.match(/^(\s*)/)[1].length;
        if (baseIndent === null) baseIndent = indent;
        if (indent < baseIndent) break;
        collected.push(ln.slice(baseIndent));
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      val = fold ? collected.join(' ').replace(/\s+/g, ' ').trim() : collected.join('\n').trim();
      i = j - 1;
    } else {
      val = val.replace(/^["']|["']$/g, '').trim();
    }
    fields[key] = val;
  }

  return {
    name: (fields.name || '').trim(),
    description: (fields.description || '').trim(),
    body,
  };
}

/** Vrai si le nom de fichier correspond au fichier principal d'un skill. */
export const isSkillMdFile = (filename = '') =>
  /(^|\/)skill\.md$/i.test(filename.trim());

/** Nom de base d'un chemin (retire dossiers, ex: "references/x.md" → "x.md"). */
export const baseName = (path = '') => path.split(/[\\/]/).pop() || path;
