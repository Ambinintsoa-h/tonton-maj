import { store } from '../store';
import { PHASE_OBSOLESCENCE, PHASE_RELECTURE } from '../constants/majPhases';
import { ensureRelectureTimeDoc, recordRelectureTime, recordRelectureAiTime } from './firebase';

// ─────────────────────────────────────────────────────────────────────────────
// RelectureTimeTracker — temps de RELECTURE (phases 3 Obsolescence + 4
// Relecture UNIQUEMENT — jamais l'audit ni la génération), par jour, séparé en
// deux compteurs :
//   • hors Tonton — temps actif humain (heartbeat idle-gaté, identique dans
//     l'esprit à articleTimeTracker.js) ;
//   • avec Tonton — le même total, PLUS la durée des appels IA qui se
//     déclenchent PENDANT cette fenêtre (passe de style, réécriture de
//     passage/section, vérification obsolescence).
// `avec Tonton` est donc toujours ≥ `hors Tonton` — rien à soustraire côté
// affichage.
//
// INDÉPENDANT d'`articleTimeTracker.js`, qui reste inchangé et continue de
// mesurer sa propre durée globale (lancement → publication). Le bloc idle/
// heartbeat ci-dessous est volontairement DUPLIQUÉ plutôt qu'extrait en
// commun : `articleTimeTracker.js` est un module sensible et déjà éprouvé —
// une extraction créerait un couplage qui obligerait à revalider les DEUX
// trackers à chaque futur ajustement de l'un.
//
// Bornage temporel : pas de signal unique « la génération vient de finir »
// (le stepper de phases autorise à naviguer librement entre 2/3/4, et
// rouvrir un article déjà avancé saute directement à sa phase la plus
// avancée). Le déclenchement est donc RÉACTIF : `enterWindow`/`leaveWindow`
// sont appelés depuis un `useEffect` sur `agent.phase` (ArticleResult.jsx),
// pas depuis un événement de fin de génération.
//
// Jour = date LOCALE du rédacteur (jamais recalculée serveur), même
// convention que `activity_sessions` / l'onglet « Détail par jour » de
// MemberStatsPanel.jsx — la cohérence des deux vues « par jour » du même
// panneau prime sur la réutilisation d'un helper UI depuis un service.
// ─────────────────────────────────────────────────────────────────────────────

const TICK_MS     = 60 * 1000;      // 1 minute
const IDLE_MS     = 5 * 60 * 1000;  // 5 min sans activité → pause
const THROTTLE_MS = 10 * 1000;      // throttle mousemove / scroll

const RELECTURE_PHASES = new Set([PHASE_OBSOLESCENCE, PHASE_RELECTURE]);

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

class RelectureTimeTracker {
  constructor() {
    this._articleId    = null;
    this._meta         = null;   // { title, url }
    this._user         = null;   // { userId, userName, userRole }
    this._lastEvent    = 0;
    this._throttleTs   = 0;
    this._timer        = null;
    this._active       = false;
    this._currentDate  = null;   // jour courant (localDate()) de la ligne créditée
    this._docReadyFor  = null;   // date pour laquelle ensureRelectureTimeDoc a réussi

    this._onEvent    = this._signal.bind(this);
    this._onThrottle = this._signalThrottled.bind(this);
  }

  /**
   * Entre dans la fenêtre de relecture pour cet article/utilisateur (appelé à
   * chaque fois que `agent.phase` devient Obsolescence ou Relecture).
   * Idempotent sur le même article+utilisateur — un re-render ne relance rien.
   */
  enterWindow({ articleId, title = '', url = '', userId, userName = '', userRole = '' }) {
    if (!articleId || !userId) { this.leaveWindow(); return; }
    if (this._active && this._articleId === articleId && this._user?.userId === userId) {
      this._lastEvent = Date.now();
      return;
    }
    if (this._active) this.leaveWindow();

    this._articleId    = articleId;
    this._meta         = { title, url };
    this._user         = { userId, userName, userRole };
    this._lastEvent    = Date.now();
    this._currentDate  = localDate();
    this._docReadyFor  = null;
    this._active       = true;

    window.addEventListener('click',     this._onEvent);
    window.addEventListener('keydown',   this._onEvent);
    window.addEventListener('mousemove', this._onThrottle);
    window.addEventListener('scroll',    this._onThrottle, { passive: true });
    this._timer = setInterval(() => this._tick(), TICK_MS);

    this._ensureDoc();
  }

