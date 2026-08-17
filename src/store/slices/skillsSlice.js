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
  // `bootstrapped` — le chargement serveur des skills a-t-il ABOUTI (succès OU
  // échec) ? À l'ouverture, `list` ne contient que le cache localStorage, qui peut
  // très bien ne pas porter le skill cerveau (snapshot d'avant migration, cache
  // vidé, autre poste). Tout écran qui EXIGE ce cerveau concluait alors « aucun
  // skill cerveau actif » et refusait l'audit, une seconde avant que le serveur ne
  // le livre. Distinguer « pas encore arrivé » de « vraiment absent » est la seule
  // façon de dire quelque chose de vrai au rédacteur — les deux appellent des
  // gestes opposés (attendre / aller en créer un).
  initialState: { list: load(STORAGE_KEYS.skills), loading: false, bootstrapped: false },
  reducers: {
    setSkills: (state, action) => { state.list = mergeDefaultSkills(action.payload); },
    setSkillsBootstrapped: (state, action) => { state.bootstrapped = action.payload !== false; },
    addSkill: (state, action) => { state.list.unshift(action.payload); },
    updateSkill: (state, action) => {
      const idx = state.list.findIndex(s => s.id === action.payload.id);
      if (idx !== -1) state.list[idx] = action.payload;
    },
    removeSkill: (state, action) => { state.list = state.list.filter(s => s.id !== action.payload); },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});

export const {
  setSkills, addSkill, updateSkill, removeSkill, setLoading, setSkillsBootstrapped,
} = skillsSlice.actions;
export default skillsSlice.reducer;
