/**
 * Verrou : le tutoriel d'un rédacteur ne parle PAS d'administration.
 *
 * Demande d'Andrianina (17/11/2026) : le tutoriel est axé sur l'usage d'un
 * QA / rédacteur ; les actions d'admin ont leur propre menu. Un nouveau rédacteur
 * qui lirait « Paramètres » ou « Budget API » chercherait des boutons qu'il n'a pas.
 */
import {
  PARCOURS, PARCOURS_REDACTEUR, PARCOURS_ADMIN, CHAPITRES,
  ROLE_REDACTEUR, ROLE_MANAGER, ROLE_SUPPORT, ROLE_SUPER_ADMIN,
  peutVoirParcours, parcoursAccessibles, chapitresVisibles, chapitreParId,
  voisins, cheminChapitre, pourcentageLu, minutesTotal,
} from './chapitres';

const ids = (liste) => liste.map((c) => c.id);

describe('qui voit quel parcours', () => {
  it('le parcours rédacteur est ouvert à TOUS les rôles', () => {
    [ROLE_REDACTEUR, ROLE_MANAGER, ROLE_SUPPORT, ROLE_SUPER_ADMIN].forEach((r) => {
      expect(peutVoirParcours(PARCOURS_REDACTEUR, r)).toBe(true);
    });
  });

  it('le parcours admin est fermé au rédacteur et au support', () => {
    expect(peutVoirParcours(PARCOURS_ADMIN, ROLE_REDACTEUR)).toBe(false);
    expect(peutVoirParcours(PARCOURS_ADMIN, ROLE_SUPPORT)).toBe(false);
    expect(peutVoirParcours(PARCOURS_ADMIN, ROLE_MANAGER)).toBe(true);
    expect(peutVoirParcours(PARCOURS_ADMIN, ROLE_SUPER_ADMIN)).toBe(true);
  });

  it('un rôle inconnu ou absent n\'a que le tutoriel rédacteur', () => {
    expect(peutVoirParcours(PARCOURS_ADMIN, undefined)).toBe(false);
    expect(peutVoirParcours(PARCOURS_ADMIN, 'stagiaire')).toBe(false);
    expect(ids(parcoursAccessibles('stagiaire'))).toEqual([PARCOURS_REDACTEUR]);
  });

  it('un parcours inexistant n\'est accessible à personne', () => {
    expect(peutVoirParcours('inconnu', ROLE_SUPER_ADMIN)).toBe(false);
  });

  it('le menu d\'un manager propose les deux parcours, celui d\'un rédacteur un seul', () => {
    expect(ids(parcoursAccessibles(ROLE_MANAGER))).toEqual([PARCOURS_REDACTEUR, PARCOURS_ADMIN]);
    expect(ids(parcoursAccessibles(ROLE_REDACTEUR))).toEqual([PARCOURS_REDACTEUR]);
  });
});

describe('un rédacteur ne reçoit AUCUN contenu d\'admin', () => {
  it('le parcours admin lui rend une liste vide, même demandé directement', () => {
    expect(chapitresVisibles(PARCOURS_ADMIN, ROLE_REDACTEUR)).toEqual([]);
    expect(chapitreParId(PARCOURS_ADMIN, 'admin-budget', ROLE_REDACTEUR)).toBeNull();
    expect(voisins(PARCOURS_ADMIN, 'admin-equipe', ROLE_REDACTEUR)).toEqual({ precedent: null, suivant: null });
  });

  it('aucun chapitre du parcours rédacteur ne porte un identifiant d\'admin', () => {
    CHAPITRES.filter((c) => c.parcours === PARCOURS_REDACTEUR).forEach((c) => {
      expect(c.id.startsWith('admin-')).toBe(false);
    });
  });

  it('le support n\'a pas le chapitre « MAJ en lot » : il n\'a pas la page', () => {
    expect(ids(chapitresVisibles(PARCOURS_REDACTEUR, ROLE_SUPPORT))).not.toContain('maj-en-lot');
    expect(ids(chapitresVisibles(PARCOURS_REDACTEUR, ROLE_REDACTEUR))).toContain('maj-en-lot');
  });
});

