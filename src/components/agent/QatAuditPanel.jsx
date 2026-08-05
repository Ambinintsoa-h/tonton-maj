// Rendu de l'audit QAT (JSON) — onglet AUDIT en mode « Audit QAT + Refonte ».
// Le flux historique continue d'afficher son rapport markdown : ce panneau ne
// s'affiche que lorsque `auditJson` est présent.
import React from 'react';
import {
  Gauge, AlertTriangle, CheckCircle2, XCircle, Info, Tag, Trash2,
  Clock, Link2, ShieldCheck, Target, ListChecks,
} from 'lucide-react';

// ── Helpers d'affichage ───────────────────────────────────────────────────────

const scoreTone = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'text-gray-400';
  if (v >= 8) return 'text-emerald-600';
  if (v >= 6) return 'text-amber-600';
  if (v >= 4) return 'text-orange-600';
  return 'text-red-600';
};

const fmtScore = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(1) : '—');

const STATUS_ICON = {
  ok:              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />,
  warning:         <AlertTriangle size={13} className="text-amber-600 shrink-0" />,
  error:           <XCircle size={13} className="text-red-600 shrink-0" />,
  sourced:         <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />,
  vague:           <AlertTriangle size={13} className="text-amber-600 shrink-0" />,
  unsourced:       <XCircle size={13} className="text-red-600 shrink-0" />,
  provided:        <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />,
  to_define:       <AlertTriangle size={13} className="text-amber-600 shrink-0" />,
  verify_postpub:  <Info size={13} className="text-sky-600 shrink-0" />,
};

const PRIORITY_STYLE = {
  P1: 'bg-red-50 text-red-700 border-red-200',
  P2: 'bg-amber-50 text-amber-700 border-amber-200',
  P3: 'bg-gray-50 text-gray-600 border-gray-200',
};

const MOTIF_LABEL = {
  hors_sujet:         'Hors-sujet',
  doublon:            'Doublon',
  remplissage:        'Remplissage',
  artefact_technique: 'Artefact technique',
  plan_disperse:      'Plan dispersé',
};

const Section = ({ icon, title, count, children }) => (
  <div className="space-y-2">
    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
      {icon}
      {title}
      {count !== undefined && <span className="font-normal text-gray-300">({count})</span>}
    </h4>
    {children}
  </div>
);

const asArray = (v) => (Array.isArray(v) ? v : []);

// ── Panneau ───────────────────────────────────────────────────────────────────

