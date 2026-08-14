// Champs de lancement propres au mode « Audit QAT + Refonte ».
// Rendus uniquement quand ce mode est sélectionné : le flux historique garde son
// formulaire inchangé (double flux temporaire — voir constants/majMode.js).
import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Plug, Ruler, AlertCircle } from 'lucide-react';
import {
  ARTICLE_TYPES, SEO_PLUGINS, TARGET_WORDS_MIN, TARGET_WORDS_MAX,
} from '../../constants/majMode';
// Le bloc de saisie du maillage vit dans son propre composant : la phase 2 le
// rend aussi, pour que les articles arrivés par la file ne partent plus avec un
// brief vide (cf. InternalLinksField.jsx).
import InternalLinksField from './InternalLinksField';

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
      <InternalLinksField linkRows={linkRows} setLinkRows={setLinkRows} articleUrl={articleUrl} />
    </motion.div>
  );
};

export default QatBriefFields;
