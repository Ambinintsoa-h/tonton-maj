import { useEffect, useRef } from 'react';
import { STORAGE_KEYS } from './constants/storage';
import { safeSetItem, persistHistory, persistPending } from './utils/localCache';
import { useDispatch } from 'react-redux';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useSelector } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import axios from 'axios';
import store from './store';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RoleGuard from './components/auth/RoleGuard';
import { logout } from './store/slices/authSlice';
import Layout from './components/layout/Layout';
import Articles from './pages/Articles';
import Skills from './pages/Skills';
import WordPress from './pages/WordPress';
import Commentaires from './pages/Commentaires';
import Historique from './pages/Historique';
import Parametres from './pages/Parametres';
import Dashboard from './pages/Dashboard';
import MajEnAttente from './pages/MajEnAttente';
import Equipe from './pages/Equipe';
import Tickets from './pages/Tickets';
import SupportDashboard from './pages/SupportDashboard';
import Archives from './pages/Archives';
import { setSettings, setFirebaseReady, DEFAULT_FIREBASE_CONFIG } from './store/slices/settingsSlice';
import { setSkills } from './store/slices/skillsSlice';
import { countCustomSkills } from './constants/defaultSkills';
import { setKnowledge } from './store/slices/knowledgeSlice';
import { setHistory } from './store/slices/articlesSlice';
import { setSites } from './store/slices/wordpressSlice';
import { setUsers } from './store/slices/usersSlice';
import { setPending } from './store/slices/pendingSlice';
import { setStats } from './store/slices/statsSlice';
import {
  initFirebase, getSkills, getArticles, getWordPressSites, getUsers,
  getPendingItems, getStats, savePendingList, saveStats, getKnowledge,
  subscribeToNotifications, subscribeToPending,
} from './services/firebase';
import { setBackend, getBackend } from './services/backendMode';
import tracker from './services/activityTracker';
import { setNotifications } from './store/slices/notificationsSlice';
import toast from 'react-hot-toast';
import { Bell } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Intercepteurs axios — niveau module, s'appliquent à toutes les requêtes
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'tonton_auth_token';

