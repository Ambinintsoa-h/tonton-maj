import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Globe, Plus, Trash2, Edit3, Save, X, CheckCircle2, XCircle, Loader } from 'lucide-react';
import { addSite, updateSite, removeSite } from '../store/slices/wordpressSlice';
import { saveWordPressSite, deleteWordPressSite } from '../services/firebase';
import { testWordPressConnection } from '../services/wordpress';

const EMPTY_SITE = { name: '', url: '', username: '', password: '' };

function SiteForm({ site, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_SITE, ...site });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setTestResult(null); };

  const handleTest = async () => {
    setTesting(true);
    const result = await testWordPressConnection(form);
    setTesting(false);
    setTestResult(result);
  };

  const handleSave = () => {
    if (!form.name || !form.url || !form.username || !form.password) {
      toast.error('Tous les champs sont requis');
      return;
    }
    onSave(form);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="glass-card p-6 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{site.id ? 'Modifier le site' : 'Nouveau site WordPress'}</h3>
        <button onClick={onCancel} className="btn-ghost p-1.5"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-600">Nom du site</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Mon site" className="input-glass" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-600">URL du site <span className="text-gray-400 font-normal">(page d'accueil)</span></label>
          <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://inigeek.fr/" className="input-glass" />
          <p className="text-xs text-gray-400">URL racine du site, pas l'URL de connexion</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-600">Identifiant WordPress</label>
          <input value={form.username} onChange={e => set('username', e.target.value)} placeholder="admin" className="input-glass" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-600">Mot de passe d'application</label>
          <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="xxxx xxxx xxxx xxxx" className="input-glass" />
          {site.id && !form.password && (
            <p className="text-xs text-amber-500 font-medium">⚠️ Mot de passe absent — veuillez le ressaisir pour le persister.</p>
          )}
          {!site.id && (
            <p className="text-xs text-gray-400">WordPress → Utilisateurs → Profil → Mots de passe d'application (bas de page)</p>
          )}
        </div>
      </div>

      {/* Test connection */}
      {testResult && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${testResult.success ? 'bg-sage-100 text-sage-500' : 'bg-red-50 text-red-600'}`}
        >
          {testResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {testResult.success ? 'Connexion réussie !' : `Erreur : ${testResult.error}`}
        </motion.div>
      )}

      <div className="flex gap-2 justify-between">
        <button onClick={handleTest} disabled={testing} className="btn-secondary">
          {testing ? <Loader size={14} className="animate-spin" /> : <Globe size={14} />}
          Tester la connexion
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-ghost">Annuler</button>
          <button onClick={handleSave} className="btn-primary">
            <Save size={14} />
            Enregistrer
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function WordPress() {
  const dispatch = useDispatch();
  const sites = useSelector(s => s.wordpress.sites);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const handleSave = async (site) => {
    if (firebaseReady) {
      try {
        const id = await saveWordPressSite(site);
        if (site.id) dispatch(updateSite({ ...site, id }));
        else dispatch(addSite({ ...site, id }));
      } catch {
        if (site.id) dispatch(updateSite(site));
        else dispatch(addSite({ ...site, id: Date.now().toString() }));
      }
    } else {
      if (site.id) dispatch(updateSite(site));
      else dispatch(addSite({ ...site, id: Date.now().toString() }));
    }
    toast.success('Site WordPress enregistré !');
    setEditing(null);
    setShowNew(false);
  };

  const handleDelete = async (id) => {
    if (firebaseReady) { try { await deleteWordPressSite(id); } catch {} }
    dispatch(removeSite(id));
    toast.success('Site supprimé');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WordPress</h1>
          <p className="text-sm text-gray-500 mt-1">Gérez vos sites pour la publication directe</p>
        </div>
        <button onClick={() => { setShowNew(true); setEditing(null); }} className="btn-primary">
          <Plus size={15} />
          Ajouter un site
        </button>
      </div>

      <AnimatePresence>
        {(showNew || editing) && (
          <SiteForm
            key={editing?.id || 'new'}
            site={editing || EMPTY_SITE}
            onSave={handleSave}
            onCancel={() => { setEditing(null); setShowNew(false); }}
          />
        )}
      </AnimatePresence>

      {sites.length > 0 ? (
        <motion.div layout className="grid gap-4">
          <AnimatePresence>
            {sites.map(site => (
              <motion.div
                key={site.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass-card p-5 flex items-center gap-4 group"
              >
                <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center flex-shrink-0">
                  <Globe size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{site.name}</p>
                  <p className="text-sm text-gray-500 truncate">{site.url}</p>
                  <p className="text-xs text-gray-400">{site.username}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditing(site); setShowNew(false); }} className="btn-ghost p-2">
                    <Edit3 size={15} />
                  </button>
                  <button onClick={() => handleDelete(site.id)} className="btn-ghost p-2 hover:text-red-500">
                    <Trash2 size={15} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : !showNew && (
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
    </div>
  );
}
