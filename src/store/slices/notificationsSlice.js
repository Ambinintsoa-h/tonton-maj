import { createSlice } from '@reduxjs/toolkit';

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: { list: [], unreadCount: 0 },
  reducers: {
    setNotifications: (state, action) => {
      state.list = action.payload;
      state.unreadCount = action.payload.filter(n => !n.read).length;
    },
    addNotification: (state, action) => {
      // Éviter les doublons
      if (state.list.find(n => n.id === action.payload.id)) return;
      state.list.unshift(action.payload);
      if (!action.payload.read) state.unreadCount = Math.max(0, state.unreadCount + 1);
    },
    markRead: (state, action) => {
      const n = state.list.find(n => n.id === action.payload);
      if (n && !n.read) { n.read = true; state.unreadCount = Math.max(0, state.unreadCount - 1); }
    },
    markAllRead: (state) => {
      state.list.forEach(n => { n.read = true; });
      state.unreadCount = 0;
    },
  },
});
export const { setNotifications, addNotification, markRead, markAllRead } = notificationsSlice.actions;
export default notificationsSlice.reducer;