// Injecte le token JWT sur chaque requête vers /api/*
axios.interceptors.request.use((config) => {
  if (config.url?.startsWith('/api')) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirige vers /login si le serveur répond 401 (token expiré ou invalide)
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.config?.url?.startsWith('/api')) {
      sessionStorage.removeItem(TOKEN_KEY);
      store.dispatch(logout());
      window.location.replace('/login');
    }
    return Promise.reject(error);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Firebase — exécuté UNE SEULE FOIS au niveau module, avant tout
// rendu React. Utilise store.dispatch directement (pas de hook) pour être
// totalement immunisé contre le double-effet du React 19 Strict Mode et le
// rechargement de module par le HMR Webpack.
// window.__tontonFirebaseBooted protège contre le double-chargement HMR.
// ─────────────────────────────────────────────────────────────────────────────
// La file « MAJ en attente » est désormais synchronisée en TEMPS RÉEL par
// PendingSync (onSnapshot) dès que l'utilisateur est authentifié → plus besoin
// de garde d'hydratation au bootstrap. Le bootstrap ne fait qu'un seed rapide
// (premier paint) ; onSnapshot corrige ensuite avec la vérité serveur.

// Stocké sur window pour que App puisse attendre la fin avant de retirer le splash
window.__tontonBootstrapPromise = (async function bootstrapFirebase() {
  if (window.__tontonFirebaseBooted) return;
  window.__tontonFirebaseBooted = true;

  const dispatch = store.dispatch;

  // Lire les settings sauvegardés
  let parsed = {};
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.settings);
    if (saved) parsed = JSON.parse(saved);
  } catch {}

  if (Object.keys(parsed).length > 0) dispatch(setSettings(parsed));

  // Backend de données : Firestore (défaut) ou MySQL, piloté par DATA_BACKEND
  // côté proxy. Lu UNE fois au bootstrap ; défaut firestore si le fetch échoue.
  try {
    const r = await fetch('/api/backend');
    if (r.ok) { const d = await r.json(); if (d && d.backend) setBackend(d.backend); }
  } catch { /* défaut firestore — comportement historique */ }

  // Config Firebase : localStorage en priorité, sinon config par défaut
  const fbConfig = (parsed.firebaseConfig?.apiKey)
    ? parsed.firebaseConfig
    : DEFAULT_FIREBASE_CONFIG;

  if (getBackend() === 'firestore') {
    const ok = initFirebase(fbConfig);
    dispatch(setFirebaseReady(ok));
    if (!ok) {
      console.error('[firebase] Échec de l\'initialisation');
      return;
    }
  } else {
    // Mode MySQL : pas d'init Firebase ; tout l'accès données passe par le proxy.
    dispatch(setFirebaseReady(true));
  }


  // Charger les données Firestore (ne remplace le localStorage que si Firestore a des données)
  try {
    const [skills, articles, sites, users, pending, stats, knowledge] = await Promise.all([
      getSkills().catch(() => []),
      getArticles().catch(() => []),
      getWordPressSites().catch(() => []),
      getUsers().catch(() => []),
      getPendingItems().catch(() => []),
      getStats().catch(() => null),
      getKnowledge().catch(() => []),
    ]);

    // localStorage = source de vérité pour skills + knowledge.
    // Firestore ne remplace TOUT que si aucun skill PERSONNALISÉ n'existe en local
    // (le skill par défaut « Skills par Tonton AI » est toujours présent et ne compte pas).
    const localSkills = store.getState().skills.list;
    if (countCustomSkills(localSkills) === 0 && skills.length > 0) {
      dispatch(setSkills(skills));
      safeSetItem(STORAGE_KEYS.skills, skills);
    } else {
      // Garde-fou : les skills CERVEAU (format SKILL.md) sont globaux/partagés. On fusionne
      // toujours par id ceux qui manquent en local, même si l'utilisateur a déjà des skills
      // perso — sinon un snapshot localStorage pré-migration prive l'utilisateur (typiquement
      // un cq_ia, qui n'a pas accès à la page Skills) du cerveau → pas d'audit + MAJ legacy.
      // N'enlève AUCUN skill local existant.
      const localIds = new Set(localSkills.map(s => s.id));
      const missingBrain = skills.filter(s => s.format === 'skillmd' && s.active !== false && !localIds.has(s.id));
      if (missingBrain.length > 0) {
        const merged = [...localSkills, ...missingBrain];
        dispatch(setSkills(merged));
        safeSetItem(STORAGE_KEYS.skills, merged);
      }
    }
    if (articles.length > 0) {
      dispatch(setHistory(articles));
      persistHistory(articles); // cache local allégé (HTML exclu) — Firestore = source de vérité
    }
    if (sites.length > 0) {
      dispatch(setSites(sites));
      safeSetItem(STORAGE_KEYS.wpSites, sites);
    }
    if (users.length > 0) {
      dispatch(setUsers(users));
    }
    if (pending.length > 0) {
      dispatch(setPending(pending));
      persistPending(pending); // cache local allégé (HTML de majResult exclu)
    }
    if (stats) {
      dispatch(setStats(stats));
    }
    const localKnowledge = store.getState().knowledge.list;
    if (localKnowledge.length === 0 && knowledge.length > 0) {
      dispatch(setKnowledge(knowledge));
      safeSetItem(STORAGE_KEYS.knowledge, knowledge);
    }
  } catch (e) {
    console.error('[firebase] Erreur chargement données :', e.message);
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Chargement des paramètres serveur après authentification
// Les clés API (Anthropic, Brave, Tavily, Groq) sont stockées côté serveur dans
// data/settings.json (gitignorés). Tous les membres de l'équipe reçoivent
// les mêmes clés dès qu'ils sont connectés — plus besoin de les saisir chacun.
// ─────────────────────────────────────────────────────────────────────────────
function SettingsLoader() {
  const dispatch = useDispatch();
  const isAuthenticated = useSelector(s => s.auth.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    axios.get('/api/settings')
      .then(res => {
        if (res.data && Object.keys(res.data).length > 0) {
          dispatch(setSettings(res.data));
          // Cache du firebaseConfig en localStorage uniquement (pour le bootstrap au prochain chargement)
          if (res.data.firebaseConfig) {
            const existing = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
              ...existing,
              firebaseConfig: res.data.firebaseConfig,
            }));
          }
        }
      })
      .catch(() => {
        // Fallback silencieux — l'utilisateur peut configurer via Paramètres
      });
  }, [isAuthenticated, dispatch]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chargement automatique des tarifs Anthropic depuis LiteLLM (via proxy)
