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
  MAJ_SCOPES, SCOPE_SIMPLE, scopeProposedByAudit, wordsAddedReport,
} from '../../constants/majPhases';

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
}) {
  const propose  = scopeProposedByAudit(audit);
  const decision = audit && audit.ampleur && audit.ampleur.decision;
  const retenu   = scope || propose;
  const contredit = !!scope && scope !== propose;
  const dejaGenere = !!generatedHtml && !!qatArticle;
  const bilan = dejaGenere ? wordsAddedReport(originalHtml, generatedHtml, retenu) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-4">

      {/* Ce que l'audit recommande */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Sparkles size={14} className="text-sage-500" />
          Ampleur de la mise à jour
        </h3>
        {decision ? (
          <p className="text-[11px] text-gray-500">
            L'audit recommande une <strong className="text-gray-700">{LIBELLE_DECISION[decision] || decision}</strong>.
            {audit.ampleur.justification ? ` ${audit.ampleur.justification}` : ''}
          </p>
        ) : (
          <p className="text-[11px] text-gray-400 italic">
            L'audit n'a pas exprimé d'ampleur — la refonte est présélectionnée par prudence.
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

      {/* Le prompt : la vision du rédacteur fusionnée avec l'audit */}
      <div className="space-y-1.5">
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
          onChange={(e) => onPromptChange?.(e.target.value)}
          disabled={generating}
          rows={12}
          spellCheck={false}
          className="input-glass text-[12px] leading-relaxed font-mono resize-y w-full disabled:opacity-60"
          placeholder="Directives de génération…"
        />
        <p className="text-[11px] text-gray-400">
          Pré-rempli avec vos directives permanentes et ce que l'audit demande de corriger. Ajustez-le pour CET
          article — c'est ce texte exact qui part à l'IA.
        </p>
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
