# Git & Déploiement

> ⚠️ CRITIQUE — lire avant tout commit

## Règle absolue : push direct sur `main`
```bash
git add <fichiers>
git commit -m "message"
git push origin main   # → GitHub Actions déploie automatiquement sur maj.stomos.net
```

## Interdictions absolues
- **Ne JAMAIS reset `main` via l'API GitHub** — casse le CI/CD (redéploie l'ancien code)
- **Ne JAMAIS créer de branches/PR via reset de main**
- Si `/create-pr-command` demandé : commit + push main → fournir URL commit : `https://github.com/Ambinintsoa-h/tonton-maj/commit/{SHA}`

## Infra prod
- **URL** : `maj.stomos.net` — N0C (node143-eu.n0c.com, port 5022, user eufcarqxft)
- **CI/CD** : push main → GitHub Actions → SCP (retry 3×, ServerAliveInterval 15) → `npm install --omit=dev` → `cp build/ public/` → `touch tmp/restart.txt`
- **Repo** : `git@github.com:Ambinintsoa-h/tonton-maj.git` (SSH configuré)
- **Firebase project** : `tonton-ai-c8196`

## SSH
Clé SSH configurée sur la machine — `git push origin main` fonctionne directement.
