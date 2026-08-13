// Champs de lancement propres au mode « Audit QAT + Refonte ».
// Rendus uniquement quand ce mode est sélectionné : le flux historique garde son
// formulaire inchangé (double flux temporaire — voir constants/majMode.js).
import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Plug, Ruler, Link2, Plus, X as XIcon, AlertCircle } from 'lucide-react';
import {
  ARTICLE_TYPES, SEO_PLUGINS, TARGET_WORDS_MIN, TARGET_WORDS_MAX,
  INTERNAL_LINK_ROWS_MAX, emptyLinkRow, cleanLinkRows,
  offDomainLinkRows, unverifiableLinkRows,
} from '../../constants/majMode';

const Segmented = ({ options, value, onChange }) => (
  <div className="flex items-center gap-1 bg-gray-100/70 rounded-xl p-1 w-fit">
    {Object.entries(options).map(([key, o]) => (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
          value === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const QatBriefFields = ({
  articleType, setArticleType,
  seoPlugin, setSeoPlugin,
  targetWords, setTargetWords,
  linkRows, setLinkRows,
  hasBrainSkill = true,
  articleUrl = '',
}) => {
  const filled = cleanLinkRows(linkRows).length;
  // Le code PLACE lui-même ces liens depuis R2 : une URL hors domaine deviendrait
  // un lien EXTERNE ajouté (règle 8), donc elle est écartée. Autant le dire ICI,
  // pendant la saisie, plutôt qu'après une MAJ payée.
  const horsDomaine = offDomainLinkRows(linkRows, articleUrl);
  const nonVerifiables = unverifiableLinkRows(linkRows, articleUrl);

  const setRow = (i, patch) =>
    setLinkRows(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-4 space-y-4 overflow-hidden"
    >
      {!hasBrainSkill && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Aucun skill cerveau (SKILL.md) actif dans le menu <a href="/skills" className="underline font-medium">SKILLS IA</a> —
            ce mode a besoin du skill qui porte la méthode d'audit et les gabarits de rédaction.
          </span>
        </div>
      )}

      {/* ── Type d'article ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <FileText size={13} className="text-gray-400" />
          Type d'article
        </label>
        <Segmented options={ARTICLE_TYPES} value={articleType} onChange={setArticleType} />
        <p className="text-[11px] text-gray-400">{ARTICLE_TYPES[articleType]?.description}</p>
      </div>

      {/* ── Plugin SEO ─────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Plug size={13} className="text-gray-400" />
          Plugin SEO du site
        </label>
        <Segmented options={SEO_PLUGINS} value={seoPlugin} onChange={setSeoPlugin} />
        <p className="text-[11px] text-gray-400">
          Détermine la terminologie employée dans la checklist avant publication.
        </p>
      </div>

      {/* ── Longueur cible ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Ruler size={13} className="text-gray-400" />
          Longueur cible
          <span className="ml-1 text-xs font-normal text-gray-400">{targetWords} mots</span>
        </label>
        <input
          type="range"
          min={TARGET_WORDS_MIN}
          max={TARGET_WORDS_MAX}
          step={100}
          value={targetWords}
          onChange={e => setTargetWords(Number(e.target.value))}
          className="w-full max-w-sm accent-indigo-500"
        />
        <p className="text-[11px] text-gray-400">
          Défaut 2 500 mots, la médiane des MAJ publiées par l'équipe. Au-delà de 3 000 mots, le taux
          de citation par les IA passe à 24 % contre 10 % entre 1 000 et 2 000.
        </p>
      </div>

      {/* ── Maillage interne : paires ancre + URL ──────────────────────────── */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Link2 size={13} className="text-gray-400" />
          Liens internes à placer
          <span className="ml-1 text-xs font-normal text-gray-400">
            {filled} paire{filled > 1 ? 's' : ''} complète{filled > 1 ? 's' : ''}
          </span>
        </label>

        <div className="space-y-2">
          {linkRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={row.anchor}
                onChange={e => setRow(i, { anchor: e.target.value })}
                placeholder="Ancre — ex. le prix au m² d'un faux plafond"
                className="input-glass text-xs flex-1 min-w-0"
              />
              <input
                type="url"
                value={row.url}
                onChange={e => setRow(i, { url: e.target.value })}
                placeholder="https://mon-site.fr/ma-page"
                className="input-glass text-xs flex-1 min-w-0"
              />
              <button
                type="button"
                onClick={() => setLinkRows(rows => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyLinkRow()]))}
                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                title="Retirer cette ligne"
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>

        {linkRows.length < INTERNAL_LINK_ROWS_MAX && (
          <button
            type="button"
            onClick={() => setLinkRows(rows => [...rows, emptyLinkRow()])}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <Plus size={13} /> Ajouter un lien
          </button>
        )}

        {horsDomaine.length > 0 && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>
              {horsDomaine.length} URL hors du domaine de l'article — elle{horsDomaine.length > 1 ? 's' : ''} sera
              {horsDomaine.length > 1 ? 'ont' : ''} ÉCARTÉE{horsDomaine.length > 1 ? 'S' : ''} : le maillage interne ne
              doit jamais ajouter de lien externe. {horsDomaine.map(r => r.url).join(', ')}
            </span>
          </div>
        )}

        {nonVerifiables.length > 0 && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>
              Aucune URL d'article n'est renseignée (contenu collé) : une URL absolue ne peut alors être ni vérifiée ni
              placée — le verrou liens externes la retirerait. Saisissez un chemin relatif (<code>/ma-page</code>) pour
              ces {nonVerifiables.length} paire(s).
            </span>
          </div>
        )}

        <p className="text-[11px] text-gray-400">
          Toutes ces paires sont placées : celles que l'IA n'intègre pas d'elle-même, le code les place — en écrivant
          au besoin une courte phrase, surlignée en jaune dans l'éditeur pour que vous la reformuliez. Jamais dans un
          titre, le TL;DR, un tableau ou la FAQ. Les liens externes de l'article d'origine sont conservés à l'identique
          et aucun n'est ajouté.
        </p>
      </div>
    </motion.div>
  );
};

export default QatBriefFields;
