import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

const load = (key, def) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? def; } catch { return def; }
};

// Additionne (signe +1) ou retire (signe -1) une agrégation par passe dans le
// cumul équipe. `addition` vient de `aggregateCallsByPass` (agent.js) :
// { [passe]: { model, input, output, costUsd } }. Un article sans détail par
// passe (généré avant ce dispositif) n'a rien à fusionner — `addition` est
// alors `null`, et la boucle ne fait rien.
const mergeByPass = (target, addition, sign) => {
  if (!addition) return target;
  const next = { ...target };
  for (const [pass, v] of Object.entries(addition)) {
    const cur = next[pass] || { model: v.model, input: 0, output: 0, costUsd: 0 };
    next[pass] = {
      model:   v.model || cur.model,
      input:   cur.input   + sign * (v.input   || 0),
      output:  cur.output  + sign * (v.output  || 0),
      costUsd: cur.costUsd + sign * (v.costUsd || 0),
    };
  }
  return next;
};

const statsSlice = createSlice({
  name: 'stats',
  initialState: {
    totalArticles: load(STORAGE_KEYS.statsArticles, 0),
    totalInputTokens: load(STORAGE_KEYS.statsInput, 0),
    totalOutputTokens: load(STORAGE_KEYS.statsOutput, 0),
    totalCostUsd: load(STORAGE_KEYS.statsCost, 0),
    history: load(STORAGE_KEYS.statsHistory, []), // [{id, title, inputTokens, outputTokens, costUsd, createdAt, pass, byPass}]
    // Cumul par passe du registre IA (MODEL_PASSES, agent.js) — alimenté
    // seulement par les articles traités APRÈS ce dispositif : les entrées
    // plus anciennes n'ont pas ce détail dans tokenUsage.calls.
    totalByPass: load(STORAGE_KEYS.statsByPass, {}),
  },
  reducers: {
    setStats: (state, action) => ({ ...state, ...action.payload }),

    addArticleStat: (state, action) => {
      const { id, title, inputTokens, outputTokens, costUsd, createdAt, assigneeId = null, pass = 1, byPass = null } = action.payload;
      const existingIdx = state.history.findIndex(h => h.id === id && h.pass === pass);

      if (existingIdx !== -1) {
        // Mise à jour d'une entrée existante : ajuster les totaux (delta uniquement)
        const old = state.history[existingIdx];
        state.totalInputTokens  += inputTokens  - old.inputTokens;
        state.totalOutputTokens += outputTokens - old.outputTokens;
        state.totalCostUsd      += costUsd      - old.costUsd;
        // Retire l'ancien détail par passe avant d'ajouter le nouveau — sinon
        // relancer une passe deux fois doublerait son coût dans le cumul.
        state.totalByPass = mergeByPass(state.totalByPass, old.byPass, -1);
        state.totalByPass = mergeByPass(state.totalByPass, byPass, 1);
        state.history[existingIdx] = { ...old, inputTokens, outputTokens, costUsd, byPass };
      } else {
        // Nouvelle entrée — ne compter l'article qu'une fois (passe 1 seulement)
        if (pass === 1) state.totalArticles += 1;
        state.totalInputTokens  += inputTokens;
        state.totalOutputTokens += outputTokens;
        state.totalCostUsd      += costUsd;
        state.totalByPass = mergeByPass(state.totalByPass, byPass, 1);
        state.history.unshift({ id, title, inputTokens, outputTokens, costUsd, createdAt, assigneeId, pass, byPass });
        if (state.history.length > 200) state.history.pop();
      }
    },
    resetStats: (state) => {
      state.totalArticles = 0;
      state.totalInputTokens = 0;
      state.totalOutputTokens = 0;
      state.totalCostUsd = 0;
      state.history = [];
      state.totalByPass = {};
    },
  },
});

export const { setStats, addArticleStat, resetStats } = statsSlice.actions;
export default statsSlice.reducer;
