/**
 * PhaseRelecture — panneau de la PHASE 4.
 *
 * Retrait des patterns d'écriture IA, puis finitions humaines. Rien n'est
 * corrigé automatiquement : chaque anomalie est montrée AVEC son extrait, et
 * c'est le rédacteur qui tranche. Une correction automatique sur du style
 * produirait des phrases fausses sans que personne ne s'en aperçoive.
 *
 * Le décompte est recalculé sur le texte courant de l'éditeur à chaque
 * ouverture : il reflète donc les corrections au fur et à mesure, ce qui est
 * précisément ce qui rassure en fin de parcours.
 *
 * WIDGET FLOTTANT (position: fixed, portal document.body) — même facture que
 * DocNavigator : 66 points répartis sur 6 règles ne se corrigent pas en
 * mémorisant la liste. Dans le flux de la page le panneau imposait un
 * aller-retour par point (remonter lire, redescendre corriger). Flottant, il
 * reste sous les yeux PENDANT l'édition.
 *   • replié  → onglet vertical sur un bord de l'écran (rien ne masque le texte) ;
 *   • déplié  → colonne latérale, en-tête et pied fixes, la liste défile seule ;
 *   • le bord (gauche/droite) est au choix du rédacteur : quel que soit le côté,
 *     un panneau opaque recouvre une partie des lignes — c'est à lui de décider
 *     lequel gêne le passage qu'il est en train de réécrire.
 *
 * Z-index 230 : au-dessus de l'éditeur, du stepper épinglé (90) et de la barre
 * d'actions du bas (40) ; SOUS le widget Structure (DocNavigator, 240) et sous
 * les barres d'édition de texte (BubbleToolbar/TableToolbar, ~9998) — celles-ci
 * doivent rester cliquables même si elles surgissent au-dessus du panneau.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Check, X, Sparkles,
  ArrowLeftRight,
} from 'lucide-react';
import { detectStylePatterns } from '../../utils/stylePatterns';
import { proposeMechanicalFix } from '../../utils/styleFixes';

// Même clé que côté service (`stylePrompt.js` → `flattenAiOccurrences`) : le
// texte de l'extrait, espaces normalisés. Content-addressé plutôt qu'indexé,
// pour rester valide après un « Accepter » qui retire une occurrence de la
// liste et décale les index des suivantes dans la même règle.
const cleOccurrence = (id, extrait) => `${id}::${String(extrait || '').replace(/\s+/g, ' ').trim()}`;

// Placement du panneau et de son onglet selon le bord choisi.
//  • top 160 = barre du haut (62 px, z-index 100) + bloc stepper épinglé (~94 px) :
//    le panneau commence juste sous le stepper, qui reste le repère principal.
//  • hauteur bornée + défilement interne : la liste peut faire 66 entrées, et la
//    marge basse dégage la barre d'actions épinglée (plus large sur petit écran,
//    où ses boutons passent à la ligne).
//  • < md : la sidebar n'est pas décalée (même convention que la barre du bas,
//    `md:left-60`) et le panneau prend toute la largeur disponible.
const PLACEMENT = {
  gauche: {
    panneau: 'left-2 right-2 md:left-[248px] md:right-auto md:w-[336px]',
    onglet:  'left-0 md:left-60 rounded-r-xl pl-1.5 pr-2',
    ongletTop: '38%',
  },
  droite: {
    panneau: 'left-2 right-2 md:right-[14px] md:left-auto md:w-[336px]',
    onglet:  'right-0 rounded-l-xl pr-1.5 pl-2',
    // 62 % et non 40 % : l'onglet « Structure » de DocNavigator occupe déjà le
    // bord droit à 40 % — les deux languettes ne doivent pas se chevaucher.
    ongletTop: '62%',
  },
};

// Préférences d'affichage du widget — volontairement HORS état React (portée
// module) : le parent remonte ce composant (`key={relectureTick}`) à chaque
// « Accepter » et chaque « Recalculer » pour recalculer le décompte sur le texte
// courant. En état local, le panneau replié se rouvrirait et retournerait à
// gauche à CHAQUE correction acceptée — soit 66 fois sur un article comme celui
// qui a motivé ce panneau. Persisté pour la session, pas au-delà : ce n'est pas
// un réglage à mémoriser d'un article à l'autre.
const prefsAffichage = { cote: 'gauche', replie: false };

export default function PhaseRelecture({
  html = '', onRefresh, onAccept, onLocate,
  onRunStyleFix, styleFixRunning = false, styleFixStep = '', aiProposals = {},
}) {
  const [ouvert, setOuvert] = useState(null);
  // Panneau replié en languette : l'article redevient entièrement lisible sans
  // perdre la liste (un clic la ramène).
  const [replie, setReplieState] = useState(prefsAffichage.replie);
  const [cote, setCoteState] = useState(prefsAffichage.cote);
  const setReplie = (v) => { prefsAffichage.replie = v; setReplieState(v); };
  const setCote   = (v) => { prefsAffichage.cote   = v; setCoteState(v); };
  // Occurrences écartées par le rédacteur — locales à la session : « Ignorer »
  // n'écrit rien dans l'article, il retire simplement la ligne de la liste.
  const [ignores, setIgnores] = useState([]);
  const rapport = useMemo(() => detectStylePatterns(html), [html]);
  const propre = rapport.findings.length === 0;
  // Occurrences sans correction mécanique : celles que seule l'IA peut traiter.
  const aManquant = useMemo(() => rapport.findings.reduce((n, f) => n + f.exemples.filter(
    (ex) => !proposeMechanicalFix(f.id, ex.extrait, ex.terme),
  ).length, 0), [rapport.findings]);

  const place = PLACEMENT[cote] || PLACEMENT.gauche;

  // ── Replié : languette sur le bord, façon DocNavigator ──────────────────────
  if (replie) {
    return createPortal(
      <button
        type="button"
        onClick={() => setReplie(false)}
        title="Relecture — patterns d'écriture IA à relire"
        style={{ position: 'fixed', top: place.ongletTop, zIndex: 230 }}
        className={`flex flex-col items-center gap-1.5 bg-gray-900 text-white py-3 shadow-[0_6px_24px_rgba(0,0,0,0.35)] hover:bg-gray-800 transition-colors ${place.onglet}`}
      >
        <ShieldCheck size={15} className={propre ? 'text-emerald-300' : 'text-amber-300'} />
        <span className="text-[10px] font-semibold tracking-wide" style={{ writingMode: 'vertical-rl' }}>
          {propre ? 'Relecture — OK' : `Relecture · ${rapport.total}`}
        </span>
      </button>,
      document.body,
    );
  }

  // ── Déplié ──────────────────────────────────────────────────────────────────
  // Fond OPAQUE : sur du translucide le texte de l'article défilerait au travers
  // et rendrait la liste illisible.
  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{ position: 'fixed', top: 160, zIndex: 230 }}
      className={`flex flex-col bg-white border border-gray-200 rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.22)] overflow-hidden max-h-[calc(100vh-300px)] md:max-h-[calc(100vh-235px)] ${place.panneau}`}
    >
      {/* ── En-tête FIXE : le décompte reste lu même la liste défilée ── */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 bg-gray-50/80 shrink-0">
        <ShieldCheck size={14} className={`shrink-0 ${propre ? 'text-emerald-500' : 'text-amber-500'}`} />
        <span className="text-xs font-semibold text-gray-800 flex-1 min-w-0 truncate">Patterns d'écriture IA</span>
        {!propre && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 shrink-0">
            {rapport.total}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCote(cote === 'gauche' ? 'droite' : 'gauche')}
          title={cote === 'gauche'
            ? 'Déplacer le panneau à droite (s\'il masque le passage à corriger)'
            : 'Déplacer le panneau à gauche'}
          className="p-1 rounded-lg hover:bg-black/5 text-gray-400 hover:text-amber-600 transition-colors shrink-0"
        >
          <ArrowLeftRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => setReplie(true)}
          title="Replier en languette — la liste reste accessible d'un clic"
          className="p-1 rounded-lg hover:bg-black/5 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Corps DÉFILANT ── */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
        {propre ? (
          <p className="text-xs text-emerald-700 bg-emerald-50/70 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-start gap-1.5">
            <Check size={13} className="shrink-0 mt-0.5" />
            <span>Aucun pattern détecté sur les {rapport.phrases} phrases analysées — l'article est prêt pour les finitions.</span>
          </p>
        ) : (
          <>
            <p className="text-[11px] text-gray-500">
              <strong className="text-amber-700">{rapport.total}</strong> point(s) à relire, répartis sur{' '}
              {rapport.findings.length} règle(s). Rien n'est corrigé automatiquement : à vous de juger sur l'extrait.
            </p>
            <div className="space-y-1.5">
              {rapport.findings.map((f) => {
                const deplie = ouvert === f.id;
                return (
                  <div key={f.id} className="rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOuvert(deplie ? null : f.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 bg-gray-50/80 hover:bg-gray-100 transition-colors text-left"
                    >
                      <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                      <span className="text-xs font-semibold text-gray-800 flex-1 min-w-0 truncate">{f.label}</span>
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 flex-shrink-0">
                        {f.count}
                      </span>
                      {deplie ? <ChevronUp size={13} className="text-gray-400 flex-shrink-0" />
                              : <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />}
                    </button>
                    {deplie && (
                      <div className="px-3 py-2.5 space-y-2 bg-white">
                        <p className="text-[11px] text-gray-500 italic">{f.hint}</p>
                        <ul className="space-y-2">
                          {f.exemples.map((ex, i) => {
                            const cle = `${f.id}-${i}`;
                            if (ignores.includes(cle)) return null;
                            // Correction MÉCANIQUE quand elle est sûre (tirets, adverbes).
                            // `null` pour tout ce qui demande de comprendre la phrase :
                            // la proposition vient alors de l'IA, si elle a tourné.
                            const prop = proposeMechanicalFix(f.id, ex.extrait, ex.terme)
                              || aiProposals[cleOccurrence(f.id, ex.extrait)];
                            return (
                              <li key={i} className="text-[11px] leading-relaxed border-l-2 border-amber-200 pl-2 space-y-1">
                                <button
                                  type="button"
                                  // Le TERME est transmis : c'est lui qu'on
                                  // surligne, pas tout le paragraphe.
                                  onClick={() => onLocate?.(ex.extrait, ex.terme)}
                                  title={ex.terme
                                    ? `Situer et surligner « ${ex.terme} » dans l'article`
                                    : 'Situer ce passage dans l\'article'}
                                  className="text-left text-gray-700 hover:text-amber-800 transition-colors"
                                >
                                  {ex.terme && <strong className="text-amber-800">« {ex.terme} » — </strong>}
                                  {ex.mots && <span className="text-gray-400">({ex.mots} mots) </span>}
                                  {ex.extrait}
                                </button>
                                {prop ? (
                                  <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 px-2 py-1.5 space-y-1">
                                    <p className="text-[10px] text-emerald-900">
                                      <span className="uppercase tracking-wide font-bold text-emerald-700 text-[9px]">Proposition </span>
                                      {prop.apres}
                                    </p>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => onAccept?.(prop)}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700 transition-colors"
                                      >
                                        <Check size={10} /> Accepter
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setIgnores((l) => [...l, cle])}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white text-gray-500 border border-gray-200 text-[10px] font-semibold hover:text-gray-800 transition-colors"
                                      >
                                        <X size={10} /> Ignorer
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  // On le DIT plutôt que de laisser une ligne muette :
                                  // le rédacteur doit savoir pourquoi il n'a pas de bouton.
                                  <p className="text-[10px] text-gray-400 italic">
                                    {styleFixRunning
                                      ? 'Correction IA en cours...'
                                      : 'Correction à écrire à la main : elle dépend du sens de la phrase.'}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {f.count > f.exemples.length && (
                          <p className="text-[10px] text-gray-400">
                            {f.count - f.exemples.length} autre(s) occurrence(s) non listée(s) ici.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Pied FIXE : les actions globales restent atteignables sans remonter
             la liste (elle peut faire 66 entrées). Mêmes handlers, mêmes
             conditions d'affichage qu'avant. ── */}
      <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 border-t border-gray-100 bg-gray-50/60 shrink-0 flex-wrap">
        <span className="text-[11px] text-gray-400 px-1">{rapport.phrases} phrases analysées</span>
        <div className="flex items-center gap-1">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              title="Recalculer sur le texte actuel de l'éditeur"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors"
            >
              <RefreshCw size={11} /> Recalculer
            </button>
          )}
          {onRunStyleFix && aManquant > 0 && (
            <button
              type="button"
              onClick={() => onRunStyleFix(rapport.findings)}
              disabled={styleFixRunning}
              title="Un seul appel IA pour proposer une réécriture de tous les passages qui demandent de comprendre la phrase"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              <Sparkles size={11} />
              {styleFixRunning ? (styleFixStep || 'Correction en cours...') : `Corriger ${aManquant} passage(s) avec l'IA`}
            </button>
          )}
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
