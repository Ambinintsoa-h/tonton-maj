/**
 * Proxy local ArticleAI
 * Auth : déchiffrement OSCrypt (Chromium/Electron) du token OAuth Claude Desktop
 * → appel direct API Anthropic sans spawner claude.exe
 * Fallback : claude.exe CLI si DPAPI indisponible
 */
const express = require('express');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const net = require('net');
const { spawn, execSync } = require('child_process');
const { createDecipheriv } = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const FormData = require('form-data');

// ── Décodeur HTML entities (WordPress renvoie &amp; &#8211; etc.) ─────────────
const decodeHtmlEntities = (str) => {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&#(\d+);/g,        (_, n)   => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
};
const axios = require('axios');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const nodemailer = require('nodemailer');
const dns = require('dns').promises;

const app = express();
app.set('trust proxy', 1); // Nginx devant en prod — req.ip = vraie IP client

// ─── Auth JWT ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'tonton-dev-secret-change-me-in-production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ─── Blacklist JWT (M2) ───────────────────────────────────────────────────────
// Permet la révocation immédiate d'un token avant son expiration.
// En mémoire (reset au redémarrage) — fenêtre de risque de 8h max après restart.
// Redis recommandé pour une révocation persistante.
// Nettoyage automatique des jti expirés toutes les heures.
const _revokedJti = new Map(); // jti → expiresAt (timestamp)

const revokeToken = (jti, expiresAt) => { _revokedJti.set(jti, expiresAt); };
const isTokenRevoked = (jti) => _revokedJti.has(jti);

// Purge des entrées expirées (pas besoin de garder des jti dont le token est déjà expiré)
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of _revokedJti) {
    if (expiresAt < now) _revokedJti.delete(jti);
  }
}, 60 * 60 * 1000);

const requireAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié — connectez-vous sur /login' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    // Guard path traversal : username utilisé dans des chemins de fichiers
    if (req.user.username && !SAFE_USERNAME_RE.test(req.user.username)) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    // M2 — Vérifier que le token n'a pas été révoqué
    if (req.user.jti && isTokenRevoked(req.user.jti)) {
      return res.status(401).json({ error: 'Session révoquée — reconnectez-vous' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Token JWT invalide ou expiré' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  const r = req.user?.role;
  if (!r || !roles.includes(r)) return res.status(403).json({ error: 'Accès refusé' });
  next();
};

// ─── Firebase Admin SDK ───────────────────────────────────────────────────────
let firebaseAdmin = null;
try {
  const _admin = require('firebase-admin');
  const saPath = path.join(__dirname, 'data', 'firebase-service-account.json');
  if (fs.existsSync(saPath)) {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    if (!_admin.apps.length) _admin.initializeApp({ credential: _admin.credential.cert(sa) });
    firebaseAdmin = _admin;
    console.log('[firebase-admin] ✓ Initialisé');
  } else {
    console.warn('[firebase-admin] ⚠ data/firebase-service-account.json manquant');
  }
} catch (e) { console.error('[firebase-admin] Erreur :', e.message); }

// ─── CORS restreint selon l'environnement ────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Vérifications de sécurité au démarrage ───────────────────────────────────
if (IS_PROD) {
  if (JWT_SECRET === 'tonton-dev-secret-change-me-in-production') {
    console.error('[SECURITY] ✗ JWT_SECRET non configuré — définissez JWT_SECRET dans .env en production');
    process.exit(1);
  }
  if (ADMIN_PASSWORD === 'admin') {
    console.error('[SECURITY] ✗ ADMIN_PASSWORD par défaut — définissez ADMIN_PASSWORD dans .env en production');
    process.exit(1);
  }
}

// ─── Constantes de validation ─────────────────────────────────────────────────
const VALID_ROLES       = new Set(['super_admin', 'manager', 'cq_ia']);
const SAFE_USERNAME_RE  = /^[a-zA-Z0-9._-]{1,64}$/; // point autorisé (colonel.sanders) — path.basename() protège du traversal
const SETTINGS_WHITELIST = [
  'anthropicKey', 'groqKey', 'braveKey', 'tavilyKey', 'haloscanKey',
  'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom',
  'firebaseConfig', 'useLocalProxy',
];

app.use(cors({
  origin: IS_PROD
    ? ['https://maj.stomos.net']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Force UTF-8 sur toutes les réponses JSON ──────────────────────────────────
app.use((_req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return orig(body);
  };
  next();
});

// ─── Headers de sécurité HTTP ──────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: IS_PROD ? {
    directives: {
      defaultSrc:  ["'self'"],
      // CRA produit des chunks JS séparés → 'unsafe-inline' non requis en prod.
      // Si une régression CSP survient, vérifier avec INLINE_RUNTIME_CHUNK=false dans .env.
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],  // requis par Tailwind/inline styles
      imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc:  [
        "'self'",
        'https://api.anthropic.com',
        'https://api.groq.com',
        'https://r.jina.ai',
        'https://s.jina.ai',
        'https://firestore.googleapis.com',
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
      ],
      fontSrc:     ["'self'", 'data:'],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      upgradeInsecureRequests: [],
    },
  } : false,
}));

// ─── Protection SSRF : bloque les IPs internes / loopback / link-local ────────
// Sans cette validation, /api/scrape et /api/wordpress permettent de faire fetcher
// au proxy n'importe quelle URL interne (127.x, 192.168.x, 169.254.x, AWS metadata…).
const isPrivateHost = (hostname) => {
  // Résolution IPv4 directe
  if (net.isIPv4(hostname)) {
    const [a, b] = hostname.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)  // link-local / AWS IMDS
    );
  }
  // IPv6 loopback / ULA / link-local
  if (net.isIPv6(hostname)) {
    const h = hostname.toLowerCase();
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }
  // Noms d'hôtes locaux
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost');
};

const assertSafeUrl = async (raw, label = 'URL') => {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} invalide`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Protocole non autorisé : ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`Accès réseau interne interdit (${parsed.hostname})`);
  }
  // Résolution DNS : bloque le DNS rebinding (domaine public → IP privée)
  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateHost(address)) {
      throw new Error(`Accès réseau interne interdit via DNS (${address})`);
    }
  } catch (e) {
    if (e.message.startsWith('Accès')) throw e;
    throw new Error(`${label} : hostname non résolvable (${parsed.hostname})`);
  }
  return parsed;
};

// ─── Helper erreur (M4) ───────────────────────────────────────────────────────
// En production, ne jamais exposer e.message dans les 500 — cache la structure interne.
// En dev, retourner le message réel pour faciliter le debug.
const safeError = (e, publicMsg = 'Erreur interne du serveur') =>
  IS_PROD ? publicMsg : (e?.message || publicMsg);

// ─── Fichiers statiques React (production uniquement) ────────────────────────
if (IS_PROD) {
  app.use(express.static(path.join(__dirname, 'build')));
}

// ─── 2FA — stockage local dans data/2fa/{username}.json ─────────────────────
const TFA_DIR = path.join(__dirname, 'data', '2fa');
const read2fa  = (u) => { try { return JSON.parse(fs.readFileSync(path.join(TFA_DIR, `${path.basename(u)}.json`), 'utf8')); } catch { return {}; } };
const write2fa = (u, d) => { if (!fs.existsSync(TFA_DIR)) fs.mkdirSync(TFA_DIR, { recursive: true }); fs.writeFileSync(path.join(TFA_DIR, `${path.basename(u)}.json`), JSON.stringify(d, null, 2), 'utf8'); };

// ─── Profil utilisateur — data/profiles/{username}.json ─────────────────────
const PROFILES_DIR = path.join(__dirname, 'data', 'profiles');
const readProfile  = (u) => { try { return JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, `${path.basename(u)}.json`), 'utf8')); } catch { return {}; } };
const writeProfile = (u, d) => { if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true }); fs.writeFileSync(path.join(PROFILES_DIR, `${path.basename(u)}.json`), JSON.stringify(d, null, 2), 'utf8'); };

// Hashage HMAC-SHA256 des codes OTP email avant stockage (jamais en clair sur disque)
const hashOtp = (code) => require('crypto').createHmac('sha256', JWT_SECRET).update(String(code)).digest('hex');

// ─── Envoi email OTP ──────────────────────────────────────────────────────────
const sendEmailOtp = async (toEmail, code) => {
  const s = readServerSettings();
  if (!s.smtpHost || !s.smtpUser || !s.smtpPass) throw new Error('SMTP non configuré dans les paramètres');
  const transporter = nodemailer.createTransport({
    host: s.smtpHost, port: s.smtpPort || 587, secure: (s.smtpPort || 587) === 465,
    auth: { user: s.smtpUser, pass: s.smtpPass },
  });
  await transporter.sendMail({
    from: s.smtpFrom || s.smtpUser,
    to: toEmail,
    subject: 'TONTON AI — Code de connexion',
    text: `Votre code de vérification : ${code}\n\nCe code expire dans 10 minutes.`,
    html: `<p style="font-size:16px">Votre code de vérification :</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p style="color:#999;font-size:13px">Ce code expire dans 10 minutes.</p>`,
  });
};

// ─── Envoi email d'invitation nouveau membre ──────────────────────────────────
const sendInviteEmail = async ({ toEmail, firstName, username, resetLink }) => {
  const s = readServerSettings();
  if (!s.smtpHost || !s.smtpUser || !s.smtpPass) {
    console.warn('[invite] SMTP non configuré — email d\'invitation non envoyé');
    return;
  }
  const loginUrl = IS_PROD ? 'https://maj.stomos.net' : 'http://localhost:3000';
  const transporter = nodemailer.createTransport({
    host: s.smtpHost, port: s.smtpPort || 587, secure: (s.smtpPort || 587) === 465,
    auth: { user: s.smtpUser, pass: s.smtpPass },
  });
  await transporter.sendMail({
    from: s.smtpFrom || s.smtpUser,
    to: toEmail,
    subject: 'TONTON AI — Votre accès à la plateforme',
    text: [
      `Bonjour ${firstName},`,
      '',
      'Votre compte TONTON AI a été créé. Voici votre identifiant de connexion :',
      `  Identifiant : ${username}`,
      resetLink ? `  Définissez votre mot de passe : ${resetLink}` : '  Contactez un administrateur pour définir votre mot de passe.',
      '',
      `Connectez-vous ici : ${loginUrl}`,
      '',
      'Pensez à changer votre mot de passe après votre première connexion.',
      '',
      'L\'équipe PUBLITHINGS',
    ].join('\n'),
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
        <!-- Header -->
        <div style="background:#111;padding:32px 36px 24px">
          <p style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.02em">TONTON AI</p>
          <p style="margin:4px 0 0;color:#aaa;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em">PUBLITHINGS</p>
        </div>
        <!-- Body -->
        <div style="padding:32px 36px">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Bonjour ${firstName} 👋</p>
          <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">
            Votre compte a été créé sur la plateforme TONTON AI.<br>
            Voici vos identifiants de connexion :
          </p>
          <!-- Credentials -->
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:6px 0;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.06em;width:130px">Identifiant</td>
                <td style="padding:6px 0;font-size:15px;font-weight:700;color:#111;font-family:monospace">${username}</td>
              </tr>
              ${resetLink ? `<tr>
                <td style="padding:6px 0;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.06em">Mot de passe</td>
                <td style="padding:6px 0;font-size:15px;color:#111"><a href="${resetLink}" style="color:#111;font-weight:700">Définir mon mot de passe →</a></td>
              </tr>` : ''}
            </table>
          </div>
          <!-- CTA -->
          <a href="${loginUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 28px;border-radius:999px;letter-spacing:0.01em">
            Se connecter →
          </a>
          <p style="margin:24px 0 0;color:#aaa;font-size:12px;line-height:1.6">
            🔐 Le lien de définition de mot de passe expire dans 24h.
          </p>
        </div>
      </div>
    `,
  });
  console.log(`[invite] ✓ Email d'invitation envoyé à ${toEmail}`);
};

// ─── Rate limiter intégré ─────────────────────────────────────────────────────
// Enregistré ICI, avant les routes auth, pour couvrir /api/auth/login etc.
// Limite générale : 60 req/min/IP. Limite auth : 10 req/min/IP (anti brute-force).
const _rl     = new Map();
const _rlAuth = new Map();

const makeRateLimiter = (store, max) => (req, res, next) => {
  const key = req.ip || 'local';
  const now = Date.now();
  const e = store.get(key) || { n: 0, t: now };
  if (now - e.t > 60_000) { store.set(key, { n: 1, t: now }); return next(); }
  if (e.n >= max) return res.status(429).json({ error: 'Trop de requêtes — réessayez dans une minute.' });
  e.n++;
  store.set(key, e);
  next();
};

const rateLimiter     = makeRateLimiter(_rl,     60);
const authRateLimiter = makeRateLimiter(_rlAuth, 10);

// ─── Lockout IP après échecs répétés (H2) ─────────────────────────────────────
// Complète le rate limiter : après 5 échecs de credentials, verrouille l'IP 15 min.
// En mémoire (reset au redémarrage) — acceptable pour un outil interne.
// Redis recommandé pour un verrouillage persistant.
const _loginFailures = new Map(); // IP → { count, lockedUntil }

