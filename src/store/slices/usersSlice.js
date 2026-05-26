import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.users) || 'null') || []; }
  catch { return []; }
};

const usersSlice = createSlice({
  name: 'users',
  initialState: { list: load(), loading: false },
  reducers: {
    setUsers:   (state, action) => { state.list = action.payload; },
    addUser:    (state, action) => { state.list.unshift(action.payload); },
    updateUser: (state, action) => {
      const idx = state.list.findIndex(u => u.id === action.payload.id);
      if (idx !== -1) state.list[idx] = action.payload;
    },
    removeUser: (state, action) => {
      state.list = state.list.filter(u => u.id !== action.payload);
    },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});

export const { setUsers, addUser, updateUser, removeUser, setLoading } = usersSlice.actions;
export default usersSlice.reducer;
