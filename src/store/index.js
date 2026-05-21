import { configureStore } from '@reduxjs/toolkit';
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

// ── Middleware de persistance localStorage ────────────────────────────────────
// Se déclenche UNIQUEMENT sur les actions des slices skills / knowledge / articles.
// Contrairement à store.subscribe(), il ne fire jamais pendant l'initialisation
// du store ni pendant le Hot Module Replacement de CRA → plus de risque d'écraser
// les données avec un état vide.
const trySet = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
};

const persistMiddleware = (storeAPI) => (next) => (action) => {
  const result = next(action);
  const type = action.type || '';
  if (
    type.startsWith('skills/')    ||
    type.startsWith('knowledge/') ||
    type.startsWith('articles/')  ||
    type.startsWith('pending/')   ||
    type.startsWith('stats/')
  ) {
    const s = storeAPI.getState();
    trySet('articleai_skills',    s.skills.list);
    trySet('articleai_knowledge', s.knowledge.list);
    trySet('articleai_history',   s.articles.history);
    if (type.startsWith('pending/')) trySet('articleai_pending', s.pending.list);
    if (type.startsWith('stats/')) {
      trySet('articleai_stats_articles', s.stats.totalArticles);
      trySet('articleai_stats_input',    s.stats.totalInputTokens);
      trySet('articleai_stats_output',   s.stats.totalOutputTokens);
      trySet('articleai_stats_cost',     s.stats.totalCostUsd);
      trySet('articleai_stats_history',  s.stats.history);
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
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ serializableCheck: false }).concat(persistMiddleware),
});

export default store;