const QatAuditPanel = ({ audit }) => {
  if (!audit) return null;

  const s = audit.scores || {};
  const qat = audit.qat_assessment || {};
  const ampleur = audit.ampleur || {};
  // Trois ampleurs possibles : le fond est en cause, le plan seul est en cause,
  // ou tout tient. Chacune a son code couleur pour être lue d'un coup d'œil.
  const AMPLEUR_UI = {
    refonte_totale:   { label: 'Refonte totale recommandée', hint: 'le fond est en cause', box: 'bg-orange-50 border-orange-200', title: 'text-orange-800', text: 'text-orange-700', icon: 'text-orange-600' },
    restructuration:  { label: 'Restructuration recommandée', hint: 'le fond tient, le plan est à refaire', box: 'bg-amber-50 border-amber-200', title: 'text-amber-800', text: 'text-amber-700', icon: 'text-amber-600' },
    maj_ciblee:       { label: 'MAJ ciblée recommandée', hint: 'le fond et le plan tiennent', box: 'bg-sky-50 border-sky-200', title: 'text-sky-800', text: 'text-sky-700', icon: 'text-sky-600' },
  };
  const amp = AMPLEUR_UI[ampleur.decision];
  const repo = audit.keyword_repositioning;
  const toRemove = asArray(audit.a_supprimer);
  const recent = audit.recent_context || {};

  return (
    <div className="space-y-6 text-sm">

      {/* ── Décision d'ampleur — la conclusion la plus structurante ─────────── */}
      {amp && (
        <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${amp.box}`}>
          <Target size={16} className={`shrink-0 mt-0.5 ${amp.icon}`} />
          <div className="min-w-0">
            <p className={`font-semibold ${amp.title}`}>
              {amp.label}
              <span className={`ml-1.5 text-xs font-normal ${amp.text}`}>— {amp.hint}</span>
            </p>
            {ampleur.justification && (
              <p className={`text-xs mt-0.5 ${amp.text}`}>{ampleur.justification}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Repositionnement du mot-clé cible ───────────────────────────────── */}
      {repo?.recommande && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 flex items-start gap-3">
          <Tag size={16} className="text-violet-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-violet-800">Mot-clé cible à repositionner</p>
            <p className="text-xs text-violet-700 mt-0.5">
              <span className="line-through opacity-70">{repo.actuel || '—'}</span>
              {' → '}
              <strong>{repo.recommande}</strong>
            </p>
            {repo.raison && <p className="text-xs text-violet-600 mt-1">{repo.raison}</p>}
          </div>
        </div>
      )}

      {/* ── Scores ──────────────────────────────────────────────────────────── */}
      <Section icon={<Gauge size={13} />} title="Scores">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            ['IA', s.ia], ['GEO', s.geo], ['SEO', s.seo],
            ['Citabilité', s.citability], ['Global', s.global],
          ].map(([label, v]) => (
            <div key={label} className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
              <p className={`text-lg font-semibold ${scoreTone(v)}`}>{fmtScore(v)}</p>
            </div>
          ))}
        </div>
        {Number.isFinite(Number(s.globalAttainable)) && (
          <p className="text-[11px] text-gray-400">
            Score atteignable après mise à jour : <strong className="text-gray-600">{fmtScore(s.globalAttainable)}/10</strong>
          </p>
        )}
        {s.justification && <p className="text-xs text-gray-500">{s.justification}</p>}
      </Section>

      {/* ── Résumé exécutif ─────────────────────────────────────────────────── */}
      {audit.executive_summary && (
        <Section icon={<Info size={13} />} title="Résumé exécutif">
          <p className="text-gray-600 leading-relaxed whitespace-pre-line">{audit.executive_summary}</p>
        </Section>
      )}

      {/* ── Framework QAT ───────────────────────────────────────────────────── */}
      {(qat.quality || qat.accuracy || qat.transparency) && (
        <Section icon={<ShieldCheck size={13} />} title="Framework QAT">
          <div className="space-y-2">
            {[
              ['Quality', qat.quality], ['Accuracy', qat.accuracy], ['Transparency', qat.transparency],
            ].filter(([, v]) => v).map(([label, v]) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                  <span className={`text-xs font-semibold ${scoreTone(v.score)}`}>{fmtScore(v.score)}/10</span>
                </div>
                {v.detail && <p className="text-xs text-gray-500 mt-1">{v.detail}</p>}
                {v.fanout_coverage && <p className="text-[11px] text-gray-400 mt-0.5">Fan-out : {v.fanout_coverage}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Actions prioritaires ────────────────────────────────────────────── */}
      {asArray(audit.priority_actions).length > 0 && (
        <Section icon={<ListChecks size={13} />} title="Actions prioritaires" count={audit.priority_actions.length}>
          <div className="space-y-1.5">
            {audit.priority_actions.map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[a.priority] || PRIORITY_STYLE.P3}`}>
                  {a.priority || 'P3'}
                </span>
                <div className="min-w-0">
                  <p className="text-gray-700 font-medium text-xs">{a.title}</p>
                  {a.detail && <p className="text-xs text-gray-500">{a.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Contenus à retirer ──────────────────────────────────────────────── */}
      {toRemove.length > 0 && (
        <Section icon={<Trash2 size={13} />} title="À retirer" count={toRemove.length}>
          <div className="space-y-1.5">
            {toRemove.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-600">
                  {MOTIF_LABEL[r.motif] || r.motif || '—'}
                </span>
                <div className="min-w-0">
                  <p className="text-gray-700 text-xs font-medium">{r.element}</p>
                  {r.detail && <p className="text-xs text-gray-500">{r.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Fraîcheur ───────────────────────────────────────────────────────── */}
      {asArray(audit.freshness_checks).length > 0 && (
        <Section icon={<Clock size={13} />} title="Fraîcheur" count={audit.freshness_checks.length}>
          <div className="space-y-1">
            {audit.freshness_checks.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                {STATUS_ICON[f.status] || <Info size={13} className="text-gray-400 shrink-0" />}
                <p className="text-xs text-gray-600 min-w-0">
                  <strong className="text-gray-700">{f.element}</strong>
                  {f.note ? ` — ${f.note}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Données obsolètes et développements manquants ───────────────────── */}
      {(asArray(recent.donnees_obsoletes).length > 0 || asArray(recent.developpements_manquants).length > 0) && (
        <Section icon={<AlertTriangle size={13} />} title="Contexte récent">
          {asArray(recent.donnees_obsoletes).map((d, i) => (
            <div key={`o${i}`} className="rounded-xl border border-red-100 bg-red-50/60 px-3 py-2">
              <p className="text-xs font-medium text-red-800">{d.element}</p>
              <p className="text-xs text-red-700">
                <span className="line-through opacity-70">{d.valeur_article}</span> → <strong>{d.valeur_actuelle}</strong>
              </p>
              {d.source && (
                <a href={d.source} target="_blank" rel="noopener noreferrer" className="text-[11px] text-red-600 underline break-all">
                  {d.source}
                </a>
              )}
            </div>
          ))}
          {asArray(recent.developpements_manquants).map((d, i) => (
            <div key={`d${i}`} className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2">
              <p className="text-xs font-medium text-sky-800">
                {d.sujet}
                {d.importance && <span className="ml-1.5 font-normal text-sky-500">({d.importance})</span>}
              </p>
              {d.description && <p className="text-xs text-sky-700">{d.description}</p>}
              {d.source && (
                <a href={d.source} target="_blank" rel="noopener noreferrer" className="text-[11px] text-sky-600 underline break-all">
                  {d.source}
                </a>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* ── Affirmations à sourcer ──────────────────────────────────────────── */}
      {asArray(audit.sources_check).length > 0 && (
        <Section icon={<ShieldCheck size={13} />} title="Affirmations à sourcer" count={audit.sources_check.length}>
          <div className="space-y-1">
            {audit.sources_check.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                {STATUS_ICON[c.status] || <Info size={13} className="text-gray-400 shrink-0" />}
                <p className="text-xs text-gray-600 min-w-0">
                  « {c.affirmation} »{c.note ? ` — ${c.note}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Checklist avant publication ─────────────────────────────────────── */}
      {asArray(audit.pre_pub_checklist).length > 0 && (
        <Section icon={<ListChecks size={13} />} title="Avant publication" count={audit.pre_pub_checklist.length}>
          <div className="space-y-1">
            {audit.pre_pub_checklist.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                {STATUS_ICON[c.status] || <Info size={13} className="text-gray-400 shrink-0" />}
                <p className="text-xs text-gray-600 min-w-0">
                  <strong className="text-gray-700">{c.item}</strong>
                  {c.recommended_value ? ` — ${c.recommended_value}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Maillage interne suggéré ────────────────────────────────────────── */}
      {asArray(audit.internal_linking?.liens_entrants).length > 0 && (
        <Section icon={<Link2 size={13} />} title="Liens internes suggérés" count={audit.internal_linking.liens_entrants.length}>
          <div className="space-y-1.5">
            {audit.internal_linking.liens_entrants.map((l, i) => (
              <div key={i} className="text-xs text-gray-600">
                <p><strong className="text-gray-700">Ancre :</strong> {l.ancre}</p>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline break-all">{l.url}</a>
                {l.contexte && <p className="text-gray-400">{l.contexte}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Listes simples ──────────────────────────────────────────────────── */}
      {[
        ['Manques SEO / GEO', audit.seo_geo_gaps],
        ['Recommandations EEAT', audit.eeat_recommendations],
        ['Recommandation stratégique', audit.strategic_recommendation],
      ].filter(([, arr]) => asArray(arr).length > 0).map(([title, arr]) => (
        <Section key={title} icon={<ListChecks size={13} />} title={title} count={arr.length}>
          <ul className="list-disc pl-5 space-y-0.5 text-xs text-gray-600">
            {arr.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}
          </ul>
        </Section>
      ))}
    </div>
  );
};

export default QatAuditPanel;
