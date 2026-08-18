/**
 * PhaseGeneration — panneau de la PHASE 2.
 *
 * L'audit a proposé une ampleur ; c'est ici que le rédacteur tranche, puis lance
 * la génération. Purement présentationnel : la génération elle-même vit dans
 * ArticleResult, qui appelle runQatRewrite.
 *
 * Principe tenu à chaque phase : ne rien affirmer sans le montrer. Le bilan de
 * longueur affiché après génération est CALCULÉ sur le texte produit
 * (wordsAddedReport), pas repris d'une déclaration de l'IA.
 *
 * L'éditeur de prompt (la vision du rédacteur fusionnée avec l'audit) arrive en
 * PR 3 ; ici la consigne libre existante en tient lieu.
 */
import { motion } from 'framer-motion';
import { Sparkles, Loader2, Check, AlertTriangle, ArrowRight, FileText, RotateCcw, Save } from 'lucide-react';
import {
  MAJ_SCOPES, SCOPE_SIMPLE, scopeProposedByAudit, scopeRecommendationSource, wordsAddedReport,
} from '../../constants/majPhases';
import { cleanLinkRows } from '../../constants/majMode';
// Plafond RÉEL de l'instruction : `runQatRewrite` tronque à cette longueur.
// Le compteur et le blocage de saisie s'appuient donc sur le même littéral que
// l'envoi — un compteur qui mentirait sur la limite serait pire que rien.
import { MAX_INSTRUCTION_CHARS } from '../../utils/generationPrompt';
import InternalLinksField from './InternalLinksField';
import AuditChecklist from './AuditChecklist';

const LIBELLE_DECISION = {
  maj_ciblee:      'MAJ ciblée',
  restructuration: 'restructuration (plan refait, fond conservé)',
  refonte_totale:  'refonte totale',
};

