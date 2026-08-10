import { createSlice } from '@reduxjs/toolkit';

// Exporté : « Vider le cache » (Header) préserve ce jeton pour garder la session.
export const TOKEN_KEY = 'tonton_auth_token';

// Décode le payload JWT sans vérifier la signature (vérification faite côté serveur sur chaque appel).
// Utilisé uniquement pour restaurer role/username/uid au rechargement de page (F5).
const decodeJwt = (token) => {
  try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
};

const getInitialState = () => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return {
    isAuthenticated: false, token: null,
    username: null, role: null, uid: null,
    nom: '', prenom: '', email: '', avatarUrl: '',
    twoFaEnabled: false, twoFaMethod: 'none',
    prompts: {},   // prompts personnels des phases 2 et 3, chargés par /api/account
  };
  // Restaurer role/username/uid depuis le payload — évite le menu réduit après F5
  const decoded = decodeJwt(token);
  return {
    isAuthenticated: true,
    token,
    username: decoded?.username || null,
    role:     decoded?.role     || null,
    uid:      decoded?.uid      || null,
    nom: '', prenom: '', email: '', avatarUrl: '',
    twoFaEnabled: false, twoFaMethod: 'none',
    prompts: {},   // prompts personnels des phases 2 et 3, chargés par /api/account
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
      const { nom, prenom, email, avatarUrl, twoFaEnabled, twoFaMethod, prompts } = action.payload;
      if (nom       !== undefined) state.nom       = nom;
      if (prenom    !== undefined) state.prenom    = prenom;
      if (email     !== undefined) state.email     = email;
      if (avatarUrl !== undefined) state.avatarUrl = avatarUrl;
      if (twoFaEnabled !== undefined) state.twoFaEnabled = twoFaEnabled;
      if (twoFaMethod  !== undefined) state.twoFaMethod  = twoFaMethod;
      // Prompts personnels du rédacteur (phases 2 et 3). Cette liste est un
      // FILTRE : un champ non cité ici n'atteint jamais le store, quoi que
      // renvoie /api/account.
      if (prompts   !== undefined) state.prompts   = prompts || {};
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
