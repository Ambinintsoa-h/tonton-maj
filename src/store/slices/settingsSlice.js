import { createSlice } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '../../constants/storage';

// Config Firebase par défaut (projet tonton-ai-c8196)
// Exportée pour AppInit — la sécurité vient des règles Firestore, pas de cette config.
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAe-ZxaFzfMWSalo9d7WEWoIoaGhL2WCvg',
  authDomain: 'tonton-ai-c8196.firebaseapp.com',
  projectId: 'tonton-ai-c8196',
  storageBucket: 'tonton-ai-c8196.firebasestorage.app',
  messagingSenderId: '931975714834',
  appId: '1:931975714834:web:c4681d0589f9041541e0cb',
};

// Prix officiels Anthropic par défaut (USD / million de tokens).
// Modifiables via Paramètres → Tarification sans toucher au code.
export const DEFAULT_MODEL_PRICING = {
  'claude-haiku-4-5':  { input: 0.80,  output: 4.00  },
  'claude-sonnet-4-5': { input: 3.00,  output: 15.00 },
  'claude-opus-4-5':   { input: 15.00, output: 75.00 },
};

// Charge les paramètres sauvegardés depuis localStorage au démarrage.
const loadSavedSettings = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.settings);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return {
      anthropicKey:   parsed.anthropicKey   || '',
      useLocalProxy:  parsed.useLocalProxy  || false,
      braveKey:       parsed.braveKey       || '',
      tavilyKey:      parsed.tavilyKey      || '',
      groqKey:        parsed.groqKey        || '',
      firebaseConfig: parsed.firebaseConfig || DEFAULT_FIREBASE_CONFIG,
      modelPricing:   parsed.modelPricing   || DEFAULT_MODEL_PRICING,
    };
  } catch { return {}; }
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState: {
    anthropicKey:  '',
    useLocalProxy: false,
    braveKey:      '',
    tavilyKey:     '',
    groqKey:       '',
    firebaseConfig: DEFAULT_FIREBASE_CONFIG,
    modelPricing:   DEFAULT_MODEL_PRICING,
    firebaseReady: false,
    loading: false,
    ...loadSavedSettings(),
  },
  reducers: {
    setSettings: (state, action) => ({ ...state, ...action.payload }),
    setFirebaseReady: (state, action) => { state.firebaseReady = action.payload; },
    setLoading: (state, action) => { state.loading = action.payload; },
  },
});

export const { setSettings, setFirebaseReady, setLoading } = settingsSlice.actions;
export default settingsSlice.reducer;