  /** Quitte la fenêtre (changement de phase hors 3/4, changement d'article, démontage). */
  leaveWindow() {
    if (!this._active) return;
    window.removeEventListener('click',     this._onEvent);
    window.removeEventListener('keydown',   this._onEvent);
    window.removeEventListener('mousemove', this._onThrottle);
    window.removeEventListener('scroll',    this._onThrottle);
    clearInterval(this._timer);
    this._timer        = null;
    this._active       = false;
    this._articleId    = null;
    this._meta         = null;
    this._user         = null;
    this._currentDate  = null;
    this._docReadyFor  = null;
  }

  /**
   * À appeler juste AVANT un appel IA reachable en phase 3/4 (vérification
   * obsolescence, passe de style, réécriture de passage/section). Lit la
   * phase courante DANS LE STORE au moment de l'appel : les emplacements
   * comme RewritePanel ne sont pas filtrés par phase côté interface, donc
   * c'est ICI que se décide si l'appel compte pour la relecture.
   *
   * Ne bloque jamais, ne lève jamais — lecture/calcul synchrones uniquement.
   * @returns {object|null} un jeton à repasser à `markAiCallEnd`, ou `null`
   *   si l'appel ne doit pas être compté (hors phase 3/4, ou hors fenêtre).
   */
  markAiCallStart() {
    try {
      const phase = store.getState()?.agent?.phase;
      if (!RELECTURE_PHASES.has(phase)) return null;
      if (!this._active || !this._articleId || !this._user) return null;
      // Le jeton capture articleId/userId au moment du départ : un changement
      // de phase/article pendant que l'appel est en vol ne doit ni perdre ni
      // mal-attribuer ce temps.
      return { articleId: this._articleId, userId: this._user.userId, startedAt: Date.now() };
    } catch {
      return null;
    }
  }

  /**
   * À appeler dans un `finally`, juste après l'appel IA — que celui-ci ait
   * réussi ou échoué (le temps d'attente a été consommé dans les deux cas).
   * `token` null (appel non compté) → aucune action.
   */
  markAiCallEnd(token) {
    if (!token) return;
    const seconds = Math.round((Date.now() - token.startedAt) / 1000);
    if (seconds <= 0) return;
    // Crédité au jour où l'appel SE TERMINE (un appel à cheval sur minuit
    // reste rare et le choix n'a pas besoin d'être plus subtil que ça).
    const date = localDate();
    ensureRelectureTimeDoc(token.articleId, token.userId, date, {})
      .catch(() => {})
      .then(() => recordRelectureAiTime(token.articleId, token.userId, date, seconds).catch(() => {}));
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
    if (!this._articleId || !this._user || !this._currentDate) return;
    if (this._docReadyFor === this._currentDate) return;
    const date = this._currentDate;
    try {
      await ensureRelectureTimeDoc(this._articleId, this._user.userId, date, {
        userName: this._user.userName,
        userRole: this._user.userRole,
        title:    this._meta?.title || '',
        url:      this._meta?.url || '',
      });
      this._docReadyFor = date;
    } catch { /* réessayé au prochain tick */ }
  }

  _tick() {
    if (!this._active) return;
    // Inactif depuis > 5 min → cette minute ne compte pas
    if (Date.now() - this._lastEvent > IDLE_MS) return;
    // Changement de jour pendant que l'éditeur reste ouvert (rare, mais la
    // ligne du nouveau jour doit exister avant d'y créditer quoi que ce soit).
    const today = localDate();
    if (today !== this._currentDate) {
      this._currentDate = today;
      this._docReadyFor = null;
    }
    const articleId = this._articleId;
    const userId    = this._user.userId;
    const date      = this._currentDate;
    this._ensureDoc()
      .then(() => recordRelectureTime(articleId, userId, date, 60))
      .catch(() => {});
  }
}

const relectureTimeTracker = new RelectureTimeTracker();
export default relectureTimeTracker;
