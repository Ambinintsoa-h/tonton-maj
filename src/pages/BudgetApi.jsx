/**
 * BudgetApi — « Combien reste-t-il sur l'API Anthropic ? »
 *
 * Page distincte du Dashboard, qui reste inchangé : celui-ci compte des
 * articles et des coûts d'équipe, celle-ci suit une enveloppe. Le Dashboard ne
 * reçoit qu'un bandeau d'une ligne, pour qu'on voie le restant sans venir ici.
 *
 * ── CE QUE CETTE PAGE S'INTERDIT ───────────────────────────────────────────
 * Afficher un restant comme s'il venait d'Anthropic. Il n'en vient pas :
 * Anthropic n'expose aucun solde, le chiffre est une SOUSTRACTION entre des
 * recharges saisies à la main et une consommation mesurée. Trois réserves sont
 * donc écrites à l'écran, jamais en note de bas de page :
 *   — un solde antérieur à la première recharge n'est pas compté ;
 *   — les appels antérieurs à la migration n'ont pas leur cache facturé ;
 *   — l'état du dernier envoi d'alerte est affiché, échec compris.
 *
 * Cette dernière réserve est le cœur du dispositif. Tous les envois SMTP de ce
 * projet échouent EN SILENCE quand SMTP n'est pas configuré : une alerte qu'on
 * croit armée et qui ne partira jamais serait pire que pas d'alerte du tout.
 * Le bloc « Alerte » dit donc, AVANT tout franchissement, si elle peut partir.
 */
import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Wallet, AlertCircle, Loader, RefreshCw, Plus, Trash2, TrendingDown,
  CheckCircle2, MailWarning, MailCheck, Calendar, Cpu, Layers, Info,
} from 'lucide-react';
// Aucun calcul ici : la route sert le budget déjà calculé par
// `src/server/apiBudget.js`, le même module que celui dont dépend l'alerte.
// Cette page rend des nombres, elle n'en fabrique pas — voir l'en-tête de ce
// module pour le pourquoi.
const SEUIL_ALERTE_DEFAUT = 50;

// Forme d'un budget sans recharge — identique à ce que renvoie
// `calculerBudget` côté serveur, pour que le rendu n'ait pas à connaître deux
// formes différentes du même objet.
const VIDE = {
  aucuneRecharge: true, totalRecharge: 0, consomme: 0, restant: null, depuis: null,
  parJour: [], parModele: [], parFlux: [],
  appelsComptes: 0, lignesSansCache: 0, coutSansCache: 0, articles: 0,
};

const usd = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 100) return `$${v.toFixed(0)}`;
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
};
const fmtJour = (iso) => {
  if (!iso) return '—';
  const [a, m, j] = String(iso).slice(0, 10).split('-');
  return `${j}/${m}/${String(a).slice(2)}`;
};
const fmtDateHeure = (ms) => {
  if (!ms) return '—';
  try { return new Date(Number(ms)).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return '—'; }
};
const aujourdhui = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Libellés des sous-passes du registre IA (MODEL_PASSES, agent.js). Recopiés
// plutôt qu'importés : agent.js tire tout le moteur de génération derrière lui,
// et cette page n'a besoin que de douze chaînes de caractères.
const FLUX_LABELS = {
  audit_qat: 'Audit QAT',
  refonte: 'Refonte',
  obsolescence: 'Obsolescence',
  reecriture_passage: 'Réécriture — passage',
  reecriture_section: 'Réécriture — section',
  gras: 'Passe de gras',
  style: 'Passe de style',
  query_extraction: 'Extraction de requêtes',
  seo_meta: 'SEO meta',
  commentaire_reponse: 'Réponse commentaire',
  commentaire_tri: 'Tri des commentaires',
  commentaire_traduction: 'Traduction commentaire',
  inconnu: 'Non étiqueté',
};

const Kpi = ({ valeur, libelle, detail, accent = 'text-gray-900', icone: Icone }) => (
  <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3.5">
    <div className="flex items-center gap-1.5">
      {Icone && <Icone size={13} className="text-gray-300" />}
      <span className={`text-2xl font-semibold tabular-nums ${accent}`}>{valeur}</span>
    </div>
    <p className="text-[11px] font-medium text-gray-600 mt-0.5">{libelle}</p>
    {detail && <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{detail}</p>}
  </div>
);

