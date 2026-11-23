/**
 * chapitres.js — LE REGISTRE DES DEUX TUTORIELS.
 *
 * Deux parcours, et c'est voulu (demande d'Andrianina, 17/11/2026) :
 *   • `redacteur` — « Tutoriel » : l'usage quotidien d'un rédacteur / QA (rôle
 *     CQ IA). Visible de TOUS les rôles. Il ne parle d'aucune action d'admin.
 *   • `admin`     — « Tutoriel admin » : gérer l'équipe, les règles de l'IA, les
 *     réglages, le budget. Réservé aux managers et super admins.
 *
 * Pourquoi deux menus plutôt qu'un seul filtré : un nouveau rédacteur qui ouvre
 * le tutoriel ne doit croiser ni « Paramètres », ni « Budget API », ni la
 * gestion des rôles — des écrans qu'il ne voit même pas dans son menu. Les lui
 * décrire, c'est lui faire chercher des boutons qui n'existent pas pour lui.
 *
 * Ce fichier est PUR (aucun JSX, aucun import React) : le contenu de chaque
 * chapitre vit dans `chapitres/*.jsx`, relié par `id` dans `chapitres/index.js`.
 * Un test verrouille que chaque entrée d'ici a bien son contenu.
 */

export const PARCOURS_REDACTEUR = 'redacteur';
export const PARCOURS_ADMIN = 'admin';

export const ROLE_REDACTEUR = 'cq_ia';
export const ROLE_MANAGER = 'manager';
export const ROLE_SUPPORT = 'support';
export const ROLE_SUPER_ADMIN = 'super_admin';

/**
 * `roles: null` = tous les rôles. Les rôles de chaque parcours reprennent ceux de
 * la barre latérale (`NAV_ALL`, Sidebar.jsx) : une entrée de menu absente pour un
 * rôle ne doit pas apparaître dans SON tutoriel.
 */
export const PARCOURS = {
  [PARCOURS_REDACTEUR]: {
    id: PARCOURS_REDACTEUR,
    route: '/tutoriel',
    titre: 'Tutoriel',
    sousTitre: 'Utiliser Tonton AI au quotidien',
    roles: null,
  },
  [PARCOURS_ADMIN]: {
    id: PARCOURS_ADMIN,
    route: '/tutoriel-admin',
    titre: 'Tutoriel admin',
    sousTitre: 'Administrer Tonton AI',
    roles: [ROLE_MANAGER, ROLE_SUPER_ADMIN],
  },
};

const TOUS = null;

