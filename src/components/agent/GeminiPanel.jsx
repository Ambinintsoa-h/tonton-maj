/**
 * GeminiPanel — réécriture d'un passage sélectionné avec Gemini, sans quitter
 * l'onglet. gemini.google.com ne peut pas être iframé (X-Frame-Options Google) :
 * panneau natif TONTON alimenté par l'API Gemini, avec la clé PERSONNELLE de
 * l'utilisateur (compte Google → aistudio.google.com → « Get API key »),
 * stockée en local sur le poste.
 *
 * « Valider » ne remplace pas le texte brutalement : le parent insère une
 * proposition del/mark (accepter ✓ / rejeter ✗), cohérente avec le flux de MAJ.
 */
import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Sparkles, X, Loader, KeyRound, RefreshCw, CheckCircle2, ExternalLink } from 'lucide-react';
import { GEMINI_PRESETS, geminiRewrite, getGeminiKey, setGeminiKey } from '../../services/gemini';

export default function GeminiPanel({ originalText, onValidate, onClose }) {
  const [key, setKey]           = useState(getGeminiKey());
  const [keyInput, setKeyInput] = useState('');
  const [presetId, setPresetId] = useState(GEMINI_PRESETS[0].id);
  const [custom, setCustom]     = useState('');
  const [result, setResult]     = useState('');
  const [loading, setLoading]   = useState(false);

  const saveKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    setGeminiKey(k);
    setKey(k);
    toast.success('Clé Gemini enregistrée sur ce poste');
  };

  const generate = useCallback(async () => {
    const preset = GEMINI_PRESETS.find(p => p.id === presetId) || GEMINI_PRESETS[0];
    const instruction = custom.trim()
      ? `${preset.prompt}\nConsigne supplémentaire : ${custom.trim()}`
      : preset.prompt;
    setLoading(true);
    try {
      const text = await geminiRewrite({ key, text: originalText, instruction });
      setResult(text);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [key, presetId, custom, originalText]);

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
            <h2 className="text-sm font-semibold text-gray-900">Réécrire avec Gemini</h2>
            <p className="text-[11px] text-gray-400">La proposition s'insérera en modification à accepter ✓ ou rejeter ✗</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Clé absente → configuration en 30 s */}
          {!key && (
            <div className="rounded-xl border-2 border-violet-200 bg-violet-50/60 p-4 space-y-2.5">
              <p className="text-xs font-semibold text-violet-900 flex items-center gap-1.5"><KeyRound size={13} /> Connectez votre compte Gemini (une seule fois par poste)</p>
              <ol className="text-[11px] text-violet-800 list-decimal ml-4 space-y-0.5">
                <li>Ouvrez <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline font-medium">aistudio.google.com/apikey <ExternalLink size={9} className="inline -mt-0.5" /></a> et connectez-vous avec votre compte Google</li>
                <li>Cliquez « Créer une clé API » (gratuit) puis copiez la clé</li>
                <li>Collez-la ci-dessous — elle reste sur ce poste, jamais partagée</li>
              </ol>
              <div className="flex gap-2">
                <input
                  type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                  placeholder="Clé API Gemini (AIza…)"
                  className="flex-1 bg-white border border-violet-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                <button onClick={saveKey} disabled={!keyInput.trim()} className="px-3.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 disabled:opacity-40 transition-colors">
                  Enregistrer
                </button>
              </div>
            </div>
          )}

          {/* Texte original */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Texte sélectionné</p>
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600 leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">{originalText}</div>
          </div>

          {/* Prompts préfabriqués */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Style de réécriture</p>
            <div className="flex flex-wrap gap-1.5">
              {GEMINI_PRESETS.map(p => (
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
          </div>

          {/* Résultat */}
          {(result || loading) && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1.5">Proposition Gemini</p>
              <div className="rounded-xl bg-violet-50/60 border-2 border-violet-200 px-4 py-3 text-xs text-gray-800 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                {loading ? <span className="flex items-center gap-2 text-violet-500"><Loader size={13} className="animate-spin" /> Gemini réécrit…</span> : result}
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
              disabled={!key || loading}
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