const isLoginLocked = (ip) => {
  const r = _loginFailures.get(ip);
  if (!r) return false;
  if (r.lockedUntil > Date.now()) return true;
  // Verrouillage expiré — purger
  _loginFailures.delete(ip);
  return false;
};

const recordLoginFailure = (ip) => {
  const r = _loginFailures.get(ip) || { count: 0, lockedUntil: 0 };
  r.count++;
  if (r.count >= 5) {
    r.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 min
    console.warn(`[auth] ⚠ IP ${ip} verrouillée 15 min (${r.count} échecs consécutifs)`);
  }
  _loginFailures.set(ip, r);
};

const clearLoginFailure = (ip) => { _loginFailures.delete(ip); };

app.use('/api/', rateLimiter);

// ─── Route de login (publique — pas d'auth requise) ──────────────────────────
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const { username, password, twoFaCode, tempToken } = req.body || {};

  // ── Étape 2 : vérification du code 2FA ──────────────────────────────────────
  if (tempToken && twoFaCode) {
    let decoded;
    try { decoded = jwt.verify(tempToken, JWT_SECRET); } catch { return res.status(401).json({ error: 'Session 2FA expirée — reconnectez-vous' }); }
    if (decoded.type !== 'tfa_pending') return res.status(401).json({ error: 'Token invalide' });
    const tfa = read2fa(decoded.username);
    let valid = false;
    if (tfa.method === 'totp') {
      valid = speakeasy.totp.verify({ secret: tfa.totpSecret, encoding: 'base32', token: twoFaCode.replace(/\s/g, ''), window: 1 });
    } else if (tfa.method === 'email') {
      valid = hashOtp(twoFaCode) === tfa.emailCode && Date.now() < (tfa.emailCodeExpiry || 0);
    }
    if (!valid) return setTimeout(() => res.status(401).json({ error: 'Code incorrect' }), 500);
    // uid présent si le tempToken vient d'un compte Firebase (firebase-login)
    const payload = { username: decoded.username, role: decoded.role, jti: require('crypto').randomUUID() };
    if (decoded.uid) payload.uid = decoded.uid;
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token, role: decoded.role, username: decoded.username, uid: decoded.uid || null });
  }

  // ── Étape 1 : username + password ───────────────────────────────────────────
  if (!username || !password) return res.status(400).json({ success: false, error: 'username et password requis' });

  // H2 — Lockout IP après 5 échecs consécutifs
  const clientIp = req.ip || 'local';
  if (isLoginLocked(clientIp)) {
    return res.status(429).json({ success: false, error: 'Trop de tentatives — accès verrouillé 15 minutes' });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const tfa = read2fa(username);
    if (tfa.enabled) {
      // Email OTP : générer et envoyer le code
      if (tfa.method === 'email') {
        const profile = readProfile(username);
        const email = profile.email || tfa.email;
        if (!email) return res.status(400).json({ error: 'Aucune adresse email configurée pour la 2FA' });
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        write2fa(username, { ...tfa, emailCode: hashOtp(code), emailCodeExpiry: Date.now() + 10 * 60 * 1000 });
        try { await sendEmailOtp(email, code); } catch (e) { return res.status(500).json({ error: `Échec envoi email : ${e.message}` }); }
      }
      const tempToken = jwt.sign({ username, role: 'super_admin', type: 'tfa_pending' }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ success: true, requires2fa: true, method: tfa.method, tempToken });
    }
    clearLoginFailure(clientIp); // credentials corrects → réinitialiser le compteur
    const token = jwt.sign({ username, role: 'super_admin', jti: require('crypto').randomUUID() }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token, role: 'super_admin', username });
  }
  // Identifiants incorrects — enregistrer l'échec + délai anti-bruteforce
  recordLoginFailure(clientIp);
  setTimeout(() => res.status(401).json({ success: false, error: 'Identifiants incorrects' }), 500);
});

// ─── Logout — révocation immédiate du token (M2) ──────────────────────────────
app.post('/api/auth/logout', requireAuth, (req, res) => {
  if (req.user.jti) {
    // Calculer l'expiration du token pour purger automatiquement après 8h
    const expiresAt = (req.user.exp || 0) * 1000 || Date.now() + 8 * 60 * 60 * 1000;
    revokeToken(req.user.jti, expiresAt);
    console.log(`[auth] Token révoqué — user: ${req.user.username}, jti: ${req.user.jti}`);
  }
  res.json({ success: true });
});

// ─── Résoudre username → email (public, pour le flow Firebase Auth) ───────────
// H3 — Rate limit strict (5/min/IP) pour limiter l'énumération de comptes.
// Note : cet endpoint retourne l'email si le username existe (nécessaire pour le
// flow Firebase Auth signInWithEmailAndPassword). Limitation structurelle documentée.
const _rlResolve = new Map();
const resolveRateLimiter = makeRateLimiter(_rlResolve, 5); // 5 req/min/IP

app.get('/api/auth/resolve-username', resolveRateLimiter, async (req, res) => {
  if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase Admin non configuré' });
  const username = (req.query.u || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Paramètre u requis' });
  if (!SAFE_USERNAME_RE.test(username)) return res.json({ email: null }); // username invalide → réponse neutre
  try {
    const snap = await firebaseAdmin.firestore().collection('users').where('username', '==', username).limit(1).get();
    // Toujours 200 — évite l'énumération de comptes valides via code HTTP différent
    if (!snap.empty) console.log(`[resolve-username] lookup: ${username} (IP: ${req.ip})`);
    return res.json({ email: snap.empty ? null : snap.docs[0].data().email });
  } catch (e) { console.error('[resolve-username]', e.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

// ─── Échanger un Firebase ID token contre un JWT interne ──────────────────────
// Gère aussi la vérification 2FA pour les comptes Firebase (manager, cq_ia).
// Même flow que /api/auth/login : si 2FA activée → tempToken → code → JWT final.
app.post('/api/auth/firebase-login', authRateLimiter, async (req, res) => {
  if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase Admin non configuré' });
  const { idToken, tempToken, twoFaCode } = req.body || {};

  // ── Étape 2 : vérification du code 2FA (Firebase users) ─────────────────────
  if (tempToken && twoFaCode) {
    let decoded;
    try { decoded = jwt.verify(tempToken, JWT_SECRET); } catch { return res.status(401).json({ error: 'Session 2FA expirée — reconnectez-vous' }); }
    if (decoded.type !== 'tfa_pending') return res.status(401).json({ error: 'Token invalide' });
    const tfa = read2fa(decoded.username);
    let valid = false;
    if (tfa.method === 'totp') {
      valid = speakeasy.totp.verify({ secret: tfa.totpSecret, encoding: 'base32', token: twoFaCode.replace(/\s/g, ''), window: 1 });
    } else if (tfa.method === 'email') {
      valid = hashOtp(twoFaCode) === tfa.emailCode && Date.now() < (tfa.emailCodeExpiry || 0);
    }
    if (!valid) return setTimeout(() => res.status(401).json({ error: 'Code incorrect' }), 500);
    const token = jwt.sign({ uid: decoded.uid, username: decoded.username, role: decoded.role, jti: require('crypto').randomUUID() }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token, role: decoded.role, username: decoded.username, uid: decoded.uid });
  }

  // ── Étape 1 : vérification du Firebase idToken ───────────────────────────────
  if (!idToken) return res.status(400).json({ error: 'idToken requis' });
  try {
    const fbDecoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const role     = VALID_ROLES.has(fbDecoded.role) ? fbDecoded.role : 'cq_ia';
    const username = fbDecoded.username || fbDecoded.email?.split('@')[0] || fbDecoded.uid;

    // Vérifier si la 2FA est activée pour cet utilisateur
    const tfa = read2fa(username);
    if (tfa.enabled) {
      if (tfa.method === 'email') {
        const profile = readProfile(username);
        const email   = profile.email || tfa.email;
        if (!email) return res.status(400).json({ error: 'Aucune adresse email configurée pour la 2FA' });
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        write2fa(username, { ...tfa, emailCode: hashOtp(code), emailCodeExpiry: Date.now() + 10 * 60 * 1000 });
        try { await sendEmailOtp(email, code); } catch (e) { return res.status(500).json({ error: `Échec envoi email : ${e.message}` }); }
      }
      const tfaTempToken = jwt.sign({ uid: fbDecoded.uid, username, role, type: 'tfa_pending' }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ success: true, requires2fa: true, method: tfa.method, tempToken: tfaTempToken });
    }

    const token = jwt.sign({ uid: fbDecoded.uid, username, role, jti: require('crypto').randomUUID() }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token, role, username, uid: fbDecoded.uid });
  } catch (e) { return res.status(401).json({ error: 'Erreur d\'authentification' }); }
});

// ─── Créer un compte membre (admin ou manager) ────────────────────────────────
app.post('/api/users/create', requireAuth, requireRole('super_admin', 'manager'), async (req, res) => {
  if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase Admin non configuré' });
  const { firstName, lastName, email, username, role, password } = req.body || {};
  // Manager ne peut créer que des cq_ia
  if (req.user.role === 'manager' && role !== 'cq_ia') {
    return res.status(403).json({ error: 'Un manager ne peut créer que des comptes CQ IA' });
  }
  if (!email || !username || !password || !role) return res.status(400).json({ error: 'Champs requis : email, username, role, password' });
  if (!SAFE_USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username invalide — lettres, chiffres, tirets et underscores uniquement (1–64 caractères)' });
  if (!VALID_ROLES.has(role)) return res.status(400).json({ error: 'Rôle invalide' });
  try {
    const userRecord = await firebaseAdmin.auth().createUser({ email, password, displayName: username });
    await firebaseAdmin.auth().setCustomUserClaims(userRecord.uid, { role, username });
    await firebaseAdmin.firestore().collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid, username, firstName: firstName || '', lastName: lastName || '',
      email, role, status: 'active', createdAt: Date.now(),
      // password volontairement omis — Firebase Auth gère le hash côté serveur
    });
    // Générer un lien de réinitialisation de mot de passe (pas d'envoi du mdp en clair)
    let resetLink = null;
    try {
      const appUrl = IS_PROD ? 'https://maj.stomos.net' : 'http://localhost:3000';
      resetLink = await firebaseAdmin.auth().generatePasswordResetLink(email, {
        url: `${appUrl}/reset-password`,
        // handleCodeInApp: true nécessite la configuration Firebase Console
        // Authentication → Templates → Action URL → https://maj.stomos.net/reset-password
        // Sans cette config, Firebase redirige vers /reset-password en continueUrl après sa propre page.
      });
    } catch (e) {
      console.warn('[invite] Impossible de générer le lien reset :', e.message);
    }
    sendInviteEmail({ toEmail: email, firstName: firstName || username, username, resetLink }).catch(e => {
      console.error('[invite] Échec envoi email :', e.message);
    });
    return res.json({ success: true, uid: userRecord.uid });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// ─── Supprimer un compte membre ───────────────────────────────────────────────
app.delete('/api/users/:uid', requireAuth, requireRole('super_admin', 'manager'), async (req, res) => {
  if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase Admin non configuré' });
  const { uid } = req.params;
  try {
    await firebaseAdmin.auth().deleteUser(uid);
    await firebaseAdmin.firestore().collection('users').doc(uid).delete();
    return res.json({ success: true });
  } catch (e) { return res.status(400).json({ error: e.message }); }
});

// ─── Multer — stockage mémoire pour les uploads audio ─────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max (limite Groq Whisper)
});

// ─── Paramètres serveur (clés API partagées entre utilisateurs) ──────────────
// Stockés dans data/settings.json (gitignorés — jamais versionnés)
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const readServerSettings = () => {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch { return {}; }
};

const writeServerSettings = (payload) => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2), 'utf8');
};

// ─── Compte utilisateur ───────────────────────────────────────────────────────
// GET  /api/account — profil du compte connecté
// Fallback Firestore : si le profil local est vide (nouveau compte Firebase),
// on lit firstName/lastName/email/avatarUrl depuis la collection users.
app.get('/api/account', requireAuth, async (req, res) => {
  const profile = readProfile(req.user.username);
  const tfa     = read2fa(req.user.username);

  let fb = {};
  const profileIsEmpty = !profile.nom && !profile.prenom && !profile.email;
  if (profileIsEmpty && firebaseAdmin && req.user.uid) {
    try {
      const doc = await firebaseAdmin.firestore().collection('users').doc(req.user.uid).get();
      if (doc.exists) {
        const d = doc.data();
        fb = { nom: d.lastName || '', prenom: d.firstName || '', email: d.email || '', avatarUrl: d.avatarUrl || '' };
        // Persister en local pour les prochains appels (évite un aller-retour Firestore à chaque fois)
        writeProfile(req.user.username, { ...fb, updatedAt: Date.now() });
      }
    } catch (e) { console.warn('[account] Firestore fallback :', e.message); }
  }

  res.json({
    username:    req.user.username,
    role:        req.user.role || 'cq_ia',
    nom:         profile.nom       || fb.nom       || '',
    prenom:      profile.prenom    || fb.prenom    || '',
    email:       profile.email     || fb.email     || '',
    avatarUrl:   profile.avatarUrl || fb.avatarUrl || '',
    twoFaEnabled: !!tfa.enabled,
    twoFaMethod:  tfa.method || 'none',
  });
});

