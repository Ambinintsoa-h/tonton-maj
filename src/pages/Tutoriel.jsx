/**
 * Tutoriel — deux parcours servis par la même page :
 *   /tutoriel[/:id]        — usage quotidien d'un rédacteur / QA (tous les rôles)
 *   /tutoriel-admin[/:id]  — actions d'administration (managers et super admins)
 *
 * La garde d'accès est ICI et pas seulement dans le menu : `RoleGuard` (App.js)
 * protège la route admin, et `chapitresVisibles` ne rend aucun chapitre à un rôle
 * qui n'a pas le parcours. Un menu masqué n'est pas une protection — quelqu'un peut
 * taper l'adresse à la main.
 *
 * Contenu : `src/tutoriel/contenus/` (un fichier par chapitre), relié au registre
 * `src/tutoriel/chapitres.js` par l'identifiant.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  GraduationCap, ShieldCheck, CheckCircle2, Circle, ArrowLeft, ArrowRight, Clock, Play,
} from 'lucide-react';
import {
  PARCOURS, PARCOURS_REDACTEUR, PARCOURS_ADMIN,
  chapitresVisibles, chapitreParId, voisins, cheminChapitre,
  pourcentageLu, minutesTotal, peutVoirParcours, parcoursAccessibles,
} from '../tutoriel/chapitres';
import { lireChapitresLus, basculerChapitreLu } from '../tutoriel/progression';
import { CONTENUS } from '../tutoriel/contenus';

const ICONES = { [PARCOURS_REDACTEUR]: GraduationCap, [PARCOURS_ADMIN]: ShieldCheck };

function BarreProgression({ pct, label }) {
  return (
    <div
      className="h-1.5 rounded-full bg-gray-100 overflow-hidden"
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}
    >
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function SommaireChapitres({ parcours, chapitres, lus, courant }) {
  return (
    <nav aria-label="Chapitres" className="glass-card p-2">
      <ol className="space-y-0.5">
        {chapitres.map((c, i) => {
          const actif = c.id === courant;
          const lu = lus.includes(c.id);
          return (
            <li key={c.id}>
              <Link
                to={cheminChapitre(parcours.id, c.id)}
                aria-current={actif ? 'page' : undefined}
                className={`flex items-start gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                  actif ? 'bg-black text-white' : 'text-gray-600 hover:bg-black/5'
                }`}
              >
                <span className="flex-shrink-0 mt-0.5" aria-hidden="true">
                  {lu
                    ? <CheckCircle2 size={15} className={actif ? 'text-emerald-300' : 'text-emerald-500'} />
                    : <Circle size={15} className={actif ? 'text-white/60' : 'text-gray-300'} />}
                </span>
                <span className="leading-snug">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide block ${actif ? 'text-white/60' : 'text-gray-400'}`}>
                    Chapitre {i + 1}
                  </span>
                  {c.titre}
                  {lu && <span className="sr-only"> (lu)</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Accueil({ parcours, chapitres, lus, role }) {
  const Icone = ICONES[parcours.id] || GraduationCap;
  const pct = pourcentageLu(lus, chapitres);
  const premierNonLu = chapitres.find((c) => !lus.includes(c.id));
  const autres = parcoursAccessibles(role).filter((p) => p.id !== parcours.id);
  return (
    <div className="space-y-6">
      <div className="glass-card p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-black text-white flex items-center justify-center flex-shrink-0">
            <Icone size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{parcours.titre}</h1>
            <p className="text-sm text-gray-500 mt-1">{parcours.sousTitre}</p>
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1.5">
              <Clock size={12} aria-hidden="true" />
              {chapitres.length} chapitres · environ {minutesTotal(chapitres)} minutes
            </p>
          </div>
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <span>Votre progression</span>
            <span className="tabular-nums font-medium">{pct} %</span>
          </div>
          <BarreProgression pct={pct} label="Progression dans le tutoriel" />
        </div>
        {premierNonLu && (
          <Link
            to={cheminChapitre(parcours.id, premierNonLu.id)}
            className="btn-primary inline-flex mt-5 w-fit"
          >
            <Play size={14} aria-hidden="true" />
            {lus.length ? 'Reprendre' : 'Commencer'} : {premierNonLu.titre}
          </Link>
        )}
        {!premierNonLu && chapitres.length > 0 && (
          <p role="status" className="mt-5 text-sm font-medium text-emerald-700">
            Vous avez lu tous les chapitres. Vous pouvez les rouvrir à tout moment.
          </p>
        )}
      </div>

      <ol className="grid gap-3 md:grid-cols-2">
        {chapitres.map((c, i) => {
          const lu = lus.includes(c.id);
          return (
            <li key={c.id}>
              <Link
                to={cheminChapitre(parcours.id, c.id)}
                className="glass-card block p-5 h-full hover:shadow-glass-lg transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Chapitre {i + 1}</span>
                  {lu
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><CheckCircle2 size={13} aria-hidden="true" /> Lu</span>
                    : <span className="text-[11px] text-gray-400">{c.minutes} min</span>}
                </div>
                <h2 className="text-base font-semibold text-gray-900 mt-1.5">{c.titre}</h2>
                <p className="text-sm text-gray-500 mt-1 leading-snug">{c.resume}</p>
              </Link>
            </li>
          );
        })}
      </ol>

      {autres.map((p) => {
        const I = ICONES[p.id] || GraduationCap;
        return (
          <Link key={p.id} to={p.route} className="glass-card flex items-center gap-3 p-4 hover:shadow-glass-lg transition-shadow">
            <I size={18} className="text-gray-500" aria-hidden="true" />
            <span className="text-sm text-gray-700">
              <span className="font-semibold text-gray-900">{p.titre}</span> — {p.sousTitre}
            </span>
            <ArrowRight size={14} className="ml-auto text-gray-400" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}

export default function Tutoriel({ parcours: parcoursId = PARCOURS_REDACTEUR }) {
  const { id } = useParams();
  const role = useSelector((s) => s.auth.role);
  const membre = useSelector((s) => s.auth.uid || s.auth.username || '');
  const parcours = PARCOURS[parcoursId];
  const haut = useRef(null);

  const chapitres = useMemo(() => chapitresVisibles(parcoursId, role), [parcoursId, role]);
  const [lus, setLus] = useState(() => lireChapitresLus(membre, parcoursId));
  useEffect(() => { setLus(lireChapitresLus(membre, parcoursId)); }, [membre, parcoursId]);

  // Revient en haut à chaque changement de chapitre : sans cela, « Chapitre suivant »
  // ouvre le suivant déjà défilé jusqu'en bas.
  useEffect(() => {
    if (id && haut.current && typeof haut.current.scrollIntoView === 'function') {
      haut.current.scrollIntoView({ block: 'start' });
    }
  }, [id]);

  if (!parcours || !peutVoirParcours(parcoursId, role)) {
    return <Navigate to={PARCOURS[PARCOURS_REDACTEUR].route} replace />;
  }

  const chapitre = id ? chapitreParId(parcoursId, id, role) : null;
  if (id && !chapitre) return <Navigate to={parcours.route} replace />;

  if (!chapitre) {
    return <Accueil parcours={parcours} chapitres={chapitres} lus={lus} role={role} />;
  }

  const Contenu = CONTENUS[chapitre.id];
  const { precedent, suivant } = voisins(parcoursId, chapitre.id, role);
  const numero = chapitres.findIndex((c) => c.id === chapitre.id) + 1;
  const estLu = lus.includes(chapitre.id);

  return (
    <div ref={haut} className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] items-start">
      <aside className="lg:sticky lg:top-4 space-y-3">
        <Link to={parcours.route} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900">
          <ArrowLeft size={13} aria-hidden="true" /> {parcours.titre}
        </Link>
        <SommaireChapitres parcours={parcours} chapitres={chapitres} lus={lus} courant={chapitre.id} />
      </aside>

      <article className="glass-card p-6 md:p-8 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Chapitre {numero} sur {chapitres.length} · {chapitre.minutes} min
        </p>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight mt-1 mb-5">{chapitre.titre}</h1>

        {Contenu ? <Contenu membre={membre} role={role} /> : (
          <p className="text-sm text-gray-500">Ce chapitre n'est pas encore disponible.</p>
        )}

        <div className="mt-10 pt-5 border-t border-gray-200 flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={estLu}
            onClick={() => setLus(basculerChapitreLu(membre, parcoursId, chapitre.id))}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              estLu
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {estLu ? <CheckCircle2 size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
            {estLu ? 'Chapitre lu' : 'Marquer ce chapitre comme lu'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {precedent && (
              <Link to={cheminChapitre(parcoursId, precedent.id)} className="btn-secondary">
                <ArrowLeft size={14} aria-hidden="true" /> Précédent
              </Link>
            )}
            {suivant && (
              <Link to={cheminChapitre(parcoursId, suivant.id)} className="btn-primary">
                Suivant <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