describe('le parcours admin, par rôle', () => {
  it('un manager ne voit pas les chapitres réservés aux super admins', () => {
    const manager = ids(chapitresVisibles(PARCOURS_ADMIN, ROLE_MANAGER));
    ['admin-parametres', 'admin-budget', 'admin-effet'].forEach((id) => {
      expect(manager).not.toContain(id);
    });
    expect(manager).toEqual(expect.arrayContaining(['admin-apercu', 'admin-equipe', 'admin-skills', 'admin-wordpress']));
  });

  it('un super admin voit tous les chapitres admin', () => {
    expect(chapitresVisibles(PARCOURS_ADMIN, ROLE_SUPER_ADMIN)).toHaveLength(
      CHAPITRES.filter((c) => c.parcours === PARCOURS_ADMIN).length,
    );
  });
});

describe('cohérence du registre', () => {
  it('chaque identifiant est unique dans son parcours', () => {
    Object.keys(PARCOURS).forEach((p) => {
      const l = ids(CHAPITRES.filter((c) => c.parcours === p));
      expect(new Set(l).size).toBe(l.length);
    });
  });

  it('chaque chapitre a un titre, un résumé et une durée', () => {
    CHAPITRES.forEach((c) => {
      expect(c.titre.length).toBeGreaterThan(3);
      expect(c.resume.length).toBeGreaterThan(10);
      expect(c.minutes).toBeGreaterThan(0);
      expect(PARCOURS[c.parcours]).toBeTruthy();
    });
  });

  it('les routes des deux parcours sont distinctes', () => {
    expect(PARCOURS[PARCOURS_REDACTEUR].route).not.toBe(PARCOURS[PARCOURS_ADMIN].route);
    expect(cheminChapitre(PARCOURS_ADMIN, 'admin-budget')).toBe('/tutoriel-admin/admin-budget');
    expect(cheminChapitre(PARCOURS_REDACTEUR, 'bienvenue')).toBe('/tutoriel/bienvenue');
  });
});

describe('navigation entre chapitres', () => {
  it('précédent / suivant suivent l\'ordre, et s\'arrêtent aux extrémités', () => {
    const l = chapitresVisibles(PARCOURS_REDACTEUR, ROLE_REDACTEUR);
    expect(voisins(PARCOURS_REDACTEUR, l[0].id, ROLE_REDACTEUR).precedent).toBeNull();
    expect(voisins(PARCOURS_REDACTEUR, l[0].id, ROLE_REDACTEUR).suivant.id).toBe(l[1].id);
    expect(voisins(PARCOURS_REDACTEUR, l[l.length - 1].id, ROLE_REDACTEUR).suivant).toBeNull();
  });

  it('le suivant saute un chapitre que le rôle ne voit pas (support, sans « MAJ en lot »)', () => {
    const suivant = voisins(PARCOURS_REDACTEUR, 'relire-publier', ROLE_SUPPORT).suivant;
    expect(suivant.id).toBe('suivre-son-travail');
  });

  it('un identifiant inconnu n\'a pas de voisins', () => {
    expect(voisins(PARCOURS_REDACTEUR, 'nimporte', ROLE_REDACTEUR)).toEqual({ precedent: null, suivant: null });
  });
});

describe('pourcentageLu', () => {
  const l = chapitresVisibles(PARCOURS_REDACTEUR, ROLE_REDACTEUR);

  it('0 % sans rien de lu, 100 % avec tout', () => {
    expect(pourcentageLu([], l)).toBe(0);
    expect(pourcentageLu(ids(l), l)).toBe(100);
  });

  it('ignore les identifiants inconnus et les doublons', () => {
    expect(pourcentageLu(['inconnu', l[0].id, l[0].id], l)).toBe(Math.round(100 / l.length));
  });

  it('une liste de chapitres vide ne divise pas par zéro', () => {
    expect(pourcentageLu(['bienvenue'], [])).toBe(0);
  });

  it('minutesTotal additionne les durées', () => {
    expect(minutesTotal(l)).toBe(l.reduce((s, c) => s + c.minutes, 0));
  });
});
