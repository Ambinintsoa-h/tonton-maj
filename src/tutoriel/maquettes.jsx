/**
 * maquettes.jsx — des écrans de Tonton AI redessinés en HTML, et cliquables.
 *
 * Choix d'Andrianina (17/11/2026) : maquettes plutôt que captures d'écran. Deux
 * raisons qui tiennent à la nature de l'outil :
 *   • une capture montrerait des données réelles — sites clients, adresses,
 *     noms de l'équipe — qu'il faudrait flouter à chaque fois ;
 *   • une capture vieillit à chaque évolution de l'interface ; une maquette
 *     se retouche avec le code.
 *
 * Une maquette est donc FIDÈLE AUX LIBELLÉS (mêmes mots que l'écran réel, jamais
 * paraphrasés) mais n'imite pas chaque pixel, et n'affiche JAMAIS de donnée réelle :
 * ni URL de client, ni nom, ni adresse e-mail.
 */
import { useEffect, useMemo, useState } from 'react';
import { Globe, Rocket, ChevronDown, CheckCircle2, Loader, Clock, AlertCircle, ArrowRight } from 'lucide-react';
import { FenetreMaquette, Legende, Pastille, Encadre } from './ui';

// ── Constantes que le tutoriel annonce — une seule source ────────────────────
export const CONSIGNE_MAX = 2500;           // plafond de la consigne (generationPrompt.js)
export const COUT_MOYEN_USD = 0.51;         // mesuré sur « Mes MAJ », novembre 2026
export const MINUTES_PAR_ARTICLE = 7;       // temps machine moyen mesuré, novembre 2026
export const PARALLELISME_DEFAUT = 4;       // Paramètres → traitement en lot (défaut)

// ── 1. Le menu, selon le rôle ────────────────────────────────────────────────
// Miroir de `NAV_ALL` (Sidebar.jsx). Un test compare les deux : si le menu réel
// change, la maquette ne peut pas rester muette.
export const ENTREES_MENU = [
  { to: '/',                label: 'Faire une MAJ',   roles: null },
  { to: '/maj-en-attente',  label: 'Mes MAJ',         roles: null },
  { to: '/lots',            label: 'MAJ en lot',      roles: ['super_admin', 'manager', 'cq_ia'] },
  { to: '/skills',          label: 'Skills IA',       roles: ['super_admin', 'manager'] },
  { to: '/wordpress',       label: 'WordPress',       roles: ['super_admin', 'manager', 'support'] },
  { to: '/commentaires',    label: 'Commentaires',    roles: ['super_admin', 'manager', 'support'], beta: true },
  { to: '/historique',      label: 'Historique',      roles: null },
  { to: '/archives',        label: 'Archives',        roles: ['super_admin'] },
  { to: '/suivi-positions', label: 'Suivi positions', roles: ['super_admin'] },
  { to: '/bilan-seo',       label: 'Effet des MAJ',   roles: ['super_admin'] },
  { to: '/budget-api',      label: 'Budget API',      roles: ['super_admin'] },
  { to: '/equipe',          label: 'Équipe',          roles: ['super_admin', 'manager'] },
  { to: '/tickets',         label: 'Tickets',         roles: null },
  { to: '/tutoriel',        label: 'Tutoriel',        roles: null },
  { to: '/tutoriel-admin',  label: 'Tutoriel admin',  roles: ['super_admin', 'manager'] },
];

export const ROLES_MENU = [
  { id: 'cq_ia', label: 'Rédacteur (CQ IA)' },
  { id: 'manager', label: 'Manager' },
  { id: 'support', label: 'Support' },
  { id: 'super_admin', label: 'Super admin' },
];

/**
 * Entrées de menu visibles pour un rôle : le tableau de bord en tête (il varie selon
 * le rôle), puis les pages, puis « Paramètres » — qui, dans la vraie barre latérale,
 * est séparé en bas et réservé aux super admins.
 */
export const menuPourRole = (role) => {
  const tableau = role === 'support' ? 'Tableau de bord' : 'Dashboard';
  const entrees = ENTREES_MENU
    .filter((e) => e.roles === null || e.roles.includes(role))
    .map((e) => ({ label: e.label, beta: !!e.beta }));
  const bas = role === 'super_admin' ? [{ label: 'Paramètres', beta: false }] : [];
  return [{ label: tableau, beta: false }, ...entrees, ...bas];
};

