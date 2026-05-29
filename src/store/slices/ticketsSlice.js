import { createSlice } from '@reduxjs/toolkit';

const ticketsSlice = createSlice({
  name: 'tickets',
  initialState: { list: [], loading: false },
  reducers: {
    setTickets: (state, action) => { state.list = action.payload; },
    addTicket: (state, action) => { state.list.unshift(action.payload); },
    updateTicket: (state, action) => {
      const idx = state.list.findIndex(t => t.id === action.payload.id);
      if (idx !== -1) state.list[idx] = { ...state.list[idx], ...action.payload };
    },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});
export const { setTickets, addTicket, updateTicket, setLoading } = ticketsSlice.actions;
export default ticketsSlice.reducer;