// PUT  /api/account — mettre à jour nom, prénom, email, avatarUrl
// Sync Firestore : l'avatarUrl est répercuté dans la collection users
// pour que la page Équipe affiche la vraie photo des membres.
app.put('/api/account', requireAuth, async (req, res) => {
  const { nom, prenom, email, avatarUrl } = req.body || {};
  if (avatarUrl && !avatarUrl.startsWith('https://') && !avatarUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'avatarUrl invalide — doit commencer par https:// ou data:image/' });
  }
  const existing = readProfile(req.user.username);
  writeProfile(req.user.username, { ...existing, nom, prenom, email, avatarUrl, updatedAt: Date.now() });

  // Sync vers Firestore (non bloquant) — page Équipe lit avatarUrl depuis la collection users
  if (firebaseAdmin && req.user.uid) {
    const update = {};
    if (nom       !== undefined) update.lastName  = nom       || '';
    if (prenom    !== undefined) update.firstName = prenom    || '';
    if (avatarUrl !== undefined) update.avatarUrl = avatarUrl || '';
    if (Object.keys(update).length > 0) {
      firebaseAdmin.firestore().collection('users').doc(req.user.uid)
        .update(update).catch(e => console.warn('[account] Firestore sync :', e.message));
    }
  }

  res.json({ success: true });
});

// POST /api/account/avatar — upload d'une photo de profil (retourne data URL)
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
app.post('/api/account/avatar', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  const mime = req.file.mimetype;
  if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Fichier image requis' });
  // Vérification par magic bytes (non contournable via Content-Type)
  const MAGIC = [
    [0xFF, 0xD8, 0xFF],        // JPEG
    [0x89, 0x50, 0x4E, 0x47], // PNG
    [0x47, 0x49, 0x46],        // GIF
    [0x52, 0x49, 0x46, 0x46], // WebP (RIFF)
  ];
  const buf = req.file.buffer;
  const isValidImage = MAGIC.some(m => m.every((b, i) => buf[i] === b));
  if (!isValidImage) return res.status(400).json({ error: 'Format non supporté — JPEG, PNG, GIF ou WebP uniquement' });
  const dataUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
  res.json({ success: true, avatarUrl: dataUrl });
});

// ─── 2FA endpoints ────────────────────────────────────────────────────────────
// POST /api/2fa/setup-totp — génère un secret TOTP + QR code (non activé)
app.post('/api/2fa/setup-totp', requireAuth, async (req, res) => {
  const username = req.user.username;
  const profile  = readProfile(username);
  const secret   = speakeasy.generateSecret({ name: `TONTON AI (${username})`, length: 20 });
  const tfa = read2fa(username);
  // Stocker le secret en attente (pas encore activé)
  write2fa(username, { ...tfa, pendingTotpSecret: secret.base32 });
  try {
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, secret: secret.base32, qrCode: qrDataUrl });
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération QR code' });
  }
});

// POST /api/2fa/enable-totp — vérifie le code TOTP et active
app.post('/api/2fa/enable-totp', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const username = req.user.username;
  const tfa = read2fa(username);
  if (!tfa.pendingTotpSecret) return res.status(400).json({ error: 'Aucun secret TOTP en attente — relancez la configuration' });
  const valid = speakeasy.totp.verify({ secret: tfa.pendingTotpSecret, encoding: 'base32', token: (code || '').replace(/\s/g, ''), window: 1 });
  if (!valid) return res.status(400).json({ error: 'Code incorrect — vérifiez votre application authenticator' });
  write2fa(username, { enabled: true, method: 'totp', totpSecret: tfa.pendingTotpSecret });
  res.json({ success: true });
});

// POST /api/2fa/setup-email — envoie un code de vérification par email
app.post('/api/2fa/setup-email', requireAuth, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requis' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const username = req.user.username;
  const tfa = read2fa(username);
  write2fa(username, { ...tfa, pendingEmail: email, pendingEmailCode: hashOtp(code), pendingEmailExpiry: Date.now() + 10 * 60 * 1000 });
  try {
    await sendEmailOtp(email, code);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: `Échec envoi email : ${e.message}` });
  }
});

// POST /api/2fa/enable-email — vérifie le code email et active
app.post('/api/2fa/enable-email', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const username = req.user.username;
  const tfa = read2fa(username);
  if (!tfa.pendingEmailCode) return res.status(400).json({ error: 'Aucun code en attente — relancez la configuration' });
  if (hashOtp(code) !== tfa.pendingEmailCode || Date.now() > (tfa.pendingEmailExpiry || 0)) {
    return res.status(400).json({ error: 'Code incorrect ou expiré' });
  }
  const profile = readProfile(username);
  writeProfile(username, { ...profile, email: tfa.pendingEmail });
  write2fa(username, { enabled: true, method: 'email', email: tfa.pendingEmail });
  res.json({ success: true });
});

// DELETE /api/2fa — désactiver la 2FA
app.delete('/api/2fa', requireAuth, (req, res) => {
  write2fa(req.user.username, { enabled: false, method: 'none' });
  res.json({ success: true });
});

// GET /api/settings — retourne les paramètres partagés (clés API de l'équipe)
app.get('/api/settings', requireAuth, (req, res) => {
  const settings = readServerSettings();
  if (req.user.role !== 'super_admin') {
    // Clés API non exposées aux rôles inférieurs — le serveur les lit directement depuis settings.json
    const { anthropicKey, groqKey, braveKey, tavilyKey, haloscanKey, smtpPass, smtpUser, smtpHost, smtpFrom, smtpPort, ...safeSettings } = settings;
    return res.json({
      ...safeSettings,
      aiConfigured:       !!(settings.anthropicKey || settings.useLocalProxy),
      haloscanConfigured: !!settings.haloscanKey,
    });
  }
  res.json(settings);
});

// POST /api/settings — sauvegarde les paramètres partagés (super_admin seulement)
app.post('/api/settings', requireAuth, requireRole('super_admin'), (req, res) => {
  try {
    const incoming = req.body || {};
    const filtered = {};
    for (const key of SETTINGS_WHITELIST) {
      if (key in incoming) filtered[key] = incoming[key];
    }
    writeServerSettings(filtered);
    console.log('[settings] ✓ Paramètres équipe sauvegardés');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde des paramètres' });
  }
});

// ─── Tarification modèles Anthropic (auto depuis LiteLLM) ───────────────────
// LiteLLM maintient une base JSON publique (mise à jour par la communauté).
// Rafraîchie côté serveur toutes les 6h — aucune action manuelle requise.
const ANTHROPIC_MODELS  = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
const PRICING_TTL_MS    = 6 * 60 * 60 * 1000; // 6h
const _pricingCache     = { data: null, fetchedAt: 0 };

const fetchModelPricing = async () => {
  if (_pricingCache.data && Date.now() - _pricingCache.fetchedAt < PRICING_TTL_MS) {
    return _pricingCache.data;
  }
  try {
    const resp = await axios.get(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
      { timeout: 15000 }
    );
    const all = resp.data || {};
    const pricing = {};
    for (const modelId of ANTHROPIC_MODELS) {
      const entry = all[modelId];
      if (entry?.input_cost_per_token != null) {
        const inVal  = parseFloat(entry.input_cost_per_token)  * 1_000_000;
        const outVal = parseFloat(entry.output_cost_per_token) * 1_000_000;
        // Validation de plage : rejette les valeurs aberrantes (0, NaN, > $200/MTok)
        if (inVal > 0 && outVal > 0 && inVal < 200 && outVal < 200) {
          pricing[modelId] = { input: inVal, output: outVal };
        }
      }
    }
    if (Object.keys(pricing).length > 0) {
      _pricingCache.data      = pricing;
      _pricingCache.fetchedAt = Date.now();
      console.log('[pricing] ✓ Tarifs LiteLLM —',
        Object.entries(pricing).map(([k, v]) => `${k}: $${v.input}/$${v.output}`).join(' | '));
    }
  } catch (e) {
    console.warn('[pricing] ⚠ LiteLLM inaccessible — fallback hardcodé :', e.message);
  }
  return _pricingCache.data;
};

// Fetch non bloquant au démarrage du serveur
fetchModelPricing().catch(() => {});

// GET /api/model-pricing — tarifs Anthropic à jour (tous rôles authentifiés)
app.get('/api/model-pricing', requireAuth, async (req, res) => {
  const pricing = await fetchModelPricing();
  res.json({ pricing: pricing || {}, fetchedAt: _pricingCache.fetchedAt, source: 'litellm' });
});

// ─── Proxy Brave Search (clé lue depuis settings.json — jamais exposée au navigateur) ──
app.get('/api/brave', requireAuth, async (req, res) => {
  const { q, freshness } = req.query;
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });
  const braveKey = readServerSettings().braveKey;
  if (!braveKey) return res.status(503).json({ error: 'Clé Brave Search non configurée' });
  try {
    const params = { q, count: 8, country: 'us', search_lang: 'en' };
    if (freshness) params.freshness = freshness;
    const resp = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
      params,
      timeout: 10000,
    });
    if (!resp.headers['content-type']?.includes('application/json')) {
      return res.status(502).json({ error: 'Réponse Brave invalide' });
    }
    res.json(resp.data);
  } catch (e) {
    console.error('[brave]', e.message);
    res.status(e.response?.status || 500).json({ error: 'Erreur Brave Search' });
  }
});

// ─── Proxy Tavily (clé lue depuis settings.json — jamais exposée au navigateur) ────────
app.post('/api/tavily', requireAuth, async (req, res) => {
  const { query, search_depth = 'advanced', max_results = 8, days, exclude_domains = [] } = req.body;
  if (!query) return res.status(400).json({ error: 'Paramètre query requis' });
  const tavilyKey = readServerSettings().tavilyKey;
  if (!tavilyKey) return res.status(503).json({ error: 'Clé Tavily non configurée' });
  try {
    const resp = await axios.post('https://api.tavily.com/search', {
      api_key: tavilyKey, query, search_depth, max_results,
      include_answer: false, include_raw_content: false,
      ...(days ? { days } : {}),
      exclude_domains,
    }, { timeout: 20000 });
    if (!resp.headers['content-type']?.includes('application/json')) {
      return res.status(502).json({ error: 'Réponse Tavily invalide' });
    }
    res.json(resp.data);
  } catch (e) {
    console.error('[tavily]', e.message);
    res.status(e.response?.status || 500).json({ error: 'Erreur Tavily Search' });
  }
});

// ─── Proxy SearXNG (instances tierces — requêtes passent par le serveur, pas le navigateur) ─
const SEARXNG_INSTANCES = ['https://searx.be', 'https://search.mdosch.de', 'https://searx.fmac.xyz'];
app.get('/api/searxng', requireAuth, async (req, res) => {
  const { q, time_range = 'month', language = 'en' } = req.query;
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const resp = await axios.get(`${instance}/search`, {
        params: { q, format: 'json', language, time_range, categories: 'general' },
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TontonAI/1.0)' },
        timeout: 10000,
      });
      if (resp.headers['content-type']?.includes('application/json') && resp.data?.results) {
        return res.json(resp.data);
      }
    } catch {}
  }
  res.status(503).json({ error: 'SearXNG inaccessible', results: [] });
});

// ─── Haloscan SEO API ────────────────────────────────────────────────────────
// Base URL : https://api.haloscan.com/api  (confirmé dans la doc officielle)
// Auth     : header "haloscan-api-key: {jwt}"
// Endpoints utilisés :
//   GET  /user/credit            → test de connexion
//   POST /keywords/overview      → données SERP par mot-clé (1 appel par mot-clé)
//     body: { keyword, requested_data: ["serp", "metrics"] }
//     → on parse le SERP pour retrouver la position de l'URL de l'article
const HALOSCAN_BASE   = 'https://api.haloscan.com/api';
const haloscanHeaders = (key) => ({
  'haloscan-api-key': key,
  'accept':           'application/json',
  'content-type':     'application/json',
});

// Cherche l'URL de l'article dans un SERP Haloscan (old_serp ou new_serp)
// Retourne { position, diff } ou null si non trouvé
const _findInSerp = (serp, articleUrl) => {
  if (!Array.isArray(serp) || !articleUrl) return null;
  const norm  = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();
  const target = norm(articleUrl);
  return serp.find(r => {
    const u = norm(r.url);
    return u === target || u.includes(target) || target.includes(u);
  }) || null;
};

