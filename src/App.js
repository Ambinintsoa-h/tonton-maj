import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useSelector } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import axios from 'axios';
import store from './store';
import Login from './pages/Login';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { logout } from './store/slices/authSlice';
import Layout from './components/layout/Layout';
import Articles from './pages/Articles';
import Skills from './pages/Skills';
import WordPress from './pages/WordPress';
import Historique from './pages/Historique';
import Parametres from './pages/Parametres';
import Dashboard from './pages/Dashboard';
import MajEnAttente from './pages/MajEnAttente';
import Equipe from './pages/Equipe';
import { setSettings, setFirebaseReady, DEFAULT_FIREBASE_CONFIG } from './store/slices/settingsSlice';
import { setSkills } from './store/slices/skillsSlice';
import { setHistory } from './store/slices/articlesSlice';
import { setSites } from './store/slices/wordpressSlice';
import { setUsers } from './store/slices/usersSlice';
import { initFirebase, getSkills, getArticles, getWordPressSites, getUsers } from './services/firebase';

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
// Stocké sur window pour que App puisse attendre la fin avant de retirer le splash
window.__tontonBootstrapPromise = (async function bootstrapFirebase() {
  if (window.__tontonFirebaseBooted) return;
  window.__tontonFirebaseBooted = true;

  const dispatch = store.dispatch;

  // Lire les settings sauvegardés
  let parsed = {};
  try {
    const saved = localStorage.getItem('articleai_settings');
    if (saved) parsed = JSON.parse(saved);
  } catch {}

  if (Object.keys(parsed).length > 0) dispatch(setSettings(parsed));

  // Config Firebase : localStorage en priorité, sinon config par défaut
  const fbConfig = (parsed.firebaseConfig?.apiKey)
    ? parsed.firebaseConfig
    : DEFAULT_FIREBASE_CONFIG;

  console.log('[firebase] Connexion au projet :', fbConfig.projectId);

  const ok = initFirebase(fbConfig);
  dispatch(setFirebaseReady(ok));

  if (!ok) {
    console.error('[firebase] ✗ Échec de l\'initialisation');
    return;
  }

  console.log('[firebase] ✓ Connecté —', fbConfig.projectId);

  // Charger les données Firestore (ne remplace le localStorage que si Firestore a des données)
  try {
    const [skills, articles, sites, users] = await Promise.all([
      getSkills().catch(() => []),
      getArticles().catch(() => []),
      getWordPressSites().catch(() => []),
      getUsers().catch(() => []),
    ]);

    if (skills.length > 0) {
      dispatch(setSkills(skills));
      localStorage.setItem('articleai_skills', JSON.stringify(skills));
      console.log(`[firebase] ${skills.length} skill(s) chargé(s)`);
    }
    if (articles.length > 0) {
      dispatch(setHistory(articles));
      localStorage.setItem('articleai_history', JSON.stringify(articles));
      console.log(`[firebase] ${articles.length} article(s) chargé(s)`);
    }
    if (sites.length > 0) {
      dispatch(setSites(sites));
      localStorage.setItem('articleai_wp_sites', JSON.stringify(sites));
      console.log(`[firebase] ${sites.length} site(s) WP chargé(s)`);
    }
    if (users.length > 0) {
      dispatch(setUsers(users));
      console.log(`[firebase] ${users.length} membre(s) d'équipe chargé(s)`);
    }
  } catch (e) {
    console.error('[firebase] Erreur chargement données :', e.message);
  }
})();

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
        const existing = JSON.parse(localStorage.getItem('articleai_settings') || '{}');
        localStorage.setItem('articleai_settings', JSON.stringify({
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
  const skills  = useSelector(s => s.skills.list);
  const history = useSelector(s => s.articles.history);
  const sites   = useSelector(s => s.wordpress.sites);
  const users   = useSelector(s => s.users.list);
  const stats   = useSelector(s => s.stats);

  useEffect(() => {
    localStorage.setItem('articleai_skills', JSON.stringify(skills));
  }, [skills]);

  useEffect(() => {
    localStorage.setItem('articleai_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('articleai_wp_sites', JSON.stringify(sites));
  }, [sites]);

  useEffect(() => {
    localStorage.setItem('articleai_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('articleai_stats_articles', JSON.stringify(stats.totalArticles));
    localStorage.setItem('articleai_stats_input',    JSON.stringify(stats.totalInputTokens));
    localStorage.setItem('articleai_stats_output',   JSON.stringify(stats.totalOutputTokens));
    localStorage.setItem('articleai_stats_cost',     JSON.stringify(stats.totalCostUsd));
    localStorage.setItem('articleai_stats_history',  JSON.stringify(stats.history));
  }, [stats]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      {/* Route publique — accessible sans authentification */}
      <Route path="/login" element={<Login />} />

      {/* Routes protégées — redirige vers /login si non authentifié */}
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/"               element={<Articles />}     />
              <Route path="/maj-en-attente" element={<MajEnAttente />} />
              <Route path="/skills"         element={<Skills />}       />
              <Route path="/wordpress"      element={<WordPress />}    />
              <Route path="/historique"     element={<Historique />}   />
              <Route path="/parametres"     element={<Parametres />}   />
              <Route path="/dashboard"      element={<Dashboard />}    />
              <Route path="/equipe"         element={<Equipe />}       />
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
        <ProxyDetector />
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