// Rafraîchi toutes les 6h côté serveur — aucune saisie manuelle.
// ─────────────────────────────────────────────────────────────────────────────
function PricingLoader() {
  const dispatch = useDispatch();
  const isAuthenticated = useSelector(s => s.auth.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    axios.get('/api/model-pricing')
      .then(res => {
        if (res.data?.pricing && Object.keys(res.data.pricing).length > 0) {
          dispatch(setSettings({ modelPricing: res.data.pricing }));
        }
      })
      .catch(() => { /* Fallback silencieux — DEFAULT_MODEL_PRICING du store */ });
  }, [isAuthenticated, dispatch]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synchronisation Firestore pour pending et stats
// Debounce : pending toutes les 3s, stats toutes les 8s après un changement.
// Full-replace pour pending (liste courte), setDoc pour stats.
// ─────────────────────────────────────────────────────────────────────────────
function FirestoreSync() {
  const stats         = useSelector(s => s.stats);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const statsTimer   = useRef(null);

  useEffect(() => {
    if (!firebaseReady) return;
    clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(() => {
      saveStats(stats).catch(() => {});
    }, 8000);
    return () => clearTimeout(statsTimer.current);
  }, [stats, firebaseReady]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synchronisation TEMPS RÉEL de la file « MAJ en attente ».
// Firestore = source de vérité live (onSnapshot) : la liste est TOUJOURS
// rechargée depuis la base dès que l'utilisateur est authentifié — après login,
// logout/re-login, rechargement, vidage de cache ou sur un autre poste. Fini la
// dépendance au timing du bootstrap et le risque de file « vide ».
// Écriture (full-replace debounced) UNIQUEMENT quand l'état local DIVERGE
// vraiment de la dernière version serveur reçue → pas de boucle d'écho, pas
// d'écrasement de la file des collègues par une liste locale périmée.
function PendingSync() {
  const dispatch      = useDispatch();
  const pending       = useSelector(s => s.pending.list);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);
  const isAuthenticated = useSelector(s => s.auth.isAuthenticated);

  const serverSig = useRef(null);   // signature de la dernière file reçue du serveur
  const gotSnapshot = useRef(false);
  const writeTimer = useRef(null);

  // Signature « métier » stable (ignore le HTML/ordre) : ce qui définit la file.
  const sigOf = (list) => JSON.stringify(
    (list || [])
      .map(i => [String(i.id), i.status || '', i.assigneeId || '', i.priority || '', i.title || '', i.url || ''])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );

  // Lecture temps réel
  useEffect(() => {
    if (!firebaseReady || !isAuthenticated) return undefined;
    const unsub = subscribeToPending((items) => {
      gotSnapshot.current = true;
      serverSig.current = sigOf(items);
      dispatch(setPending(items));
    });
    return unsub;
  }, [firebaseReady, isAuthenticated, dispatch]);

  // Écriture différée, seulement si la file locale diverge du serveur
  useEffect(() => {
    if (!firebaseReady || !isAuthenticated || !gotSnapshot.current) return undefined;
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      if (sigOf(pending) === serverSig.current) return; // écho d'un snapshot → rien à écrire
      serverSig.current = sigOf(pending); // évite une 2e écriture avant l'écho
      savePendingList(pending).catch(() => {});
    }, 1500);
    return () => clearTimeout(writeTimer.current);
  }, [pending, firebaseReady, isAuthenticated]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Détection du proxy local — dans un useEffect car besoin du store via dispatch,
// mais totalement idempotent (plusieurs appels = même résultat).
// ─────────────────────────────────────────────────────────────────────────────
function ProxyDetector() {
  useEffect(() => {
    // Guard Strict Mode : React 19 fire les effets 2× en dev (mount→unmount→mount).
    // Sans ce guard, 2 requêtes axios partent en même temps vers le health check.
    if (window.__tontonProxyDetected) return;
    window.__tontonProxyDetected = true;

    // Détection réservée au POSTE DE DEV (CRA sur localhost) : en prod
    // (maj.stomos.net), ce ping vers localhost:3001 échouait de toute façon
    // (mixed content + CSP connect-src) en polluant la console — on ne le
    // tente plus, le comportement prod reste identique (mode aiConfigured).
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;

    // Timeout 5000ms (au lieu de 2000ms) : le health check proxy répond maintenant
    // instantanément, mais 5s de marge évite tout faux timeout sur machine lente.
    axios.get('http://localhost:3001/health', { timeout: 5000 })
      .then(() => {
        store.dispatch(setSettings({ anthropicKey: 'local', useLocalProxy: true }));
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
        localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
          ...existing, anthropicKey: 'local', useLocalProxy: true,
        }));
      })
      .catch(() => {
        // Proxy absent ou erreur réseau — mode direct API key
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sauvegarde automatique dans localStorage à chaque changement du store
// ─────────────────────────────────────────────────────────────────────────────
function LocalStorageSync() {
  const skills     = useSelector(s => s.skills.list);
  const knowledge  = useSelector(s => s.knowledge.list);
  const history    = useSelector(s => s.articles.history);
  const sites      = useSelector(s => s.wordpress.sites);
  const users      = useSelector(s => s.users.list);
  const stats      = useSelector(s => s.stats);

  // Toutes les écritures passent par les helpers tolérants au quota (jamais
  // d'exception → jamais de page blanche ; historique allégé, sans HTML).
  useEffect(() => {
    safeSetItem(STORAGE_KEYS.skills, skills);
  }, [skills]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.knowledge, knowledge);
  }, [knowledge]);

  useEffect(() => {
    persistHistory(history);
  }, [history]);

  useEffect(() => {
    // localStorage : Application Passwords WP persistés entre sessions
    safeSetItem(STORAGE_KEYS.wpSites, sites);
  }, [sites]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.users, users);
  }, [users]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.statsArticles, stats.totalArticles);
    safeSetItem(STORAGE_KEYS.statsInput,    stats.totalInputTokens);
    safeSetItem(STORAGE_KEYS.statsOutput,   stats.totalOutputTokens);
    safeSetItem(STORAGE_KEYS.statsCost,     stats.totalCostUsd);
    safeSetItem(STORAGE_KEYS.statsHistory,  stats.history);
  }, [stats]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracking invisible — TOUS les rôles (cq_ia, manager, support, super_admin),
