import { configureStore } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../constants/storage';
import { safeSetItem, persistHistory, persistPending } from '../utils/localCache';
import settingsReducer from './slices/settingsSlice';
import skillsReducer from './slices/skillsSlice';
import articlesReducer from './slices/articlesSlice';
import wordpressReducer from './slices/wordpressSlice';
import agentReducer from './slices/agentSlice';
import knowledgeReducer from './slices/knowledgeSlice';
import statsReducer from './slices/statsSlice';
import pendingReducer from './slices/pendingSlice';
import usersReducer from './slices/usersSlice';
import authReducer from './slices/authSlice';
import ticketsReducer from './slices/ticketsSlice';
import notificationsReducer from './slices/notificationsSlice';

// ── Middleware de persistance localStorage ────────────────────────────────────
// Se déclenche UNIQUEMENT sur les actions des slices skills / knowledge / articles.
// Contrairement à store.subscribe(), il ne fire jamais pendant l'initialisation
// du store ni pendant le Hot Module Replacement de CRA → plus de risque d'écraser
// les données avec un état vide.
// Toutes les écritures passent par les helpers TOLÉRANTS AU QUOTA de localCache
// (jamais d'exception ; l'historique et la file sont allégés — HTML exclu).
const persistMiddleware = (storeAPI) => (next) => (action) => {
  const result = next(action);
  const type = action.type || '';
  if (
    type.startsWith('skills/')     ||
    type.startsWith('knowledge/')  ||
    type.startsWith('articles/')   ||
    type.startsWith('pending/')    ||
    type.startsWith('stats/')      ||
    type.startsWith('wordpress/')
  ) {
    const s = storeAPI.getState();
    safeSetItem(STORAGE_KEYS.skills,    s.skills.list);
    safeSetItem(STORAGE_KEYS.knowledge, s.knowledge.list);
    persistHistory(s.articles.history); // allégé (sans HTML) + plafonné + dégressif
    if (type.startsWith('wordpress/')) safeSetItem(STORAGE_KEYS.wpSites, s.wordpress.sites);
    if (type.startsWith('pending/')) persistPending(s.pending.list); // allégé (sans HTML majResult)
    if (type.startsWith('stats/')) {
      safeSetItem(STORAGE_KEYS.statsArticles, s.stats.totalArticles);
      safeSetItem(STORAGE_KEYS.statsInput,    s.stats.totalInputTokens);
      safeSetItem(STORAGE_KEYS.statsOutput,   s.stats.totalOutputTokens);
      safeSetItem(STORAGE_KEYS.statsCost,     s.stats.totalCostUsd);
      safeSetItem(STORAGE_KEYS.statsHistory,  s.stats.history);
      safeSetItem(STORAGE_KEYS.statsByPass,   s.stats.totalByPass);
    }
  }
  return result;
};

export const store = configureStore({
  reducer: {
    settings: settingsReducer,
    skills: skillsReducer,
    articles: articlesReducer,
    wordpress: wordpressReducer,
    agent: agentReducer,
    knowledge: knowledgeReducer,
    stats: statsReducer,
    pending: pendingReducer,
    users:   usersReducer,
    auth:    authReducer,
    tickets: ticketsReducer,
    notifications: notificationsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }).concat(persistMiddleware),
});

export default store;
