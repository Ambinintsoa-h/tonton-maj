# Tonton AI — liste de tâches

Issue de la cartographie du pipeline (`docs/systeme-nerveux.html`), lecture du code à `eb0ea3e`.
Chaque point a été vérifié par grep ou par lecture — aucun n'est déduit.

**Légende** — Effort : `XS` < 30 min · `S` ~1 h · `M` ~ une demi-journée · `L` > une journée.
**Risque** : impact potentiel sur ce qui fonctionne déjà (règle 7).
🔴 = bloqué sur ton arbitrage · 🟢 = exécutable tel quel.

Ordre proposé : un lot = une branche = une PR.

---

## LOT 1 — Le test de la chaîne de verrous

> Le seul point de la liste où une régression future passerait **inaperçue**.
> 49 fichiers de test, tous unitaires : aucun n'enchaîne les verrous. L'ordre est
> pourtant ce que le code décrit comme fragile, et il n'est tenu que par des commentaires.
> Un réordonnancement malheureux passerait les 772 tests au vert.

- [ ] **T1** — 🟢 Écrire `src/services/chaineVerrous.test.js` · `M` · risque **nul** (aucun code de prod touché)

  Réutiliser le harnais de mock de `src/services/runQatRewrite.test.js` (il mocke déjà l'appel Claude).

  **Article d'entrée à fabriquer**, portant les six pièges en une fois :
  - 1 lien **externe** dans une phrase du corps
  - 1 lien **interne** existant
  - 1 image dans un `<figure>` avec `<figcaption>`
  - 2 passages en `<strong>`
  - 1 paire du brief dont **l'ancre n'existe nulle part** dans le texte produit
  - 1 lien interne que la réponse mockée pose **dans la FAQ**

  **Assertions sur la sortie :**
  - [ ] le lien externe est intact — même `href`, même texte d'ancre
  - [ ] le lien interne d'origine est repris
  - [ ] l'image est replacée **dans son `<figure>`**, avec sa `<figcaption>`
  - [ ] les deux `<strong>` sont conservés
  - [ ] la paire sans ancre produit une clause **marquée** `data-lien-redige`
  - [ ] le lien de la FAQ est **délié puis replacé dans le corps** (et pas simplement supprimé)

  **Assertions d'ORDRE** — c'est le cœur du test, à écrire explicitement :
  - [ ] R2a passe **avant** R2 : sinon le lien de FAQ reste perdu
  - [ ] R6 passe **après** R2
  - [ ] R4 et R5 passent **en dernier**

---

## LOT 2 — Les mesures qui disparaissent

> `phrasesTropLongues`, `suroptimisationMotCle` et `elisionsOrphelines` sont calculés à la
> génération (`agentQat.js:1228`, `:1234`, `:1240`), émis en `onStep`… et **absents de l'objet
> renvoyé**. Or `onStep` meurt avec l'écran de génération.
> C'est le défaut déjà corrigé pour la passe de gras — `boldPass` est persisté exactement pour ça.
> Trois mesures ont été oubliées dans ce geste.
>
> Les 20 mots sont recalculés en phase 4. **La suroptimisation et les élisions sont perdues pour de bon.**

- [ ] **T2** — 🟢 Renvoyer les trois constats dans l'objet `article` · `XS` · risque **faible** (purement additif)
  - `agentQat.js` : ajouter `phrasesLongues`, `suroptimisation`, `elisions` à côté de `constatGras`
  - Vérifier que rien ne casse à la persistance (champs `undefined` refusés côté base)

- [ ] **T3** — 🟢 Les afficher en phase 2, avec le bilan de longueur · `S` · risque **faible**
  - Même emplacement que `wordsAddedReport`, même ton : un chiffre, pas un jugement

- [ ] **T4** — 🟢 Bouton « recompter » en phase 4 · `S` · risque **faible**
  - Les trois fonctions sont **pures** et déjà importées : c'est du câblage
  - Motif : après les phases 3 et 4, les chiffres affichés décrivent un texte qui n'existe plus

---

## LOT 3 — Les choix de modèle

> `runBoldPass` et `runStyleFixAgent` appellent `callClaudeWithProgress` **sans passer `model`**.
> La destructuration de `callClaude` (`agent.js:519`) applique alors `MODELS.FAST` = Haiku 4.5.
> Ce n'est pas forcément une erreur. Ce qui manque, c'est la **décision** : partout ailleurs
> dans ce code, un choix de modèle porte son commentaire.

- [ ] **T5** — 🔴 **Trancher le modèle de la passe de gras** · `XS` une fois décidé · risque **faible**

  Éléments pour l'arbitrage :
  - la passe doit désigner « la phrase qui répond à la requête », distinguer une entité d'un chiffre
  - **deux tentatives ont déjà échoué sur ce jugement précis** (consigne noyée dans le prompt, puis pose déterministe)
  - elle est non bloquante : un échec ne coûte que le gras
  - `max_tokens: 16000`, une fois par génération

  → puis **rendre le choix explicite** dans l'appel, avec le commentaire qui dit pourquoi.

- [ ] **T6** — 🔴 Même arbitrage pour `runStyleFixAgent` · `XS` · risque **faible**
  - `max_tokens: 8000`, déclenché par bouton, une fois par relecture

- [ ] **T7** — 🟢 Corriger le tarif Opus · `XS` · risque **nul**
  - `claude-opus-4-5` : `15 / 75` → **`5 / 25`**
  - Les **deux** tables : `agent.js:105` et `store/slices/settingsSlice.js`
  - [ ] Ajouter l'assertion manquante dans `modelMigration.test.js` — Sonnet 5 et Haiku 4.5 y sont verrouillés sous le titre « le suivi de coûts ne doit pas mentir », Opus a été oublié de ce verrou : c'est pour ça que la valeur a pu vieillir

- [ ] **T8** — 🟢 `generateReply` passe par `selectModel` · `XS` · risque **faible**
  - `src/services/comments.js:36` fige `model: 'claude-sonnet-4-5'` dans le corps de la requête
  - Seul appel du code applicatif à contourner `selectModel` : une bascule centralisée ne l'atteint pas

- [ ] **T9** — 🟢 Étendre le verrou de cascade · `XS` · risque **nul**
  - `modelMigration.test.js:36` ne couvre que `selectModel('update_generation')`
  - Boucler sur **toutes** les valeurs de `MODELS` : aujourd'hui sans conséquence (`FAST` *est* le repli, `BEST` n'est jamais rendu), mais le jour où une tâche renverra `MODELS.BEST`, rien n'assérera qu'Opus est dans la cascade

