import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

const load = (key, def) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? def; } catch { return def; }
};

const statsSlice = createSlice({
  name: 'stats',
  initialState: {
    totalArticles: load(STORAGE_KEYS.statsArticles, 0),
    totalInputTokens: load(STORAGE_KEYS.statsInput, 0),
    totalOutputTokens: load(STORAGE_KEYS.statsOutput, 0),
    totalCostUsd: load(STORAGE_KEYS.statsCost, 0),
    history: load(STORAGE_KEYS.statsHistory, []), // [{id, title, inputTokens, outputTokens, costUsd, createdAt, pass}]
  },
  reducers: {
    setStats: (state, action) => ({ ...state, ...action.payload }),

    addArticleStat: (state, action) => {
      const { id, title, inputTokens, outputTokens, costUsd, createdAt, assigneeId = null, pass = 1 } = action.payload;
      const existingIdx = state.history.findIndex(h => h.id === id && h.pass === pass);

      if (existingIdx !== -1) {
        // Mise à jour d'une entrée existante : ajuster les totaux (delta uniquement)
        const old = state.history[existingIdx];
        state.totalInputTokens  += inputTokens  - old.inputTokens;
        state.totalOutputTokens += outputTokens - old.outputTokens;
        state.totalCostUsd      += costUsd      - old.costUsd;
        state.history[existingIdx] = { ...old, inputTokens, outputTokens, costUsd };
      } else {
        // Nouvelle entrée — ne compter l'article qu'une fois (passe 1 seulement)
        if (pass === 1) state.totalArticles += 1;
        state.totalInputTokens  += inputTokens;
        state.totalOutputTokens += outputTokens;
        state.totalCostUsd      += costUsd;
        state.history.unshift({ id, title, inputTokens, outputTokens, costUsd, createdAt, assigneeId, pass });
        if (state.history.length > 200) state.history.pop();
      }
    },
    resetStats: (state) => {
      state.totalArticles = 0;
      state.totalInputTokens = 0;
      state.totalOutputTokens = 0;
      state.totalCostUsd = 0;
      state.history = [];
    },
  },
});

export const { setStats, addArticleStat, resetStats } = statsSlice.actions;
export default statsSlice.reducer;
