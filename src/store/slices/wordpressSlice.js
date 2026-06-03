import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

const loadFromLocal = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || []; }
  catch { return []; }
};

const wordpressSlice = createSlice({
  name: 'wordpress',
  // localStorage : Application Passwords WP persistés entre sessions (tokens révocables ≠ mdp admin)
  initialState: { sites: loadFromLocal(STORAGE_KEYS.wpSites), loading: false },
  reducers: {
    setSites: (state, action) => { state.sites = action.payload; },
    addSite: (state, action) => { state.sites.push(action.payload); },
    updateSite: (state, action) => {
      const idx = state.sites.findIndex(s => s.id === action.payload.id);
      if (idx !== -1) state.sites[idx] = action.payload;
    },
    removeSite: (state, action) => { state.sites = state.sites.filter(s => s.id !== action.payload); },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});

export const { setSites, addSite, updateSite, removeSite, setLoading } = wordpressSlice.actions;
export default wordpressSlice.reducer;
