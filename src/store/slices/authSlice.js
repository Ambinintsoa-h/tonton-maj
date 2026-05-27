import { createSlice } from '@reduxjs/toolkit';

const TOKEN_KEY = 'tonton_auth_token';

const getInitialState = () => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  return {
    isAuthenticated: !!token,
    token: token || null,
    username: null,
    role: null,
    uid: null,
    // Profil utilisateur (chargé après connexion)
    nom:       '',
    prenom:    '',
    email:     '',
    avatarUrl: '',
    twoFaEnabled: false,
    twoFaMethod:  'none',
  };
};

const authSlice = createSlice({
  name: 'auth',
  initialState: getInitialState(),
  reducers: {
    loginSuccess(state, action) {
      const { token, username, role, uid } = action.payload;
      state.isAuthenticated = true;
      state.token = token;
      state.username = username;
      state.role = role;
      state.uid = uid || null;
      sessionStorage.setItem(TOKEN_KEY, token);
    },
    setProfile(state, action) {
      const { nom, prenom, email, avatarUrl, twoFaEnabled, twoFaMethod } = action.payload;
      if (nom       !== undefined) state.nom       = nom;
      if (prenom    !== undefined) state.prenom    = prenom;
      if (email     !== undefined) state.email     = email;
      if (avatarUrl !== undefined) state.avatarUrl = avatarUrl;
      if (twoFaEnabled !== undefined) state.twoFaEnabled = twoFaEnabled;
      if (twoFaMethod  !== undefined) state.twoFaMethod  = twoFaMethod;
    },
    logout(state) {
      state.isAuthenticated = false;
      state.token = null;
      state.username = null;
      state.role = null;
      state.uid = null;
      state.nom = '';
      state.prenom = '';
      state.email = '';
      state.avatarUrl = '';
      state.twoFaEnabled = false;
      state.twoFaMethod = 'none';
      sessionStorage.removeItem(TOKEN_KEY);
    },
  },
});

export const { loginSuccess, setProfile, logout } = authSlice.actions;
export default authSlice.reducer;
