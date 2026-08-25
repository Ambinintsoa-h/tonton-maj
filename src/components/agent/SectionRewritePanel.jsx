/**
 * SectionRewritePanel — réécriture d'une SECTION ENTIÈRE (titre H2/H3/H4 cliqué
 * + tout son contenu jusqu'au prochain titre de même niveau ou supérieur).
 * Moteur Claude, même mémoire des consignes que RewritePanel (réutilisée).
 *
 * Contrairement à RewritePanel (texte brut, remplacement en del/mark à
 * accepter/rejeter), ici l'aperçu est du HTML rendu (structure conservée :
 * titres, paragraphes, listes, gras, liens…) et « Valider » REMPLACE
 * directement la section — l'undo maison (Ctrl+Z) reste disponible.
 */
import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Sparkles, X, Loader, RefreshCw, CheckCircle2, History } from 'lucide-react';
import { rewriteSection } from '../../services/agent';
import { REWRITE_PRESETS, getRecentPrompts, rememberPrompt } from '../../services/rewrite';

export default function SectionRewritePanel({ originalHtml, onValidate, onClose }) {
  const modelSelections = useSelector(s => s.settings.modelSelections) || null;
  const [presetId, setPresetId] = useState(REWRITE_PRESETS[0].id);
  const [recent, setRecent]     = useState(getRecentPrompts());
  const [custom, setCustom]     = useState(recent[0] || '');
  const [result, setResult]     = useState('');
  const [loading, setLoading]   = useState(false);

  const generate = useCallback(async () => {
    const preset = REWRITE_PRESETS.find(p => p.id === presetId) || REWRITE_PRESETS[0];
    const extra = custom.trim();
    const instruction = extra ? `${preset.prompt}\nConsigne supplémentaire : ${extra}` : preset.prompt;
    setLoading(true);
    try {
      const html = await rewriteSection({ html: originalHtml, instruction, modelSelections });
      setResult(html);
      if (extra) { rememberPrompt(extra); setRecent(getRecentPrompts()); }
    } catch (e) {
      toast.error(e.message || 'Réécriture impossible — réessayez.');
    } finally {
      setLoading(false);
    }
  }, [presetId, custom, originalHtml, modelSelections]);

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-white">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500 text-white"><Sparkles size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Réécrire cette section</h2>
            <p className="text-[11px] text-gray-400">Le titre et tout son contenu sont réécrits ensemble — « Valider » remplace la section (Ctrl+Z pour annuler)</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Section actuelle</p>
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-sm leading-relaxed max-h-52 overflow-y-auto md-content" dangerouslySetInnerHTML={{ __html: originalHtml }} />
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Style de réécriture</p>
            <div className="flex flex-wrap gap-1.5">
              {REWRITE_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                    presetId === p.id
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text" value={custom} onChange={e => setCustom(e.target.value)}
              placeholder="Consigne supplémentaire (optionnelle) — ex. « ajoute un exemple chiffré »"
              className="mt-2 w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300"
            />
            {recent.length > 0 && (
              <div className="mt-1.5 flex items-start gap-1.5 flex-wrap">
                <History size={11} className="text-gray-300 mt-1 shrink-0" />
                {recent.map(p => (
                  <button
                    key={p}
                    onClick={() => setCustom(p)}
                    title="Réutiliser cette consigne"
                    className={`max-w-[240px] truncate px-2 py-1 rounded-full text-[10px] border transition-colors ${
                      custom === p
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-white text-gray-400 border-gray-200 hover:text-amber-600 hover:border-amber-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(result || loading) && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-1.5">Proposition</p>
              <div className="rounded-xl bg-amber-50/60 border-2 border-amber-200 px-4 py-3 text-sm leading-relaxed max-h-64 overflow-y-auto md-content">
                {loading ? <span className="flex items-center gap-2 text-amber-600"><Loader size={13} className="animate-spin" /> Réécriture en cours…</span> : <div dangerouslySetInnerHTML={{ __html: result }} />}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50/60">
          <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors">Annuler</button>
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
            >
              {result ? <><RefreshCw size={13} /> Régénérer</> : <><Sparkles size={13} /> Réécrire</>}
            </button>
            <button
              onClick={() => onValidate(result)}
              disabled={!result || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 shadow-sm transition-colors"
            >
              <CheckCircle2 size={13} /> Valider — remplacer la section
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
