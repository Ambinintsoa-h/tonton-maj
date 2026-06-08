import {
  saveActivitySession,
  updateActivityHeartbeat,
  recordActivityPause,
  recordActivityAction,
  recordSessionClose,
} from './firebase';

const HEARTBEAT_MS = 2 * 60 * 1000;   // 2 min
const INACTIVE_MS  = 10 * 60 * 1000;  // 10 min sans activité → pause
const THROTTLE_MS  = 30 * 1000;       // throttle mousemove / scroll
const CLOSE_KEY    = 'tonton_pending_close'; // clé localStorage pour la fermeture

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// ActivityTracker — singleton invisible, uniquement pour manager / cq_ia
// ─────────────────────────────────────────────────────────────────────────────
class ActivityTracker {
  constructor() {
    this._uid          = null;
    this._role         = null;
    this._name         = null;
    this._lastEvent    = 0;
    this._throttleTs   = 0;
    this._pauseStart   = null;
    this._today        = null;
    this._initializing = false;
    this._ready        = false;
    this._timer        = null;

    // Bindings stables
    this._direct       = this._onDirect.bind(this);
    this._throttled    = this._onThrottled.bind(this);
    this._beforeunload = this._onClose.bind(this);
    this._pagehide     = this._onPageHide.bind(this);
  }

  /**
   * Initialise le tracker — appelé une seule fois après connexion.
   * Si déjà initialisé, no-op.
   */
  init(uid, role, name) {
    if (this._uid) return;
    this._uid   = uid;
    this._role  = role;
    this._name  = name;
    this._today = localDate();

    // Récupère et sync le close en attente de la session précédente
    this._syncPendingClose();

    window.addEventListener('click',        this._direct);
    window.addEventListener('keydown',      this._direct);
    window.addEventListener('mousemove',    this._throttled);
    window.addEventListener('scroll',       this._throttled, { passive: true });
    window.addEventListener('beforeunload', this._beforeunload);
    window.addEventListener('pagehide',     this._pagehide);

    this._timer = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
  }

  /**
   * Détruit le tracker — appelé à la déconnexion.
   */
  destroy() {
    window.removeEventListener('click',        this._direct);
    window.removeEventListener('keydown',      this._direct);
    window.removeEventListener('mousemove',    this._throttled);
    window.removeEventListener('scroll',       this._throttled);
    window.removeEventListener('beforeunload', this._beforeunload);
    window.removeEventListener('pagehide',     this._pagehide);
    clearInterval(this._timer);
    this._uid          = null;
    this._ready        = false;
    this._initializing = false;
    this._pauseStart   = null;
  }

  /**
   * Enregistre une action métier (articles, tickets…).
   * Importé et appelé depuis Articles.jsx et Tickets.jsx.
   * No-op si le tracker n'est pas initialisé (super_admin).
   */
  trackAction(type) {
    if (!this._uid || !this._ready) return;
    this._signal();
    recordActivityAction(this._uid, this._today, type).catch(() => {});
  }

  // ── Fermeture navigateur ─────────────────────────────────────────────────────

  /**
   * Appelé sur beforeunload / pagehide (fermeture onglet, refresh, navigation externe).
   * Enregistre le timestamp de dernière activité comme "heure de fermeture".
   * localStorage d'abord (synchrone, garanti), Firestore en parallèle (async).
   */
  _onClose() {
    if (!this._uid || !this._ready) return;
    const closeTime = this._lastEvent > 0 ? this._lastEvent : Date.now();
    // Écriture synchrone en localStorage — survivra à la fermeture
    try {
      localStorage.setItem(CLOSE_KEY, JSON.stringify({
        uid: this._uid, date: this._today, closeTime,
      }));
    } catch {}
    // Tentative Firestore (peut ne pas aboutir si l'onglet se ferme trop vite)
    recordSessionClose(this._uid, this._today, closeTime).catch(() => {});
  }

  _onPageHide(event) {
    // persisted=true = page mise en bfcache, pas vraiment fermée
    if (event.persisted) return;
    this._onClose();
  }

  /**
   * Au prochain init(), synchonise le close stocké en localStorage vers Firestore.
   * Couvre le cas où l'onglet s'est fermé avant que la requête Firestore n'aboutisse.
   */
  _syncPendingClose() {
    try {
      const raw = localStorage.getItem(CLOSE_KEY);
      if (!raw) return;
      localStorage.removeItem(CLOSE_KEY);
      const { uid, date, closeTime } = JSON.parse(raw);
      if (uid === this._uid) {
        recordSessionClose(uid, date, closeTime).catch(() => {});
      }
    } catch {}
  }

  // ── Gestionnaires d'événements ───────────────────────────────────────────────

  _onDirect() {
    this._signal();
  }

  _onThrottled() {
    const now = Date.now();
    if (now - this._throttleTs < THROTTLE_MS) return;
    this._throttleTs = now;
    this._signal();
  }

  // ── Logique interne ──────────────────────────────────────────────────────────

  _signal() {
    if (!this._uid) return;
    const now = Date.now();

    // Fin de pause : l'utilisateur revient après inactivité
    if (this._pauseStart) {
      const pauseDuration = now - this._pauseStart;
      // Ignorer les pauses cross-midnight (> 8h) — elles correspondent à la nuit,
      // pas à une vraie inactivité dans la session de travail du jour.
      const MAX_PAUSE_MS = 8 * 60 * 60 * 1000;
      if (pauseDuration > 0 && pauseDuration <= MAX_PAUSE_MS) {
        recordActivityPause(this._uid, this._today, {
          start: this._pauseStart,
          end:   now,
        }).catch(() => {});
      }
      this._pauseStart = null;
    }

    this._lastEvent = now;

    // Changement de jour — réinitialiser la session
    const today = localDate();
    if (today !== this._today) {
      this._today        = today;
      this._ready        = false;
      this._initializing = false;
    }

    // Créer la session du jour si pas encore fait
    if (!this._ready && !this._initializing) this._createSession(now);
  }

  _createSession(now) {
    this._initializing = true;
    saveActivitySession({
      userId:           this._uid,
      userRole:         this._role,
      userName:         this._name,
      date:             this._today,
      firstActivityAt:  now,
      lastActivityAt:   now,

    })
      .then(() => {
        this._ready        = true;
        this._initializing = false;
      })
      .catch(() => {
        this._initializing = false; // autorise une nouvelle tentative
      });
  }

  _heartbeat() {
    if (!this._uid || !this._ready) return;

    const now   = Date.now();
    const since = now - this._lastEvent;

    // Changement de jour en cours de session
    const today = localDate();
    if (today !== this._today) {
      this._today        = today;
      this._ready        = false;
      this._initializing = false;
      this._pauseStart   = null; // annuler la pause cross-midnight (nuit ≠ inactivité)
      return;
    }

    if (since > INACTIVE_MS) {
      // Marquer le début de pause (une seule fois)
      if (!this._pauseStart && this._lastEvent > 0) this._pauseStart = this._lastEvent;
      return;
    }

    // Utilisateur actif → heartbeat Firestore
    updateActivityHeartbeat(this._uid, this._today, new Date().getHours()).catch(() => {});
  }
}

// Singleton exporté
const tracker = new ActivityTracker();
export default tracker;