export function MaquetteMenu({ roleInitial = 'cq_ia', surligner = [] }) {
  const [role, setRole] = useState(roleInitial);
  const entrees = menuPourRole(role);
  return (
    <FenetreMaquette
      titre="Barre latérale — ce que chaque rôle voit"
      legende="Choisissez un rôle : seules les pages de ce rôle apparaissent dans son menu. Le « Tutoriel » est visible de tous ; « Tutoriel admin » seulement des managers et super admins."
    >
      <div role="group" aria-label="Choisir un rôle" className="flex flex-wrap gap-1.5 mb-3">
        {ROLES_MENU.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={role === r.id}
            onClick={() => setRole(r.id)}
            className={`text-xs font-medium rounded-full px-3 py-1.5 border transition-colors ${
              role === r.id ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <ul aria-label={`Menu du rôle ${ROLES_MENU.find((r) => r.id === role)?.label}`} className="w-60 space-y-1">
        {entrees.map((e) => (
          <li
            key={e.label}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              surligner.includes(e.label) ? 'bg-black text-white' : 'bg-white text-gray-700 border border-gray-100'
            }`}
          >
            <span className="flex-1">{e.label}</span>
            {e.beta && <span className="text-[9px] font-bold bg-violet-100 text-violet-700 rounded-full px-1.5 py-0.5">BÊTA</span>}
          </li>
        ))}
      </ul>
    </FenetreMaquette>
  );
}

