// Badge — pastille de statut générique, extraite de LotsBatch.jsx (chantier
// "Mes MAJ") pour être partagée avec MajEnAttente.jsx sans dupliquer le style.
export default function Badge({ meta, fallback }) {
  const m = meta || { label: fallback || '—', color: 'text-gray-500 bg-gray-50 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${m.color}`}>
      {m.label}
    </span>
  );
}
