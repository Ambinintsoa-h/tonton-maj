import { createSlice } from '@reduxjs/toolkit';
import { PHASE_AUDIT, initialPhaseStatus } from '../../constants/majPhases';

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
    // ── Parcours en QUATRE phases (voir constants/majPhases.js) ───────────────
    // Remplace le double flux « classique | qat », annoncé comme temporaire. Il n'y
    // a plus qu'un seul parcours, et l'ampleur (MAJ simple / refonte) se décide en
    // PHASE 2, une fois l'audit lu — plus au lancement, où le rédacteur n'avait
    // aucun élément pour trancher.
    phase: PHASE_AUDIT,                  // phase ouverte dans l'éditeur
    phaseStatus: initialPhaseStatus(),   // { audit, generation, obsolescence, relecture }
    majScope: null,                      // simple | refonte — null tant que le rédacteur n'a pas tranché
    linkAudit: null,                     // inventaire des liens de l'original (pré-requis de l'audit)
    obsolescenceReport: null,            // suggestions de la phase 3
    auditJson: null,       // objet d'audit QAT { scores, ampleur, priority_actions… } — onglet AUDIT
    qatArticle: null,      // { titreSeo, metaDescription, h1, chapoHtml, wordCount, ampleurAppliquee… }
    // Rédaction en direct (streaming SSE) : on ne garde que la QUEUE du texte —
    // une refonte dépasse 100 000 caractères, inutile de la stocker en entier
    // dans Redux alors que l'affichage n'en montre que la fin.
    liveTail: '',
    liveChars: 0,
    // Métadonnées d'édition restaurées depuis le brouillon autosave (titre édité,
    // SEO Meta, date MAJ, image à la une, catégories) — consommées une fois par
    // ArticleResult pour rehydrater ses états locaux après un rechargement.
    editorMeta: null,
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
      state.phase = PHASE_AUDIT;
      state.phaseStatus = initialPhaseStatus();
      state.majScope = null;
      state.linkAudit = null;
      state.obsolescenceReport = null;
      state.auditJson = null;
      state.qatArticle = null;
      state.liveTail = '';
      state.liveChars = 0;
      state.editorMeta = null;
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
    setPhase: (state, action) => { state.phase = action.payload || PHASE_AUDIT; },
    setPhaseStatus: (state, action) => {
      // payload : { phase, status } — une phase à la fois, pour que l'appelant ne
      // puisse pas écraser par mégarde l'avancement des trois autres.
      const { phase, status } = action.payload || {};
      if (phase && status) state.phaseStatus = { ...state.phaseStatus, [phase]: status };
    },
    // Restauration EN BLOC de l'avancement, à la réouverture d'un article
    // (historique, file d'attente). Complète setPhaseStatus, qui ne touche qu'une
    // phase à la fois pendant le déroulé normal.
    restorePhaseStatus: (state, action) => {
      state.phaseStatus = { ...initialPhaseStatus(), ...(action.payload || {}) };
    },
    setMajScope: (state, action) => { state.majScope = action.payload || null; },
    setLinkAudit: (state, action) => { state.linkAudit = action.payload || null; },
    setObsolescenceReport: (state, action) => { state.obsolescenceReport = action.payload || null; },
    setAuditJson: (state, action) => { state.auditJson = action.payload || null; },
    setQatArticle: (state, action) => { state.qatArticle = action.payload || null; },
    setLiveText: (state, action) => {
      state.liveTail  = action.payload?.tail  || '';
      state.liveChars = action.payload?.chars || 0;
    },
    clearLiveText: (state) => { state.liveTail = ''; state.liveChars = 0; },
    setEditorMeta: (state, action) => { state.editorMeta = action.payload || null; },
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
  setWpData, setInternalLinks, setInternalLinksInfo, setTargetKeyword, setMajDepth, setInstruction, setAudit, setEditorMeta, setDraftStatus,
  setPhase, setPhaseStatus, restorePhaseStatus, setMajScope, setLinkAudit, setObsolescenceReport,
  setAuditJson, setQatArticle, setLiveText, clearLiveText,
} = agentSlice.actions;
export default agentSlice.reducer;
