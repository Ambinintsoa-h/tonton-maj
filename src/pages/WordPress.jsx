import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Globe, Plus, Trash2, Save, X,
  CheckCircle2, XCircle, Loader, AlertTriangle,
  KeyRound, Link2, User, ChevronRight,
} from 'lucide-react';
import { addSite, updateSite, removeSite } from '../store/slices/wordpressSlice';
import { saveWordPressSite, deleteWordPressSite } from '../services/firebase';
import { testWordPressConnection } from '../services/wordpress';

const EMPTY_SITE = { name: '', url: '', username: '', password: '' };

// ── Calcul du statut d'un site ────────────────────────────────────────────────
const getSiteStatus = (site) => {
  const missing = [];
  if (!site.url)      missing.push({ key: 'url',      label: 'URL manquante',      icon: Link2 });
  if (!site.username) missing.push({ key: 'username', label: 'Identifiant manquant', icon: User });
  if (!site.password) missing.push({ key: 'password', label: 'Mot de passe app absent', icon: KeyRound });
  return missing;
};

// ── Dot de statut ─────────────────────────────────────────────────────────────
function StatusDot({ site }) {
  const missing = getSiteStatus(site);
  if (missing.length === 0)
    return <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" title="Tout est configuré" />;
  if (missing.some(m => m.key !== 'password'))
    return <span className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" title={missing.map(m => m.label).join(', ')} />;
  return <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" title="Mot de passe d'application absent" />;
}