// POST /api/haloscan/test — valide la clé (super_admin seulement)
// La clé peut être passée dans le body (avant sauvegarde) ou lue depuis settings.json
app.post('/api/haloscan/test', requireAuth, requireRole('super_admin'), async (req, res) => {
  const haloscanKey = req.body?.key || readServerSettings().haloscanKey;
  if (!haloscanKey) return res.status(400).json({ error: 'Clé Haloscan manquante — renseignez-la dans le champ puis retestez' });
  try {
    const resp = await axios.request({
      method:  'get',
      url:     `${HALOSCAN_BASE}/user/credit`,
      headers: haloscanHeaders(haloscanKey),
      data:    {},
      timeout: 10000,
    });
    res.json({ success: true, credits: resp.data });
  } catch (e) {
    const status  = e.response?.status;
    const invalid = status === 401 || status === 403;
    console.error('[haloscan/test]', status, e.response?.data || e.message);
    res.status(invalid ? 400 : 500).json({
      success: false,
      error:   invalid ? 'Clé API invalide' : 'Erreur API Haloscan',
      status,
      detail:  e.response?.data || e.message,
    });
  }
});

// POST /api/haloscan/check — position Google de l'article pour chaque mot-clé
// Utilise POST /keywords/serp/compare (period: "1 month") — Haloscan calcule lui-même le diff
// Réponse : { keyword, position, positionOld, haloscanDiff, dates, inSerp }
app.post('/api/haloscan/check', requireAuth, async (req, res) => {
  const { keywords, articleUrl, period = '1 month' } = req.body;
  const haloscanKey = readServerSettings().haloscanKey;
  if (!haloscanKey)                                 return res.status(503).json({ error: 'Clé Haloscan non configurée' });
  if (!Array.isArray(keywords) || !keywords.length) return res.status(400).json({ error: 'keywords (array) requis' });
  if (!articleUrl)                                  return res.status(400).json({ error: 'articleUrl requis' });

  try {
    const results = await Promise.all(keywords.map(async (keyword) => {
      try {
        const resp = await axios.post(`${HALOSCAN_BASE}/keywords/serp/compare`, {
          keyword,
          period,
        }, {
          headers: haloscanHeaders(haloscanKey),
          timeout: 25000,
        });

        const data    = resp.data;
        const newSerp = data?.results?.new_serp || [];
        const oldSerp = data?.results?.old_serp || [];

        const newEntry = _findInSerp(newSerp, articleUrl);
        const oldEntry = _findInSerp(oldSerp, articleUrl);

        return {
          keyword,
          position:      newEntry?.position ?? null,   // position actuelle (new_serp)
          positionOld:   oldEntry?.position ?? null,   // position période précédente (old_serp)
          haloscanDiff:  newEntry?.diff     ?? null,   // diff calculé par Haloscan ex: "+5", "lost", "new"
          dates:         data?.dates        || [],     // [date_ancienne, date_récente]
          inSerp:        !!newEntry,                   // false = article absent du top 100
        };
      } catch (e) {
        console.warn(`[haloscan] keyword "${keyword}" :`, e.response?.data || e.message);
        return { keyword, position: null, positionOld: null, haloscanDiff: null, inSerp: false,
                 error: e.response?.data?.message || e.message };
      }
    }));

    res.json({ success: true, results });
  } catch (e) {
    console.error('[haloscan]', e.message);
    res.status(500).json({ error: 'Erreur Haloscan API', detail: e.message });
  }
});

// POST /api/haloscan/evolution — historique complet de position d'une URL pour un mot-clé
// Utilise POST /keywords/serp/pageEvolution — retourne position_history + volume_history
app.post('/api/haloscan/evolution', requireAuth, async (req, res) => {
  const { keyword, articleUrl, firstDate, secondDate } = req.body;
  const haloscanKey = readServerSettings().haloscanKey;
  if (!haloscanKey)  return res.status(503).json({ error: 'Clé Haloscan non configurée' });
  if (!keyword)      return res.status(400).json({ error: 'keyword requis' });
  if (!articleUrl)   return res.status(400).json({ error: 'articleUrl requis' });
  if (!firstDate)    return res.status(400).json({ error: 'firstDate requis (YYYY-MM-DD)' });

  const today = new Date().toISOString().slice(0, 10);
  try {
    const resp = await axios.post(`${HALOSCAN_BASE}/keywords/serp/pageEvolution`, {
      keyword,
      url:         articleUrl,
      first_date:  firstDate,
      second_date: secondDate || today,
    }, {
      headers: haloscanHeaders(haloscanKey),
      timeout: 30000,
    });
    const data = resp.data;
    res.json({
      keyword,
      position_history: data?.results?.position_history || [],
      volume_history:   data?.results?.volume_history   || [],
      dates:            data?.dates || [],
    });
  } catch (e) {
    console.error('[haloscan/evolution]', e.response?.data || e.message);
    res.status(e.response?.status || 500).json({
      error:  'Erreur Haloscan pageEvolution',
      detail: e.response?.data || e.message,
    });
  }
});

// ─── Haloscan cron — snapshots SEO automatiques J+7 / J+30 ──────────────────
// Vérifie toutes les 6h les articles ayant un snapshot en attente.
// Nécessite Firebase Admin + clé Haloscan configurés.
const _seoSnapshotCheck = async () => {
  const haloscanKey = readServerSettings().haloscanKey;
  if (!haloscanKey || !firebaseAdmin) return;

  const DAY = 24 * 60 * 60 * 1000;
  try {
    const db  = firebaseAdmin.firestore();
    const now = Date.now();

    // Articles avec nextSnapshotAt dépassé et tracking non terminé
    const snap = await db.collection('articles')
      .where('seoTracking.nextSnapshotAt', '<=', now)
      .where('seoTracking.completed', '==', false)
      .limit(20)
      .get();

    if (snap.empty) return;
    console.log(`[seo-cron] ${snap.size} article(s) à mettre à jour`);

    for (const docSnap of snap.docs) {
      const article = docSnap.data();
      const seo     = article.seoTracking || {};
      if (!seo.keywords?.length || !seo.articleUrl) continue;

      try {
        // 1 appel serp/compare par mot-clé → position actuelle + diff Haloscan
        const kwResults = await Promise.all((seo.keywords || []).map(async (keyword) => {
          try {
            const r = await axios.post(`${HALOSCAN_BASE}/keywords/serp/compare`, {
              keyword, period: '1 month',
            }, { headers: haloscanHeaders(haloscanKey), timeout: 25000 });
            const newSerp  = r.data?.results?.new_serp || [];
            const oldSerp  = r.data?.results?.old_serp || [];
            const newEntry = _findInSerp(newSerp, seo.articleUrl);
            const oldEntry = _findInSerp(oldSerp, seo.articleUrl);
            return {
              keyword,
              position:     newEntry?.position ?? null,
              positionOld:  oldEntry?.position ?? null,
              haloscanDiff: newEntry?.diff     ?? null,
              inSerp:       !!newEntry,
            };
          } catch { return { keyword, position: null, positionOld: null, haloscanDiff: null, inSerp: false }; }
        }));

        const capturedAt = now;
        const type       = seo.nextSnapshotType || 'after_7d';
        const snapshot   = { type, capturedAt, results: kwResults };

        // Planification du prochain snapshot
        const isLast = type === 'after_30d';
        const updates = {
          'seoTracking.snapshots':         firebaseAdmin.firestore.FieldValue.arrayUnion(snapshot),
          'seoTracking.lastSnapshotAt':    capturedAt,
          'seoTracking.completed':         isLast,
          'seoTracking.nextSnapshotAt':    isLast ? Number.MAX_SAFE_INTEGER : capturedAt + (type === 'after_7d' ? 23 * DAY : DAY),
          'seoTracking.nextSnapshotType':  isLast ? null : 'after_30d',
        };
        await db.collection('articles').doc(docSnap.id).update(updates);
        console.log(`[seo-cron] ✓ Snapshot ${type} — article ${docSnap.id}`);
      } catch (e) {
        console.warn(`[seo-cron] ✗ Article ${docSnap.id} :`, e.message);
      }
    }
  } catch (e) {
    console.warn('[seo-cron] Erreur :', e.message);
  }
};

// Lancement 30s après démarrage, puis toutes les 6h
setTimeout(() => {
  _seoSnapshotCheck();
  setInterval(_seoSnapshotCheck, 6 * 60 * 60 * 1000);
}, 30000);

// ─── Sécurité globale : empêche le proxy de crasher sur exceptions non gérées ─
process.on('uncaughtException', (err) => {
  console.error('[proxy] ⚠ Exception non gérée (processus maintenu) :', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[proxy] ⚠ Promesse rejetée non gérée :', reason?.message || reason);
});

// ─── Résolution du binaire claude (fallback) ──────────────────────────────────
const resolveClaude = () => {
  if (process.env.CLAUDE_CODE_EXECPATH) return process.env.CLAUDE_CODE_EXECPATH;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'claude-path.json'), 'utf8'));
    if (cfg.path) return cfg.path;
  } catch {}
  return 'claude';
};
const CLAUDE_BIN = resolveClaude();

// ─── Résolution du dossier de données Claude Desktop ─────────────────────────
const resolveClaudeDataDir = () => {
  const candidates = [];

  if (CLAUDE_BIN && CLAUDE_BIN !== 'claude') {
    const parts = CLAUDE_BIN.split(path.sep);
    const claudeIdx = parts.lastIndexOf('Claude');
    if (claudeIdx !== -1) {
      candidates.push(parts.slice(0, claudeIdx + 1).join(path.sep));
    }
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const pkgDir = path.join(localAppData, 'Packages');
  try {
    const entries = fs.readdirSync(pkgDir);
    const claudePkg = entries.find(e => e.startsWith('Claude_'));
    if (claudePkg) {
      candidates.push(path.join(pkgDir, claudePkg, 'LocalCache', 'Roaming', 'Claude'));
    }
  } catch {}

  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  candidates.push(path.join(appData, 'Claude'));

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'Local State'))) {
        console.log(`[proxy] Dossier Claude Desktop : ${dir}`);
        return dir;
      }
    } catch {}
  }

  return candidates[0];
};

const CLAUDE_DATA_DIR = resolveClaudeDataDir();
const LOCAL_STATE_PATH = path.join(CLAUDE_DATA_DIR, 'Local State');
const CONFIG_PATH = path.join(CLAUDE_DATA_DIR, 'config.json');

// ─── Cache token ──────────────────────────────────────────────────────────────
let aesKeyCache = null;
let tokenCache = { token: null, expiresAt: 0 };

function getAesKey() {
  if (process.platform !== 'win32') throw new Error('DPAPI disponible uniquement sur Windows');
  if (aesKeyCache) return aesKeyCache;

  const localState = JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, 'utf8'));
  const encKeyB64 = localState.os_crypt?.encrypted_key;
  if (!encKeyB64) throw new Error('Pas de encrypted_key dans Local State');

  const ps1File = path.join(os.tmpdir(), `aes_key_${Date.now()}.ps1`);
  const outFile = path.join(os.tmpdir(), `aes_out_${Date.now()}.txt`);

  const ps1 = `Add-Type -AssemblyName System.Security\n$bytes = [System.Convert]::FromBase64String('${encKeyB64.replace(/'/g, "''")}')\n$enc = $bytes[5..($bytes.Length-1)]\n$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser\n$key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc,$null,$scope)\n[System.Convert]::ToBase64String($key) | Set-Content '${outFile.replace(/\\/g, '/')}' -Encoding UTF8`;

  try {
    fs.writeFileSync(ps1File, ps1, 'utf8');
    execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${ps1File}"`, { timeout: 8000, stdio: 'pipe' });
    aesKeyCache = Buffer.from(fs.readFileSync(outFile, 'utf8').trim(), 'base64');
    return aesKeyCache;
  } finally {
    try { fs.unlinkSync(ps1File); } catch {}
    try { fs.unlinkSync(outFile); } catch {}
  }
}

function getOAuthToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token;
  }

  const aesKey = getAesKey();
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const encTokenB64 = config['oauth:tokenCache'];
  if (!encTokenB64) throw new Error('Pas de oauth:tokenCache dans config.json');

  const encToken = Buffer.from(encTokenB64, 'base64');
  const iv = encToken.slice(3, 15);
  const authTag = encToken.slice(encToken.length - 16);
  const ciphertext = encToken.slice(15, encToken.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const data = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));

  const anthropicEntry = Object.entries(data).find(([k]) => k.includes('api.anthropic.com'));
  if (!anthropicEntry) throw new Error('Pas de token api.anthropic.com dans le cache');

  const entry = anthropicEntry[1];
  const token = entry.token || entry.accessToken || entry.access_token;
  if (!token) throw new Error("Champ token introuvable dans l'entrée Anthropic");

  tokenCache = {
    token,
    expiresAt: entry.expiresAt || (Date.now() + 60 * 60 * 1000),
  };

  console.log(`[proxy] Token OAuth lu (expire ${new Date(tokenCache.expiresAt).toLocaleTimeString()})`);
  return token;
}

// ─── Catalogue de modèles ─────────────────────────────────────────────────────
const MODEL_CASCADE = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
];
const MODEL_FALLBACK = 'claude-haiku-4-5';

