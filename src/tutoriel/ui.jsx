/**
 * ui.jsx — les briques interactives communes aux chapitres du tutoriel.
 *
 * Volontairement SANS framer-motion : des transitions CSS suffisent, et un
 * composant sans dépendance d'animation se teste sans rien simuler.
 *
 * Toutes les briques interactives sont de vrais <button> (clavier, lecteur
 * d'écran) avec leurs attributs ARIA : un tutoriel qu'on ne peut pas parcourir
 * au clavier n'est pas un tutoriel.
 */
import { useState } from 'react';
import {
  Lightbulb, AlertTriangle, ShieldCheck, Info, ChevronDown, Check,
  CheckCircle2, Circle, RotateCcw,
} from 'lucide-react';
import { basculerCoche, lireCoches } from './progression';

// ── Capture d'écran annotée ───────────────────────────────────────────────────
/**
 * Une VRAIE capture de l'application (rangée dans `public/tutoriel/`), avec des
 * pastilles numérotées posées par-dessus. Contrairement aux maquettes, elle montre
 * l'écran tel qu'il est : à n'utiliser que pour un écran qu'on ne peut pas
 * reproduire fidèlement, et seulement après avoir retiré toute donnée réelle (nom du
 * membre, texte d'un article) — le dossier `public/` est servi sans connexion.
 *
 * `pastilles` : [{ n, x, y }] — x et y en POURCENTAGE de l'image (0-100), pour que
 * les pastilles suivent la capture à toutes les largeurs.
 */
export function Capture({ fichier, alt, legende, pastilles = [] }) {
  const src = `${process.env.PUBLIC_URL || ''}/tutoriel/${fichier}`;
  return (
    <figure className="my-4">
      <div className="relative rounded-xl border border-gray-200 overflow-hidden bg-white">
        <img src={src} alt={alt} loading="lazy" className="block w-full h-auto" />
        {pastilles.map((p) => (
          <span
            key={p.n}
            aria-hidden="true"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center ring-2 ring-white shadow"
          >
            {p.n}
          </span>
        ))}
      </div>
      {legende && <figcaption className="text-xs text-gray-500 mt-1.5">{legende}</figcaption>}
    </figure>
  );
}

// ── Encadrés ──────────────────────────────────────────────────────────────────
const ENCADRES = {
  regle:     { Icone: ShieldCheck,   fond: 'bg-emerald-50 border-emerald-200', texte: 'text-emerald-900', icone: 'text-emerald-600', titre: 'Règle absolue' },
  astuce:    { Icone: Lightbulb,     fond: 'bg-sky-50 border-sky-200',         texte: 'text-sky-900',     icone: 'text-sky-600',     titre: 'Astuce' },
  attention: { Icone: AlertTriangle, fond: 'bg-amber-50 border-amber-200',     texte: 'text-amber-900',   icone: 'text-amber-600',   titre: 'Attention' },
  info:      { Icone: Info,          fond: 'bg-gray-50 border-gray-200',       texte: 'text-gray-800',    icone: 'text-gray-500',    titre: 'À savoir' },
};

