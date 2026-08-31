import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Save, CheckCircle2, AlertCircle, Loader, Monitor, Mic, Mail, TrendingUp, ExternalLink, Flame, Shield, Zap, AlertTriangle, Cpu, RotateCcw, FileSpreadsheet, RefreshCw } from 'lucide-react';
import axios from 'axios';
import { setSettings, setFirebaseReady } from '../store/slices/settingsSlice';
import { initFirebase, saveSettings } from '../services/firebase';
import { MODEL_PASSES } from '../services/agent';
import { recentAvgForPass, N_RECENTS } from '../utils/modelCosts';
import { syncGoogleSheetNow } from '../services/gsheetStaging';

// Groupes d'affichage — présentation uniquement, aucun impact sur le registre
// (MODEL_PASSES, agent.js) : juste pour rendre 12 lignes plates plus lisibles.
const MODEL_PASS_GROUPS = [
  { title: 'Génération d\'article', passes: ['audit_qat', 'refonte', 'obsolescence', 'gras', 'style', 'reecriture_passage', 'reecriture_section'] },
  { title: 'Tâches mécaniques',     passes: ['query_extraction', 'seo_meta'] },
  { title: 'Commentaires',          passes: ['commentaire_reponse', 'commentaire_tri', 'commentaire_traduction'] },
];

const fmtPrice = (p) => p ? `$${p.input.toFixed(2)} / $${p.output.toFixed(2)}` : null;

