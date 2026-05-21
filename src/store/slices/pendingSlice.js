import { createSlice } from '@reduxjs/toolkit';

const load = () => {
  try { return JSON.parse(localStorage.getItem('articleai_pending') || 'null') || []; }
  catch { return []; }
};

const pendingSlice = createSlice({
  name: 'pending',
  initialState: { list: load() },
  reducers: {
    setPending: (state, action) => { state.list = action.payload; },

    addPendingItems: (state, action) => {
      // action.payload = tableau d'articles à ajouter (dédupliqués par URL)
      const existing = new Set(state.list.map(i => i.url?.trim().toLowerCase()));
      const newItems = action.payload.filter(i => !existing.has(i.url?.trim().toLowerCase()));
      state.list = [...newItems, ...state.list];
    },

    addPendingItem: (state, action) => {
      state.list.unshift(action.payload);
    },

    updatePendingItem: (state, action) => {
      const idx = state.list.findIndex(i => i.id === action.payload.id);
      if (idx !== -1) state.list[idx] = { ...state.list[idx], ...action.payload };
    },

    removePendingItem: (state, action) => {
      state.list = state.list.filter(i => i.id !== action.payload);
    },

    setItemStatus: (state, action) => {
      // { id, status }
      const idx = state.list.findIndex(i => i.id === action.payload.id);
      if (idx !== -1) {
        state.list[idx].status = action.payload.status;
        state.list[idx].updatedAt = Date.now();
      }
    },

    clearDone: (state) => {
      state.list = state.list.filter(i => i.status !== 'done');
    },

    clearAll: (state) => {
      state.list = [];
    },
  },
});

export const {
  setPending, addPendingItems, addPendingItem,
  updatePendingItem, removePendingItem, setItemStatus,
  clearDone, clearAll,
} = pendingSlice.actions;
export default pendingSlice.reducer;