export const CHAPITRES = [
  // ── Parcours rédacteur / QA ────────────────────────────────────────────────
  {
    id: 'bienvenue', parcours: PARCOURS_REDACTEUR, minutes: 4, roles: TOUS,
    titre: 'Bienvenue : à quoi sert Tonton AI',
    resume: 'Le principe, la règle absolue, les 4 étapes et votre menu.',
  },
  {
    id: 'premiers-pas', parcours: PARCOURS_REDACTEUR, minutes: 3, roles: TOUS,
    titre: 'Premiers pas : votre compte',
    resume: 'Connexion, double authentification, photo, notifications.',
  },
  {
    id: 'faire-une-maj', parcours: PARCOURS_REDACTEUR, minutes: 8, roles: TOUS,
    titre: 'Faire une MAJ, pas à pas',
    resume: 'Lancer l\'analyse, lire l\'audit, générer, vérifier.',
  },
  {
    id: 'consigne-maj', parcours: PARCOURS_REDACTEUR, minutes: 8, roles: TOUS,
    titre: 'Ajouter une consigne à une MAJ',
    resume: 'Où la saisir selon la façon de lancer la MAJ, et comment l\'écrire.',
  },
  {
    id: 'relire-publier', parcours: PARCOURS_REDACTEUR, minutes: 7, roles: TOUS,
    titre: 'Relire et publier',
    resume: 'Corriger le texte, régler le titre, publier sans mauvaise surprise.',
  },
  {
    id: 'maj-en-lot', parcours: PARCOURS_REDACTEUR, minutes: 9,
    // Même règle que l'entrée de menu « MAJ en lot » : le rôle support ne l'a pas.
    roles: [ROLE_REDACTEUR, ROLE_MANAGER, ROLE_SUPER_ADMIN],
    titre: 'La MAJ en lot',
    resume: 'Traiter plusieurs articles à la fois, et écrire une bonne consigne.',
  },
  {
    id: 'suivre-son-travail', parcours: PARCOURS_REDACTEUR, minutes: 4, roles: TOUS,
    titre: 'Suivre son travail',
    resume: 'Mes MAJ, Historique, Tickets : où retrouver quoi.',
  },
  {
    id: 'depannage', parcours: PARCOURS_REDACTEUR, minutes: 5, roles: TOUS,
    titre: 'Un souci ? Questions fréquentes',
    resume: 'Les problèmes les plus courants, et quoi faire.',
  },

  // ── Parcours admin ─────────────────────────────────────────────────────────
  {
    id: 'admin-apercu', parcours: PARCOURS_ADMIN, minutes: 3, roles: TOUS,
    titre: 'Votre périmètre d\'admin',
    resume: 'Quelles pages vous avez, selon votre rôle.',
  },
  {
    id: 'admin-equipe', parcours: PARCOURS_ADMIN, minutes: 4, roles: TOUS,
    titre: 'Gérer l\'équipe et les rôles',
    resume: 'Inviter un membre, choisir son rôle, suivre son activité.',
  },
  {
    id: 'admin-skills', parcours: PARCOURS_ADMIN, minutes: 5, roles: TOUS,
    titre: 'Régler l\'IA : les Skills',
    resume: 'Les règles rédactionnelles, le budget de caractères, l\'import.',
  },
  {
    id: 'admin-wordpress', parcours: PARCOURS_ADMIN, minutes: 3, roles: TOUS,
    titre: 'Connecter un site WordPress',
    resume: 'Ajouter un site pour permettre la publication directe.',
  },
  {
    id: 'admin-parametres', parcours: PARCOURS_ADMIN, minutes: 5, roles: [ROLE_SUPER_ADMIN],
    titre: 'Paramètres : clés, modèles, e-mail',
    resume: 'Les clés des services, le modèle par étape, l\'envoi d\'e-mails.',
  },
  {
    id: 'admin-budget', parcours: PARCOURS_ADMIN, minutes: 4, roles: [ROLE_SUPER_ADMIN],
    titre: 'Budget API et alerte',
    resume: 'Saisir une recharge, lire le restant, comprendre l\'alerte.',
  },
  {
    id: 'admin-effet', parcours: PARCOURS_ADMIN, minutes: 4, roles: [ROLE_SUPER_ADMIN],
    titre: 'Mesurer l\'effet des MAJ',
    resume: 'Suivi positions, Effet des MAJ, Archives.',
  },
  {
    id: 'admin-coulisses', parcours: PARCOURS_ADMIN, minutes: 5, roles: TOUS,
    titre: 'Coulisses : services, coûts, gains',
    resume: 'Ce que l\'outil utilise, ce qu\'il coûte, ce qui se mesure.',
  },
];

/** Un rôle peut-il ouvrir ce parcours ? Un rôle inconnu n'a accès qu'au rédacteur. */
export const peutVoirParcours = (parcoursId, role) => {
  const p = PARCOURS[parcoursId];
  if (!p) return false;
  return p.roles === null || p.roles.includes(role);
};

/** Parcours accessibles à un rôle, dans l'ordre d'affichage du menu. */
export const parcoursAccessibles = (role) =>
  Object.values(PARCOURS).filter((p) => peutVoirParcours(p.id, role));

/**
 * Chapitres d'un parcours que CE rôle peut lire. Liste vide si le parcours lui
 * est fermé : un chapitre d'admin n'est jamais servi à un rédacteur, même si
 * quelqu'un tape l'adresse à la main.
 */
export const chapitresVisibles = (parcoursId, role) => {
  if (!peutVoirParcours(parcoursId, role)) return [];
  return CHAPITRES.filter(
    (c) => c.parcours === parcoursId && (c.roles === null || c.roles.includes(role)),
  );
};

export const chapitreParId = (parcoursId, id, role) =>
  chapitresVisibles(parcoursId, role).find((c) => c.id === id) || null;

/** Chapitre précédent / suivant, dans les seuls chapitres visibles du rôle. */
export const voisins = (parcoursId, id, role) => {
  const liste = chapitresVisibles(parcoursId, role);
  const i = liste.findIndex((c) => c.id === id);
  if (i === -1) return { precedent: null, suivant: null };
  return { precedent: liste[i - 1] || null, suivant: liste[i + 1] || null };
};

export const cheminChapitre = (parcoursId, id) => {
  const p = PARCOURS[parcoursId];
  return p ? `${p.route}/${id}` : '/';
};

/** Part de chapitres lus, en % entier. Les identifiants inconnus sont ignorés. */
export const pourcentageLu = (lus, chapitres) => {
  if (!chapitres.length) return 0;
  const ids = new Set(chapitres.map((c) => c.id));
  const faits = (lus || []).filter((id) => ids.has(id));
  return Math.round((new Set(faits).size / chapitres.length) * 100);
};

export const minutesTotal = (chapitres) => chapitres.reduce((s, c) => s + (c.minutes || 0), 0);
