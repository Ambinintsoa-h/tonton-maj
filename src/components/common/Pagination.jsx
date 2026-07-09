import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE = 50; // Max de MAJ affichées par page (toutes les listes)

/**
 * Pagination commune (Historique, MAJ en attente, Archives, Temps équipe).
 * Client-side : le parent slice sa liste avec pageSlice(list, page).
 * Rien ne s'affiche si la liste tient sur une page.
 */
export const pageSlice = (list, page, perPage = PAGE_SIZE) =>
  list.slice((page - 1) * perPage, page * perPage);

export default function Pagination({ total, page, onPageChange, perPage = PAGE_SIZE }) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  if (pageCount <= 1) return null;

  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * perPage + 1;
  const to   = Math.min(current * perPage, total);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[11px] text-gray-400">
        {from}–{to} sur {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={13} /> Précédent
        </button>
        <span className="text-[12px] text-gray-500 px-2">
          Page <span className="font-semibold text-gray-700">{current}</span> / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Suivant <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}
