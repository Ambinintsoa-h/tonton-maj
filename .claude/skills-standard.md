# Standard des Skills & Base de connaissances — TONTON AI

Norme de référence pour toute entrée du menu **SKILLS IA**. L'UI de la page Skills
fait respecter ce standard (template, compteur de budget, linter, aperçu du prompt).

> Important : ces entrées ne sont **pas** des fichiers `SKILL.md` Anthropic (pas de
> frontmatter YAML). Ce sont des **fragments injectés** dans le system prompt de
> l'agent. Le standard reprend les principes de la méthodo skills (progressive
> disclosure, écrire pour un modèle intelligent, expliquer le pourquoi) **adaptés**
> à de l'injection de prompt.

---

## 1. Deux types, deux rôles

| Type | Rôle | Question à laquelle il répond | Toujours injecté ? |
|------|------|-------------------------------|--------------------|
| **Skill** | Règle d'écriture | *Comment* TONTON doit rédiger | Oui (doit rester maigre) |
| **BDC** | Fait de référence | *Quoi* vérifier / quelles données | À la demande, par pertinence |

Un **Skill** dit comment écrire (ton, structure, contraintes). Une **BDC** apporte
un fait vérifiable que l'agent confronte à l'article (tarifs, specs, process, dates).

Ce qui n'est **ni l'un ni l'autre** n'a pas sa place ici : tutoriels d'utilisation
de l'outil, transcriptions vidéo, captures, procédures opérateur (cocher une
catégorie, changer l'auteur…). Ça relève de la doc d'onboarding humaine, pas du
contexte de l'agent.

---

## 2. Comment c'est injecté — et pourquoi rester maigre

Tout le contenu **actif** part dans le system prompt à **chaque** appel de
l'agent et de ses sous-agents. Chaque caractère est donc payé à chaque MAJ, et
plus le prompt est long, plus le signal utile se dilue.

C'est le **progressive disclosure** adapté : les *règles* (Skills) restent toujours
chargées → elles doivent être courtes et denses ; les *faits* (BDC) se chargent
**par pertinence** → on n'injecte pas les 23 documents en bloc, seulement ceux qui
concernent l'article traité.

**Budget indicatif** (affiché par l'UI) :
- Skill : **≤ 1 500 caractères**.
- BDC : **≤ 1 000 caractères**, factuel.
- Total des Skills actifs : viser **≤ 6 000 caractères**.

---

## 3. Format d'un Skill

Structure imposée, dans cet ordre :

```
## [Nom court et explicite]
**Objectif** — en une phrase, le résultat visé.
**Règle** — quoi faire concrètement (impératif, points courts).
**Pourquoi** — la raison (un modèle qui comprend le but généralise mieux qu'un
modèle qui suit une consigne aveugle).
**Exemple** — un avant/après court quand c'est utile.
```

Bonnes pratiques :
- **Impératif et concret** : « Reformule les listes de + de 5 puces en prose. »
- **Expliquer le pourquoi** plutôt qu'empiler des MAJUSCULES rigides.
- **Une seule responsabilité** par skill. Deux idées = deux skills.

---

## 4. Format d'une entrée BDC

Une BDC est un **fait de référence**, pas un récit :

```
## [Sujet]
- Fait : [donnée vérifiable]
- Valeur / seuil : [chiffre, version, date]
- Source : [URL ou origine]
- Dernière vérif : [AAAA-MM]
```

- **Factuel, daté, sourçable.** Si ce n'est pas vérifiable, ce n'est pas une BDC.
- **Pas de langage parlé**, pas de filler, pas de méta (« dans cette vidéo… »).
- Si une BDC contient une *règle d'écriture*, c'est en réalité un Skill → déplacer.

---

## 5. Anti-patterns (signalés par le linter)

1. **Redéfinition de rôle** — « Tu es un agent / consultant… ». Le rôle appartient
   au pipeline. Un skill est un fragment de règles, pas un agent autonome.
2. **Redéfinition de la sortie** — « Réponds uniquement… », « Structure de l'output… »,
   « retourne sans balise ». Le format de sortie (JSON d'updates) est piloté par le
   pipeline ; un skill ne doit jamais le réécrire.
3. **Longueur excessive** — au-delà du budget : à scinder ou distiller.
4. **Doublon** — une règle déjà couverte par une autre entrée (risque de divergence).
5. **Contradiction** — deux entrées qui s'excluent (ex. deux éléments « tout en bas »).
6. **Filler conversationnel** — « bonjour tout le monde », « j'espère que… », « Ciao ».
7. **Procédure UI/opérateur** — décrit des clics dans l'app, pas la rédaction.

---

## 6. Activation & portée

- Chaque entrée a un **état actif/inactif** : seul l'actif est injecté.
- Une entrée porte un **type** (Skill / BDC) et, à terme, une **portée** (quels
  sous-agents la reçoivent — inutile d'envoyer la règle FAQ à l'extracteur de
  requêtes).
- L'UI affiche en permanence le **budget de contexte consommé** par les entrées
  actives et un **aperçu du prompt réellement injecté**.

---

## 7. Checklist avant d'enregistrer

- [ ] C'est bien un Skill (règle) **ou** une BDC (fait) — pas un tutoriel.
- [ ] Respecte le format de sa catégorie (§3 ou §4).
- [ ] Sous le budget de caractères.
- [ ] Ne redéfinit ni le rôle ni le format de sortie.
- [ ] N'est ni un doublon ni en contradiction avec une entrée existante.
- [ ] Explique le **pourquoi** (pour un Skill) / est **sourcée et datée** (pour une BDC).
