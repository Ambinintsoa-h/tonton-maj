# TONTON AI

## Règles permanentes
1. Terminer chaque intervention par **`TERMINER SIR`**
2. Questions **une par une** avant de coder
3. **Ne jamais lancer `npm start`**
4. Travailler sur une **branche** (`feat/...` ou `fix/...`), ouvrir une **PR** vers `main`
5. Merger via PR uniquement — CI (`Build & Lint`) doit être vert
6. `git pull --rebase` avant chaque push
7. **NE JAMAIS TOUCHER AUX FONCTIONNALITÉS EXISTANTES QUI FONCTIONNENT.**
   - Si on est dans l'obligation d'y toucher : **toujours demander avant**, et **vérifier qu'aucun conflit/régression n'existe**. Rester très vigilant.
8. **URGENT ET IMPORTANT — ne JAMAIS ajouter ni supprimer de liens EXTERNES dans les articles.**
   - Verrou codé en dur : `enforceExternalLinkPolicy` dans `src/utils/diff.js` (appelé par `applyAllDiffs`, passes 1 et 2, tous les flux) + consigne dans les prompts (`services/agent.js`).
   - Ne jamais affaiblir ce verrou sans accord explicite. Les liens INTERNES (même domaine) ne sont pas concernés.

## Docs chargées automatiquement
@.claude/git-deploy.md
@.claude/architecture.md
@.claude/roles-security.md

## Docs à lire selon le contexte
- `.claude/features.md` — pages, routes, comportements UI
- `.claude/firebase.md` — collections Firestore, règles de sécurité
- `.claude/agent-pipeline.md` — agent.js, search, prompts IA
- `.claude/tickets.md` — système tickets, permissions, UI