// ── 2. L'écran « Faire une MAJ » ─────────────────────────────────────────────
export function MaquetteLancement() {
  const [mode, setMode] = useState('url');
  const [url, setUrl] = useState('');
  const [motCle, setMotCle] = useState('');
  const [avance, setAvance] = useState(false);
  const [lance, setLance] = useState(false);
  const pret = (mode === 'url' ? url.trim().length > 8 : url.trim().length > 20) && motCle.trim().length > 1;

  return (
    <FenetreMaquette
      titre="Faire une MAJ"
      legende="Essayez : remplissez l'adresse (ou collez du texte) et le mot-clé cible — le bouton se débloque."
    >
      <div className="space-y-3">
        <div role="tablist" aria-label="Source de l'article" className="inline-flex rounded-xl bg-gray-100 p-1 text-sm">
          {[['url', 'Lien URL'], ['coller', 'Copier-coller']].map(([id, label]) => (
            <button
              key={id} type="button" role="tab" aria-selected={mode === id}
              onClick={() => { setMode(id); setLance(false); }}
              className={`px-4 py-1.5 rounded-lg font-medium transition-colors ${mode === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              {label} {id === 'url' ? <Pastille n={1} /> : null}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="mq-url">
            {mode === 'url' ? 'URL de l\'article' : 'Contenu de l\'article'} <Pastille n={2} />
          </label>
          {mode === 'url' ? (
            <input
              id="mq-url" value={url} onChange={(e) => { setUrl(e.target.value); setLance(false); }}
              placeholder="https://exemple.com/mon-article/"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            />
          ) : (
            <textarea
              id="mq-url" rows={3} value={url} onChange={(e) => { setUrl(e.target.value); setLance(false); }}
              placeholder="Collez ici le texte de l'article…"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            />
          )}
          <p className="text-[11px] text-gray-400 mt-1">
            {mode === 'url' ? 'L\'agent va récupérer le contenu complet de la page mot par mot.' : 'Utile quand le site bloque la récupération automatique.'}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="mq-kw">
            Mot-clé cible <span className="text-red-500">*</span> <Pastille n={3} />
          </label>
          <input
            id="mq-kw" value={motCle} onChange={(e) => { setMotCle(e.target.value); setLance(false); }}
            placeholder="ex. devis toiture"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-400 mt-1">L'IA optimisera l'article autour de ce mot-clé (H1/H2, intro, densité sémantique).</p>
        </div>

        <button
          type="button" aria-expanded={avance} onClick={() => setAvance((v) => !v)}
          className="w-full flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-left text-xs text-gray-600"
        >
          <ChevronDown size={13} aria-hidden="true" className={`transition-transform ${avance ? 'rotate-180' : '-rotate-90'}`} />
          <span><span className="font-medium text-gray-800">Réglages avancés</span> — type d'article, plugin SEO, longueur cible, maillage</span>
          <Pastille n={4} />
        </button>
        {avance && (
          <p className="text-xs text-gray-600 rounded-xl bg-white border border-gray-100 px-3 py-2">
            Les valeurs par défaut conviennent dans la plupart des cas. Ne les changez que si une consigne de la rédaction le demande.
          </p>
        )}

        <button
          type="button" disabled={!pret} onClick={() => setLance(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-black text-white text-sm font-medium px-4 py-2 disabled:bg-gray-300"
        >
          <Rocket size={14} aria-hidden="true" /> Lancer l'analyse IA <Pastille n={5} />
        </button>

        {lance && (
          <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            <CheckCircle2 size={15} aria-hidden="true" /> Analyse lancée : la phase 1 (Audit) démarre.
          </p>
        )}
      </div>
      <Legende items={[
        'Lien URL : l\'outil lit la page lui-même. Copier-coller : vous fournissez le texte.',
        'L\'adresse de la page (ou le texte collé).',
        'Le mot-clé cible est obligatoire : sans lui, le bouton reste grisé.',
        'Réglages avancés : à laisser par défaut sauf consigne contraire.',
        'Lance la phase 1. Rien n\'est publié : vous relirez avant.',
      ]} />
    </FenetreMaquette>
  );
}

// ── 3. Une ligne de MAJ en lot ───────────────────────────────────────────────
export const TYPES_LOT = [
  {
    id: 'maj', label: 'Selon l\'audit',
    desc: 'L\'audit choisit l\'ampleur. Dans la pratique il recommande presque toujours une refonte : c\'est le réglage par défaut.',
  },
  {
    id: 'ciblee', label: 'MAJ ciblée',
    desc: 'Modifications ciblées : la structure et le texte existants sont conservés, quoi que recommande l\'audit.',
  },
  {
    id: 'refonte', label: 'Refonte',
    desc: 'L\'article est réécrit en entier, quoi que recommande l\'audit.',
  },
];

/**
 * Détecte, dans une consigne, des minima chiffrés — ce que l'outil NE GARANTIT PAS
 * (mesuré en prod le 17/11/2026 : « 450 mots minimum » rendu à 237 ; « lucide » ×11
 * rendu 6 fois). Sert à prévenir pendant la saisie, pas après coup.
 */
export const contientMinimaChiffres = (texte) =>
  /(\bau moins\b|\bminimum\b|\bmini\b|\bde \d+ à \d+ mots\b|\b\d+\s*mots\b|\b\d+\s*fois\b)/i.test(String(texte || ''));

const STATUTS = ['En attente', 'En cours', 'Fait'];

export function MaquetteLot() {
  const [type, setType] = useState('maj');
  const [consigne, setConsigne] = useState('');
  const [etape, setEtape] = useState(-1); // -1 = non lancé
  const courant = TYPES_LOT.find((t) => t.id === type);
  const trop = consigne.length > CONSIGNE_MAX;

  useEffect(() => {
    if (etape < 0 || etape >= STATUTS.length - 1) return undefined;
    const t = setTimeout(() => setEtape((e) => e + 1), 1100);
    return () => clearTimeout(t);
  }, [etape]);

  return (
    <FenetreMaquette
      titre="MAJ en lot — Nouveau lot"
      legende="Changez le type, écrivez une consigne, puis lancez : le lot passe par « En attente », « En cours », « Fait »."
    >
      {/* Une rangée qui SE REPLIE, et non quatre colonnes fixes : `md:grid-cols-4` se
          déclenche sur la largeur de la FENÊTRE (≥ 768 px), alors que la colonne d'un
          chapitre n'en fait que ~550 à 860 px. Le sélecteur et la consigne débordaient
          alors de leur cadre — constaté en production le 17/11/2026. */}
      <div className="flex flex-wrap gap-2">
        <input aria-label="URL de l'article" readOnly value="https://exemple.com/mon-article/" className="flex-1 min-w-[11rem] rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500" />
        <input aria-label="Mot-clé cible" readOnly value="devis toiture" className="flex-1 min-w-[8rem] rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500" />
        <select
          aria-label="Type de mise à jour" value={type}
          onChange={(e) => { setType(e.target.value); setEtape(-1); }}
          className="min-w-[8rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {TYPES_LOT.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input
          aria-label="Consigne (optionnel)" placeholder="Consigne (optionnel)" value={consigne}
          onChange={(e) => { setConsigne(e.target.value); setEtape(-1); }}
          className="flex-1 min-w-[14rem] rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
        />
      </div>

      <p className="text-xs text-gray-600 mt-2"><span className="font-semibold text-gray-800">{courant.label} :</span> {courant.desc}</p>
      <p className={`text-[11px] mt-1 tabular-nums ${trop ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
        {consigne.length} / {CONSIGNE_MAX} caractères{trop ? ' — la fin sera coupée' : ''}
      </p>

      {contientMinimaChiffres(consigne) && (
        <Encadre type="attention" titre="Un minimum chiffré dans votre consigne">
          <p>
            L'IA ne tient pas fiablement les minima de longueur (« 450 mots minimum », « ce mot 11 fois »).
            Décrivez plutôt la structure et le fond ; vérifiez les longueurs à la relecture.
          </p>
        </Encadre>
      )}

      <div className="flex items-center gap-3 mt-3">
        <button
          type="button" onClick={() => setEtape(0)}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 text-white text-sm font-medium px-4 py-2"
        >
          <Rocket size={14} aria-hidden="true" /> Lancer le lot (1 article)
        </button>
        {etape >= 0 && (
          <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${
            etape === 2 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : etape === 1 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            {etape === 2 ? <CheckCircle2 size={12} aria-hidden="true" /> : etape === 1 ? <Loader size={12} className="animate-spin" aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}
            {STATUTS[etape]}
          </span>
        )}
      </div>
      {etape === 2 && (
        <p className="text-xs text-gray-600 mt-2">
          « Fait » veut dire <span className="font-semibold">prêt à relire</span> : rien n'est publié. Ouvrez « Mes MAJ » pour relire.
        </p>
      )}
    </FenetreMaquette>
  );
}

// ── 4. La phase 4 : titre et publication ─────────────────────────────────────
export function MaquettePublication() {
  const TITRE_ORIGINE = 'Comment bien choisir sa toiture';
  const [titre, setTitre] = useState(TITRE_ORIGINE);
  const [ouvert, setOuvert] = useState(false);
  const [dejaPublie, setDejaPublie] = useState(false);
  const [publie, setPublie] = useState(false);
  const modifie = titre !== TITRE_ORIGINE;

  return (
    <FenetreMaquette
      titre="Phase 4 — Relecture"
      legende="Modifiez le titre, ouvrez « Publier » : vous voyez ce qui partira, et ce qui ne partira pas."
    >
      <div role="tablist" aria-label="Vue" className="inline-flex rounded-xl bg-gray-100 p-1 text-xs mb-3">
        {['Audit', 'Avant', 'Après'].map((o) => (
          <span key={o} role="tab" aria-selected={o === 'Après'} className={`px-3 py-1 rounded-lg font-medium ${o === 'Après' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{o}</span>
        ))}
      </div>

      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-xs">
        <span className="text-[11px] font-medium text-gray-500">Titre</span>
        <input
          aria-label="Titre" value={titre} onChange={(e) => { setTitre(e.target.value); setPublie(false); }}
          className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs min-w-0"
        />
        {modifie && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">modifié</span>}
      </div>
      <p className="text-xs mt-2 text-gray-600">
        {modifie
          ? <>Ce titre <span className="font-semibold">sera envoyé</span> au site à la publication.</>
          : <>Titre inchangé : <span className="font-semibold">le titre actuel du site est conservé</span>.</>}
      </p>

      <div className="relative inline-block mt-4">
        <button
          type="button" aria-expanded={ouvert} onClick={() => setOuvert((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-black text-white text-xs font-medium px-4 py-2"
        >
          <Globe size={13} aria-hidden="true" /> Publier <ChevronDown size={12} aria-hidden="true" />
        </button>
        {ouvert && (
          <div className="mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-glass p-2 text-xs">
            <p className="px-3 py-2 font-medium text-gray-700 flex items-center gap-2"><Globe size={13} className="text-gray-400" aria-hidden="true" /> monsite.fr</p>
            {dejaPublie && (
              <p className="mx-2 mb-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-800">
                <CheckCircle2 size={12} className="inline mr-1 -mt-0.5" aria-hidden="true" /> Déjà publié
              </p>
            )}
            <button
              type="button" onClick={() => { setPublie(true); setOuvert(false); }}
              className="w-full flex items-center gap-2 rounded-lg bg-black text-white px-3 py-2 font-medium"
            >
              Publier sur le site <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-gray-500 mt-3">
        <input type="checkbox" checked={dejaPublie} onChange={(e) => setDejaPublie(e.target.checked)} />
        Simuler : un collègue a déjà publié cet article
      </label>
      {publie && (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mt-3">
          <CheckCircle2 size={15} aria-hidden="true" /> Article mis à jour sur monsite.fr !
        </p>
      )}
    </FenetreMaquette>
  );
}

// ── 5. Calculateur de coût et de durée (tutoriel admin) ──────────────────────
export const estimerLot = ({ articles, parallelisme }) => {
  const n = Math.max(0, Math.floor(Number(articles) || 0));
  const p = Math.max(1, Math.floor(Number(parallelisme) || 1));
  const vagues = Math.ceil(n / p);
  return {
    articles: n,
    coutUsd: Math.round(n * COUT_MOYEN_USD * 100) / 100,
    // Par vagues : p articles partent ensemble, la vague suivante attend la fin de
    // la précédente. Un lot de 5 articles à 4 en parallèle prend donc 2 vagues, pas 1,25.
    minutes: vagues * MINUTES_PAR_ARTICLE,
  };
};

export const formaterDuree = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round((h / 24) * 10) / 10} jours`;
};

export function MaquetteCalculateur() {
  const [articles, setArticles] = useState(100);
  const [parallelisme, setParallelisme] = useState(PARALLELISME_DEFAUT);
  const r = useMemo(() => estimerLot({ articles, parallelisme }), [articles, parallelisme]);
  return (
    <FenetreMaquette
      titre="Estimer un lot"
      legende={`Ordre de grandeur, d'après la moyenne mesurée en novembre 2026 : environ ${COUT_MOYEN_USD.toString().replace('.', ',')} $ et ${MINUTES_PAR_ARTICLE} minutes de traitement machine par article. Le coût varie avec la longueur de l'article.`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-700">
          Nombre d'articles : <span className="tabular-nums font-semibold">{articles}</span>
          <input
            type="range" min={1} max={1000} value={articles}
            onChange={(e) => setArticles(Number(e.target.value))}
            className="w-full mt-2" aria-label="Nombre d'articles"
          />
        </label>
        <label className="text-xs font-medium text-gray-700">
          Articles traités en parallèle : <span className="tabular-nums font-semibold">{parallelisme}</span>
          <input
            type="range" min={1} max={10} value={parallelisme}
            onChange={(e) => setParallelisme(Number(e.target.value))}
            className="w-full mt-2" aria-label="Articles traités en parallèle"
          />
        </label>
      </div>
      <dl className="grid grid-cols-2 gap-3 mt-4">
        <div className="rounded-xl bg-white border border-gray-200 px-4 py-3">
          <dt className="text-[11px] uppercase tracking-wide text-gray-400">Coût estimé</dt>
          <dd className="text-xl font-semibold text-gray-900 tabular-nums">≈ {r.coutUsd.toLocaleString('fr-FR')} $</dd>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 px-4 py-3">
          <dt className="text-[11px] uppercase tracking-wide text-gray-400">Traitement machine</dt>
          <dd className="text-xl font-semibold text-gray-900 tabular-nums">≈ {formaterDuree(r.minutes)}</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 text-[11px] text-gray-500 mt-3">
        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
        La relecture humaine s'ajoute ensuite. Le parallélisme réel se règle dans Paramètres → Traitement en lot (4 par défaut).
      </p>
    </FenetreMaquette>
  );
}
