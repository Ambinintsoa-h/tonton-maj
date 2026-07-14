/**
 * ImageAltCaptionPanel — édition semi-automatique de l'ALT et de la légende
 * d'une image (image à la une ou image du corps de l'article).
 *
 * « Suggestion IA » pré-remplit les deux champs via Claude Vision ; l'équipe
 * reste libre de modifier ou vider chaque champ avant de valider.
 */
import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ImageIcon, X, Loader, Sparkles, CheckCircle2 } from 'lucide-react';
import { generateImageMeta } from '../../services/agent';

export default function ImageAltCaptionPanel({ imageUrl, initialAlt, initialCaption, apiKey, onValidate, onClose, captionIsVisible = true }) {
  const [alt, setAlt]         = useState(initialAlt || '');
  const [caption, setCaption] = useState(initialCaption || '');
  const [loading, setLoading] = useState(false);

  const suggest = useCallback(async () => {
    if (!apiKey) { toast.error('Clé API Anthropic requise — vérifiez les Paramètres.'); return; }
    setLoading(true);
    try {
      const { alt: sAlt, caption: sCaption } = await generateImageMeta(imageUrl, apiKey);
      if (!sAlt && !sCaption) { toast.error('Suggestion impossible — réessayez.'); return; }
      if (sAlt) setAlt(sAlt);
      if (sCaption) setCaption(sCaption);
    } finally {
      setLoading(false);
    }
  }, [imageUrl, apiKey]);

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-white">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-violet-600 text-white"><ImageIcon size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Alt / Légende de l'image</h2>
            <p className="text-[11px] text-gray-400">
              {captionIsVisible ? 'La légende s\'affichera sous l\'image publiée' : 'Légende enregistrée dans la médiathèque WP (non affichée dans l\'article)'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-2 flex items-center justify-center">
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img src={imageUrl} alt="Aperçu" className="max-h-40 rounded-lg object-contain" />
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 block">Texte ALT (accessibilité / SEO)</label>
            <input
              type="text" value={alt} onChange={e => setAlt(e.target.value)}
              placeholder="ex : Isolation thermique d'une toiture en laine de verre"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-violet-300"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 block">
              Légende ({captionIsVisible ? 'affichée sous l\'image' : 'caption médiathèque WP'} — optionnelle)
            </label>
            <textarea
              value={caption} onChange={e => setCaption(e.target.value)}
              placeholder="ex : Une toiture bien isolée réduit la facture énergétique de 30 %"
              rows={2}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-violet-300"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50/60">
          <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors">Annuler</button>
          <div className="flex items-center gap-2">
            <button
              onClick={suggest}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />} Suggestion IA
            </button>
            <button
              onClick={() => onValidate({ alt: alt.trim(), caption: caption.trim() })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-500 shadow-sm transition-colors"
            >
              <CheckCircle2 size={13} /> Valider
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
