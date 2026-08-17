/**
 * PhaseAudit — panneau de la PHASE 1.
 *
 * La phase 1 n'avait aucun panneau : l'audit ne se lançait qu'une fois, depuis
 * l'écran de lancement, et rien ne permettait de le REFAIRE. Un rédacteur qui
 * corrigeait l'article en ligne, ou qui voulait auditer à nouveau après une
 * modification du skill, devait repartir de l'écran de lancement.
 *
 * Purement présentationnel : l'audit lui-même vit dans ArticleResult, qui appelle
 * runQatAudit — même découpage que PhaseGeneration.
 *
 * Le rapport complet se lit dans l'onglet « Audit ». Ici on ne montre que de quoi
 * décider : ce que l'audit a conclu, et le bouton pour le refaire.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardCheck, Loader2, ArrowRight, AlertTriangle, RotateCcw, X,
} from 'lucide-react';
import {
  scopeProposedByAudit, scopeRecommendationSource, MAJ_SCOPES, auditAmpleurDecision,
} from '../../constants/majPhases';

const LIBELLE_DECISION = {
  maj_ciblee:      'MAJ ciblée',
  restructuration: 'restructuration (plan refait, fond conservé)',
  refonte_totale:  'refonte totale',
};

export default function PhaseAudit({
  audit,
  // Audit du flux PRÉCÉDENT : un rapport markdown, sans scores structurés. Un
  // article peut être audité sans porter `audit` (l'objet QAT). Sans ce second
  // signal, le panneau annonçait « aucun audit » sur un article dont le stepper
  // affichait « Audit terminée » — relevé en production sur un rapport de 31 000
  // caractères.
  rapportMarkdown = '',
  onRun,
  running = false,
  step = '',
  progress = 0,
  // Vrai dès qu'un travail repose sur l'audit courant (génération, vérification).
  // Refaire l'audit le rendrait caduc : on prévient AVANT, pas après.
  travailEnAval = false,
  // Prérequis absents (titre, mot-clé cible) : l'audit confronte le H1 à la cible,
  // sans eux il tournerait à vide. Le parent les calcule, le panneau les nomme.
  champsManquants = [],
  // Saisie du mot-clé cible ICI, quand il manque. Indispensable : le mot-clé n'est
  // porté par AUCUN champ de l'éditeur, il vient du lancement — un article rouvert
  // depuis l'Historique sans mot-clé enregistré (entrées antérieures à son
  // archivage) laisserait sinon un bouton grisé que RIEN ne peut débloquer.
  onMotCleChange,
  // La liste des skills n'est pas encore revenue du serveur. Volontairement SÉPARÉ
  // de `champsManquants` : ce n'est pas un prérequis à renseigner mais une attente
  // de quelques secondes, et la ranger parmi les manquants produisait la phrase
  // « chargement des skills en cours manquant ». Deux états, deux messages, deux
  // gestes — patienter ici, aller créer un skill là.
  skillsEnChargement = false,
}) {
  const [confirmation, setConfirmation] = useState(false);
  const [motCleSaisi, setMotCleSaisi] = useState('');
  const bloque = champsManquants.length > 0 || skillsEnChargement;
  const manqueMotCle = champsManquants.includes('mot-clé cible');
  const libelleManquants = `${champsManquants.join(' et ')} manquant${champsManquants.length > 1 ? 's' : ''}`;
  const dejaAudite = !!audit || !!rapportMarkdown;
  const propose = dejaAudite ? scopeProposedByAudit(audit) : null;
  const source  = dejaAudite ? scopeRecommendationSource(audit) : null;
  // `auditAmpleurDecision` et non `audit.ampleur.decision` : l'audit rend parfois
  // ce champ en TEXTE LIBRE. Avec la lecture directe, `scopeRecommendationSource`
  // annonçait « L'audit recommande une » et le libellé sortait VIDE — pire que
  // l'ancien message, qui au moins ne promettait rien.
  const decision = auditAmpleurDecision(audit);
  const global = Number(audit && audit.scores && audit.scores.global);

  const demander = () => {
    if (bloque) return;               // bouton déjà désactivé — ceinture et bretelles
    if (travailEnAval) { setConfirmation(true); return; }
    onRun?.();
  };

  // Le parent enregistre la valeur (état global de l'agent) : le champ local se
  // vide, et `champsManquants` rétrécit → le bandeau disparaît de lui-même.
  const enregistrerMotCle = () => {
    const valeur = motCleSaisi.trim();
    if (!valeur) return;              // espaces seuls : rien à enregistrer
    onMotCleChange?.(valeur);
    setMotCleSaisi('');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <ClipboardCheck size={14} className="text-sage-500" />
          Audit QAT de l'article en ligne
        </h3>
        {dejaAudite && !audit ? (
          <p className="text-[11px] text-gray-500">
            Cet article porte un audit au format <strong className="text-gray-700">rapport</strong> (flux précédent),
            sans scores structurés : la phase 2 ne peut donc pas s'appuyer dessus pour proposer une ampleur.
            Le relancer produira l'audit structuré. Le rapport actuel se lit dans l'onglet « Audit ».
          </p>
        ) : dejaAudite ? (
          <p className="text-[11px] text-gray-500">
            {Number.isFinite(global) && global > 0 && (
              <>Score global <strong className="text-gray-700">{global}/10</strong>. </>
            )}
            {source === 'ampleur'
              ? <>L'audit recommande une <strong className="text-gray-700">{LIBELLE_DECISION[decision] || decision}</strong>.</>
              : source === 'scores'
                ? <>Pas d'ampleur tranchée ; d'après le score, <strong className="text-gray-700">{MAJ_SCOPES[propose]?.label}</strong> est présélectionnée.</>
                : <>Ni ampleur ni score exploitable — la refonte est présélectionnée par prudence.</>}
            {' '}Le rapport complet se lit dans l'onglet « Audit ».
          </p>
        ) : (
          <p className="text-[11px] text-gray-500">
            Aucun audit pour cet article. L'audit analyse la version EN LIGNE (Quality / Accuracy /
            Transparency) et sert de base à la phase 2.
          </p>
        )}
      </div>

      {/* Confirmation — un nouvel audit invalide ce qui en découle */}
      {confirmation && !running && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Un nouvel audit rend obsolète ce qui en découle
          </p>
          <p className="text-[11px] text-amber-800">
            La génération de la phase 2 a été produite à partir de l'audit actuel. En le refaisant, les
            phases 2 à 4 repassent à « à faire » et vous devrez relancer la génération.
            <strong> Rien n'est supprimé</strong> : votre texte, vos suggestions en attente et le rapport
            d'obsolescence restent en place. Seul l'avancement est remis à zéro.
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setConfirmation(false); onRun?.(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition-colors"
            >
              <RotateCcw size={11} /> Refaire l'audit quand même
            </button>
            <button
              type="button"
              onClick={() => setConfirmation(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-gray-500 border border-gray-200 text-[11px] font-semibold hover:text-gray-800 transition-colors"
            >
              <X size={11} /> Annuler
            </button>
          </div>
        </div>
      )}

      {/* Skills pas encore chargés — bandeau NEUTRE, pas une alerte : rien à faire
          qu'attendre, et le bouton se réactive tout seul à l'arrivée de la liste. */}
      {skillsEnChargement && !running && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-[11px] text-gray-600 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-gray-400" />
            Chargement des skills… l'audit s'appuie sur le skill cerveau (SKILL.md) : le bouton
            s'active dès que la liste est arrivée.
          </p>
        </div>
      )}

      {/* Prérequis absents — nommés AVANT le bouton grisé, sinon il est muet */}
      {champsManquants.length > 0 && !running && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-1">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Audit impossible — {libelleManquants}
          </p>
          <p className="text-[11px] text-amber-800">
            L'audit confronte le titre de l'article à son mot-clé cible.
            {champsManquants.includes('titre') && <> Renseignez le <strong>titre</strong> dans le champ « Titre » de l'onglet <strong>Après</strong>.</>}
            {manqueMotCle && <> Saisissez le <strong>mot-clé cible</strong> ci-dessous — il servira aussi de focus keyphrase à la publication.</>}
          </p>
          {/* Saisie sur place : sans elle, le bouton grisé serait un cul-de-sac sur
              tout article rouvert dont le mot-clé n'a pas été archivé. */}
          {manqueMotCle && onMotCleChange && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={motCleSaisi}
                onChange={e => setMotCleSaisi(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); enregistrerMotCle(); } }}
                placeholder="Mot-clé cible — ex : isolation phonique plafond"
                className="flex-1 min-w-0 bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <button
                type="button"
                onClick={enregistrerMotCle}
                disabled={!motCleSaisi.trim()}
                title={motCleSaisi.trim() ? 'Enregistrer le mot-clé cible' : 'Saisissez le mot-clé cible'}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Enregistrer
              </button>
            </div>
          )}
        </div>
      )}

      {!running && !confirmation && (
        <button
          type="button"
          onClick={demander}
          disabled={bloque}
          title={champsManquants.length > 0
            ? `Audit impossible — ${libelleManquants}`
            : skillsEnChargement
              ? 'Chargement des skills en cours — le bouton s\'active tout seul'
              : (dejaAudite ? 'Relancer l\'audit de la version en ligne' : 'Lancer l\'audit de la version en ligne')}
          className="flex items-center gap-2 px-4 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-black"
        >
          {dejaAudite ? <RotateCcw size={14} /> : <ClipboardCheck size={14} />}
          {dejaAudite ? 'Relancer l\'audit' : 'Lancer l\'audit'}
          <ArrowRight size={14} />
        </button>
      )}

      {running && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Loader2 size={13} className="animate-spin text-sage-500" />
            <span className="truncate">{step || 'Audit en cours…'}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-sage-500 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
