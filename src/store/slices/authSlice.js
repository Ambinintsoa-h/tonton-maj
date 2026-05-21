import { createSlice } from '@reduxjs/toolkit';

const TOKEN_KEY = 'tonton_auth_token';

const getInitialState = () => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  return {
    isAuthenticated: !!token,
    token: token || null,
    username: null,
    role: null,
  };
};

const authSlice = createSlice({
  name: 'auth',
  initialState: getInitialState(),
  reducers: {
    loginSuccess(state, action) {
      const { token, username, role } = action.payload;
      state.isAuthenticated = true;
      state.token = token;
      state.username = username;
      state.role = role;
      sessionStorage.setItem(TOKEN_KEY, token);
    },
    logout(state) {
      state.isAuthenticated = false;
      state.token = null;
      state.username = null;
      state.role = null;
      sessionStorage.removeItem(TOKEN_KEY);
    },
  },
});

export const { loginSuccess, logout } = authSlice.actions;
export default authSlice.reducer;