---

## LOT 4 — L'asymétrie de filet à la publication

> `handlePublish` rejoue R1 (`ArticleResult.jsx:3784`), R2 (`:3814`) et R4 (`:3844`),
> au motif que six chemins d'écriture contournent les verrous de la génération.
> **R5 — le gras d'origine — n'y est pas.**

- [ ] **T10** — 🟢 Ajouter un **constat** du gras d'origine perdu · `S` · risque **faible**

  ⚠️ **Un constat, pas une réparation** — et c'est le point important de cette tâche.

  Un lien perdu n'est jamais un choix ; **un gras retiré peut l'être**. Rejouer `carryOverBold`
  à la publication remettrait du gras que le rédacteur a peut-être ôté exprès : le code se
  battrait contre lui.

  → Compter les `<strong>` de `agent.originalContent` absents du HTML publié, et le **dire**.
  C'est la doctrine déjà appliquée aux élisions orphelines : signalées, jamais réparées,
  « parce qu'un code qui devine écrit *le toiture* ».

  - [ ] No-op strict si la référence est vide (F5 sur un article déchargé) — même garde que R1/R2/R4

---

## LOT 5 — Le ménage du code mort

> 🔴 **Demande ton accord explicite (règle 7).** Rien n'indique que ce code tourne,
> mais c'est une suppression de 675 lignes : je ne la lance pas sans ton feu vert.

