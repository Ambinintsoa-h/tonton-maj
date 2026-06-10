# Git & Déploiement

> ⚠️ CRITIQUE — lire avant tout commit

## Workflow obligatoire

```bash
git checkout main && git pull --rebase
git checkout -b feat/nom-feature        # ou fix/nom-bug
# ... éditions ...
git add <fichiers>
git commit -m "type(scope): description"
git push -u origin feat/nom-feature
gh pr create --title "..." --body "..."
# Attendre CI vert (Build & Lint ~1m30s), puis :
gh pr merge <N> --merge --delete-branch
git checkout main && git pull
```

## Interdictions absolues
- **Ne JAMAIS push direct sur `main`** — protégé, CI obligatoire
- **Ne JAMAIS reset/force-push** — casse le déploiement n0c
- **Ne JAMAIS merger sans CI vert**

## Infra prod
- **URL** : `maj.stomos.net` (n0c — node143-eu.n0c.com, port 5022, user eufcarqxft)
- **CI/CD** : merge main → GitHub Actions → SSH n0c (retry 3×, ConnectTimeout 60s) → `npm install --omit=dev` → `cp build/ public/` → `touch tmp/restart.txt`
- **Repo** : `git@github.com:Ambinintsoa-h/tonton-maj.git`
- **Firebase project** : `tonton-ai-c8196`

## Nommage des branches
| Préfixe | Usage |
|---------|-------|
| `feat/` | Nouvelle fonctionnalité |
| `fix/`  | Correction de bug |
| `chore/`| Docs, config, refacto sans logique |

## CI — GitHub Actions
- **`Build & Lint`** : seul check requis, ~1m30s
- Warnings PowerShell sur stderr git (ex : "Already on 'main'") = **faux positifs** — vérifier le fichier `.output` pour confirmer le vrai statut
