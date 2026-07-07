/**
 * ConfirmDialog — garde-fou de suppression réutilisable (toute l'app).
 *
 * Deux niveaux :
 *   • simple (défaut)   : confirmation d'UN élément — « Supprimer ? » (Annuler / Supprimer)
 *   • definitive        : action de masse ou irréversible (« tout supprimer »,
 *     réinitialisation…) — thème rouge renforcé, mention « action irréversible »,
 *     bouton de confirmation désarmé pendant 2 s (anti double-clic réflexe).
 *
 * Rendu en portal (document.body) au-dessus de tout (zIndex 700). Échap ou clic
 * sur le fond = annuler.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirmer la suppression',
  message = '',
  confirmLabel = 'Supprimer',
  definitive = false,
}) {
  const [armed, setArmed] = useState(!definitive);

  // Désarmement temporaire du bouton pour les actions définitives
  useEffect(() => {
    if (!open) return undefined;
    setArmed(!definitive);
    if (definitive) {
      const t = setTimeout(() => setArmed(true), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, definitive]);

  // Échap = annuler
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 700 }}
      className="bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-6"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.35)] w-full max-w-sm p-6 text-center border-t-4 ${
          definitive ? 'border-red-500' : 'border-amber-400'
        }`}
      >
        <div className={`mx-auto w-11 h-11 rounded-2xl flex items-center justify-center mb-3 ${
          definitive ? 'bg-red-50' : 'bg-amber-50'
        }`}>
          {definitive
            ? <AlertTriangle size={20} className="text-red-500" />
            : <Trash2 size={19} className="text-amber-500" />}
        </div>
        <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
        {message && (
          <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">{message}</p>
        )}
        {definitive && (
          <p className="text-[11px] font-semibold text-red-500 mt-2 uppercase tracking-wide">
            Action irréversible
          </p>
        )}
        <div className="flex items-center justify-center gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!armed}
            onClick={() => { onConfirm(); onClose(); }}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
              definitive ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {definitive && !armed ? 'Patientez…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
