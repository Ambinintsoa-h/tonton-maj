# Rôles & Sécurité

## Rôles
| Rôle | Accès |
|------|-------|
| `super_admin` | Tout + Paramètres + création tous rôles + suppression tous tickets |
| `manager` | Équipe (CQ IA) + Tickets L1 + Dashboard équipe + suppression ses tickets & tickets cq_ia |
| `support` | Lecture tickets + commentaires + assignation — **aucune suppression** |
| `cq_ia` | MAJ + MAJ en attente + Historique (ses articles) + Tickets (ses tickets) + suppression ses tickets |

## Création de tickets (`canCreate`)
Rôles autorisés : `cq_ia`, `manager`, `support`, `super_admin`

## Suppression de tickets
| Rôle | Peut supprimer |
|------|---------------|
| `super_admin` | Tous les tickets |
| `manager` | Ses tickets + tous les tickets créés par un `cq_ia` |
| `cq_ia` | Ses propres tickets uniquement |
| `support` | Aucun |

Règle miroir dans `firestore.rules` (allow delete) ET dans `canDeleteTicket()` côté UI.

## Auth
- **super_admin** : login local JWT (+ 2FA si activée)
- **manager/cq_ia/support** : Firebase Auth → `POST /api/firebase-login` → JWT interne (+ 2FA si activée)
- **2FA** : TOTP (speakeasy) ou Email OTP — activable dans Mon compte
- JWT 8h · tempToken 2FA 5min
- `SAFE_USERNAME_RE` : `/^[a-zA-Z0-9._-]{1,64}$/`

## Sécurité proxy.js
- Rate limiter AVANT les routes auth (60/min global, 10/min auth, 5/min resolve-username)
- Lockout IP : 5 échecs login → 15 min de verrouillage
- `assertSafeUrl` async + `dns.lookup()` (anti DNS rebinding / SSRF)
- Clés API (Brave/Tavily/Anthropic/Groq) **jamais exposées au client** — lues côté serveur depuis `data/settings.json`
- Application Passwords WordPress persistés dans Firestore (token révocable ≠ mot de passe admin)
- OTP 2FA hashé HMAC-SHA256 avant stockage disque