function SecretInput({ label, value, onChange, placeholder, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-glass pr-10"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

// Variante textarea de SecretInput -- pour la clé de compte de service Google
// (JSON multi-lignes, plusieurs Ko), même principe de masquage par défaut.
function SecretTextarea({ label, value, onChange, placeholder, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          spellCheck={false}
          className="input-glass pr-10 font-mono text-xs leading-relaxed"
          style={show ? undefined : { WebkitTextSecurity: 'disc', textSecurity: 'disc' }}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export default function Parametres() {
  const dispatch = useDispatch();
  const stored = useSelector(s => s.settings);
  const stats  = useSelector(s => s.stats);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingHaloscan, setTestingHaloscan] = useState(false);
  const [haloscanStatus, setHaloscanStatus] = useState(null);
  const [testingGsheet, setTestingGsheet] = useState(false);
  const [gsheetStatus, setGsheetStatus] = useState(null); // null | 'ok' | 'error'
  const [gsheetStatusDetail, setGsheetStatusDetail] = useState('');
  const [proxyStatus, setProxyStatus] = useState(null);
  const [checkingProxy, setCheckingProxy] = useState(false);
  // Catalogue de modèles (GET /api/models) — curated = testé par l'équipe
  // (prix exact), discovered = vu par l'API Anthropic mais non testé (prix
  // indicatif). Chargé une fois, pas dans le store settings : ce n'est pas
  // un réglage, juste des données de référence pour construire le sélecteur.
  const [modelCatalog, setModelCatalog] = useState({ curated: [], discovered: [], availability: {}, availabilityCheckedAt: null });
  const [loadingModels, setLoadingModels] = useState(true);
  // Synchronisation = test RÉEL de chaque modèle (un appel Anthropic par
  // modèle, voir POST /api/models/check-availability) — jamais déclenché seul,
  // toujours par un clic explicite : chaque test est facturé.
  const [syncingModels, setSyncingModels] = useState(false);
  // Panneau de test TEMPORAIRE du runner headless (Phase 1, chantier batch) —
  // voir /api/internal/run-article-pipeline.
  const [runnerUrl, setRunnerUrl] = useState('');
  const [runnerKeyword, setRunnerKeyword] = useState('');
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [runnerSteps, setRunnerSteps] = useState([]);
  const [runnerResult, setRunnerResult] = useState(null);

  const [form, setForm] = useState({
    anthropicKey:              stored.anthropicKey || '',
    useLocalProxy:             stored.useLocalProxy || false,
    braveKey:                  stored.braveKey || '',
    tavilyKey:                 stored.tavilyKey || '',
    groqKey:                   stored.groqKey || '',
    firebaseApiKey:            stored.firebaseConfig?.apiKey || '',
    firebaseAuthDomain:        stored.firebaseConfig?.authDomain || '',
    firebaseProjectId:         stored.firebaseConfig?.projectId || '',
    firebaseStorageBucket:     stored.firebaseConfig?.storageBucket || '',
    firebaseMessagingSenderId: stored.firebaseConfig?.messagingSenderId || '',
    firebaseAppId:             stored.firebaseConfig?.appId || '',
    smtpHost:  stored.smtpHost  || '',
    smtpPort:  stored.smtpPort  || 587,
    smtpUser:  stored.smtpUser  || '',
    smtpPass:  stored.smtpPass  || '',
    smtpFrom:    stored.smtpFrom    || '',
    defaultTicketAssigneeEmail: stored.defaultTicketAssigneeEmail || '',
    haloscanKey: stored.haloscanKey || '',
    googleSheetsServiceAccountJson: stored.googleSheetsServiceAccountJson || '',
    googleSheetsId: stored.googleSheetsId || '',
    modelSelections: stored.modelSelections || {},
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setModelSelection = (passId, model) =>
    setForm(f => ({ ...f, modelSelections: { ...f.modelSelections, [passId]: model } }));
  const resetModelSelection = (passId) =>
    setForm(f => {
      const next = { ...f.modelSelections };
      delete next[passId];
      return { ...f, modelSelections: next };
    });

  useEffect(() => {
    axios.get('/api/models')
      .then(r => setModelCatalog({
        curated: r.data?.curated || [],
        discovered: r.data?.discovered || [],
        availability: r.data?.availability || {},
        availabilityCheckedAt: r.data?.availabilityCheckedAt || null,
      }))
      .catch(() => {})
      .finally(() => setLoadingModels(false));
  }, []);

  // Un modèle qui a échoué au dernier test (429, introuvable, erreur) est
  // retiré du sélecteur — SAUF s'il est la sélection actuelle d'une passe :
  // le masquer là ferait afficher un <select> vide au lieu d'expliquer
  // pourquoi ce choix ne tient plus.
  const isUnavailable = (modelId) => modelCatalog.availability?.[modelId]?.ok === false;
  const unavailableCount = Object.values(modelCatalog.availability || {}).filter(v => v?.ok === false).length;

  const handleSyncModels = async () => {
    setSyncingModels(true);
    try {
      const r = await axios.post('/api/models/check-availability');
      const availability = r.data?.availability || {};
      setModelCatalog(c => ({ ...c, availability, availabilityCheckedAt: r.data?.checkedAt || Date.now() }));
      const failed = Object.values(availability).filter(v => v?.ok === false).length;
      if (failed > 0) toast.error(`${failed} modèle(s) indisponible(s) retiré(s) du sélecteur`);
      else toast.success('Tous les modèles répondent');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Test de disponibilité échoué');
    }
    setSyncingModels(false);
  };

  // Test TEMPORAIRE du runner headless (Phase 1) — POST /api/internal/run-article-pipeline.
  // Requête bloquante côté client : le run complet peut prendre plusieurs
  // minutes (4 passes IA), comme une génération lancée depuis l'UI normale.
  const handleRunPipelineTest = async () => {
    setRunnerBusy(true);
    setRunnerSteps([]);
    setRunnerResult(null);
    try {
      const r = await axios.post('/api/internal/run-article-pipeline', {
        articleUrl: runnerUrl,
        targetKeyword: runnerKeyword,
      }, { timeout: 16 * 60 * 1000 });
      setRunnerSteps(r.data?.steps || []);
      setRunnerResult(r.data);
      if (r.data?.ok) toast.success('Pipeline terminé — article en attente de relecture.');
      else toast.error(r.data?.error || 'Le pipeline a échoué');
    } catch (e) {
      setRunnerResult(e.response?.data || { ok: false, error: e.message });
      toast.error(e.response?.data?.error || e.message);
    }
    setRunnerBusy(false);
  };

  // Test Google Sheets -- contrairement à Haloscan, il n'y a pas de route de
  // test "à blanc" : le compte de service doit d'abord être enregistré côté
  // serveur (data/settings.json) pour que la lecture Sheets s'authentifie.
  // On sauvegarde donc le formulaire AVANT de lancer une synchronisation
  // réelle -- qui, comme le bouton "Synchroniser maintenant" de /lots, ne
  // fait que DÉTECTER des lignes neuves, jamais les lancer.
  const handleTestGsheet = async () => {
    if (!form.googleSheetsServiceAccountJson || !form.googleSheetsId) {
      toast.error('Renseigne la clé de compte de service et l\'identifiant du Sheet d\'abord');
      return;
    }
    setTestingGsheet(true);
    setGsheetStatus(null);
    try {
      await handleSave();
      const result = await syncGoogleSheetNow();
      setGsheetStatus('ok');
      setGsheetStatusDetail(`${result.scanned} ligne(s) lue(s), ${result.inserted} nouvelle(s)`);
      toast.success('Google Sheet connecté !');
    } catch (e) {
      setGsheetStatus('error');
      const detail = e.message || '';
      setGsheetStatusDetail(detail);
      toast.error(`Google Sheet inaccessible — ${detail || 'vérifie la clé et l\'identifiant'}`);
    }
    setTestingGsheet(false);
  };

  // Prix d'un modèle : exact (LiteLLM, modelPricing) s'il est curated, sinon
  // indicatif (déjà porté par l'entrée `discovered`), sinon rien à afficher.
  const priceForModel = (modelId) => {
    if (modelCatalog.curated.includes(modelId) && stored.modelPricing?.[modelId]) {
      return { ...stored.modelPricing[modelId], indicative: false };
    }
    const found = modelCatalog.discovered.find(m => m.id === modelId);
    return found?.indicativePricing ? { ...found.indicativePricing, indicative: true } : null;
  };

  const buildFirebaseConfig = () => ({
    apiKey:            form.firebaseApiKey,
    authDomain:        form.firebaseAuthDomain,
    projectId:         form.firebaseProjectId,
    storageBucket:     form.firebaseStorageBucket,
    messagingSenderId: form.firebaseMessagingSenderId,
    appId:             form.firebaseAppId,
  });

  const handleTestProxy = async () => {
    setCheckingProxy(true);
    try {
      // URL relative : en dev CRA la redirige vers localhost:3001 (champ "proxy"
      // de package.json), en prod elle teste le serveur même — aucune violation
      // CSP/mixed content contrairement à l'ancien http://localhost:3001/health.
      await axios.get('/health', { timeout: 3000 });
      setProxyStatus('ok');
      toast.success('Proxy actif !');
    } catch {
      setProxyStatus('error');
      toast.error('Proxy non joignable — lance d\'abord : node proxy.js');
    }
    setCheckingProxy(false);
  };

  const handleTestFirebase = async () => {
    if (!form.firebaseProjectId) { toast.error('Project ID Firebase requis'); return; }
    setTesting(true);
    const config = buildFirebaseConfig();
    const ok = initFirebase(config);
    setTesting(false);
    if (ok) {
      dispatch(setFirebaseReady(true));
      toast.success('Firebase connecté !');
    } else {
      toast.error('Erreur Firebase — vérifiez la configuration');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const firebaseConfig = buildFirebaseConfig();
    const newSettings = {
      anthropicKey:  form.useLocalProxy ? 'local' : form.anthropicKey,
      useLocalProxy: form.useLocalProxy,
      braveKey:      form.braveKey,
      tavilyKey:     form.tavilyKey,
      groqKey:       form.groqKey,
      firebaseConfig,
      smtpHost:    form.smtpHost,
      smtpPort:    Number(form.smtpPort) || 587,
      smtpUser:    form.smtpUser,
      smtpPass:    form.smtpPass,
      smtpFrom:    form.smtpFrom,
      defaultTicketAssigneeEmail: form.defaultTicketAssigneeEmail,
      haloscanKey: form.haloscanKey,
      googleSheetsServiceAccountJson: form.googleSheetsServiceAccountJson,
      googleSheetsId: form.googleSheetsId,
      modelSelections: form.modelSelections,
    };

    // 1. Init Firebase si config fournie
    if (firebaseConfig.apiKey && firebaseConfig.projectId) {
      const ok = initFirebase(firebaseConfig);
      dispatch(setFirebaseReady(ok));
      if (ok) { try { await saveSettings(newSettings); } catch {} }
    }

    // 2. Sauvegarde côté serveur (partagée entre tous les membres de l'équipe)
    try {
      await axios.post('/api/settings', newSettings);
    } catch (e) {
      toast.error('Erreur sauvegarde serveur : ' + (e.response?.data?.error || e.message));
      setSaving(false);
      return;
    }

    // 3. Mise à jour du store Redux + cache localStorage (firebaseConfig seulement)
    dispatch(setSettings(newSettings));
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ firebaseConfig }));

    setSaving(false);
    toast.success('Paramètres enregistrés pour toute l\'équipe !');
  };

  // Détection automatique du proxy au chargement — POSTE DE DEV uniquement
  // (en prod le ping localhost échouait en polluant la console : CSP + mixed
  // content ; le comportement prod reste inchangé — mode aiConfigured).
  useEffect(() => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    axios.get('http://localhost:3001/health', { timeout: 2000 })
      .then(() => {
        setProxyStatus('ok');
        setForm(f => ({ ...f, useLocalProxy: true }));
        dispatch(setSettings({ anthropicKey: 'local', useLocalProxy: true }));
        localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
          ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}'),
          anthropicKey: 'local',
          useLocalProxy: true,
        }));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronise le formulaire depuis le store Redux quand les settings sont chargés
  // (SettingsLoader les récupère du serveur après authentification)
  useEffect(() => {
    setForm(f => ({
      ...f,
      anthropicKey:              stored.anthropicKey === 'local' ? '' : (stored.anthropicKey || ''),
      useLocalProxy:             stored.useLocalProxy || false,
      braveKey:                  stored.braveKey || '',
      tavilyKey:                 stored.tavilyKey || '',
      groqKey:                   stored.groqKey || '',
      firebaseApiKey:            stored.firebaseConfig?.apiKey || '',
      firebaseAuthDomain:        stored.firebaseConfig?.authDomain || '',
      firebaseProjectId:         stored.firebaseConfig?.projectId || '',
      firebaseStorageBucket:     stored.firebaseConfig?.storageBucket || '',
      firebaseMessagingSenderId: stored.firebaseConfig?.messagingSenderId || '',
      firebaseAppId:             stored.firebaseConfig?.appId || '',
      smtpHost:    stored.smtpHost    || '',
      smtpPort:    stored.smtpPort    || 587,
      smtpUser:    stored.smtpUser    || '',
      smtpPass:    stored.smtpPass    || '',
      smtpFrom:    stored.smtpFrom    || '',
      defaultTicketAssigneeEmail: stored.defaultTicketAssigneeEmail || '',
      haloscanKey: stored.haloscanKey || '',
      googleSheetsServiceAccountJson: stored.googleSheetsServiceAccountJson || '',
      googleSheetsId: stored.googleSheetsId || '',
      modelSelections: stored.modelSelections || {},
    }));
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-sm text-gray-500 mt-1">Configuration des clés API et services</p>
      </div>

      {/* Proxy local Claude Desktop */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-900 rounded-xl flex items-center justify-center">
            <Monitor size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Proxy local (Claude Desktop)</h2>
            <p className="text-xs text-gray-400">Utilise les tokens de ta session Claude Code — aucune clé API requise</p>
          </div>
          {proxyStatus === 'ok' && <CheckCircle2 size={16} className="text-sage-400" />}
          {proxyStatus === 'error' && <AlertCircle size={16} className="text-red-400" />}
        </div>

        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-800">Activer le proxy local</p>
            <p className="text-xs text-gray-400 mt-0.5">Désactive la clé API Anthropic au profit du proxy</p>
          </div>
          <button
            onClick={() => set('useLocalProxy', !form.useLocalProxy)}
            role="switch"
            aria-checked={form.useLocalProxy}
            className={`relative inline-flex w-11 h-6 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${form.useLocalProxy ? 'bg-black' : 'bg-gray-200'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${form.useLocalProxy ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {form.useLocalProxy && (
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500">Pour activer le proxy :</p>
              <p className="text-xs text-gray-600 font-mono bg-white rounded-lg px-3 py-2 border border-gray-100">
                node proxy.js
              </p>
              <p className="text-xs text-gray-400">Lance cette commande dans un terminal depuis le dossier du projet, puis laisse-le ouvert.</p>
            </div>
            <button onClick={handleTestProxy} disabled={checkingProxy} className="btn-secondary text-xs">
              {checkingProxy ? <Loader size={13} className="animate-spin" /> : <Monitor size={13} />}
              Vérifier que le proxy est actif
            </button>
          </div>
        )}
      </motion.div>

      {/* Anthropic */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`glass-card p-6 space-y-5 transition-opacity duration-200 ${form.useLocalProxy ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-3">
          {/* Anthropic logo — stylisé */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#191919' }}>
            <svg viewBox="0 0 24 24" fill="white" className="w-[18px] h-[18px]">
              <path d="M17.32 3H14.2L12 8.8 9.8 3H6.68L11 13.82h2L17.32 3zM6 21h2.8l1.2-3h4l1.2 3H18l-5-12.5h-2L6 21zm5.1-5.3 1.4-3.5 1.4 3.5h-2.8z"/>
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Anthropic Claude</h2>
            <p className="text-xs text-gray-400">API pour l'agent IA (déploiement équipe)</p>
          </div>
          {stored.anthropicKey && stored.anthropicKey !== 'local' && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>
        <SecretInput
          label="Clé API Anthropic"
          value={form.anthropicKey}
          onChange={v => set('anthropicKey', v)}
          placeholder="sk-ant-..."
          hint="Trouvez votre clé sur console.anthropic.com"
        />
      </motion.div>

      {/* Gestion des modèles IA — un modèle par passe du registre (MODEL_PASSES, agent.js) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Cpu size={16} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Gestion des modèles IA</h2>
            <p className="text-xs text-gray-400">Quel modèle Claude pour chaque passe — coût mesuré sur les {N_RECENTS} derniers articles</p>
          </div>
          {loadingModels && <Loader size={15} className="animate-spin text-gray-400 ml-auto" />}
          <button
            type="button"
            onClick={handleSyncModels}
            disabled={syncingModels || loadingModels}
            className="btn-secondary text-xs ml-auto"
            title="Teste chaque modèle avec un appel Anthropic réel (coût minime) et retire ceux qui ne répondent pas du sélecteur"
          >
            {syncingModels
              ? <><Loader size={13} className="animate-spin" /> Test en cours...</>
              : <><RotateCcw size={13} /> Synchroniser</>}
          </button>
        </div>
        {modelCatalog.availabilityCheckedAt && (
          <p className="text-xs text-gray-400 -mt-3">
            Dernière synchro : {new Date(modelCatalog.availabilityCheckedAt).toLocaleString('fr-FR')}
            {unavailableCount > 0 && <span className="text-amber-600 font-medium"> · {unavailableCount} modèle(s) indisponible(s) retiré(s)</span>}
          </p>
        )}

        {MODEL_PASS_GROUPS.map(group => (
          <div key={group.title} className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group.title}</p>
            <div className="space-y-2">
              {group.passes.map(passId => {
                const entry = MODEL_PASSES[passId];
                if (!entry) return null;
                const current = form.modelSelections[passId] || entry.model;
                const price = priceForModel(current);
                const recent = recentAvgForPass(stats.history, passId);
                const isOverridden = !!form.modelSelections[passId];
                const isDiscovered = !modelCatalog.curated.includes(current);
                return (
                  <div key={passId} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                        {entry.label}
                        {isDiscovered && !loadingModels && (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 rounded-full px-1.5 py-0.5">non testé</span>
                        )}
                        {isUnavailable(current) && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5" title={modelCatalog.availability[current]?.message || ''}>
                            indisponible ({modelCatalog.availability[current]?.reason === 'rate_limited' ? 'limite atteinte' : modelCatalog.availability[current]?.reason === 'not_found' ? 'introuvable' : 'erreur'})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">
                        {price ? `${fmtPrice(price)} /Mtok${price.indicative ? ' (indicatif)' : ''}` : 'Prix inconnu'}
                        {recent && ` · ~$${recent.avg.toFixed(4)}/article (${recent.n})`}
                      </p>
                    </div>
                    <select
                      value={current}
                      onChange={e => setModelSelection(passId, e.target.value)}
                      className="input-glass text-xs w-56 flex-shrink-0"
                    >
                      <optgroup label="Testés par l'équipe">
                        {/* Un modèle qui a échoué au dernier test reste visible UNIQUEMENT
                            s'il est la sélection actuelle — sinon le <select> se viderait
                            silencieusement au lieu d'expliquer pourquoi ce choix ne tient plus. */}
                        {modelCatalog.curated.filter(id => id === current || !isUnavailable(id)).map(id => (
                          <option key={id} value={id}>{id}{id === entry.model ? ' (défaut)' : ''}{isUnavailable(id) ? ' — indisponible' : ''}</option>
                        ))}
                      </optgroup>
                      {modelCatalog.discovered.length > 0 && (
                        <optgroup label="Découverts (non testés)">
                          {modelCatalog.discovered.filter(m => m.id === current || !isUnavailable(m.id)).map(m => (
                            <option key={m.id} value={m.id}>{m.displayName}{isUnavailable(m.id) ? ' — indisponible' : ''}</option>
                          ))}
                        </optgroup>
                      )}
                      {/* Valeur actuelle absente des deux listes (catalogue pas encore chargé,
                          ou modèle retiré côté Anthropic depuis) — jamais masquée en silence. */}
                      {!modelCatalog.curated.includes(current) && !modelCatalog.discovered.some(m => m.id === current) && (
                        <option value={current}>{current} (actuel, non vérifié)</option>
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => resetModelSelection(passId)}
                      disabled={!isOverridden}
                      title="Revenir au modèle par défaut de cette passe"
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-0 flex-shrink-0"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
          Un modèle « découvert » n'a pas été testé avec les prompts de cette appli (raisonnement, longueur de réponse…) — le prix affiché est indicatif, pas garanti pour ce modèle précis.
        </div>
      </motion.div>

      {/* Runner headless (Phase 1, chantier batch GSheet) — panneau de VÉRIFICATION
          TEMPORAIRE. À retirer une fois le vrai flux batch câblé (phases suivantes) :
          il n'existe que pour lancer /api/internal/run-article-pipeline sur un
          article réel et comparer le résultat au comportement de l'UI. */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }} className="glass-card p-6 space-y-4 border-2 border-dashed border-purple-300">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Runner headless — test interne (temporaire)</h2>
            <p className="text-xs text-gray-400">Lance le pipeline complet (Audit → Génération → Obsolescence → Relecture) sur un article réel, sans navigateur. Coût réel. Ne publie jamais.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            value={runnerUrl}
            onChange={e => setRunnerUrl(e.target.value)}
            placeholder="https://exemple.fr/article"
            className="input-glass text-sm"
          />
          <input
            type="text"
            value={runnerKeyword}
            onChange={e => setRunnerKeyword(e.target.value)}
            placeholder="mot-clé cible"
            className="input-glass text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleRunPipelineTest}
          disabled={runnerBusy || !runnerUrl || !runnerKeyword}
          className="btn-secondary text-xs"
        >
          {runnerBusy ? <Loader size={13} className="animate-spin" /> : <Zap size={13} />}
          {runnerBusy ? 'En cours (plusieurs minutes)...' : 'Lancer le pipeline'}
        </button>
        {runnerSteps.length > 0 && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-600 space-y-1 max-h-48 overflow-y-auto">
            {runnerSteps.map((s, i) => <p key={i}>{s}</p>)}
          </div>
        )}
        {runnerResult && (
          <pre className="bg-gray-900 text-gray-100 rounded-xl px-4 py-3 text-xs overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(runnerResult, null, 2)}
          </pre>
        )}
      </motion.div>

      {/* Brave Search */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          {/* Brave logo — lion/shield */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#FB542B' }}>
            <Shield size={17} className="text-white" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Brave Search</h2>
            <p className="text-xs text-gray-400">Recherche de sources fiables (optionnel)</p>
          </div>
          {stored.braveKey && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>
        <SecretInput
          label="Clé API Brave Search"
          value={form.braveKey}
          onChange={v => set('braveKey', v)}
          placeholder="BSA..."
          hint="api.search.brave.com — plan gratuit disponible (2000 req/mois)"
        />
        {!form.braveKey && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-600">
            <AlertCircle size={14} />
            <span>Sans Brave, l'agent utilisera Tavily (si configuré) ou SearXNG/Jina gratuitement.</span>
          </div>
        )}
      </motion.div>

      {/* Tavily Search */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          {/* Tavily logo */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1E40AF, #3B82F6)' }}>
            <svg viewBox="0 0 24 24" fill="white" className="w-[17px] h-[17px]">
              <path d="M13 3L4 14h7l-2 7 11-11h-7l2-7z"/>
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Tavily Search</h2>
            <p className="text-xs text-gray-400">Recherche IA — retourne le contenu complet des pages (optionnel)</p>
          </div>
          {stored.tavilyKey && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>
        <SecretInput
          label="Clé API Tavily"
          value={form.tavilyKey}
          onChange={v => set('tavilyKey', v)}
          placeholder="tvly-..."
          hint="tavily.com — 1 000 req/mois gratuites · conçu pour agents IA · retourne le contenu réel des pages"
        />
        <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-500 leading-relaxed space-y-1">
          <p className="font-medium text-gray-700">Avantage Tavily vs Brave</p>
          <p>Tavily retourne le <strong>contenu complet</strong> des pages (pas seulement les snippets de 150 caractères). L'agent peut lire les prix, statistiques et faits directement sans scraping supplémentaire → mises à jour plus précises.</p>
          <p>Sans aucune clé, l'agent utilise automatiquement <strong>SearXNG</strong> (méta-moteur gratuit) et <strong>Jina Search</strong> en cascade.</p>
        </div>
      </motion.div>

      {/* Groq Whisper — Transcription vidéo */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          {/* Groq logo */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#F55036' }}>
            <svg viewBox="0 0 24 24" fill="white" className="w-[18px] h-[18px]">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Groq Whisper — Transcription vidéo</h2>
            <p className="text-xs text-gray-400">Transcrit vos vidéos en texte pour la base de connaissances (gratuit)</p>
          </div>
          {stored.groqKey && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>
        <SecretInput
          label="Clé API Groq"
          value={form.groqKey}
          onChange={v => set('groqKey', v)}
          placeholder="gsk_..."
          hint="Compte gratuit sur console.groq.com — 2 h de transcription/jour · whisper-large-v3-turbo · français natif"
        />
        <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-700">Comment ça marche ?</p>
          <p>Tu uploades une vidéo depuis <strong>Skills IA → Transcripteur</strong>. Le proxy local la transcrit via Groq Whisper (gratuit, français natif) et l'ajoute automatiquement à la base de connaissances. Limite : <strong>25 Mo par fichier</strong>.</p>
        </div>
      </motion.div>

      {/* Firebase */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          {/* Firebase logo — flamme */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #FFA000, #F57C00)' }}>
            <Flame size={18} className="text-white" strokeWidth={2} />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Firebase</h2>
            <p className="text-xs text-gray-400">Persistance des skills, articles et sites WordPress</p>
          </div>
          {stored.firebaseReady && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'firebaseApiKey',            label: 'API Key',              placeholder: 'AIza...' },
            { key: 'firebaseAuthDomain',         label: 'Auth Domain',          placeholder: 'projet.firebaseapp.com' },
            { key: 'firebaseProjectId',          label: 'Project ID',           placeholder: 'mon-projet' },
            { key: 'firebaseStorageBucket',      label: 'Storage Bucket',       placeholder: 'projet.appspot.com' },
            { key: 'firebaseMessagingSenderId',  label: 'Messaging Sender ID',  placeholder: '123456789' },
            { key: 'firebaseAppId',              label: 'App ID',               placeholder: '1:123:web:abc' },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">{label}</label>
              <input
                type="text"
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                className="input-glass text-xs"
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400">
          Sans Firebase, les données sont conservées en session uniquement (non persistantes).
        </p>

        <button onClick={handleTestFirebase} disabled={testing} className="btn-secondary">
          {testing ? <Loader size={14} className="animate-spin" /> : null}
          Tester la connexion Firebase
        </button>
      </motion.div>

      {/* SMTP — Emails d'invitation */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
            <Mail size={16} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">SMTP — Emails d'invitation</h2>
            <p className="text-xs text-gray-400">Permet d'envoyer les identifiants aux nouveaux membres</p>
          </div>
          {stored.smtpHost && stored.smtpUser && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Hôte SMTP</label>
            <input
              type="text"
              value={form.smtpHost}
              onChange={e => set('smtpHost', e.target.value)}
              placeholder="smtp.gmail.com"
              className="input-glass"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Port</label>
            <input
              type="number"
              value={form.smtpPort}
              onChange={e => set('smtpPort', e.target.value)}
              placeholder="587"
              className="input-glass"
            />
            <p className="text-xs text-gray-400">587 (TLS) · 465 (SSL) · 25 (non chiffré)</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Adresse expéditeur (From)</label>
            <input
              type="email"
              value={form.smtpFrom}
              onChange={e => set('smtpFrom', e.target.value)}
              placeholder="noreply@publithings.com"
              className="input-glass"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Utilisateur SMTP</label>
            <input
              type="text"
              value={form.smtpUser}
              onChange={e => set('smtpUser', e.target.value)}
              placeholder="noreply@publithings.com"
              className="input-glass"
            />
          </div>
          <SecretInput
            label="Mot de passe SMTP"
            value={form.smtpPass}
            onChange={v => set('smtpPass', v)}
            placeholder="Mot de passe ou App Password"
            hint="Gmail : utilisez un App Password (compte → Sécurité → Mots de passe des applications)"
          />
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Fournisseurs recommandés</p>
          <p>• <strong>Gmail</strong> : smtp.gmail.com · port 587 · App Password requis</p>
          <p>• <strong>OVH / Infomaniak</strong> : ssl0.ovh.net ou mail.infomaniak.com · port 587</p>
          <p>• <strong>Brevo (gratuit)</strong> : smtp-relay.brevo.com · port 587 · 300 emails/jour</p>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-gray-100">
          <label className="text-sm font-medium text-gray-700">Responsable tickets (auto-assignation)</label>
          <input
            type="email"
            value={form.defaultTicketAssigneeEmail}
            onChange={e => set('defaultTicketAssigneeEmail', e.target.value)}
            placeholder="ambinintsoa@publithings.com"
            className="input-glass"
          />
          <p className="text-xs text-gray-400">Chaque nouveau ticket est automatiquement assigné à cet email</p>
        </div>
      </motion.div>

      {/* Haloscan SEO */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
            <TrendingUp size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Haloscan — Suivi SEO</h2>
            <p className="text-xs text-gray-400">Avant/après positionnement Google par article · outil SEO N°1 FR</p>
          </div>
          {stored.haloscanKey && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>

        <SecretInput
          label="Clé API Haloscan"
          value={form.haloscanKey}
          onChange={v => { set('haloscanKey', v); setHaloscanStatus(null); }}
          placeholder="hal_..."
          hint="Disponible dans ton compte Haloscan — tool.haloscan.com/user/api"
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              if (!form.haloscanKey) { toast.error('Renseigne la clé Haloscan d\'abord'); return; }
              setTestingHaloscan(true);
              try {
                // Passe la clé directement — fonctionne avant même la sauvegarde
                const r = await axios.post('/api/haloscan/test', { key: form.haloscanKey });
                setHaloscanStatus(r.data.success ? 'ok' : 'warn');
                if (r.data.success) {
                  const credits = r.data.credits;
                  const info = credits?.remaining != null ? ` · ${credits.remaining} crédits restants` : '';
                  toast.success(`Haloscan connecté !${info}`);
                } else {
                  toast('Réponse inattendue — vérifiez la clé', { icon: <AlertTriangle size={18} className="text-amber-500" /> });
                }
              } catch (e) {
                setHaloscanStatus('error');
                const detail = e.response?.data?.detail || e.response?.data?.error || e.message || '';
                const status = e.response?.status;
                toast.error(`Haloscan ${status ? `erreur ${status}` : 'inaccessible'} — ${detail || 'Clé invalide'}`);
              }
              setTestingHaloscan(false);
            }}
            disabled={testingHaloscan}
            className="btn-secondary text-xs"
          >
            {testingHaloscan ? <Loader size={13} className="animate-spin" /> : <TrendingUp size={13} />}
            Tester la connexion
          </button>
          {haloscanStatus === 'ok'   && <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 size={13} /> Connecté</span>}
          {haloscanStatus === 'warn' && <span className="text-xs text-amber-600 font-medium flex items-center gap-1"><AlertCircle size={13} /> Partiel — voir hint</span>}
          {haloscanStatus === 'error'&& <span className="text-xs text-red-500 font-medium flex items-center gap-1"><AlertCircle size={13} /> Clé invalide</span>}
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs text-emerald-700 space-y-1.5">
          <p className="font-semibold">Ce que ça active dans le SaaS</p>
          <p>• Champ mots-clés cibles lors de chaque MAJ article</p>
          <p>• Snapshot position <strong>J+0</strong> (au moment de la MAJ) via l'API Haloscan</p>
          <p>• Snapshots automatiques <strong>J+7</strong> et <strong>J+30</strong> en arrière-plan</p>
          <p>• Graphique d'évolution de position dans l'Historique par article</p>
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-700 flex items-center gap-1.5">
            <AlertCircle size={12} className="text-amber-400" />
            Configuration endpoint (si test partiel)
          </p>
          <p>Si le test Haloscan retourne "endpoint à confirmer", vérifier l'URL API exacte dans
            {' '}<a href="https://tool.haloscan.com/user/api" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">tool.haloscan.com/user/api <ExternalLink size={10} /></a>
            {' '}et mettre à jour <code className="bg-white px-1 py-0.5 rounded border border-gray-200">HALOSCAN_BASE</code> dans <code className="bg-white px-1 py-0.5 rounded border border-gray-200">proxy.js</code>.
          </p>
        </div>
      </motion.div>

      {/* Google Sheets — synchronisation MAJ en lot */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
            <FileSpreadsheet size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">Google Sheets — MAJ en lot</h2>
            <p className="text-xs text-gray-400">Détection automatique des lignes neuves du Sheet de suivi (écran MAJ en lot)</p>
          </div>
          {stored.googleSheetsConfigured && <CheckCircle2 size={16} className="text-sage-400 ml-auto" />}
        </div>

        <SecretTextarea
          label="Clé de compte de service Google (JSON)"
          value={form.googleSheetsServiceAccountJson}
          onChange={v => { set('googleSheetsServiceAccountJson', v); setGsheetStatus(null); }}
          placeholder='{"type": "service_account", "client_email": "...", "private_key": "...", ...}'
          hint="Console Google Cloud → IAM & Admin → Comptes de service → Clés → JSON. Le Sheet doit être partagé avec l'adresse client_email de ce fichier."
        />

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Google Sheet à surveiller</label>
          <input
            type="text"
            value={form.googleSheetsId}
            onChange={e => { set('googleSheetsId', e.target.value); setGsheetStatus(null); }}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit ou l'identifiant seul"
            className="input-glass"
          />
          <p className="text-xs text-gray-400">Colle l'URL complète ou juste l'identifiant -- les deux marchent.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTestGsheet}
            disabled={testingGsheet}
            className="btn-secondary text-xs"
          >
            {testingGsheet ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Enregistrer et synchroniser maintenant
          </button>
          {gsheetStatus === 'ok'    && <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 size={13} /> Connecté{gsheetStatusDetail ? ` — ${gsheetStatusDetail}` : ''}</span>}
          {gsheetStatus === 'error' && <span className="text-xs text-red-500 font-medium flex items-center gap-1"><AlertCircle size={13} /> {gsheetStatusDetail || 'Échec'}</span>}
        </div>

        <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 text-xs text-teal-700 space-y-1.5">
          <p className="font-semibold">Ce que ça active</p>
          <p>• Un cron serveur lit le Sheet toutes les 5 minutes et détecte les lignes neuves (colonne « N° »)</p>
          <p>• Les lignes détectées apparaissent dans un bloc à part sur l'écran « MAJ en lot », à relire</p>
          <p>• Le lancement reste toujours un geste humain -- rien n'est jamais lancé automatiquement</p>
        </div>
      </motion.div>

      {/* Save */}
      <motion.button
        onClick={handleSave}
        disabled={saving}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="btn-primary w-full justify-center py-3"
      >
        {saving ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
        Enregistrer les paramètres
      </motion.button>
    </div>
  );
}
