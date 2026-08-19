// Champs de lancement propres au mode « Audit QAT + Refonte ».
// Rendus uniquement quand ce mode est sélectionné : le flux historique garde son
// formulaire inchangé (double flux temporaire — voir constants/majMode.js).
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Plug, Ruler, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
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
  // Liste des skills pas encore revenue du serveur : ne PAS annoncer une absence.
  // Le bandeau « Aucun skill cerveau actif » s'affichait pendant la seconde du
  // chargement et envoyait le rédacteur vérifier un menu où le skill était bien
  // présent. Absence CONSTATÉE et absence PAS ENCORE VÉRIFIÉE ne se disent pas
  // de la même façon.
  skillsEnChargement = false,
  articleUrl = '',
}) => {
  // ── ÉCRAN DE LANCEMENT ALLÉGÉ (18 août 2026, demande d'Andrianina) ─────────
  // Ces quatre réglages sont MASQUÉS, pas supprimés : ils sont bien consommés par
  // `runQatAudit`, mais aucun n'est touché en pratique — la file d'attente impose
  // déjà DEFAULT_ARTICLE_TYPE / DEFAULT_SEO_PLUGIN / DEFAULT_TARGET_WORDS à TOUS
  // les articles qui passent par elle. L'écran de lancement demandait donc quatre
  // décisions dont trois sont toujours la valeur par défaut.
  //
  // Le MAILLAGE est le cas le plus net : son vrai point de saisie est la PHASE 2
  // (`InternalLinksField` y est rendu aussi), seul écran que TOUS les articles
  // traversent, et où les paires suggérées par l'audit pré-remplissent déjà le
  // brief. Le demander AVANT l'audit, c'est le demander avant de savoir quoi lier.
  // Ce n'est PAS la re-fusion interdite par la règle 9 : le rendu de la phase 2 —
  // celui qui corrigeait le bug — reste intact. C'est le rendu redondant qui se
  // replie.
  const [avanceOuvert, setAvanceOuvert] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-4 space-y-4 overflow-hidden"
    >
      {skillsEnChargement ? (
        <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
          <Loader2 size={14} className="shrink-0 mt-0.5 animate-spin text-gray-400" />
          <span>Chargement des skills… le bouton de lancement s'active dès que la liste est arrivée.</span>
        </div>
      ) : !hasBrainSkill && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Aucun skill cerveau (SKILL.md) actif dans le menu <a href="/skills" className="underline font-medium">SKILLS IA</a> —
            ce mode a besoin du skill qui porte la méthode d'audit et les gabarits de rédaction.
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAvanceOuvert((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
      >
        {avanceOuvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Réglages avancés
        <span className="font-normal text-gray-400">
          — type d'article, plugin SEO, longueur cible, maillage
        </span>
      </button>

      {/* Les valeurs par défaut s'appliquent tant que ce volet reste fermé : rien
          n'est perdu, et le rédacteur n'a plus quatre décisions à prendre avant
          même de connaître le résultat de l'audit. */}
      {avanceOuvert && (
      <div className="space-y-4 border-t border-indigo-100 pt-4">
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

      {/* ── Maillage interne : paires ancre + URL ──────────────────────────────
          Rendu ici pour ne rien retirer au rédacteur qui veut préparer son
          maillage dès le lancement. Le point de saisie de RÉFÉRENCE reste la
          phase 2 : c'est là que les paires suggérées par l'audit arrivent. */}
      <InternalLinksField linkRows={linkRows} setLinkRows={setLinkRows} articleUrl={articleUrl} />
      </div>
      )}
    </motion.div>
  );
};

export default QatBriefFields;