// ─── Appel API Anthropic via clé API (x-api-key) ─────────────────────────────
// Utilisé quand le client fournit sa propre clé Anthropic plutôt que le token OAuth.
// Le call est fait côté serveur (Node.js) — la clé ne transite jamais vers Anthropic
// depuis le navigateur, ce qui évite son exposition dans les DevTools du navigateur.
const callAnthropicWithApiKey = (apiKey, bodyObj) => new Promise((resolve, reject) => {
  const requestBody = {
    model: bodyObj.model,
    max_tokens: bodyObj.max_tokens || 4096,
    messages: bodyObj.messages,
  };
  if (bodyObj.system) requestBody.system = bodyObj.system;
  if (bodyObj.tools?.length) requestBody.tools = bodyObj.tools;
  const payload = JSON.stringify(requestBody);
  const req = https.request({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    let data = '';
    res.on('data', d => { data += d; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode === 401 || res.statusCode === 403) return reject(new Error('Clé API Anthropic invalide ou expirée'));
        if (res.statusCode === 429) return reject(new Error('RATE_LIMITED'));
        if (res.statusCode !== 200) return reject(new Error(json.error?.message || `HTTP ${res.statusCode}`));
        const text = json.content?.[0]?.text || '';
        const usage = json.usage || {};
        resolve({ text, modelUsed: json.model || bodyObj.model, usage });
      } catch (e) { reject(new Error('Réponse API invalide')); }
    });
  });
  const timer = setTimeout(() => { req.destroy(); reject(new Error('Timeout (>5min)')); }, 300000);
  req.on('close', () => clearTimeout(timer));
  req.on('error', reject);
  req.write(payload);
  req.end();
});

// ─── Appel API Anthropic direct ───────────────────────────────────────────────
// Passe `system` comme paramètre top-level (meilleure qualité qu'intégrer dans le user content)
// Retourne la réponse complète incluant `usage` pour le suivi des tokens
const callAnthropicDirect = (token, bodyObj) => new Promise((resolve, reject) => {
  // Construire le corps de la requête avec system en top-level si fourni
  const requestBody = {
    model: bodyObj.model,
    max_tokens: bodyObj.max_tokens || 4096,
    messages: bodyObj.messages,
  };
  if (bodyObj.system) requestBody.system = bodyObj.system;
  if (bodyObj.tools?.length) requestBody.tools = bodyObj.tools;

  const payload = JSON.stringify(requestBody);
  const req = https.request({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    let data = '';
    res.on('data', d => { data += d; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode === 401 || res.statusCode === 403) {
          tokenCache = { token: null, expiresAt: 0 };
          return reject(new Error('AUTH_REQUIRED'));
        }
        if (res.statusCode === 429) {
          return reject(new Error('RATE_LIMITED'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(json.error?.message || `HTTP ${res.statusCode}: ${data}`));
        }
        resolve(json); // réponse complète avec usage inclus
      } catch (e) { reject(new Error('Réponse API invalide: ' + data.substring(0, 100))); }
    });
  });
  const timer = setTimeout(() => { req.destroy(); reject(new Error('Timeout (>5min)')); }, 300000);
  req.on('close', () => clearTimeout(timer));
  req.on('error', reject);
  req.write(payload);
  req.end();
});

/**
 * Tente d'appeler l'API avec le modèle demandé, puis cascade automatiquement
 * vers des modèles moins coûteux si le modèle est indisponible (HTTP 429).
 * Retourne { text, modelUsed, usage }.
 */
const callWithModelCascade = async (token, bodyObj) => {
  const requestedModel = bodyObj.model || MODEL_FALLBACK;

  const cascadeIdx = MODEL_CASCADE.indexOf(requestedModel);
  const toTry = cascadeIdx === -1
    ? [requestedModel, MODEL_FALLBACK]
    : MODEL_CASCADE.slice(cascadeIdx);

  const modelsToTry = [...new Set(toTry)];

  for (const model of modelsToTry) {
    try {
      const result = await callAnthropicDirect(token, { ...bodyObj, model });
      // Extraire text + usage depuis la réponse complète
      const text = result.content?.[0]?.text || '';
      const usage = result.usage || {};
      if (model !== requestedModel) {
        console.log(`[proxy] Cascade : ${requestedModel} → ${model} (utilisé)`);
      } else {
        console.log(`[proxy] Modèle : ${model}`);
      }
      return { text, modelUsed: model, usage };
    } catch (e) {
      if (e.message === 'RATE_LIMITED') {
        console.log(`[proxy] Modèle ${model} indisponible (429), cascade...`);
        continue;
      }
      throw e;
    }
  }

  throw new Error(`Tous les modèles ont échoué (cascade depuis ${requestedModel})`);
};

// ─── Fallback : claude.exe CLI ────────────────────────────────────────────────
const callClaude = (prompt) => new Promise((resolve, reject) => {
  const tmp = path.join(os.tmpdir(), `claude_${Date.now()}.txt`);
  try { fs.writeFileSync(tmp, prompt, 'utf8'); }
  catch (e) { return reject(new Error('Fichier temp: ' + e.message)); }

  const bin = CLAUDE_BIN.replace(/'/g, "''");
  const tmpPs = tmp.replace(/'/g, "''");
  const ps1 = `$p = Get-Content -Raw -Path '${tmpPs}'; & '${bin}' -p $p --output-format text`;

  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps1], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env },
  });

  let stdout = '', stderr = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  const timer = setTimeout(() => {
    try { proc.kill(); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    reject(new Error('Timeout CLI (>5min)'));
  }, 300000);

  proc.on('close', (code) => {
    clearTimeout(timer);
    try { fs.unlinkSync(tmp); } catch {}
    const errMsg = (stderr + stdout).toLowerCase();
    if (errMsg.includes('not logged') || errMsg.includes('/login') || errMsg.includes('run /login')) {
      return reject(new Error('AUTH_REQUIRED'));
    }
    if (code !== 0) return reject(new Error(stderr || `Code ${code}`));
    const text = stdout.trim();
    if (!text) return reject(new Error('Réponse vide'));
    resolve(text);
  });

  proc.on('error', (e) => { clearTimeout(timer); try { fs.unlinkSync(tmp); } catch {} reject(e); });
});

// ─── Route principale ──────────────────────────────────────────────────────────
app.post('/api/claude', requireAuth, async (req, res) => {
  const { system, messages, max_tokens = 4096, model } = req.body;
  const bodyApiKey = null; // clé API jamais acceptée depuis le client — lire uniquement settings.json
  if (!messages?.length) return res.status(400).json({ error: 'messages requis' });

  // Clé Anthropic : lire depuis data/settings.json en priorité, fallback sur la clé du body.
  const serverSettings = readServerSettings();
  const serverApiKey = serverSettings.anthropicKey && serverSettings.anthropicKey !== 'local'
    ? serverSettings.anthropicKey
    : null;
  const clientApiKey = serverApiKey || bodyApiKey;

  // Prompt CLI (seulement si OAuth échoue — le CLI reçoit le tout en une chaîne)
  const systemBlock = system ? `[SYSTEM]\n${system}\n\n[USER]\n` : '';
  const cliContent = systemBlock + messages.map(m => m.content).join('\n');

  const requestedModel = MODEL_CASCADE.includes(model) ? model : MODEL_FALLBACK;

  // ── Stratégie 0 : clé API fournie par le client ou le serveur ─────────────
  // Le call est fait ici côté serveur (Node.js) → la clé Anthropic ne transite
  // jamais vers api.anthropic.com depuis le navigateur (invisible dans DevTools).
  if (clientApiKey && clientApiKey !== 'local') {
    try {
      const toTry = (() => {
        const idx = MODEL_CASCADE.indexOf(requestedModel);
        return idx === -1 ? [requestedModel, MODEL_FALLBACK] : MODEL_CASCADE.slice(idx);
      })();
      for (const m of [...new Set(toTry)]) {
        try {
          const { text, modelUsed, usage } = await callAnthropicWithApiKey(clientApiKey, { model: m, max_tokens, system, messages });
          return res.json({ content: [{ text }], modelUsed, usage });
        } catch (e) {
          if (e.message === 'RATE_LIMITED') { console.log(`[proxy] Cascade clé API : ${m} → suivant`); continue; }
          throw e;
        }
      }
      return res.status(429).json({ error: 'Tous les modèles en rate-limit (clé API)' });
    } catch (e) {
      console.error('[proxy] Erreur clé API fournie :', e.message);
      return res.status(500).json({ error: 'Erreur lors de l\'appel à l\'IA' });
    }
  }

  try {
    // Stratégie 1 : OAuth token DPAPI → API directe avec cascade de modèles
    // Le system prompt est passé comme paramètre top-level (meilleure qualité)
    try {
      const token = getOAuthToken();
      const { text, modelUsed, usage } = await callWithModelCascade(token, {
        model: requestedModel,
        max_tokens,
        system,    // ← top-level system parameter (pas intégré dans user content)
        messages,  // ← messages d'origine (structure correcte)
      });
      // Retourner la réponse avec usage pour le suivi des tokens
      return res.json({
        content: [{ text }],
        modelUsed,
        usage,  // ← { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
      });
    } catch (e) {
      if (e.message !== 'AUTH_REQUIRED') {
        console.error('[proxy] API OAuth échouée:', e.message);
        return res.status(500).json({ error: 'Erreur lors de l\'appel à l\'IA' });
      }
      console.log('[proxy] Token OAuth invalide, tentative CLI...');
    }

    // Stratégie 2 : claude.exe CLI (fallback auth uniquement)
    const text = await callClaude(cliContent);
    return res.json({ content: [{ text }], modelUsed: 'cli-fallback', usage: {} });

  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') {
      return res.status(401).json({
        error: `Claude non connecté.\n\nOuvre un terminal PowerShell et lance :\n"${CLAUDE_BIN}" login\n\nPuis relance npm start.`,
      });
    }
    console.error('[proxy] Erreur:', e.message);
    // Toujours retourner une réponse HTTP, ne jamais laisser Express crasher
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

// ─── Route streaming Claude — SSE token counter ──────────────────────────────
// Même interface que /api/claude mais retourne des Server-Sent Events.
// Le client reçoit en temps réel :
//   data: {"type":"delta","chars":N}          ← progression (N chars reçus)
//   data: {"type":"done","text":"…","usage":{…}}   ← fin de génération
//   data: {"type":"error","error":"…"}        ← erreur
app.post('/api/claude-stream', requireAuth, (req, res) => {
  const { system, messages, max_tokens = 32000, model } = req.body;
  const bodyApiKey = null; // clé API jamais acceptée depuis le client — lire uniquement settings.json
  if (!messages?.length) return res.status(400).json({ error: 'messages requis' });

  // Clé Anthropic : lire depuis data/settings.json en priorité, fallback sur la clé du body.
  const serverSettings = readServerSettings();
  const serverApiKey = serverSettings.anthropicKey && serverSettings.anthropicKey !== 'local'
    ? serverSettings.anthropicKey
    : null;
  const clientApiKey = serverApiKey || bodyApiKey;

  // ── SSE headers ──────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx/reverse-proxy
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  // ── Corps de la requête Anthropic (streaming activé) ──────────────────────────
  const requestedModel = MODEL_CASCADE.includes(model) ? model : MODEL_FALLBACK;
  const requestBody = { model: requestedModel, max_tokens, messages, stream: true };
  if (system) requestBody.system = system;
  const payload = JSON.stringify(requestBody);

  // ── Auth : clé API fournie par le client OU token OAuth serveur ───────────────
  let authHeaders;
  if (clientApiKey && clientApiKey !== 'local') {
    authHeaders = { 'x-api-key': clientApiKey };
  } else {
    try {
      authHeaders = { 'Authorization': `Bearer ${getOAuthToken()}` };
    } catch {
      send({ type: 'error', error: 'AUTH_REQUIRED' });
      return res.end();
    }
  }

  let fullText = '';
  let charCount = 0;
  let lastSentAt = 0;
  let usage = {};
  let sseBuffer = '';

  const apiReq = https.request({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      ...authHeaders,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (apiRes) => {
    // Erreur HTTP de l'API Anthropic
    if (apiRes.statusCode !== 200) {
      let errData = '';
      apiRes.on('data', d => { errData += d; });
      apiRes.on('end', () => {
        try {
          const j = JSON.parse(errData);
          send({ type: 'error', error: j.error?.message || `HTTP ${apiRes.statusCode}` });
        } catch { send({ type: 'error', error: `HTTP ${apiRes.statusCode}` }); }
        res.end();
      });
      return;
    }

    // Lecture du flux SSE Anthropic
    apiRes.on('data', (chunk) => {
      sseBuffer += chunk.toString();
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || ''; // conserver la ligne incomplète

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const event = JSON.parse(raw);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const delta = event.delta.text || '';
            fullText += delta;
            charCount += delta.length;
            // Throttle : envoyer au max toutes les 120 chars (~30 tokens)
            if (charCount - lastSentAt >= 120) {
              lastSentAt = charCount;
              send({ type: 'delta', chars: charCount });
            }
          } else if (event.type === 'message_start' && event.message?.usage) {
            usage.input_tokens = event.message.usage.input_tokens || 0;
          } else if (event.type === 'message_delta' && event.usage) {
            usage.output_tokens = event.usage.output_tokens || 0;
          }
        } catch { /* ligne SSE mal formée — ignorée */ }
      }
    });

    apiRes.on('end', () => {
      send({
        type: 'done',
        text: fullText,
        usage: {
          input_tokens:  usage.input_tokens  || 0,
          output_tokens: usage.output_tokens || Math.round(charCount / 4),
          model: requestedModel,
        },
      });
      res.end();
    });

    apiRes.on('error', (e) => { send({ type: 'error', error: e.message }); res.end(); });
  });

  const timer = setTimeout(() => {
    apiReq.destroy();
    send({ type: 'error', error: 'Timeout 5min dépassé' });
    res.end();
  }, 300000);

  apiReq.on('close', () => clearTimeout(timer));
  apiReq.on('error', (e) => {
    clearTimeout(timer);
    send({ type: 'error', error: e.message });
    if (!res.writableEnded) res.end();
  });

  // Libérer si le navigateur ferme la connexion
  req.on('close', () => { clearTimeout(timer); apiReq.destroy(); });

  apiReq.write(payload);
  apiReq.end();
});

