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
  subscribeToNotifications,
} from './services/firebase';
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
// Garde anti-écrasement de la file partagée : tant que la lecture INITIALE de
// la collection pending n'a pas RÉUSSI, FirestoreSync ne pousse rien. Sans ça,
// après un vidage de cache (Redux = liste vide) une hydratation lente ou en
// échec laissait le full-replace debounce 3 s SUPPRIMER les items de toute
// l'équipe (dont les « À valider »).
let pendingHydrated = false;

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

  // Config Firebase : localStorage en priorité, sinon config par défaut
  const fbConfig = (parsed.firebaseConfig?.apiKey)
    ? parsed.firebaseConfig
    : DEFAULT_FIREBASE_CONFIG;


  const ok = initFirebase(fbConfig);
  dispatch(setFirebaseReady(ok));

  if (!ok) {
    console.error('[firebase] Échec de l\'initialisation');
    return;
  }


  // Charger les données Firestore (ne remplace le localStorage que si Firestore a des données)
  try {
    const [skills, articles, sites, users, pending, stats, knowledge] = await Promise.all([
      getSkills().catch(() => []),
      getArticles().catch(() => []),
      getWordPressSites().catch(() => []),
      getUsers().catch(() => []),
      getPendingItems().then(list => { pendingHydrated = true; return list; }).catch(() => []),
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
  const pending       = useSelector(s => s.pending.list);
  const stats         = useSelector(s => s.stats);
  const firebaseReady = useSelector(s => s.settings.firebaseReady);

  const pendingTimer = useRef(null);
  const statsTimer   = useRef(null);

  useEffect(() => {
    if (!firebaseReady) return;
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      // Jamais de full-replace avant une hydratation RÉUSSIE de la file :
      // pousser une liste locale vide/partielle supprimerait les items des
      // autres membres (vidage de cache, lecture initiale en échec…).
      if (!pendingHydrated) return;
      savePendingList(pending).catch(() => {});
    }, 3000);
    return () => clearTimeout(pendingTimer.current);
  }, [pending, firebaseReady]);

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
// Détection du proxy local — dans un useEffect car besoin du store via dispatch,
// mais totalement idempotent (plusieurs appels = même résultat).
// ─────────────────────────────────────────────────────────────────────────────
function ProxyDetector() {
  useEffect(() => {
    // Guard Strict Mode : React 19 fire les effets 2× en dev (mount→unmount→mount).
    // Sans ce guard, 2 requêtes axios partent en même temps vers le health check.
    if (window.__tontonProxyDetected) return;
    window.__tontonProxyDetected = true;

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
// Tracking invisible — manager / cq_ia uniquement, totalement transparent
// ─────────────────────────────────────────────────────────────────────────────
function ActivityTrackerInit() {
  const isAuthenticated = useSelector(s => s.auth.isAuthenticated);
  const role     = useSelector(s => s.auth.role);
  const uid      = useSelector(s => s.auth.uid);
  const username = useSelector(s => s.auth.username);
  const prenom   = useSelector(s => s.auth.prenom);
  const nom      = useSelector(s => s.auth.nom);

  useEffect(() => {
    if (!isAuthenticated || !['manager', 'cq_ia'].includes(role)) return;
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
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.uid) return;
    const userId = auth.uid || auth.username;
    const unsub = subscribeToNotifications(userId, (notifs) => {
      dispatch(setNotifications(notifs));
      // Toast pour les nouvelles notifs non lues
      const unread = notifs.filter(n => !n.read);
      if (unread.length > prevCountRef.current) {
        const newest = unread[0];
        if (newest) toast(newest.message, { icon: <Bell size={18} />, duration: 4000 });
      }
      prevCountRef.current = unread.length;
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