// ── Panneau slide depuis la droite ────────────────────────────────────────────
function SitePanel({ site, onSave, onDelete, onClose }) {
  const isNew = !site.id;
  const [form, setForm]         = useState({ ...EMPTY_SITE, ...site });
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [showPwd, setShowPwd]   = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setTestResult(null); };

  const handleTest = async () => {
    if (!form.url || !form.username || !form.password) {
      toast.error('Renseignez URL, identifiant et mot de passe avant de tester');
      return;
    }
    setTesting(true);
    const result = await testWordPressConnection(form);
    setTesting(false);
    setTestResult(result);
  };

  const handleSave = async () => {
    if (!form.name || !form.url || !form.username || !form.password) {
      toast.error('Tous les champs sont requis');
      return;
    }
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const missing = getSiteStatus(site);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
        style={{ zIndex: 200 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
        style={{ zIndex: 201 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
          <div className="w-9 h-9 bg-black rounded-xl flex items-center justify-center flex-shrink-0">
            <Globe size={17} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900 truncate">
              {isNew ? 'Nouveau site WordPress' : (form.name || site.name)}
            </h2>
            {!isNew && (
              <p className="text-xs text-gray-400 truncate">{site.url}</p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost !p-1.5 text-gray-400 hover:text-gray-700 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Alertes manquants (site existant) */}
        {!isNew && missing.length > 0 && (
          <div className="px-6 pt-4 space-y-2">
            {missing.map(({ key, label, icon: Icon }) => (
              <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${key === 'password' ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                <Icon size={13} className="flex-shrink-0" />
                {label}
              </div>
            ))}
          </div>
        )}

        {/* Formulaire */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Nom du site</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Mon site"
              className="input-glass"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
              <Link2 size={11} className="text-gray-400" /> URL du site
            </label>
            <input
              value={form.url}
              onChange={e => set('url', e.target.value)}
              placeholder="https://monsite.fr/"
              className={`input-glass ${!form.url ? 'border-red-200' : ''}`}
            />
            <p className="text-xs text-gray-400">URL racine, pas l'URL de connexion</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
              <User size={11} className="text-gray-400" /> Identifiant WordPress
            </label>
            <input
              value={form.username}
              onChange={e => set('username', e.target.value)}
              placeholder="admin"
              className={`input-glass ${!form.username ? 'border-red-200' : ''}`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
              <KeyRound size={11} className="text-gray-400" /> Mot de passe d'application
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx"
                className={`input-glass pr-10 ${!form.password ? 'border-amber-200' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                {showPwd ? 'Masquer' : 'Voir'}
              </button>
            </div>
            {!form.password && (
              <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <AlertTriangle size={11} />
                {isNew ? 'WordPress → Utilisateurs → Profil → Mots de passe d\'application' : 'Ressaisir le mot de passe d\'application pour le persister'}
              </p>
            )}
          </div>

          {/* Résultat test */}
          <AnimatePresence>
            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}
              >
                {testResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                {testResult.success ? 'Connexion réussie !' : `Erreur : ${testResult.error}`}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 space-y-3">
          <div className="flex gap-2">
            <button onClick={handleTest} disabled={testing} className="btn-secondary flex-1">
              {testing ? <Loader size={14} className="animate-spin" /> : <Globe size={14} />}
              Tester la connexion
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              Enregistrer
            </button>
          </div>

          {/* Suppression */}
          {!isNew && (
            confirmDel ? (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <p className="text-xs text-red-600 flex-1">Supprimer définitivement ?</p>
                <button onClick={() => onDelete(site.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">Oui</button>
                <span className="text-gray-300">·</span>
                <button onClick={() => setConfirmDel(false)} className="text-xs text-gray-500">Non</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDel(true)}
                className="w-full text-xs text-gray-400 hover:text-red-500 transition-colors py-1"
              >
                Supprimer ce site
              </button>
            )
          )}
        </div>
      </motion.div>
    </>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function WordPress() {
  const dispatch      = useDispatch();
  const sites         = useSelector(s => s.wordpress.sites);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const [activePanel, setActivePanel] = useState(null); // site object ou 'new'

  const openNew  = () => setActivePanel({ ...EMPTY_SITE });
  const openSite = (site) => setActivePanel(site);
  const closePanel = () => setActivePanel(null);

  const handleSave = async (site) => {
    if (firebaseReady) {
      try {
        const id = await saveWordPressSite(site);
        if (site.id) dispatch(updateSite({ ...site, id }));
        else         dispatch(addSite({ ...site, id }));
      } catch {
        if (site.id) dispatch(updateSite(site));
        else         dispatch(addSite({ ...site, id: Date.now().toString() }));
      }
    } else {
      if (site.id) dispatch(updateSite(site));
      else         dispatch(addSite({ ...site, id: Date.now().toString() }));
    }
    toast.success('Site WordPress enregistré !');
    closePanel();
  };

  const handleDelete = async (id) => {
    if (firebaseReady) { try { await deleteWordPressSite(id); } catch {} }
    dispatch(removeSite(id));
    toast.success('Site supprimé');
    closePanel();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WordPress</h1>
          <p className="text-sm text-gray-500 mt-1">Gérez vos sites pour la publication directe</p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus size={15} />
          Ajouter un site
        </button>
      </div>

      {/* Légende statuts */}
      {sites.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Tout configuré</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Mot de passe manquant</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Infos critiques manquantes</span>
        </div>
      )}

      {/* Liste des sites */}
      {sites.length > 0 ? (
        <motion.div layout className="grid gap-3">
          <AnimatePresence>
            {sites.map(site => {
              const missing = getSiteStatus(site);
              return (
                <motion.div
                  key={site.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  onClick={() => openSite(site)}
                  className="glass-card px-5 py-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow group"
                >
                  {/* Icône */}
                  <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center flex-shrink-0 relative">
                    <Globe size={18} className="text-white" />
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 truncate">{site.name}</p>
                      <StatusDot site={site} />
                    </div>
                    <p className="text-sm text-gray-500 truncate">{site.url}</p>
                    <p className="text-xs text-gray-400">{site.username}</p>
                  </div>

                  {/* Chips manquants */}
                  {missing.length > 0 && (
                    <div className="hidden sm:flex flex-col gap-1 flex-shrink-0">
                      {missing.map(({ key, label, icon: Icon }) => (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${key === 'password' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-red-50 text-red-500 border border-red-100'}`}
                        >
                          <Icon size={9} />
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Flèche */}
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-gray-400"
        >
          <Globe size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucun site configuré</p>
          <p className="text-xs mt-1">Ajoutez un site WordPress pour publier directement</p>
        </motion.div>
      )}

      {/* Slide panel */}
      <AnimatePresence>
        {activePanel && (
          <SitePanel
            key={activePanel.id || 'new'}
            site={activePanel}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={closePanel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
