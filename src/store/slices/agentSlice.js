import { createSlice } from '@reduxjs/toolkit';

const agentSlice = createSlice({
  name: 'agent',
  initialState: {
    status: 'idle', // idle | running | done | error
    steps: [],
    currentStep: '',
    progress: 0,
    originalContent: '',
    updatedContent: '',
    diff: [],
    sources: [],
    analysis: '',
    error: null,
    currentArticleId: null,  // ID de l'entrée historique en cours — pour la mettre à jour après passe 2
    tokenUsage: null, // { input, output, costUsd, calls: [{model, input, output}] }
    parseFailed: false,  // true si Claude a répondu mais le JSON n'a pas pu être parsé
    wpData: null,  // { siteId, siteName, postId, postType, featuredMediaId, featuredMediaUrl, postLink }
  },
  reducers: {
    resetAgent: (state) => {
      state.status = 'idle';
      state.steps = [];
      state.currentStep = '';
      state.progress = 0;
      state.originalContent = '';
      state.updatedContent = '';
      state.diff = [];
      state.sources = [];
      state.analysis = '';
      state.error = null;
      state.currentArticleId = null;
      state.tokenUsage = null;
      state.parseFailed = false;
      state.wpData = null;
    },
    setStatus: (state, action) => { state.status = action.payload; },
    addStep: (state, action) => {
      state.steps.push({ text: action.payload, ts: Date.now() });
      state.currentStep = action.payload;
    },
    setProgress: (state, action) => { state.progress = action.payload; },
    setOriginalContent: (state, action) => { state.originalContent = action.payload; },
    setUpdatedContent: (state, action) => { state.updatedContent = action.payload; },
    setDiff: (state, action) => { state.diff = action.payload; },
    setSources: (state, action) => { state.sources = action.payload; },
    setAnalysis: (state, action) => { state.analysis = action.payload; },
    setError: (state, action) => { state.error = action.payload; state.status = 'error'; },
    setCurrentArticleId: (state, action) => { state.currentArticleId = action.payload; },
    setTokenUsage: (state, action) => { state.tokenUsage = action.payload; },
    setParseFailed: (state, action) => { state.parseFailed = action.payload; },
    setWpData: (state, action) => { state.wpData = action.payload; },
  },
});

export const {
  resetAgent, setStatus, addStep, setProgress,
  setOriginalContent, setUpdatedContent, setDiff, setSources,
  setAnalysis, setError, setCurrentArticleId, setTokenUsage, setParseFailed,
  setWpData,
} = agentSlice.actions;
export default agentSlice.reducer;