export function Encadre({ type = 'astuce', titre, children }) {
  const s = ENCADRES[type] || ENCADRES.astuce;
  const { Icone } = s;
  return (
    <aside role="note" className={`rounded-xl border px-4 py-3 my-4 ${s.fond} ${s.texte}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icone size={15} className={s.icone} aria-hidden="true" />
        {titre || s.titre}
      </p>
      <div className="text-sm leading-relaxed mt-1 space-y-2">{children}</div>
    </aside>
  );
}

// ── Titres et texte ───────────────────────────────────────────────────────────
export function Section({ titre, children, id }) {
  return (
    <section id={id} className="mt-8 first:mt-0">
      {titre && <h2 className="text-lg font-semibold text-gray-900 mb-2">{titre}</h2>}
      <div className="text-sm text-gray-700 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export const Mot = ({ children }) => (
  <span className="font-semibold text-gray-900">{children}</span>
);

// Un libellé d'écran tel qu'il s'affiche dans l'outil : jamais paraphrasé.
export const Ecran = ({ children }) => (
  <span className="inline-block rounded-md bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-[12px] font-medium text-gray-800 whitespace-nowrap">
    {children}
  </span>
);

// ── Onglets ───────────────────────────────────────────────────────────────────
export function Onglets({ onglets, initial, idGroupe = 'onglets' }) {
  const [actif, setActif] = useState(initial || onglets[0]?.id);
  const courant = onglets.find((o) => o.id === actif) || onglets[0];
  return (
    <div className="my-4">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-gray-200">
        {onglets.map((o) => {
          const on = o.id === courant?.id;
          return (
            <button
              key={o.id}
              type="button"
              role="tab"
              id={`${idGroupe}-tab-${o.id}`}
              aria-selected={on}
              aria-controls={`${idGroupe}-panneau-${o.id}`}
              onClick={() => setActif(o.id)}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                on ? 'border-black text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {courant && (
        <div
          role="tabpanel"
          id={`${idGroupe}-panneau-${courant.id}`}
          aria-labelledby={`${idGroupe}-tab-${courant.id}`}
          className="pt-4 text-sm text-gray-700 leading-relaxed space-y-3"
        >
          {courant.contenu}
        </div>
      )}
    </div>
  );
}

// ── Étapes cliquables (la « frise ») ─────────────────────────────────────────
export function Etapes({ etapes, initial = 0, idGroupe = 'etapes' }) {
  const [i, setI] = useState(initial);
  const e = etapes[i] || etapes[0];
  return (
    <div className="my-4 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* En colonne JUSQU'À `lg` : `sm` se déclenche sur la largeur de la FENÊTRE, or le
          contenu d'un chapitre n'occupe que ~550 px à 860 px de fenêtre (barre latérale
          + sommaire). Quatre étapes en ligne y rognaient « Relecture » — constaté en
          production le 17/11/2026. */}
      <ol className="flex flex-col lg:flex-row border-b border-gray-200" aria-label="Étapes">
        {etapes.map((x, k) => {
          const on = k === i;
          const faite = k < i;
          return (
            <li key={x.titre} className="flex-1">
              <button
                type="button"
                aria-current={on ? 'step' : undefined}
                onClick={() => setI(k)}
                className={`w-full flex items-center gap-2 px-3 py-3 text-left text-sm transition-colors ${
                  on ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                    on ? 'bg-white text-black' : faite ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {faite ? <Check size={12} aria-hidden="true" /> : k + 1}
                </span>
                <span className="font-medium">{x.titre}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div id={`${idGroupe}-detail`} aria-live="polite" className="p-4 text-sm text-gray-700 leading-relaxed space-y-3">
        {e.sousTitre && <p className="text-xs uppercase tracking-wide font-semibold text-gray-400">{e.sousTitre}</p>}
        {e.corps}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setI(Math.max(0, i - 1))}
            disabled={i === 0}
            className="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-30"
          >
            ← Étape précédente
          </button>
          <button
            type="button"
            onClick={() => setI(Math.min(etapes.length - 1, i + 1))}
            disabled={i === etapes.length - 1}
            className="text-xs font-medium text-gray-900 hover:underline disabled:opacity-30"
          >
            Étape suivante →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Accordéon (FAQ) ───────────────────────────────────────────────────────────
export function Accordeon({ items }) {
  const [ouverts, setOuverts] = useState(() => new Set());
  const basculer = (k) => setOuverts((prev) => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  return (
    <div className="my-4 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
      {items.map((it, k) => {
        const on = ouverts.has(k);
        return (
          <div key={it.q}>
            <button
              type="button"
              aria-expanded={on}
              aria-controls={`acc-${k}`}
              onClick={() => basculer(k)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              <span>{it.q}</span>
              <ChevronDown size={16} aria-hidden="true" className={`flex-shrink-0 text-gray-400 transition-transform ${on ? 'rotate-180' : ''}`} />
            </button>
            {on && (
              <div id={`acc-${k}`} className="px-4 pb-4 text-sm text-gray-700 leading-relaxed space-y-2">
                {it.r}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Quiz de fin de chapitre ──────────────────────────────────────────────────
// Pour s'auto-vérifier, pas pour être noté : rien n'est enregistré ni transmis.
export function Quiz({ questions, titre = 'Vérifiez que vous avez compris' }) {
  const [reponses, setReponses] = useState({});
  const repondues = Object.keys(reponses).length;
  const bonnes = questions.filter((q, k) => reponses[k] === q.bonne).length;
  return (
    <div className="my-6 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{titre}</h3>
        {repondues > 0 && (
          <button
            type="button"
            onClick={() => setReponses({})}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            <RotateCcw size={12} aria-hidden="true" /> Recommencer
          </button>
        )}
      </div>
      <ol className="space-y-5">
        {questions.map((q, k) => {
          const choisi = reponses[k];
          const fait = choisi !== undefined;
          return (
            <li key={q.q}>
              <p className="text-sm font-medium text-gray-900 mb-2">{k + 1}. {q.q}</p>
              <div className="space-y-1.5" role="group" aria-label={`Réponses à la question ${k + 1}`}>
                {q.choix.map((c, j) => {
                  const estBonne = j === q.bonne;
                  const estChoisie = j === choisi;
                  let style = 'border-gray-200 hover:bg-gray-50 text-gray-700';
                  if (fait && estBonne) style = 'border-emerald-300 bg-emerald-50 text-emerald-900';
                  else if (fait && estChoisie) style = 'border-red-300 bg-red-50 text-red-800';
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={fait}
                      aria-pressed={estChoisie}
                      onClick={() => setReponses((r) => ({ ...r, [k]: j }))}
                      className={`w-full text-left rounded-xl border px-3 py-2 text-sm transition-colors disabled:cursor-default ${style}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {fait && (
                <p role="status" className={`text-xs mt-2 ${choisi === q.bonne ? 'text-emerald-700' : 'text-red-700'}`}>
                  {choisi === q.bonne ? 'Exact. ' : 'Pas tout à fait. '}{q.explication}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {repondues === questions.length && (
        <p role="status" className="mt-4 text-sm font-semibold text-gray-900">
          {bonnes} bonne{bonnes > 1 ? 's' : ''} réponse{bonnes > 1 ? 's' : ''} sur {questions.length}.
        </p>
      )}
    </div>
  );
}

// ── Liste « À faire », mémorisée dans le navigateur ──────────────────────────
export function ListeAFaire({ listeId, membre, etapes, titre }) {
  const [coches, setCoches] = useState(() => lireCoches(membre, listeId));
  const faites = etapes.filter((e) => coches.includes(e.id)).length;
  const pct = etapes.length ? Math.round((faites / etapes.length) * 100) : 0;
  return (
    <div className="my-6 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{titre}</h3>
        <span className="text-xs font-medium text-gray-500 tabular-nums">{faites} / {etapes.length}</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-gray-100 mt-2 overflow-hidden"
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={titre}
      >
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 space-y-1">
        {etapes.map((e) => {
          const on = coches.includes(e.id);
          return (
            <li key={e.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setCoches(basculerCoche(membre, listeId, e.id))}
                className="w-full flex items-start gap-2.5 text-left rounded-lg px-2 py-2 hover:bg-gray-50"
              >
                {on
                  ? <CheckCircle2 size={18} className="flex-shrink-0 text-emerald-500 mt-0.5" aria-hidden="true" />
                  : <Circle size={18} className="flex-shrink-0 text-gray-300 mt-0.5" aria-hidden="true" />}
                <span>
                  <span className={`text-sm ${on ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>{e.texte}</span>
                  {e.detail && <span className="block text-xs text-gray-500 mt-0.5">{e.detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {faites === etapes.length && etapes.length > 0 && (
        <p role="status" className="text-sm font-medium text-emerald-700 mt-3">Tout est fait — bravo.</p>
      )}
    </div>
  );
}

// ── Cadre de maquette ────────────────────────────────────────────────────────
// Une maquette n'est PAS une capture : aucune donnée réelle (ni site client, ni nom
// de l'équipe). Le cadre le dit, pour qu'on ne la prenne pas pour l'écran réel.
export function FenetreMaquette({ titre, children, legende }) {
  return (
    <figure className="my-5">
      <div className="rounded-2xl border border-gray-300 bg-white shadow-glass overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border-b border-gray-200">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-red-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          </span>
          <span className="text-[11px] font-medium text-gray-500 truncate">{titre}</span>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">
            Maquette cliquable
          </span>
        </div>
        {/* `overflow-x-auto` : une maquette trop large pour sa colonne défile dans son cadre
            au lieu de déborder de la page (et d'être rognée sur le bord). */}
        <div className="p-4 bg-gray-50/60 overflow-x-auto">{children}</div>
      </div>
      {legende && <figcaption className="text-xs text-gray-500 mt-2">{legende}</figcaption>}
    </figure>
  );
}

// Pastille numérotée, pour relier un élément de la maquette à sa légende.
export const Pastille = ({ n }) => (
  <span
    aria-hidden="true"
    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-black text-white text-[9px] font-bold align-middle"
  >
    {n}
  </span>
);

export function Legende({ items }) {
  return (
    <ol className="mt-3 space-y-1.5 text-xs text-gray-600">
      {items.map((t, k) => (
        <li key={t} className="flex gap-2">
          <span className="flex-shrink-0 mt-0.5"><Pastille n={k + 1} /></span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}
