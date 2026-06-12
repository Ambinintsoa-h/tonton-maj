import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';
import { mergeDefaultSkills } from '../../constants/defaultSkills';

const load = (key) => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null') || [];
    return mergeDefaultSkills(stored);
  } catch { return mergeDefaultSkills([]); }
};

const skillsSlice = createSlice({
  name: 'skills',
  initialState: { list: load(STORAGE_KEYS.skills), loading: false },
  reducers: {
    setSkills: (state, action) => { state.list = mergeDefaultSkills(action.payload); },
    addSkill: (state, action) => { state.list.unshift(action.payload); },
    updateSkill: (state, action) => {
      const idx = state.list.findIndex(s => s.id === action.payload.id);
      if (idx !== -1) state.list[idx] = action.payload;
    },
    removeSkill: (state, action) => { state.list = state.list.filter(s => s.id !== action.payload); },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});

export const { setSkills, addSkill, updateSkill, removeSkill, setLoading } = skillsSlice.actions;
export default skillsSlice.reducer;
