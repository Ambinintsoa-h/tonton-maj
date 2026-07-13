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
    internalLinks: [],  // [{ anchor, url, title, reason }] — suggestions de liens internes
    internalLinksInfo: null,  // { reason, existingInternal, throttled } — explication quand 0 suggestion
    targetKeyword: '',  // mot-clé cible → focus keyphrase SEO (Yoast/RankMath/SEOPress) à la publication
    majDepth: 'standard',  // profondeur de MAJ (legere|standard|refonte) — transmise à la passe 2
    instruction: '',  // consigne libre de l'équipe → injectée dans les prompts (analyse + MAJ, passe 2)
    audit: '',  // rapport d'audit complet (markdown) produit par le skill SKILL.md — onglet AUDIT
    draftStatus: 'idle',   // idle | saving | saved | local — état de l'autosave (indicateur header)
    draftSavedAt: null,    // timestamp du dernier enregistrement réussi
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
      state.internalLinks = [];
      state.internalLinksInfo = null;
      state.targetKeyword = '';
      state.majDepth = 'standard';
      state.instruction = '';
      state.audit = '';
      state.draftStatus = 'idle';
      state.draftSavedAt = null;
    },
    setStatus: (state, action) => { state.status = action.payload; },
    addStep: (state, action) => {
      const text = action.payload;
      state.steps.push({ text, ts: Date.now() });
      state.currentStep = text;
    },
    replaceLastStep: (state, action) => {
      const text = action.payload;
      if (state.steps.length > 0) {
        state.steps[state.steps.length - 1] = { text, ts: Date.now() };
      } else {
        state.steps.push({ text, ts: Date.now() });
      }
      state.currentStep = text;
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
    setInternalLinks: (state, action) => { state.internalLinks = action.payload; },
    setInternalLinksInfo: (state, action) => { state.internalLinksInfo = action.payload; },
    setTargetKeyword: (state, action) => { state.targetKeyword = action.payload || ''; },
    setMajDepth: (state, action) => { state.majDepth = action.payload || 'standard'; },
    setInstruction: (state, action) => { state.instruction = action.payload || ''; },
    setAudit: (state, action) => { state.audit = action.payload || ''; },
    setDraftStatus: (state, action) => {
      // payload : { status, savedAt? }
      state.draftStatus = action.payload?.status ?? 'idle';
      if (action.payload?.savedAt) state.draftSavedAt = action.payload.savedAt;
    },
  },
});

export const {
  resetAgent, setStatus, addStep, replaceLastStep, setProgress,
  setOriginalContent, setUpdatedContent, setDiff, setSources,
  setAnalysis, setError, setCurrentArticleId, setTokenUsage, setParseFailed,
  setWpData, setInternalLinks, setInternalLinksInfo, setTargetKeyword, setMajDepth, setInstruction, setAudit, setDraftStatus,
} = agentSlice.actions;
export default agentSlice.reducer;