// ─── Transcription Groq Whisper ───────────────────────────────────────────────

/** Envoie un buffer audio à Groq Whisper et retourne la transcription */
async function transcribeWithGroq(audioBuffer, filename, groqKey, language = 'fr') {
  const formData = new FormData();
  // Groq accepte : flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
  const ext = (filename || 'audio.webm').split('.').pop().toLowerCase();
  const mime = ext === 'webm' ? 'audio/webm'
    : ext === 'mp3' ? 'audio/mpeg'
    : ext === 'mp4' ? 'audio/mp4'
    : ext === 'wav' ? 'audio/wav'
    : ext === 'ogg' ? 'audio/ogg'
    : 'audio/webm';

  formData.append('file', audioBuffer, { filename: filename || 'audio.webm', contentType: mime });
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', language);
  formData.append('response_format', 'text');

  const resp = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    formData,
    {
      headers: { 'Authorization': `Bearer ${groqKey}`, ...formData.getHeaders() },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  return typeof resp.data === 'string' ? resp.data.trim()
    : (resp.data?.text || '').trim();
}

/**
 * POST /api/transcribe/file  (multipart/form-data)
 * Champs : audio (fichier), groqKey, language?
 * Transcrit un fichier audio/vidéo uploadé directement.
 */
app.post('/api/transcribe/file', requireAuth, upload.single('audio'), async (req, res) => {
  const { groqKey: bodyGroqKey, language = 'fr' } = req.body;
  // Clé Groq : lire depuis data/settings.json en priorité (partagé équipe), fallback body
  const groqKey = readServerSettings().groqKey || bodyGroqKey;
  if (!req.file) return res.status(400).json({ error: 'Fichier audio requis' });
  if (!groqKey)  return res.status(400).json({ error: 'Clé API Groq requise — configurez-la dans Paramètres' });

  try {
    console.log(`[transcribe] ↑ Fichier local : ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} Mo)`);
    const transcript = await transcribeWithGroq(req.file.buffer, req.file.originalname, groqKey, language);
    console.log(`[transcribe] ✓ ${transcript.length} caractères`);
    res.json({ transcript, chars: transcript.length, mb: (req.file.size / 1024 / 1024).toFixed(1) });
  } catch (e) {
    console.error('[transcribe/file]', e.response?.data || e.message);
    res.status(500).json({ error: 'Erreur lors de la transcription audio' });
  }
});

// ─── Scraping article ──────────────────────────────────────────────────────────
// Utilise @mozilla/readability (même algo que le mode lecture Firefox)
// pour n'extraire que le contenu de l'article : titre + corps, sans nav/footer/pub
app.post('/api/scrape', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });

  // Protection SSRF : rejette les URLs pointant vers des ressources internes
  try { await assertSafeUrl(url, 'URL de l\'article'); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    // 1. Fetch du HTML brut
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      maxRedirects: 0,
    });

    // 2. Extraire l'image à la une AVANT que Readability modifie le DOM
    //    Ordre de priorité : og:image → twitter:image → première grande image de la page
    const rawDom = new JSDOM(response.data, { url });
    const rawDoc = rawDom.window.document;
    const baseUrl = new URL(url);

    const toAbs = (src) => {
      if (!src) return '';
      if (src.startsWith('http') || src.startsWith('//')) return src.startsWith('//') ? 'https:' + src : src;
      try { return new URL(src, baseUrl).href; } catch { return ''; }
    };

    let featuredImageUrl = '';
    // og:image
    const ogImg = rawDoc.querySelector('meta[property="og:image"], meta[name="og:image"]');
    if (ogImg) featuredImageUrl = toAbs(ogImg.getAttribute('content') || '');
    // twitter:image
    if (!featuredImageUrl) {
      const twImg = rawDoc.querySelector('meta[name="twitter:image"], meta[name="twitter:image:src"]');
      if (twImg) featuredImageUrl = toAbs(twImg.getAttribute('content') || '');
    }
    // Première grande image du document (largeur >= 300 ou sans attribut width)
    if (!featuredImageUrl) {
      const imgs = Array.from(rawDoc.querySelectorAll('img[src]'));
      for (const img of imgs) {
        const src = toAbs(img.getAttribute('src') || img.getAttribute('data-src') || '');
        if (!src || src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('data:image')) continue;
        const w = parseInt(img.getAttribute('width') || '0', 10);
        if (!w || w >= 300) { featuredImageUrl = src; break; }
      }
    }

    // 3. Parsing DOM + extraction Readability
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document, {
      charThreshold: 100,
      keepClasses: true,
    });
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 100) {
      return res.status(422).json({ error: 'Impossible d\'extraire l\'article depuis cette page.' });
    }

    // 3. Nettoyage du HTML : supprimer scripts/styles inline mais garder la structure
    //    (tableaux, titres, listes, gras, italique, liens, images, iframes vidéos…)
    const cleanDom = new JSDOM(article.content, { url });
    const doc = cleanDom.window.document;

    // Supprimer les éléments inutiles — on conserve iframe (YouTube/Vimeo) et video
    ['script', 'style', 'form', 'button', 'input', 'svg', 'noscript', 'canvas'].forEach(tag => {
      doc.querySelectorAll(tag).forEach(el => el.remove());
    });

    // ── Absolutiser les URLs relatives (img, iframe, a, video, source) ──────────
    const absolutize = (el, attr) => {
      const val = el.getAttribute(attr);
      if (!val || val.startsWith('http') || val.startsWith('//') ||
          val.startsWith('data:') || val.startsWith('#') || val.startsWith('mailto:')) return;
      try { el.setAttribute(attr, new URL(val, baseUrl).href); } catch {}
    };
    doc.querySelectorAll('img').forEach(el => {
      // Récupérer le src réel pour les images lazy-loaded (data-src, data-lazy…)
      const lazySrc = el.getAttribute('data-src')
        || el.getAttribute('data-lazy')
        || el.getAttribute('data-original')
        || el.getAttribute('data-lazy-src');
      const currentSrc = el.getAttribute('src') || '';
      if (lazySrc && (!currentSrc || currentSrc.includes('data:image') || currentSrc.length < 10)) {
        try { el.setAttribute('src', new URL(lazySrc, baseUrl).href); } catch {}
      } else {
        absolutize(el, 'src');
      }
      // Non-éditable dans le contentEditable de la vue diff
      el.setAttribute('contenteditable', 'false');
      el.setAttribute('loading', 'lazy');
    });
    doc.querySelectorAll('iframe').forEach(el => absolutize(el, 'src'));
    doc.querySelectorAll('a[href]').forEach(el => absolutize(el, 'href'));
    doc.querySelectorAll('video[src], source[src]').forEach(el => absolutize(el, 'src'));

    // ── Wrapper responsive pour les iframes (YouTube, Vimeo, etc.) ──────────────
    // On enveloppe chaque iframe dans un div 16:9 pour qu'elles s'adaptent au
    // conteneur sans débordement, et on les marque non-éditables.
    doc.querySelectorAll('iframe').forEach(el => {
      const src = el.getAttribute('src') || '';
      if (!src) { el.remove(); return; }      // iframe sans src = inutile
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('data-media', 'iframe-wrapper');
      wrapper.setAttribute('contenteditable', 'false');
      el.setAttribute('contenteditable', 'false');
      el.setAttribute('allowfullscreen', '');
      el.parentNode.insertBefore(wrapper, el);
      wrapper.appendChild(el);
    });

    // ── Garder uniquement les attributs utiles ──────────────────────────────────
    const KEEP_ATTRS = new Set([
      'href', 'src', 'srcset', 'sizes', 'alt', 'title',
      'colspan', 'rowspan', 'scope', 'headers',
      'width', 'height', 'frameborder', 'allowfullscreen', 'allow',
      'controls', 'autoplay', 'loop', 'muted', 'poster', 'preload', 'type',
      'loading', 'target', 'data-media', 'data-featured', 'contenteditable',
    ]);
    doc.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (!KEEP_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
      });
    });

    // Supprimer les éléments vides (sauf médias et tableaux)
    const STRUCTURAL = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'iframe', 'video', 'source', 'br', 'hr']);
    doc.querySelectorAll('*').forEach(el => {
      if (!STRUCTURAL.has(el.tagName.toLowerCase()) && !el.textContent.trim() && el.children.length === 0) {
        el.remove();
      }
    });

    // Convertir les <div> "feuilles" (sans enfants block) en <p>
    const BLOCK_TAGS = new Set(['p','h1','h2','h3','h4','h5','h6','div','ul','ol','table','blockquote','pre','figure','section','article','iframe','video','img']);
    doc.querySelectorAll('div:not([data-media])').forEach(div => {
      const hasBlockChild = Array.from(div.children).some(c => BLOCK_TAGS.has(c.tagName.toLowerCase()));
      if (!hasBlockChild && div.textContent.trim()) {
        const p = doc.createElement('p');
        p.innerHTML = div.innerHTML;
        if (div.parentNode) div.parentNode.replaceChild(p, div);
      }
    });

    let htmlContent = doc.body ? doc.body.innerHTML.trim() : article.content;

    const hasBlocks = /<(p|h[1-6]|table|ul|ol|img|iframe|video)\b/i.test(htmlContent);
    if (!hasBlocks) {
      htmlContent = article.textContent
        .trim()
        .split(/\n{2,}/)
        .map(chunk => chunk.trim().replace(/\n/g, '<br>'))
        .filter(Boolean)
        .map(chunk => `<p>${chunk}</p>`)
        .join('\n');
    }

    // ── Injecter l'image à la une en tête si elle n'est pas déjà dans le contenu ──
    if (featuredImageUrl) {
      const alreadyPresent = htmlContent.includes(featuredImageUrl)
        || htmlContent.includes(featuredImageUrl.split('?')[0]); // ignorer les query strings
      if (!alreadyPresent) {
        const featuredImgHtml = `<figure data-featured="true"><img src="${featuredImageUrl}" alt="${article.title || ''}" contenteditable="false" loading="lazy" /></figure>`;
        htmlContent = featuredImgHtml + '\n' + htmlContent;
      }
    }

    // ── TextContent enrichi pour Claude (texte brut + références médias) ────────
    const mediaRefs = [];
    doc.querySelectorAll('img[src]').forEach(el => {
      const alt = (el.getAttribute('alt') || '').trim();
      mediaRefs.push(alt ? `[Image: "${alt}"]` : '[Image sans légende]');
    });
    doc.querySelectorAll('[data-media="iframe-wrapper"] iframe[src]').forEach(el => {
      const src = el.getAttribute('src') || '';
      const label = /youtube|youtu\.be/i.test(src) ? 'Vidéo YouTube'
                  : /vimeo/i.test(src)             ? 'Vidéo Vimeo'
                  : 'Vidéo intégrée';
      mediaRefs.push(`[${label}: ${src}]`);
    });

    const rawText = article.textContent
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    const textContent = mediaRefs.length > 0
      ? `${rawText}\n\n--- Médias présents dans l'article ---\n${mediaRefs.join('\n')}`
      : rawText;

    return res.json({
      success: true,
      title:       article.title    || '',
      content:     htmlContent,      // ← HTML structuré (tableaux, titres, listes…)
      textContent: textContent,      // ← texte brut (fallback / usage Claude)
      byline:      article.byline   || '',
      siteName:    article.siteName || '',
      length:      textContent.length,
    });

  } catch (err) {
    console.error('[scrape]', err.message);
    const status = err.response?.status;
    if (status === 403 || status === 401) {
      return res.status(403).json({ error: 'Ce site bloque le scraping (403). Copiez-collez le contenu manuellement.' });
    }
    return res.status(500).json({ error: `Erreur de récupération : ${err.message}` });
  }
});