Vérifié par grep : `runAgent` n'a **aucun appelant**. `MAJ_MODES`, `isQatMode`, `modeMeta`
et `DEFAULT_MODE` ont **zéro usage** hors de leur définition.

Tu as supprimé `keywordBold.js` pour cette raison exacte, en écrivant que « du code mort qui
décrit une approche abandonnée est un piège pour le prochain lecteur ». C'est le même cas en
trente fois plus gros — et ce code porte ses **propres copies** des règles métier, qui ne
tournent jamais (`filterSameSiteLinks`, plancher de 3 liens).

- [ ] **T11** — 🔴 Supprimer `runAgent` · `M` · risque **moyen**
  - `src/services/agent.js:1188` — 675 lignes
  - [ ] Re-vérifier par `git grep` juste avant, y compris dans les tests
  - [ ] Build complet : exiger la ligne `Compiled` / `Failed`, **jamais valider par un grep ciblé**
  - [ ] Suite de tests complète au vert

- [ ] **T12** — 🔴 Supprimer les exports morts de `constants/majMode.js` · `XS` · risque **faible**
  - `MAJ_MODES`, `isQatMode`, `modeMeta`, `DEFAULT_MODE`
  - ⚠️ **Périmètre à respecter** : `MAJ_DEPTHS` (6 usages), `depthMeta` (5) et `MAJ_SCOPES` (6)
    sont **vivants**. Ne toucher que la moitié « mode ».

- [ ] **T13** — 🔴 Nettoyer les commentaires « double flux temporaire » · `XS` · risque **nul**
  - Ils décrivent un flux qui n'existe plus : `majMode.js`, `agentQat.js:3`, `QatBriefFields.jsx:3`

---

## LOT 6 — Fonctionnalités

- [ ] **T14** — 🟢 Champ « URL de l'article » sur le flux collé · `S` · risque **faible**
  - Sans URL, aucun lien interne à URL absolue ne peut être placé : faute d'hôte de référence,
    le verrou traite **tout absolu comme externe**
  - C'est dit au rédacteur (`unverifiableLinkRows`), mais il n'a **aucun moyen de corriger**
  - Un champ débloque le maillage sur ce flux

- [ ] **T15** — 🟢 Rapport de génération persisté · `M` · risque **faible**
  - Prolongement direct de la décision `boldPass` : quels champs d'audit sont partis, quelle
    instruction, combien de tokens, quels verrous ont agi, quoi n'a pas pu être placé
  - Aujourd'hui tout cela vit dans `onStep` et meurt avec l'écran
  - Permet de répondre à « pourquoi cet article est sorti comme ça » **trois semaines plus tard**,
    sans relancer une génération payante

---

## Non retenu

- [x] ~~**T16** — Récupérer les essais rejetés par le verrou liens externes~~ — **déconseillé**

  Un rejet jette l'`article_html` produit : jusqu'à trois articles complets payés et perdus
  pour un seul lien manquant. C'est tentant.

  Mais conserver un texte non conforme quelque part, c'est **créer le chemin par lequel il
  finira publié** — et la règle 8 est le verrou le plus cher du projet à re-gagner. La reprise
  instruite qui nomme les liens perdus est la bonne réponse, et elle existe déjà.

---

## Hors périmètre de cette liste

Je n'ai pas lu : authentification et rôles, tickets, commentaires, statistiques d'équipe,
et l'intérieur de l'éditeur (presse-papiers de blocs, verrou d'édition collaboratif, undo/redo).

Ces sous-systèmes ne participent pas au parcours de mise à jour d'un article, mais **l'absence
de constat n'est pas un constat d'absence** : je n'y ai pas cherché.
