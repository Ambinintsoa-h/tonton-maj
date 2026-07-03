import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || []; }
  catch { return []; }
};

const articlesSlice = createSlice({
  name: 'articles',
  initialState: {
    history: load(STORAGE_KEYS.history),
    current: null,
    loading: false,
  },
  reducers: {
    setHistory: (state, action) => { state.history = action.payload; },
    // Idempotent par id : si l'article existe déjà (ex. archivé automatiquement en
    // fin d'analyse, puis « Terminer »), on fusionne au lieu de créer un doublon.
    addToHistory: (state, action) => {
      const idx = state.history.findIndex(a => a.id === action.payload.id);
      if (idx !== -1) state.history[idx] = { ...state.history[idx], ...action.payload };
      else state.history.unshift(action.payload);
    },
    updateInHistory: (state, action) => {
      const idx = state.history.findIndex(a => a.id === action.payload.id);
      // Merge partiel : ne remplace que les champs fournis (préserve title, url, originalContent…)
      if (idx !== -1) state.history[idx] = { ...state.history[idx], ...action.payload };
    },
    removeFromHistory: (state, action) => {
      state.history = state.history.filter(a => a.id !== action.payload);
    },
    setCurrent: (state, action) => { state.current = action.payload; },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});

export const { setHistory, addToHistory, updateInHistory, removeFromHistory, setCurrent, setLoading } = articlesSlice.actions;
export default articlesSlice.reducer;