// ─── Proxy Jina AI (scraping & search) ───────────────────────────────────────
// Jina est appelé ici côté serveur pour que le navigateur n'expose pas les URLs
// des articles traités directement à un service tiers (confidentialité).
app.post('/api/jina', requireAuth, async (req, res) => {
  const { url, mode = 'reader' } = req.body;  // mode: 'reader' | 'search'
  if (!url) return res.status(400).json({ error: 'url manquante' });
  // Vérification SSRF sur tous les modes (reader et search)
  try { await assertSafeUrl(url, 'URL Jina'); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const base = mode === 'search' ? 'https://s.jina.ai/' : 'https://r.jina.ai/';
    const response = await axios.get(`${base}${encodeURIComponent(url)}`, {
      headers: {
        'Accept': mode === 'search' ? 'application/json' : 'text/plain',
        'X-Return-Format': mode === 'search' ? 'json' : 'text',
      },
      timeout: 30000,
    });
    return res.json({ success: true, data: response.data });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Traitement du HTML WordPress (contenu brut de l'API REST) ───────────────
// Le contenu `content.rendered` de l'API WP n'est pas passé par Readability.
// On applique les mêmes traitements que le scraper :
//   • Résolution lazy-loading (data-src → src)
//   • Wrapper responsive 16:9 pour les iframes
//   • contenteditable="false" sur les médias
const processWpHtml = (html, siteUrl) => {
  if (!html) return '';
  let dom;
  try { dom = new JSDOM(html, { url: siteUrl }); } catch { return html; }
  const doc = dom.window.document;
  const base = (() => { try { return new URL(siteUrl); } catch { return null; } })();

  const toAbs = (src) => {
    if (!src || src.startsWith('http') || src.startsWith('//')) return src;
    if (!base) return src;
    try { return new URL(src, base).href; } catch { return src; }
  };

  // Résolution lazy-loading + absolutisation
  doc.querySelectorAll('img').forEach(el => {
    const lazySrc = el.getAttribute('data-src') || el.getAttribute('data-lazy-src')
      || el.getAttribute('data-original') || el.getAttribute('data-lazy')
      || el.getAttribute('data-srcset');
    const currentSrc = el.getAttribute('src') || '';
    if (lazySrc && (!currentSrc || currentSrc.includes('data:image') || currentSrc.length < 10)) {
      el.setAttribute('src', toAbs(lazySrc));
    } else if (currentSrc && !currentSrc.startsWith('http') && !currentSrc.startsWith('data:')) {
      el.setAttribute('src', toAbs(currentSrc));
    }
    // Résoudre aussi srcset si relatif
    const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
    if (srcset && !el.getAttribute('srcset')) el.setAttribute('srcset', srcset);
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('loading', 'lazy');
  });

  // Wrapper responsive 16:9 pour les iframes (YouTube, Vimeo, etc.)
  doc.querySelectorAll('iframe').forEach(el => {
    const src = el.getAttribute('src') || '';
    if (!src) { el.remove(); return; }
    // Déjà wrappé
    if (el.parentNode?.getAttribute?.('data-media') === 'iframe-wrapper') return;
    const wrapper = doc.createElement('div');
    wrapper.setAttribute('data-media', 'iframe-wrapper');
    wrapper.setAttribute('contenteditable', 'false');
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('allowfullscreen', '');
    el.parentNode.insertBefore(wrapper, el);
    wrapper.appendChild(el);
  });

  // Non-éditabilité des vidéos
  doc.querySelectorAll('video').forEach(el => {
    el.setAttribute('contenteditable', 'false');
  });

  return doc.body ? doc.body.innerHTML.trim() : html;
};

// ─── MCP WordPress : exécution d'outils ──────────────────────────────────────
// Appelé soit directement (/api/wp-tool) soit depuis la boucle /api/claude-tools.
// wpSites : liste des sites configurés dans l'app, avec credentials complets.
async function executeWpTool(toolName, toolInput, wpSites = []) {
  const getSite = (siteId) => {
    const site = (wpSites || []).find(s => s.id === siteId);
    if (!site) throw new Error(`Site WordPress "${siteId}" non trouvé`);
    return site;
  };

  const wpApi = async (site, method, wpPath, body = null) => {
    await assertSafeUrl(site.url, 'URL du site WP');
    const url = `${site.url.replace(/\/$/, '')}${wpPath}`;
    const auth = Buffer.from(`${site.username}:${site.password}`).toString('base64');
    const resp = await axios({
      method, url,
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      data: body || undefined,
      timeout: 20000,
    });
    return resp.data;
  };

  switch (toolName) {

    case 'wp_get_post': {
      const { site_id, post_url } = toolInput;
      const site = getSite(site_id);

      let slug = '';
      try {
        const parts = new URL(post_url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
        slug = parts.pop() || '';
      } catch {
        slug = post_url.split('?')[0].replace(/\/$/, '').split('/').pop() || '';
      }
      if (!slug) return { error: 'Impossible d\'extraire le slug depuis l\'URL' };

      let post = null;
      for (const type of ['posts', 'pages']) {
        try {
          const rows = await wpApi(site, 'GET',
            `/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&_fields=id,title,content,featured_media,status,link,type,categories,tags`);
          if (Array.isArray(rows) && rows.length > 0) { post = { ...rows[0], postType: type }; break; }
        } catch {}
      }
      if (!post) return { error: `Aucun article trouvé pour le slug "${slug}"` };

      let featuredMediaUrl = null;
      if (post.featured_media) {
        try {
          const media = await wpApi(site, 'GET',
            `/wp-json/wp/v2/media/${post.featured_media}?_fields=id,source_url,alt_text`);
          featuredMediaUrl = media.source_url || null;
        } catch {}
      }

      let processedContent = processWpHtml(post.content?.rendered || '', site.url);
      // Injecter l'image à la une en tête — même logique que le scraper (ligne ~706)
      if (featuredMediaUrl) {
        const alreadyIn = processedContent.includes(featuredMediaUrl.split('?')[0]);
        if (!alreadyIn) {
          processedContent = `<figure data-featured="true"><img src="${featuredMediaUrl}" alt="" contenteditable="false" loading="lazy" /></figure>\n` + processedContent;
        }
      }

      return {
        post_id:            post.id,
        title:              decodeHtmlEntities(post.title?.rendered || ''),
        content:            processedContent,
        status:             post.status,
        post_type:          post.postType,
        link:               post.link,
        featured_media_id:  post.featured_media || null,
        featured_media_url: featuredMediaUrl,
        categories:         post.categories || [],
        tags:               post.tags || [],
      };
    }

    case 'wp_upload_media': {
      const { site_id, image_url, alt_text = '' } = toolInput;
      const site = getSite(site_id);
      await assertSafeUrl(image_url, 'URL image');

      const imgResp = await axios.get(image_url, {
        responseType: 'arraybuffer', timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const contentType = imgResp.headers['content-type'] || 'image/jpeg';
      const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
      const fname = `featured-${Date.now()}.${ext}`;

      const auth = Buffer.from(`${site.username}:${site.password}`).toString('base64');
      // L'API REST WP attend du binaire brut + Content-Disposition, pas du multipart
      const uploadResp = await axios.post(
        `${site.url.replace(/\/$/, '')}/wp-json/wp/v2/media`,
        Buffer.from(imgResp.data),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${fname}"`,
            ...(alt_text ? { 'X-WP-Alt-Text': alt_text } : {}),
          },
          timeout: 60000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );
      return { media_id: uploadResp.data.id, url: uploadResp.data.source_url };
    }

    case 'wp_update_post': {
      const { site_id, post_id, content, featured_media_id, status } = toolInput;
      const site = getSite(site_id);

      // Règles de mise à jour :
      // • Jamais de `title`  — le titre WP est conservé tel quel
      // • Jamais de `author` — l'auteur de l'article ne change jamais
      // • Jamais de champs SEO (meta, _seopress_*, _yoast_*) — gérés par SEOPRESS séparément
      const { categories, tags } = toolInput;
      const body = {};
      if (content           !== undefined) body.content        = content;
      if (status            !== undefined) body.status         = status;
      if (featured_media_id !== undefined) body.featured_media = featured_media_id;
      if (Array.isArray(categories))       body.categories     = categories;
      if (Array.isArray(tags))             body.tags           = tags;

      // Détection du type (post ou page)
      let postType = 'posts';
      try { await wpApi(site, 'GET', `/wp-json/wp/v2/posts/${post_id}?_fields=id`); }
      catch { postType = 'pages'; }

      const result = await wpApi(site, 'POST', `/wp-json/wp/v2/${postType}/${post_id}`, body);
      return { post_id: result.id, link: result.link, status: result.status, featured_media: result.featured_media };
    }

    default:
      throw new Error(`Outil MCP inconnu : ${toolName}`);
  }
}

// ─── POST /api/wp-categories — récupère catégories + tags d'un site WP ──────
// Body : { siteId, wpSites: [{ id, url, username, password }] }
app.post('/api/wp-categories', requireAuth, async (req, res) => {
  const { siteId, wpSites = [] } = req.body;
  const site = wpSites.find(s => s.id === siteId);
  if (!site || !site.url || !site.username || !site.password) {
    return res.status(400).json({ error: 'Site introuvable ou credentials manquants' });
  }
  try {
    await assertSafeUrl(site.url, 'URL du site WP');
    const auth    = Buffer.from(`${site.username}:${site.password}`).toString('base64');
    const headers = { 'Authorization': `Basic ${auth}` };
    const base    = site.url.replace(/\/$/, '');

    const [catsResp, tagsResp] = await Promise.all([
      axios.get(`${base}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,parent,count`, { headers, timeout: 10000 }),
      axios.get(`${base}/wp-json/wp/v2/tags?per_page=100&_fields=id,name,count`, { headers, timeout: 10000 }),
    ]);

    const decodeList = (arr) => (arr || []).map(item => ({ ...item, name: decodeHtmlEntities(item.name) }));
    res.json({
      categories: decodeList(catsResp.data),
      tags:       decodeList(tagsResp.data),
    });
  } catch (e) {
    console.error('[wp-categories]', e.message);
    res.status(500).json({ error: safeError(e, 'Impossible de récupérer les catégories') });
  }
});

// ─── POST /api/wp-related-posts — recherche des articles liés pour liens internes ─
// Body : { siteId, wpSites, queries: string[], excludeUrl?: string }
// Retourne : { posts: [{ id, title, url, excerpt }] }
app.post('/api/wp-related-posts', requireAuth, async (req, res) => {
  const { siteId, wpSites = [], queries = [], excludeUrl = '' } = req.body;
  const site = wpSites.find(s => s.id === siteId);
  if (!site || !site.url) {
    return res.status(400).json({ error: 'Site introuvable' });
  }
  try {
    await assertSafeUrl(site.url, 'URL du site WP');
    // Auth optionnelle — les posts publiés sont accessibles publiquement via WP REST API
    const authHeader = (site.username && site.password)
      ? { 'Authorization': `Basic ${Buffer.from(`${site.username}:${site.password}`).toString('base64')}` }
      : {};
    const headers = { ...authHeader };
    const base    = site.url.replace(/\/$/, '');

    // Recherche en parallèle pour chaque query (max 3 queries × 5 résultats)
    const searches = queries.slice(0, 3).map(q =>
      axios.get(
        `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=5&status=publish&_fields=id,title,link,excerpt`,
        { headers, timeout: 10000 }
      ).then(r => r.data).catch(() => [])
    );
    const results = await Promise.all(searches);

    // Dédupliquer par ID, exclure l'article en cours
    const seen = new Set();
    const posts = results.flat()
      .filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        if (excludeUrl && p.link && p.link.replace(/\/$/, '') === excludeUrl.replace(/\/$/, '')) return false;
        return true;
      })
      .slice(0, 15)
      .map(p => ({
        id:      p.id,
        title:   p.title?.rendered ? p.title.rendered.replace(/<[^>]+>/g, '') : '',
        url:     p.link || '',
        excerpt: p.excerpt?.rendered ? p.excerpt.rendered.replace(/<[^>]+>/g, '').substring(0, 120) : '',
      }));

    res.json({ posts });
  } catch (e) {
    console.error('[wp-related-posts]', e.message);
    res.status(500).json({ error: safeError(e, 'Impossible de récupérer les articles liés') });
  }
});

// ─── POST /api/wp-tool — exécution directe d'un outil WordPress (sans Claude) ─
app.post('/api/wp-tool', requireAuth, async (req, res) => {
  const { toolName, toolInput, wpSites = [] } = req.body;
  if (!toolName) return res.status(400).json({ success: false, error: 'toolName requis' });
  try {
    const result = await executeWpTool(toolName, toolInput || {}, wpSites);
    res.json({ success: true, result });
  } catch (e) {
    console.error('[proxy] /api/wp-tool erreur:', e.message);
    res.status(500).json({ success: false, error: safeError(e, 'Erreur lors de l\'exécution de l\'outil WordPress') });
  }
});

// ─── Validation des types de fichiers pour les PJ tickets ─────────────────────
// Blocklist des extensions pouvant servir de vecteur XSS ou d'exécution de code.
// Vecteurs bloqués : SVG (inline JS), HTML, scripts côté serveur/client, binaires.
const TICKET_BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'xml', 'mxml',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar',
  'asp', 'aspx', 'ashx', 'jsp', 'jspx', 'cfm',
  'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'msp',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1',
  'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'swf',
  'jar', 'class', 'war', 'ear',
  'py', 'rb', 'pl', 'cgi', 'lua',
]);

// Magic bytes pour les types visuels — détecte le spoofing d'extension
const TICKET_IMG_MAGIC = [
  { exts: ['jpg', 'jpeg'], magic: [0xFF, 0xD8, 0xFF] },
  { exts: ['png'],         magic: [0x89, 0x50, 0x4E, 0x47] },
  { exts: ['gif'],         magic: [0x47, 0x49, 0x46] },
  { exts: ['webp'],        magic: [0x52, 0x49, 0x46, 0x46] }, // RIFF…WEBP
  { exts: ['pdf'],         magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

const validateTicketFile = (buffer, filename) => {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (TICKET_BLOCKED_EXTENSIONS.has(ext)) {
    return `Type de fichier interdit (.${ext}) — SVG, HTML et scripts ne sont pas acceptés`;
  }
  const magicEntry = TICKET_IMG_MAGIC.find(e => e.exts.includes(ext));
  if (magicEntry) {
    const valid = magicEntry.magic.every((b, i) => buffer[i] === b);
    if (!valid) return `Contenu incohérent avec l'extension .${ext} — fichier corrompu ou déguisé`;
  }
  return null; // OK
};

// ─── PJ Tickets — stockage local serveur (data/uploads/) ────────────────────
// Firebase Storage inaccessible via service account → fichiers sur le serveur.
// Persistance : data/ n'est jamais écrasé par le CI/CD.
// Sécurité : préfixe aléatoire + path.basename() anti-traversal.
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads', 'ticket-attachments');
const ticketUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/upload-ticket-file
app.post('/api/upload-ticket-file', requireAuth, ticketUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
  const { ticketId } = req.body;
  if (!ticketId || ticketId.includes('..')) return res.status(400).json({ error: 'ticketId invalide' });

  try {
    // multer reçoit les noms en Latin-1 même si le fichier est UTF-8 → décodage explicite
    const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    // C2 — Validation type de fichier (blocklist extensions + magic bytes)
    const validationError = validateTicketFile(req.file.buffer, decodedName);
    if (validationError) return res.status(400).json({ error: validationError });
    const safeName    = path.basename(decodedName).replace(/[^a-zA-Z0-9._\-àáâãäåèéêëìíîïòóôõöùúûüýÿ]/g, '_');
    const prefix      = require('crypto').randomBytes(8).toString('hex');
    const filename    = `${prefix}_${safeName}`;
    const dir         = path.join(UPLOADS_DIR, ticketId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);

    const url = `/api/ticket-attachments/${ticketId}/${filename}`;
    console.log(`[upload-ticket-file] ✓ ${decodedName} → ${url}`);
    res.json({ url, name: decodedName, type: req.file.mimetype, size: req.file.size });
  } catch (e) {
    console.error('[upload-ticket-file]', e.message);
    res.status(500).json({ error: safeError(e, 'Erreur lors de la sauvegarde du fichier') });
  }
});

// GET /api/ticket-attachments/:ticketId/:filename — sert les PJ (auth JWT requise)
// Le frontend fetche via fetch()+blob URL pour envoyer le Bearer token.
// X-Content-Type-Options : nosniff → empêche le MIME sniffing.
// Content-Disposition : attachment pour les non-médias → empêche l'exécution inline.
app.get('/api/ticket-attachments/:ticketId/:filename', requireAuth, (req, res) => {
  const ticketId = path.basename(req.params.ticketId);
  const filename = path.basename(req.params.filename);
  if (!ticketId || !filename) return res.status(400).send('Paramètres invalides');
  const filePath = path.join(UPLOADS_DIR, ticketId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Fichier introuvable');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Images et vidéos → affichage inline (blob URL côté client, pas de risque XSS direct)
  // Autres types → forcer téléchargement pour bloquer toute exécution navigateur
  const ext = filename.split('.').pop().toLowerCase();
  const INLINE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'ogg', 'mov']);
  if (!INLINE_EXTS.has(ext)) {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }

  res.sendFile(filePath);
});

// ─── POST /api/wp-upload-file — upload d'un fichier local vers la médiathèque WP ─
// Accepte multipart/form-data : file (image), site (JSON site object).
// Utilisé pour le téléversement direct depuis le PC (bouton "Parcourir") dans l'UI.
app.post('/api/wp-upload-file', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Fichier image requis' });

  let site;
  try { site = JSON.parse(req.body.site || '{}'); } catch { return res.status(400).json({ success: false, error: 'Paramètre site invalide' }); }
  if (!site.url || !site.username || !site.password) {
    return res.status(400).json({ success: false, error: 'Paramètres site incomplets (url, username, password)' });
  }

  try {
    await assertSafeUrl(site.url, 'URL du site WP');
    const auth     = Buffer.from(`${site.username}:${site.password}`).toString('base64');
    const fname    = req.file.originalname || `image-${Date.now()}.jpg`;
    const mime     = req.file.mimetype     || 'image/jpeg';

    // L'API REST WordPress exige du binaire brut + Content-Disposition (pas multipart)
    const uploadResp = await axios.post(
      `${site.url.replace(/\/$/, '')}/wp-json/wp/v2/media`,
      req.file.buffer,
      {
        headers: {
          'Authorization':   `Basic ${auth}`,
          'Content-Type':    mime,
          'Content-Disposition': `attachment; filename="${fname}"`,
        },
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
      }
    );
    res.json({ success: true, media_id: uploadResp.data.id, url: uploadResp.data.source_url });
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.code || e.message;
    console.error('[proxy] /api/wp-upload-file erreur:', e.response?.status, msg);
    // msg provient de l'API WordPress (erreur métier) — acceptable en prod
    res.status(500).json({ success: false, error: msg || safeError(e) });
  }
});

// ─── POST /api/claude-tools — boucle agentique Claude + outils WordPress MCP ──
// Gère la boucle tool_use → exécution → tool_result jusqu'à end_turn.
// Accepte les mêmes paramètres que /api/claude + { tools, wpSites }.
app.post('/api/claude-tools', requireAuth, async (req, res) => {
  const { system, messages, max_tokens = 4096, model, tools = [], wpSites = [] } = req.body;
  const bodyApiKey = null; // clé API jamais acceptée depuis le client — lire uniquement settings.json
  // Clé Anthropic : lire depuis data/settings.json en priorité, fallback sur la clé du body.
  const { anthropicKey: _sak } = readServerSettings();
  const clientApiKey = (_sak && _sak !== 'local') ? _sak : bodyApiKey;
  if (!messages?.length) return res.status(400).json({ error: 'messages requis' });

  const requestedModel = MODEL_CASCADE.includes(model) ? model : MODEL_FALLBACK;
  const toolCallLog = [];
  let currentMessages = [...messages];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalText = '';
  let finalModel = requestedModel;

  try {
    for (let iter = 0; iter < 10; iter++) {
      let response;
      if (clientApiKey && clientApiKey !== 'local') {
        response = await callAnthropicWithApiKey(clientApiKey, {
          model: requestedModel, max_tokens, system, messages: currentMessages, tools,
        });
        // callAnthropicWithApiKey retourne { text, modelUsed, usage } — si tool_use, il faut la réponse brute
        // On utilise callAnthropicDirect à la place pour avoir le stop_reason
        const token = (() => { try { return getOAuthToken(); } catch { return null; } })();
        if (token) {
          response = await callAnthropicDirect(token, {
            model: requestedModel, max_tokens, system, messages: currentMessages, tools,
          });
        } else {
          // Pas d'OAuth : on ne peut pas faire la boucle tool_use avec clé API seule pour l'instant
          finalText = response.text || '';
          finalModel = response.modelUsed || requestedModel;
          totalUsage = response.usage || totalUsage;
          break;
        }
      } else {
        const token = getOAuthToken();
        response = await callAnthropicDirect(token, {
          model: requestedModel, max_tokens, system, messages: currentMessages, tools,
        });
      }

      totalUsage.input_tokens  += response.usage?.input_tokens  || 0;
      totalUsage.output_tokens += response.usage?.output_tokens || 0;
      finalModel = response.model || requestedModel;

      if (response.stop_reason !== 'tool_use') {
        finalText = response.content?.find(c => c.type === 'text')?.text || '';
        break;
      }

      // Exécution des outils demandés par Claude
      const tuBlocks = (response.content || []).filter(c => c.type === 'tool_use');
      const toolResults = [];
      for (const tu of tuBlocks) {
        toolCallLog.push({ name: tu.name, input: tu.input });
        try {
          const r = await executeWpTool(tu.name, tu.input, wpSites);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r) });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ error: e.message }), is_error: true });
        }
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ];
    }

    res.json({
      content:     [{ text: finalText }],
      modelUsed:   finalModel,
      usage:       totalUsage,
      toolCallLog,
    });
  } catch (e) {
    console.error('[proxy] /api/claude-tools erreur:', e.message);
    if (e.message === 'AUTH_REQUIRED')
      return res.status(401).json({ error: 'Claude non connecté. Lance `claude login` puis relance npm start.' });
    res.status(500).json({ error: e.message });
  }
});

