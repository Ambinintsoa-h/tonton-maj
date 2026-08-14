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
   - Verrou codé en dur : `enforceExternalLinkPolicy` dans `src/utils/diff.js` (appelé par `applyAllDiffs`, passes 1 et 2, tous les flux) + `sanitizeFullArticle` (flux refonte) + consigne dans les prompts (`services/agent.js`, `services/agentQat.js`).
   - Ne jamais affaiblir ce verrou sans accord explicite. Les liens INTERNES (même domaine) ne sont pas concernés.
9. **POLITIQUE DES LIENS — décision Andrianina, août 2026.** Trois obligations et une interdiction, dans cet ordre de priorité.
   - **INTERNE = DOFOLLOW, EXTERNE = NOFOLLOW.** Politique appliquée au point de sortie unique : `applyLinkFollowPolicy` (`src/utils/export.js`), appelée par `exportAsHtml` — passage obligatoire de tout ce qui est publié.
     - Lien **INTERNE** (même domaine, ou href relatif) : les jetons bloquants `nofollow` / `ugc` / `sponsored` sont **retirés**. C'est du maillage interne, il doit transmettre.
     - Lien **EXTERNE** : `nofollow` est **AJOUTÉ**. Correction Andrianina (août 2026) : les liens externes de ces articles sont les articles sponsorisés **payants**, et un lien payant suivi expose le site à une pénalité Google. Cette règle **inverse** une décision antérieure qui mettait tout en dofollow — ne pas la re-inverser sans accord explicite.
     - `noopener` / `noreferrer` sont **CONSERVÉS** des deux côtés : garde-fous navigateur, pas des directives de suivi (les tests du verrou externe attendent `rel="noopener"` à l'identique). `sponsored` / `ugc` déjà présents sur un externe sont conservés — ils vont dans le même sens.
     - `exportAsHtml(content, articleUrl)` : sans `articleUrl`, tout href **absolu** est traité comme externe (protection maximale, convention déjà en vigueur dans `diff.js`).
     - L'ingestion WordPress (`normalizeRelDofollowWp`, `proxy.js`) continue de tout normaliser en dofollow **à l'intérieur de l'outil** — la politique réelle est réappliquée à la publication. Les deux divergent volontairement ; ne pas rétablir la « parité stricte » d'avant, ce serait un faux verrou.
   - **MAILLAGE INTERNE À 100 % — LE CODE RÉDIGE.** Toutes les paires ancre + URL du brief sont placées, pas « la plupart » : le code tisse l'ancre là où son texte figure déjà, et **si l'ancre n'apparaît nulle part il RÉDIGE lui-même une clause courte** en fin du paragraphe le plus pertinent (`weaveBriefLinks`, `src/utils/internalWeave.js`). Insertion **déterministe**, aucun appel IA, aucune phrase existante triturée. Contrepartie non négociable : la clause est **marquée visiblement** dans l'éditeur (`.lien-redige`, fond jaune, `src/index.css`) pour être relue et reformulée ; la marque est retirée à l'export, le lien reste. Au moment de publier, `handlePublish` **demande confirmation** quand le code a dû écrire — sinon le texte partirait sans avoir jamais été lu.
     **Exception réelle, à ne pas maquiller** : si aucun paragraphe n'est éligible (article réduit à un tableau ou à une FAQ, paragraphes trop courts), rien n'est fabriqué de toutes pièces — c'est **affiché** au rédacteur. La garantie exacte est donc « 100 % **sauf** absence d'emplacement autorisé ».
   - **REPRENDRE LES LIENS D'AVANT — sanction ASYMÉTRIQUE.** Tout lien présent dans l'article d'origine doit réapparaître dans le texte généré. Un lien **EXTERNE** perdu fait **REJETER** la génération (règle 8, inchangé). Un lien **INTERNE** perdu est **ré-enveloppé** sur son ancre quand elle existe encore (`carryOverInternalLinks`, `src/utils/diff.js`), sinon **AVERTISSEMENT non bloquant** affiché au rédacteur — jamais un rejet : un 4ᵉ motif de rejet écraserait le message de relance et ferait perdre la consigne de reprise des liens externes.
   - **AUCUN LIEN EXTERNE NOUVEAU**, jamais, y compris par la porte du maillage : une URL du brief hors domaine est écartée par `filterSameSiteLinks` (URL protocol-relative `//host` comprises) et le motif est **dit** au rédacteur pendant la saisie (`QatBriefFields`) puis après génération.
   - Emplacements interdits à un lien posé par du code (titre, TL;DR, sommaire, tableau, FAQ, citation, légende, diff en attente) : **une seule source**, `src/utils/linkZones.js`, partagée par la reprise (R1) et le maillage (R2).
   - **Trou de couverture connu, DOCUMENTÉ et volontairement non corrigé** : le lancement depuis « MAJ en attente » force `internalLinks: []` (`src/pages/MajEnAttente.jsx`) → aucun lien interne **nouveau** par ce chemin ; la reprise des liens existants (R1) y reste active. Chantier produit à part, ne pas « corriger » sans décision.

## Docs chargées automatiquement
@.claude/git-deploy.md
@.claude/architecture.md
@.claude/roles-security.md

## Docs à lire selon le contexte
- `.claude/features.md` — pages, routes, comportements UI
- `.claude/firebase.md` — collections Firestore, règles de sécurité
- `.claude/agent-pipeline.md` — agent.js, search, prompts IA
- `.claude/tickets.md` — système tickets, permissions, UI
