import { motion } from 'framer-motion';

/* ─── Brique de base ────────────────────────────────────────────────────────
   Un rectangle gris avec l'effet shimmer façon Facebook.
   w / h peuvent être une valeur Tailwind ("w-1/2") ou un style inline.
─────────────────────────────────────────────────────────────────────────── */
function Bone({ className = '', style = {} }) {
  return (
    <div
      className={`skeleton-bone rounded-xl ${className}`}
      style={style}
    />
  );
}

/* ─── Skeleton générique adapté au layout de l'appli ───────────────────── */
export default function PageSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-6"
    >
      {/* En-tête page */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-7 w-40" />
          <Bone className="h-4 w-60" />
        </div>
        <Bone className="h-9 w-28 rounded-xl" />
      </div>

      {/* Carte principale */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Bone className="h-10 w-10 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-5 w-48" />
            <Bone className="h-3.5 w-72" />
          </div>
          <Bone className="h-8 w-24 rounded-lg" />
        </div>

        <div className="h-px bg-gray-100 my-1" />

        <div className="space-y-3">
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-5/6" />
          <Bone className="h-4 w-4/6" />
        </div>
      </div>

      {/* Grille de 2 cartes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Bone className="h-8 w-8 rounded-lg flex-shrink-0" />
              <Bone className="h-4 w-32" />
            </div>
            <Bone className="h-3.5 w-full" />
            <Bone className="h-3.5 w-4/5" />
            <Bone className="h-3.5 w-3/5" />
            <div className="flex gap-2 pt-1">
              <Bone className="h-7 w-20 rounded-lg" />
              <Bone className="h-7 w-16 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Carte liste (rows) */}
      <div className="glass-card p-5 space-y-3">
        <Bone className="h-5 w-36" />
        <div className="h-px bg-gray-100" />
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 py-1">
            <Bone className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone style={{ height: 13, width: `${55 + i * 8}%` }} />
              <Bone style={{ height: 11, width: `${35 + i * 5}%` }} />
            </div>
            <Bone className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