// ─── Proxy WordPress REST API ─────────────────────────────────────────────────
// Toutes les requêtes WP passent par ici pour éviter les blocages CORS du navigateur.
// Le proxy Node.js n'a pas de restriction cross-origin → les appels avec Authorization
// header fonctionnent même si le site WP n'a pas configuré CORS.
app.post('/api/wordpress', requireAuth, async (req, res) => {
  const { wpUrl, username, password, method = 'GET', path: wpPath, body } = req.body;
  const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);
  if (!ALLOWED_METHODS.has((method || '').toUpperCase())) {
    return res.status(400).json({ success: false, error: 'Méthode HTTP non autorisée' });
  }
  if (!wpUrl || !username || !password || !wpPath) {
    return res.status(400).json({ success: false, error: 'Paramètres manquants (wpUrl, username, password, path)' });
  }

  // Protection SSRF : le wpUrl ne doit pas pointer vers des ressources internes
  try { await assertSafeUrl(wpUrl, 'URL du site WordPress'); }
  catch (e) { return res.status(400).json({ success: false, error: e.message }); }

  // Validation du chemin : doit commencer par /wp-json/ et ne pas contenir
  // de séquences de traversal (..) ni de caractères de contrôle (header injection)
  if (!wpPath.startsWith('/wp-json/')) {
    return res.status(400).json({ success: false, error: 'Chemin WP invalide — doit commencer par /wp-json/' });
  }
  if (/[^\x20-\x7E]/.test(wpPath) || wpPath.includes('..')) {
    return res.status(400).json({ success: false, error: 'Caractères non autorisés dans le chemin WP' });
  }

  const token = Buffer.from(`${username}:${password}`).toString('base64');
  const fullUrl = `${wpUrl.replace(/\/$/, '')}${wpPath}`;

  try {
    const response = await axios({
      method,
      url: fullUrl,
      headers: {
        'Authorization': `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      data: body || undefined,
      timeout: 15000,
    });
    return res.json({ success: true, data: response.data });
  } catch (e) {
    const status  = e.response?.status;
    const message = e.response?.data?.message || e.message;
    return res.status(status || 500).json({ success: false, error: message });
  }
});

// ─── Route racine ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (IS_PROD) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  } else {
    res.redirect(302, 'http://localhost:3000');
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
// Public (utilisé par ProxyDetector avant login) — réponse minimale sans infos de config.
app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

// ─── SPA fallback (prod) — toute route non-API renvoie index.html ─────────────
// ── Tickets admin (Admin SDK — bypass règles Firestore) ──────────────────────
// GET /api/admin/tickets — tous les tickets sans restriction (super_admin + manager)
app.get('/api/admin/tickets', requireAuth, async (req, res) => {
  if (!firebaseAdmin) return res.status(503).json({ error: 'Firebase Admin non initialisé' });
  const { role } = req.user;
  if (role !== 'super_admin' && role !== 'manager') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  try {
    const db = firebaseAdmin.firestore();
    const snap = await db.collection('tickets').orderBy('createdAt', 'desc').get();
    const tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ tickets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Doit être APRÈS toutes les routes /api/* pour ne pas les intercepter.
// app.use() sans chemin = catch-all compatible toutes versions de path-to-regexp.
if (IS_PROD) {
  app.use((_, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
}

// ─── Démarrage ─────────────────────────────────────────────────────────────────
const HOST = IS_PROD ? '0.0.0.0' : '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  let authOk = false;
  try { getOAuthToken(); authOk = true; } catch {}
  console.log(`\n  ✓ Proxy ArticleAI actif → http://localhost:${PORT}`);
  if (authOk) {
    console.log(`  Auth : OAuth Claude Desktop (déchiffrement DPAPI) ✓`);
    console.log(`  Aucune configuration supplémentaire requise.\n`);
  } else {
    console.log(`  Auth : fallback CLI → ${CLAUDE_BIN}`);
    console.log(`\n  ⚠ Si l'agent échoue avec une erreur d'auth :`);
    console.log(`  → Ouvre un terminal et lance : "${CLAUDE_BIN}" login\n`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} déjà occupé. Libère le port et relance.\n`);
    process.exit(1);
  } else {
    console.error('\n  ✗ Erreur serveur proxy :', err.message);
    process.exit(1);
  }
});
