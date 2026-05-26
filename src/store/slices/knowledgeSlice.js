import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || []; }
  catch { return []; }
};

const knowledgeSlice = createSlice({
  name: 'knowledge',
  initialState: { list: load(STORAGE_KEYS.knowledge) },
  reducers: {
    addKnowledge:    (state, action) => { state.list.unshift(action.payload); },
    removeKnowledge: (state, action) => { state.list = state.list.filter(k => k.id !== action.payload); },
    setKnowledge:    (state, action) => { state.list = action.payload; },
    updateKnowledge: (state, action) => {
      const idx = state.list.findIndex(k => k.id === action.payload.id);
      if (idx !== -1) state.list[idx] = { ...state.list[idx], ...action.payload };
    },
  },
});

export const { addKnowledge, removeKnowledge, setKnowledge, updateKnowledge } = knowledgeSlice.actions;
export default knowledgeSlice.reducer;