export default function PhaseGeneration({
  audit,
  scope,
  onScopeChange,
  onGenerate,
  generating = false,
  step = '',
  progress = 0,
  originalHtml = '',
  generatedHtml = '',
  qatArticle = null,
  // Prompt de génération — pré-rempli par Tonton, éditable par le rédacteur
  prompt = '',
  onPromptChange,
  onResetPrompt,
  onSaveTemplate,
  savingTemplate = false,
  // Maillage interne — saisissable ICI, et pas seulement à l'écran de lancement.
  // C'est le seul point de passage commun à TOUS les articles : ceux ouverts
  // depuis « MAJ en attente » n'ont jamais vu le formulaire de lancement et
  // partaient donc avec un brief vide.
  linkRows = [],
  onLinkRowsChange,
  articleUrl = '',
  // Nombre de paires proposées par l'audit et versées dans le champ. Affiché
  // pour que le rédacteur sache d'où viennent les lignes pré-remplies — sinon
  // il ne peut pas distinguer sa propre saisie d'une proposition à relire.
  auditSuggestionsCount = 0,
  // Cases de l'audit — colonne GAUCHE, face aux directives. La sélection filtre
  // les DEUX canaux d'envoi ; sans elle, décocher n'aurait aucun effet réel.
  auditSelection = null,
  onAuditSelectionChange,
}) {
  const propose  = scopeProposedByAudit(audit);
  const source   = scopeRecommendationSource(audit);
  const decision = audit && audit.ampleur && audit.ampleur.decision;
  const retenu   = scope || propose;
  const contredit = !!scope && scope !== propose;
  const dejaGenere = !!generatedHtml && !!qatArticle;
  const bilan = dejaGenere ? wordsAddedReport(originalHtml, generatedHtml, retenu) : null;
  const reste = Math.max(0, MAX_INSTRUCTION_CHARS - (prompt || '').length);
  const simple = retenu === SCOPE_SIMPLE;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-4">

      {/* Ce que l'audit recommande */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Sparkles size={14} className="text-sage-500" />
          Ampleur de la mise à jour
        </h3>
        {/* La justification dit sur QUOI elle repose : une déduction ne doit jamais
            être présentée comme une décision de l'audit. */}
        {source === 'ampleur' ? (
          <p className="text-[11px] text-gray-500">
            L'audit recommande une <strong className="text-gray-700">{LIBELLE_DECISION[decision] || decision}</strong>.
            {audit.ampleur.justification ? ` ${audit.ampleur.justification}` : ''}
          </p>
        ) : source === 'scores' ? (
          <p className="text-[11px] text-gray-500">
            L'audit n'a pas tranché l'ampleur. D'après son <strong className="text-gray-700">score global de {audit.scores.global}/10</strong>,
            {' '}<strong className="text-gray-700">{MAJ_SCOPES[propose]?.label}</strong> est présélectionnée — à vous de confirmer.
          </p>
        ) : (
          <p className="text-[11px] text-gray-400 italic">
            Ni ampleur ni score exploitable dans l'audit — la refonte est présélectionnée par prudence.
          </p>
        )}
      </div>

      {/* Le rédacteur tranche */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(MAJ_SCOPES).map(([cle, m]) => {
            const actif = retenu === cle;
            return (
              <button
                key={cle}
                type="button"
                disabled={generating}
                onClick={() => onScopeChange?.(cle)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all disabled:opacity-50 ${
                  actif ? 'bg-black text-white border-black shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {m.label}
                <span className={`text-[10px] ${actif ? 'text-white/60' : 'text-gray-400'}`}>{m.hint}</span>
                {cle === propose && !actif && (
                  <span className="text-[9px] uppercase tracking-wide text-sage-600 font-bold">audit</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-400">{MAJ_SCOPES[retenu]?.description}</p>
        {contredit && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <AlertTriangle size={11} />
            Votre choix s'écarte de la recommandation de l'audit — c'est vous qui décidez, l'écart est simplement tracé.
          </p>
        )}
        {retenu === SCOPE_SIMPLE && (
          <p className="text-[11px] text-gray-400">
            Une MAJ simple doit ajouter <strong className="text-gray-600">200 mots au minimum</strong>. Le décompte réel
            sera affiché ici après la génération.
          </p>
        )}
      </div>

      {/* ── DEUX COLONNES : l'audit se coche à gauche, la vision s'écrit à droite ──
          La largeur suit l'AMPLEUR, elle n'est pas figée à 50/50 : en refonte
          l'audit porte l'essentiel du travail, en MAJ simple c'est la directive
          écrite à la main qui décide (200 mots, un H2). On donne la place à la
          colonne qui tranche. */}
      <div className={`grid gap-4 lg:grid-cols-5`}>
        <div className={simple ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <AuditChecklist
            audit={audit}
            selection={auditSelection}
            onChange={onAuditSelectionChange}
            scope={retenu}
            disabled={generating}
          />
        </div>

        <div className={`space-y-1.5 ${simple ? 'lg:col-span-3' : 'lg:col-span-2'}`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <FileText size={13} className="text-gray-400" />
            Directives envoyées à TONTON
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={generating}
              onClick={() => onResetPrompt?.()}
              title="Reconstruire le prompt depuis mon modèle et l'audit — annule mes retouches"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors disabled:opacity-40"
            >
              <RotateCcw size={11} /> Reconstruire
            </button>
            <button
              type="button"
              disabled={generating || savingTemplate || !prompt.trim()}
              onClick={() => onSaveTemplate?.()}
              title="Garder ces directives comme mon modèle par défaut, réutilisé sur mes prochains articles"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors disabled:opacity-40"
            >
              {savingTemplate ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Enregistrer comme mon modèle
            </button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange?.(e.target.value.slice(0, MAX_INSTRUCTION_CHARS))}
          disabled={generating}
          rows={12}
          spellCheck={false}
          maxLength={MAX_INSTRUCTION_CHARS}
          className="input-glass text-[12px] leading-relaxed font-mono resize-y w-full disabled:opacity-60"
          placeholder="Directives de génération…"
        />
        {/* COMPTEUR BLOQUANT. Le texte était coupé à 1 500 caractères au moment de
            l'envoi, en silence et au milieu d'une phrase. La saisie s'arrête
            maintenant AVANT, et le rédacteur voit venir la limite. */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-gray-400 flex-1 min-w-0">
            Pré-rempli avec vos directives permanentes et ce que l'audit demande de corriger. Ajustez-le pour CET
            article — c'est ce texte exact qui part à l'IA.
          </p>
          <span
            title={`Plafond réel de l'instruction envoyée à l'IA : ${MAX_INSTRUCTION_CHARS} caractères`}
            className={`text-[10px] font-semibold shrink-0 tabular-nums ${
              reste === 0 ? 'text-red-500'
              : reste <= 120 ? 'text-amber-500'
              : 'text-gray-400'
            }`}
          >
            {prompt.length}/{MAX_INSTRUCTION_CHARS}
          </span>
        </div>
        {reste === 0 && (
          <p className="text-[11px] text-red-600 flex items-center gap-1">
            <AlertTriangle size={11} className="shrink-0" />
            Plafond atteint : la saisie est bloquée. Raccourcissez une consigne pour en ajouter une autre — au-delà,
            le texte serait coupé à l'envoi.
          </p>
        )}
        </div>
      </div>

      {/* ── Maillage interne — dernière occasion de le renseigner ─────────────
          Rendu ici parce que c'est le seul écran que TOUS les articles
          traversent avant la génération. Les paires saisies sont placées à
          100 % par le code (weaveBriefLinks) : sans ce bloc, un article venu de
          la file d'attente ne pouvait recevoir aucun lien interne nouveau. */}
      <div className="border border-indigo-100 bg-indigo-50/40 rounded-xl p-4 space-y-3">
        {auditSuggestionsCount > 0 && (
          <div className="flex items-start gap-2 bg-white/70 border border-indigo-200 rounded-lg px-3 py-2 text-[11px] text-indigo-800">
            <Check size={13} className="shrink-0 mt-0.5" />
            <span>
              Pré-rempli avec les <strong>{auditSuggestionsCount} lien{auditSuggestionsCount > 1 ? 's' : ''} suggéré{auditSuggestionsCount > 1 ? 's' : ''} par l'audit</strong>.
              Corrigez une ancre, supprimez une ligne ou ajoutez les vôtres — c'est cette liste exacte qui sera placée.
            </span>
          </div>
        )}
        <InternalLinksField
          linkRows={linkRows}
          setLinkRows={onLinkRowsChange}
          articleUrl={articleUrl}
          disabled={generating}
        />
        {/* Le silence était le vrai défaut : un brief vide produisait une MAJ sans
            AUCUN lien interne nouveau, sans que rien ne le signale. */}
        {cleanLinkRows(linkRows).length === 0 && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              Aucune paire saisie : cette mise à jour ne recevra <strong>aucun lien interne nouveau</strong>.
              Les liens déjà présents dans l'article d'origine sont repris quoi qu'il arrive.
            </span>
          </div>
        )}
      </div>

      {/* Lancement */}
      {!generating && (
        <button
          type="button"
          onClick={() => onGenerate?.(retenu)}
          className="flex items-center gap-2 px-4 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors shadow-sm"
        >
          <Sparkles size={14} />
          {dejaGenere ? 'Relancer la génération' : 'Générer la mise à jour'}
          <ArrowRight size={14} />
        </button>
      )}

      {/* En cours */}
      {generating && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 size={13} className="animate-spin text-sage-500" />
            <span className="truncate">{step || 'Génération en cours…'}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-sage-500 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        </div>
      )}

      {/* Bilan CALCULÉ sur le texte produit */}
      {bilan && !generating && (
        <div className={`rounded-xl border p-3 space-y-1.5 ${bilan.conforme ? 'bg-emerald-50/70 border-emerald-200' : 'bg-amber-50/70 border-amber-200'}`}>
          <p className={`text-xs font-semibold flex items-center gap-1.5 ${bilan.conforme ? 'text-emerald-800' : 'text-amber-800'}`}>
            {bilan.conforme ? <Check size={12} /> : <AlertTriangle size={12} />}
            {bilan.conforme ? 'Longueur conforme' : `Minimum non atteint — il manque ${bilan.manque} mots`}
          </p>
          <p className="text-[11px] text-gray-600">
            <strong>{bilan.before}</strong> mots avant · <strong>{bilan.after}</strong> après ·{' '}
            <strong className={bilan.added >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
              {bilan.added >= 0 ? '+' : ''}{bilan.added}
            </strong>
            {bilan.minimum !== null && <> · minimum requis <strong>{bilan.minimum}</strong></>}
          </p>
          {qatArticle?.strippedExternalLinks?.length > 0 && (
            <p className="text-[11px] text-amber-700">
              🔒 {qatArticle.strippedExternalLinks.length} lien(s) externe(s) ajouté(s) par l'IA ont été retiré(s) — règle liens externes.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