// totalement transparent. Le super_admin de SECOURS (login local settings.json,
// sans session Firebase) ne peut pas écrire dans Firestore côté client : ses
// écritures échouent en silence (règles) — seul ce compte-là n'est pas tracké.
// ─────────────────────────────────────────────────────────────────────────────
function ActivityTrackerInit() {
  const isAuthenticated = useSelector(s => s.auth.isAuthenticated);
  const role     = useSelector(s => s.auth.role);
  const uid      = useSelector(s => s.auth.uid);
  const username = useSelector(s => s.auth.username);
  const prenom   = useSelector(s => s.auth.prenom);
  const nom      = useSelector(s => s.auth.nom);

  useEffect(() => {
    if (!isAuthenticated || !role) return;
    const userId = uid || username;
    const name   = [prenom, nom].filter(Boolean).join(' ') || username || userId;
    tracker.init(userId, role, name);
    return () => tracker.destroy();
    // prenom/nom intentionnellement exclus : leur chargement async ne doit pas
    // déclencher destroy/init (= fausses reconnexions en base)
  }, [isAuthenticated, role, uid, username]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listener temps réel pour les notifications utilisateur
// ─────────────────────────────────────────────────────────────────────────────
function NotificationListener() {
  const dispatch = useDispatch();
  const auth = useSelector(s => s.auth);
  // Ne PAS notifier au 1er snapshot : à la connexion, l'abonnement renvoie
  // TOUTES les notifs (dont d'anciennes non lues) → sans ce garde, on toastait
  // une notif déjà connue à chaque connexion. On mémorise les ids déjà présents
  // au premier chargement ; seules les notifs APPARUES ENSUITE toastent.
  const seenIdsRef = useRef(null); // null = pas encore initialisé (1er snapshot)

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.uid) return undefined;
    const userId = auth.uid || auth.username;
    seenIdsRef.current = null; // réinitialise à chaque (re)connexion
    const unsub = subscribeToNotifications(userId, (notifs) => {
      dispatch(setNotifications(notifs));
      const unread = notifs.filter(n => !n.read);
      if (seenIdsRef.current === null) {
        // 1er snapshot : enregistre l'existant SANS toaster
        seenIdsRef.current = new Set(unread.map(n => n.id));
        return;
      }
      // Toast seulement pour une notif non lue JAMAIS vue dans cette session
      const fresh = unread.find(n => !seenIdsRef.current.has(n.id));
      if (fresh) toast(fresh.message, { icon: <Bell size={18} />, duration: 4000 });
      unread.forEach(n => seenIdsRef.current.add(n.id));
    });
    return () => unsub();
  }, [auth.isAuthenticated, auth.uid, auth.username, dispatch]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      {/* Routes publiques — accessibles sans authentification */}
      <Route path="/login"          element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Routes protégées — redirige vers /login si non authentifié */}
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/"               element={<Articles />}     />
              <Route path="/maj-en-attente" element={<MajEnAttente />} />
              <Route path="/skills"         element={<Skills />}       />
              <Route path="/wordpress"      element={<WordPress />}    />
              <Route path="/commentaires"   element={
                <RoleGuard allowedRoles={['super_admin', 'manager', 'support']}>
                  <Commentaires />
                </RoleGuard>
              } />
              <Route path="/historique"     element={<Historique />}   />
              <Route path="/parametres"     element={
                <RoleGuard allowedRoles={['super_admin']}>
                  <Parametres />
                </RoleGuard>
              } />
              <Route path="/dashboard"      element={<Dashboard />}    />
              <Route path="/archives"       element={
                <RoleGuard allowedRoles={['super_admin']}>
                  <Archives />
                </RoleGuard>
              } />
              <Route path="/equipe"         element={<Equipe />}       />
              <Route path="/tickets"           element={<Tickets />}         />
              <Route path="/support-dashboard" element={
                <RoleGuard allowedRoles={['support']}>
                  <SupportDashboard />
                </RoleGuard>
              } />
              <Route path="*"              element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Retire le splash screen HTML dès que Firebase est initialisé
// ─────────────────────────────────────────────────────────────────────────────
function SplashRemover() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const remove = () => {
      const el = document.getElementById('app-loader');
      if (!el) return;
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 600);
    };
    // Attendre la fin du bootstrap Firebase avant de retirer le splash
    const p = window.__tontonBootstrapPromise;
    if (p && typeof p.then === 'function') p.then(remove).catch(remove);
    else remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <SplashRemover />
        <SettingsLoader />
        <PricingLoader />
        <ProxyDetector />
        <FirestoreSync />
        <PendingSync />
        <ActivityTrackerInit />
        <NotificationListener />
        <LocalStorageSync />
        <AppRoutes />
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: '12px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            fontSize: '14px',
          },
        }}
      />
    </Provider>
  );
}
