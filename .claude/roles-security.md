# Rôles & Sécurité

## Rôles
| Rôle | Accès |
|------|-------|
| `super_admin` | Tout + Paramètres + création tous rôles |
| `manager` | Équipe (CQ IA) + Tickets L1 + Dashboard équipe |
| `cq_ia` | MAJ + MAJ en attente + Historique (ses articles) + Tickets (ses tickets) |

## Auth
- **super_admin** : login local JWT (+ 2FA si activée)
- **manager/cq_ia** : Firebase Auth → `POST /api/firebase-login` → JWT interne (+ 2FA si activée)
- **2FA** : TOTP (speakeasy) ou Email OTP — activable dans Mon compte
- JWT 8h · tempToken 2FA 5m
- **SAFE_USERNAME_RE** : `/^[a-zA-Z0-9._-]{1,64}$/`

## Sécurité proxy.js
- Rate limiter AVANT les routes auth (60/min global, 10/min auth)
- `assertSafeUrl` async + `dns.lookup()` (anti DNS rebinding)
- Clés API (Brave/Tavily/Anthropic/Groq) jamais exposées au client
- Application Passwords WordPress **persistés dans Firestore** (token révocable ≠ mot de passe admin)
- OTP 2FA hashé HMAC-SHA256 avant stockage disque
- LiteLLM pricing : validation 0 < prix < 200 $/MTok

## Tickets WordPress (super_admin)
- `GET /api/admin/tickets` → Firebase Admin SDK (bypasse les règles Firestore)
- `cq_ia` → `where('creatorId', '==', userId)` (ses tickets uniquement)
