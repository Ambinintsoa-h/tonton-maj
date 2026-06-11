import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Save, CheckCircle2, AlertCircle, Loader, Monitor, Mic, Mail, TrendingUp, ExternalLink, Flame, Shield, Zap } from 'lucide-react';
import axios from 'axios';
import { setSettings, setFirebaseReady } from '../store/slices/settingsSlice';
import { initFirebase, saveSettings } from '../services/firebase';

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

export default function Parametres() {
  const dispatch = useDispatch();
  const stored = useSelector(s => s.settings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingHaloscan, setTestingHaloscan] = useState(false);
  const [haloscanStatus, setHaloscanStatus] = useState(null);
  const [proxyStatus, setProxyStatus] = useState(null);
  const [checkingProxy, setCheckingProxy] = useState(false);

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
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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
      await axios.get('http://localhost:3001/health', { timeout: 3000 });
      setProxyStatus('ok');
      toast.success('Proxy local actif !');
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

  // Détection automatique du proxy au chargement
  useEffect(() => {
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
                  toast('Réponse inattendue — vérifiez la clé', { icon: '⚠️' });
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
