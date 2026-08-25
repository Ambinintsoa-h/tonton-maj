/**
 * RewritePanel — réécriture d'un passage sélectionné, sans quitter l'onglet.
 * Moteur Claude (clé de la plateforme — aucune configuration par membre,
 * remplace l'ancien flux Gemini qui exigeait une clé personnelle).
 *
 * « Valider » ne remplace pas le texte brutalement : le parent insère une
 * proposition del/mark (accepter ✓ / rejeter ✗), cohérente avec le flux de MAJ.
 * Les consignes personnalisées sont mémorisées : la dernière est proposée
 * automatiquement, les précédentes sont rappelables en un clic.
 */
import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Sparkles, X, Loader, RefreshCw, CheckCircle2, History } from 'lucide-react';
import { rewriteSelection } from '../../services/agent';
import { REWRITE_PRESETS, getRecentPrompts, rememberPrompt } from '../../services/rewrite';

export default function RewritePanel({ originalText, onValidate, onClose }) {
  const modelSelections = useSelector(s => s.settings.modelSelections) || null;
  const [presetId, setPresetId] = useState(REWRITE_PRESETS[0].id);
  const [recent, setRecent]     = useState(getRecentPrompts());
  // Le dernier prompt tapé est proposé d'office (demande équipe)
  const [custom, setCustom]     = useState(recent[0] || '');
  const [result, setResult]     = useState('');
  const [loading, setLoading]   = useState(false);

  const generate = useCallback(async () => {
    const preset = REWRITE_PRESETS.find(p => p.id === presetId) || REWRITE_PRESETS[0];
    const extra = custom.trim();
    const instruction = extra ? `${preset.prompt}\nConsigne supplémentaire : ${extra}` : preset.prompt;
    setLoading(true);
    try {
      const text = await rewriteSelection({ text: originalText, instruction, modelSelections });
      setResult(text);
      if (extra) { rememberPrompt(extra); setRecent(getRecentPrompts()); }
    } catch (e) {
      toast.error(e.message || 'Réécriture impossible — réessayez.');
    } finally {
      setLoading(false);
    }
  }, [presetId, custom, originalText, modelSelections]);

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* En-tête */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-white">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-violet-600 text-white"><Sparkles size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Réécrire la phrase</h2>
            <p className="text-[11px] text-gray-400">La proposition s'insérera en modification à accepter ✓ ou rejeter ✗</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Texte original */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Texte sélectionné</p>
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600 leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">{originalText}</div>
          </div>

          {/* Styles de réécriture */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Style de réécriture</p>
            <div className="flex flex-wrap gap-1.5">
              {REWRITE_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                    presetId === p.id
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text" value={custom} onChange={e => setCustom(e.target.value)}
              placeholder="Consigne supplémentaire (optionnelle) — ex. « garde le chiffre de 40 % »"
              className="mt-2 w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-violet-300"
            />
            {/* Consignes récentes mémorisées — rappel en un clic */}
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
                        ? 'bg-violet-50 text-violet-700 border-violet-200'
                        : 'bg-white text-gray-400 border-gray-200 hover:text-violet-600 hover:border-violet-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Résultat */}
          {(result || loading) && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1.5">Proposition</p>
              <div className="rounded-xl bg-violet-50/60 border-2 border-violet-200 px-4 py-3 text-xs text-gray-800 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                {loading ? <span className="flex items-center gap-2 text-violet-500"><Loader size={13} className="animate-spin" /> Réécriture en cours…</span> : result}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50/60">
          <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors">Annuler</button>
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40 transition-colors"
            >
              {result ? <><RefreshCw size={13} /> Régénérer</> : <><Sparkles size={13} /> Réécrire</>}
            </button>
            <button
              onClick={() => onValidate(result)}
              disabled={!result || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 shadow-sm transition-colors"
            >
              <CheckCircle2 size={13} /> Valider — remplacer la sélection
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
