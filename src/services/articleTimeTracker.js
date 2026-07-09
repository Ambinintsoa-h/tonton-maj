import { ensureArticleTimeDoc, recordArticleTime, markArticleTimePublished } from './firebase';

// ─────────────────────────────────────────────────────────────────────────────
// ArticleTimeTracker — temps ACTIF passé par l'éditeur sur UN article, du
// lancement de l'analyse jusqu'à la publication.
//
// Principe : singleton mono-article (l'utilisateur ne travaille que sur un
// article à la fois — les analyses de la file MajEnAttente tournent seules et
// ne comptent pas ; le temps du CQ démarre quand il OUVRE le résultat).
//   • begin({articleId|null, user…})  → lancement d'analyse / ouverture éditeur
//   • assignArticle(id, meta)         → l'id Firestore est connu (fin passe 1) ;
//                                       les minutes accumulées avant (buffer)
//                                       sont créditées rétroactivement
//   • markPublished()                 → publication WordPress réussie
//   • end()                           → fermeture de l'article / déconnexion
//
// Comptage : heartbeat 1 min ; une minute est créditée si l'utilisateur a eu
// une activité (clic/clavier/souris/scroll) dans les 5 dernières minutes →
// les pauses > 5 min ne comptent pas (temps réel de travail, pas calendaire).
// Écriture Firestore : increment(1) sur article_time/{articleId}_{userId}.
// ─────────────────────────────────────────────────────────────────────────────

const TICK_MS       = 60 * 1000;      // 1 minute
const IDLE_MS       = 5 * 60 * 1000;  // 5 min sans activité → pause
const THROTTLE_MS   = 10 * 1000;      // throttle mousemove / scroll

class ArticleTimeTracker {
  constructor() {
    this._articleId  = null;
    this._meta       = null;   // { title, url }
    this._user       = null;   // { userId, userName, userRole }
    this._buffered   = 0;      // minutes accumulées avant de connaître l'articleId
    this._lastEvent  = 0;
    this._throttleTs = 0;
    this._timer      = null;
    this._active     = false;
    this._docReady   = false;  // ensureArticleTimeDoc fait pour l'article courant

    this._onEvent    = this._signal.bind(this);
    this._onThrottle = this._signalThrottled.bind(this);
  }

  /** Démarre le suivi. articleId peut être null (analyse en cours, id pas encore créé). */
  begin({ articleId = null, title = '', url = '', userId, userName = '', userRole = '' }) {
    if (!userId) return;
    if (this._active && this._user?.userId === userId) {
      // Déjà en cours sur le même article → simple signal d'activité
      if (this._articleId === articleId) {
        this._lastEvent = Date.now();
        return;
      }
      // L'analyse en cours (id null) vient de recevoir son id Firestore
      // (setCurrentArticleId déclenche le begin() d'ArticleResult AVANT
      // l'assignArticle d'Articles.jsx) → transférer le buffer, ne pas repartir
      // de zéro.
      if (this._articleId === null && articleId) {
        this.assignArticle(articleId, { title, url });
        this._lastEvent = Date.now();
        return;
      }
    }
    if (this._active) this.end(); // changement d'article → clôturer proprement

    this._articleId = articleId;
    this._meta      = { title, url };
    this._user      = { userId, userName, userRole };
    this._buffered  = 0;
    this._lastEvent = Date.now();
    this._docReady  = false;
    this._active    = true;

    window.addEventListener('click',     this._onEvent);
    window.addEventListener('keydown',   this._onEvent);
    window.addEventListener('mousemove', this._onThrottle);
    window.addEventListener('scroll',    this._onThrottle, { passive: true });
    this._timer = setInterval(() => this._tick(), TICK_MS);

    if (articleId) this._ensureDoc();
  }

  /** L'articleId Firestore est connu → crédite le buffer accumulé pendant l'analyse. */
  assignArticle(articleId, meta = {}) {
    if (!this._active || !articleId) return;
    this._articleId = articleId;
    if (meta.title || meta.url) this._meta = { ...this._meta, ...meta };
    this._ensureDoc().then(() => {
      if (this._buffered > 0) {
        const minutes = this._buffered;
        this._buffered = 0;
        recordArticleTime(articleId, this._user.userId, minutes).catch(() => {});
      }
    });
  }

  /** Publication réussie → horodatage sur le doc temps. */
  markPublished() {
    if (!this._articleId || !this._user) return;
    markArticleTimePublished(this._articleId, this._user.userId).catch(() => {});
  }

  /** Fin de travail sur l'article (fermeture, Terminer, déconnexion). */
  end() {
    if (!this._active) return;
    window.removeEventListener('click',     this._onEvent);
    window.removeEventListener('keydown',   this._onEvent);
    window.removeEventListener('mousemove', this._onThrottle);
    window.removeEventListener('scroll',    this._onThrottle);
    clearInterval(this._timer);
    this._timer     = null;
    this._active    = false;
    this._articleId = null;
    this._meta      = null;
    this._buffered  = 0;
    this._docReady  = false;
  }

  // ── Interne ─────────────────────────────────────────────────────────────────

  _signal() {
    this._lastEvent = Date.now();
  }

  _signalThrottled() {
    const now = Date.now();
    if (now - this._throttleTs < THROTTLE_MS) return;
    this._throttleTs = now;
    this._lastEvent = now;
  }

  async _ensureDoc() {
    if (this._docReady || !this._articleId || !this._user) return;
    this._docReady = true;
    try {
      await ensureArticleTimeDoc(this._articleId, {
        userId:   this._user.userId,
        userName: this._user.userName,
        userRole: this._user.userRole,
        title:    this._meta?.title || '',
        url:      this._meta?.url || '',
      });
    } catch { this._docReady = false; }
  }

  _tick() {
    if (!this._active) return;
    // Inactif depuis > 5 min → cette minute ne compte pas
    if (Date.now() - this._lastEvent > IDLE_MS) return;
    if (this._articleId) {
      this._ensureDoc(); // filet : recrée le doc si l'ensure initial a échoué
      recordArticleTime(this._articleId, this._user.userId, 1).catch(() => {});
    } else {
      this._buffered += 1; // analyse en cours, id pas encore connu
    }
  }
}

const articleTimeTracker = new ArticleTimeTracker();
export default articleTimeTracker;