// Barre proportionnelle au plus gros poste — une ventilation se lit d'un coup
// d'œil ou ne se lit pas.
const Barre = ({ part, teinte = 'bg-gray-800' }) => (
  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
    <div className={`h-full rounded-full ${teinte}`} style={{ width: `${Math.max(2, part * 100)}%` }} />
  </div>
);

export default function BudgetApi() {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [montant, setMontant] = useState('');
  const [date, setDate] = useState(aujourdhui());
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    setErreur(null);
    axios.get('/api/budget-api')
      .then((r) => setData(r.data))
      .catch((e) => {
        setData({ recharges: [], alertes: [], budget: VIDE });
        setErreur(e.response?.data?.error || 'Impossible de charger le budget.');
      });
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const b = data?.budget || VIDE;
  const proj = data?.projection || { parJour: 0, jours: null, joursEcoules: 0 };
  // Ce que le cron déciderait à cet instant, calculé côté serveur par la même
  // fonction que le cron lui-même.
  const etatAlerte = data?.alerte || { envoyer: false, motif: '—' };

  const derniereAlerte = (data?.alertes || [])[0] || null;
  const seuil = data?.seuil ?? SEUIL_ALERTE_DEFAUT;
  const bas = b.restant != null && b.restant < seuil;

  const ajouter = async (e) => {
    e.preventDefault();
    setEnvoi(true); setErreur(null);
    try {
      await axios.post('/api/budget-api/recharges', {
        amountUsd: Number(montant), rechargedOn: date, note: note.trim() || null,
      });
      setMontant(''); setNote('');
      charger();
    } catch (err) {
      setErreur(err.response?.data?.error || 'Enregistrement impossible.');
    } finally { setEnvoi(false); }
  };

  const supprimer = async (id) => {
    // Une recharge supprimée change le restant ET peut rallumer l'alerte :
    // on le demande, on ne le fait pas d'un clic distrait.
    if (!window.confirm('Supprimer cette recharge ? Le budget restant sera recalculé.')) return;
    try { await axios.delete(`/api/budget-api/recharges/${id}`); charger(); }
    catch (err) { setErreur(err.response?.data?.error || 'Suppression impossible.'); }
  };

  const maxJour = Math.max(1e-9, ...b.parJour.map((d) => d.usd));
  const maxModele = Math.max(1e-9, ...b.parModele.map((d) => d.usd));
  const maxFlux = Math.max(1e-9, ...b.parFlux.map((d) => d.usd));
  const derniersJours = b.parJour.slice(-30);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600">
          <Wallet size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">Budget API</h1>
          <p className="text-xs text-gray-400">
            Recharges saisies moins la consommation mesurée depuis la première — réservé aux super admins.
          </p>
        </div>
        {data && (
          <button
            onClick={() => { setData(null); charger(); }}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 rounded-xl px-3 py-2 transition-colors"
          >
            <RefreshCw size={12} /> Recharger
          </button>
        )}
      </div>

      {erreur && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" /> {erreur}
        </div>
      )}

      {data === null ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-16 justify-center">
          <Loader size={16} className="animate-spin" /> Chargement du budget…
        </div>
      ) : (
        <>
          {/* ── Le chiffre, et ses réserves ──────────────────────────────── */}
          {b.aucuneRecharge ? (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>
                Aucune recharge saisie — le budget restant ne peut pas être calculé, et l'alerte ne se déclenchera
                pas. Enregistrez la recharge du 10/11/2026 ci-dessous pour démarrer le suivi.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi
                valeur={usd(b.restant)}
                libelle="Budget restant (estimation)"
                detail={`sur ${usd(b.totalRecharge)} rechargés — seuil d'alerte ${usd(seuil)}`}
                accent={bas ? 'text-red-600' : 'text-gray-900'}
              />
              <Kpi
                icone={TrendingDown}
                valeur={usd(b.consomme)}
                libelle="Consommé"
                detail={`${b.appelsComptes.toLocaleString('fr-FR')} appels · ${b.articles.toLocaleString('fr-FR')} articles`}
              />
              <Kpi
                icone={Calendar}
                valeur={usd(proj.parJour)}
                libelle="Par jour en moyenne"
                detail={`sur ${proj.joursEcoules} jour(s) depuis le ${fmtJour(data.recharges[0]?.recharged_on)}`}
              />
              <Kpi
                valeur={proj.jours != null ? Math.floor(proj.jours).toLocaleString('fr-FR') : '—'}
                libelle="Jours avant épuisement"
                detail={proj.jours != null ? 'au rythme actuel' : 'pas assez de recul pour estimer'}
                accent={proj.jours != null && proj.jours < 14 ? 'text-red-600' : 'text-gray-900'}
              />
            </div>
          )}

          {/* ── L'alerte, et SURTOUT si elle peut partir ─────────────────── */}
          <div className={`rounded-2xl border px-4 py-3.5 ${
            data.smtpConfigure === false ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
            <div className="flex items-start gap-2.5">
              {data.smtpConfigure === false
                ? <MailWarning size={16} className="text-red-500 shrink-0 mt-0.5" />
                : <MailCheck size={16} className="text-emerald-500 shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm font-semibold text-gray-900">
                  Alerte e-mail sous {usd(seuil)}
                </p>

                {data.smtpConfigure === false ? (
                  <p className="text-xs text-red-700 leading-relaxed">
                    <strong>SMTP n'est pas configuré : aucune alerte ne partira.</strong> Les envois de ce projet
                    échouent sans message d'erreur — l'alerte serait tentée, puis perdue. Renseignez l'hôte,
                    l'utilisateur et le mot de passe SMTP dans Paramètres.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Destinataire(s) : <span className="font-medium text-gray-700">{(data.destinataires || []).join(', ') || '—'}</span>
                    {' · '}Une fois au franchissement du seuil, puis un rappel par semaine tant qu'aucune recharge
                    ne repasse au-dessus.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 pt-0.5">
                  <span>
                    État actuel :{' '}
                    <span className={`font-semibold ${etatAlerte.envoyer ? 'text-amber-600' : 'text-gray-700'}`}>
                      {etatAlerte.envoyer ? `alerte due (${etatAlerte.motif})` : etatAlerte.motif}
                    </span>
                  </span>
                  {derniereAlerte && (
                    <span>
                      Dernière tentative : {fmtDateHeure(derniereAlerte.sent_at)} —{' '}
                      <span className={`font-semibold ${
                        derniereAlerte.status === 'envoye' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {derniereAlerte.status === 'envoye' ? 'envoyée'
                          : derniereAlerte.status === 'smtp_absent' ? 'NON envoyée (SMTP absent)'
                            : 'ÉCHEC'}
                      </span>
                      {derniereAlerte.error && (
                        <span className="text-gray-400"> — {derniereAlerte.error}</span>
                      )}
                    </span>
                  )}
                  {!derniereAlerte && <span className="text-gray-400">Aucune alerte envoyée à ce jour.</span>}
                </div>
              </div>
            </div>
          </div>

          {/* ── Ce que le chiffre ne dit pas ─────────────────────────────── */}
          {!b.aucuneRecharge && (
            <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 leading-relaxed">
              <Info size={13} className="shrink-0 mt-0.5 text-gray-400" />
              <span>
                Estimation, pas un relevé : Anthropic n'expose aucun solde. Un montant qui restait <strong>avant</strong>{' '}
                le {fmtJour(data.recharges[0]?.recharged_on)} n'est pas compté — le restant réel peut donc être plus
                élevé, jamais plus bas.
                {b.lignesSansCache > 0 && (
                  <>
                    {' '}Par ailleurs, {b.lignesSansCache.toLocaleString('fr-FR')} appel(s) antérieurs à la migration
                    n'ont pas de tokens de cache enregistrés ({usd(b.coutSansCache)}) : leur coût de cache, facturé
                    1,25× à l'écriture, n'a pas pu être ajouté.
                  </>
                )}
              </span>
            </div>
          )}

          {/* ── Saisir une recharge ──────────────────────────────────────── */}
          <div className="bg-white border border-gray-100 rounded-2xl px-4 py-4 space-y-3">
            <p className="text-sm font-semibold text-gray-900">Enregistrer une recharge</p>
            <form onSubmit={ajouter} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-gray-600">Montant (USD)</label>
                <input
                  type="number" step="0.01" min="0.01" max="100000" required
                  value={montant} onChange={(e) => setMontant(e.target.value)}
                  placeholder="600"
                  className="w-32 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-300"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-gray-600">Date</label>
                <input
                  type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-300"
                />
              </div>
              <div className="space-y-1 flex-1 min-w-[180px]">
                <label className="text-[11px] font-medium text-gray-600">Note (facultatif)</label>
                <input
                  type="text" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Recharge console Anthropic"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-300"
                />
              </div>
              <button
                type="submit" disabled={envoi}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-900 text-white rounded-xl px-4 py-2.5 hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {envoi ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />} Enregistrer
              </button>
            </form>

            {data.recharges.length > 0 && (
              <div className="divide-y divide-gray-50 pt-1">
                {data.recharges.slice().reverse().map((r) => (
                  <div key={r.id} className="flex items-center gap-3 py-2 text-xs">
                    <span className="font-semibold tabular-nums text-gray-900 w-20">{usd(r.amount_usd)}</span>
                    <span className="text-gray-500 w-20">{fmtJour(r.recharged_on)}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-400">{r.note || '—'}</span>
                    <span className="text-gray-300 hidden md:inline truncate max-w-[180px]">{r.created_by || ''}</span>
                    <button
                      onClick={() => supprimer(r.id)}
                      title="Supprimer cette recharge"
                      className="text-gray-300 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Statistiques de consommation ─────────────────────────────── */}
          {!b.aucuneRecharge && b.appelsComptes > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              <div className="bg-white border border-gray-100 rounded-2xl px-4 py-4 space-y-2.5">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <Cpu size={14} className="text-gray-300" /> Par modèle
                </p>
                {b.parModele.map((m) => (
                  <div key={m.model} className="space-y-1">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="flex-1 min-w-0 truncate text-gray-600">{m.model}</span>
                      <span className="font-semibold tabular-nums text-gray-900">{usd(m.usd)}</span>
                      <span className="text-[10px] text-gray-400 tabular-nums w-16 text-right">
                        {m.appels.toLocaleString('fr-FR')} appels
                      </span>
                    </div>
                    <Barre part={m.usd / maxModele} teinte="bg-indigo-400" />
                  </div>
                ))}
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl px-4 py-4 space-y-2.5">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <Layers size={14} className="text-gray-300" /> Par flux
                </p>
                {b.parFlux.map((f) => (
                  <div key={f.flux} className="space-y-1">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="flex-1 min-w-0 truncate text-gray-600">{FLUX_LABELS[f.flux] || f.flux}</span>
                      <span className="font-semibold tabular-nums text-gray-900">{usd(f.usd)}</span>
                      <span className="text-[10px] text-gray-400 tabular-nums w-16 text-right">
                        {f.appels.toLocaleString('fr-FR')} appels
                      </span>
                    </div>
                    <Barre part={f.usd / maxFlux} teinte="bg-emerald-400" />
                  </div>
                ))}
              </div>

              <div className="md:col-span-2 bg-white border border-gray-100 rounded-2xl px-4 py-4 space-y-2.5">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <Calendar size={14} className="text-gray-300" /> Par jour
                  <span className="text-[10px] font-normal text-gray-400">
                    {b.parJour.length > 30 ? '(30 derniers jours consommés)' : ''}
                  </span>
                </p>
                {/* Les jours SANS consommation ne sont pas inventés à zéro : la
                    liste montre les jours où l'outil a tourné. Un calendrier
                    plein de zéros écraserait visuellement les vrais jours. */}
                <div className="flex items-end gap-1 h-24">
                  {derniersJours.map((d) => (
                    <div key={d.jour} className="flex-1 flex flex-col justify-end group relative" title={`${fmtJour(d.jour)} — ${usd(d.usd)}`}>
                      <div
                        className="bg-gray-800 rounded-t group-hover:bg-indigo-500 transition-colors"
                        style={{ height: `${Math.max(3, (d.usd / maxJour) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>{fmtJour(derniersJours[0]?.jour)}</span>
                  <span className="text-gray-500">Max {usd(maxJour)}</span>
                  <span>{fmtJour(derniersJours[derniersJours.length - 1]?.jour)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Journal des alertes ──────────────────────────────────────── */}
          {(data.alertes || []).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900">Journal des alertes</p>
              <div className="divide-y divide-gray-50">
                {data.alertes.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2 text-xs">
                    {a.status === 'envoye'
                      ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                      : <AlertCircle size={13} className="text-red-500 shrink-0" />}
                    <span className="text-gray-500 w-32 shrink-0">{fmtDateHeure(a.sent_at)}</span>
                    <span className="text-gray-700 w-28 shrink-0">
                      {a.kind === 'rappel' ? 'Rappel' : 'Franchissement'}
                    </span>
                    <span className="tabular-nums text-gray-900 w-16 shrink-0">{usd(a.remaining_usd)}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-400">
                      {a.status === 'envoye' ? (a.recipients || '') : (a.error || a.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
