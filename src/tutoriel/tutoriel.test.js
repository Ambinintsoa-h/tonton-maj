/**
 * Verrous du tutoriel : le contenu est relié au registre, la maquette du menu suit la
 * vraie barre latérale, et chaque chapitre s'affiche sans erreur.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CHAPITRES } from './chapitres';
import { CONTENUS } from './contenus';
import { ENTREES_MENU, menuPourRole, ROLES_MENU } from './maquettes';

const fs = require('fs');
const path = require('path');

describe('le contenu est relié au registre, dans les deux sens', () => {
  it('chaque chapitre du registre a son contenu', () => {
    CHAPITRES.forEach((c) => {
      expect(typeof CONTENUS[c.id]).toBe('function');
    });
  });

  it('aucun contenu n\'est orphelin (absent du registre)', () => {
    const ids = new Set(CHAPITRES.map((c) => c.id));
    Object.keys(CONTENUS).forEach((id) => {
      expect(ids.has(id)).toBe(true);
    });
  });
});

describe('la maquette du menu suit la vraie barre latérale', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'layout', 'Sidebar.jsx'), 'utf8');
  const bloc = source.slice(source.indexOf('const NAV_ALL = ['), source.indexOf('];', source.indexOf('const NAV_ALL = [')));
  const reel = bloc.split('\n')
    .filter((l) => /\{\s*to:\s*'/.test(l))
    .map((l) => {
      const to = l.match(/to:\s*'([^']+)'/)[1];
      const label = l.match(/label:\s*'([^']+)'/)[1];
      const roles = l.match(/roles:\s*\[([^\]]*)\]/);
      return { to, label, roles: roles ? roles[1].split(',').map((r) => r.trim().replace(/'/g, '')).filter(Boolean) : null };
    });

  it('on a bien lu les entrées réelles', () => {
    expect(reel.length).toBeGreaterThan(10);
  });

  it('mêmes pages, même ordre, mêmes libellés', () => {
    expect(ENTREES_MENU.map((e) => [e.to, e.label])).toEqual(reel.map((e) => [e.to, e.label]));
  });

  it('mêmes rôles pour chaque page', () => {
    ENTREES_MENU.forEach((e, i) => {
      const attendu = reel[i].roles;
      if (attendu === null) expect(e.roles).toBeNull();
      else expect([...e.roles].sort()).toEqual([...attendu].sort());
    });
  });

  it('le rédacteur ne voit ni les pages d\'admin, ni le tutoriel admin', () => {
    const labels = menuPourRole('cq_ia').map((e) => e.label);
    ['Skills IA', 'Équipe', 'Budget API', 'Archives', 'Effet des MAJ', 'Suivi positions', 'WordPress', 'Paramètres', 'Tutoriel admin']
      .forEach((l) => expect(labels).not.toContain(l));
    expect(labels).toEqual(expect.arrayContaining(['Faire une MAJ', 'Mes MAJ', 'MAJ en lot', 'Historique', 'Tickets', 'Tutoriel']));
  });

  it('le support n\'a pas « MAJ en lot » et a son propre tableau de bord', () => {
    const labels = menuPourRole('support').map((e) => e.label);
    expect(labels).not.toContain('MAJ en lot');
    expect(labels[0]).toBe('Tableau de bord');
  });

  it('seul le super admin a « Paramètres »', () => {
    ROLES_MENU.forEach((r) => {
      expect(menuPourRole(r.id).map((e) => e.label).includes('Paramètres')).toBe(r.id === 'super_admin');
    });
  });
});

describe('chaque chapitre s\'affiche sans erreur', () => {
  afterEach(cleanup);

  CHAPITRES.forEach((c) => {
    it(`${c.parcours} / ${c.id}`, () => {
      const Contenu = CONTENUS[c.id];
      const { container } = render(<Contenu membre="u-test" role="super_admin" />);
      expect(container.textContent.length).toBeGreaterThan(200);
      expect(container.querySelectorAll('[role="note"], section').length).toBeGreaterThan(0);
    });
  });
});

describe('le parcours rédacteur ne contient aucun vocabulaire d\'admin', () => {
  afterEach(cleanup);

  // Un rédacteur ne voit pas ces écrans : les lui décrire, c'est lui faire chercher des
  // boutons qui n'existent pas pour lui. Les mots ci-dessous n'ont pas leur place dans
  // son tutoriel — sauf pour dire qu'ils relèvent de l'admin.
  const INTERDITS = ['Budget API', 'mot de passe d\'application', 'Skills IA', 'Inviter un membre', 'Alerte budget'];

  CHAPITRES.filter((c) => c.parcours === 'redacteur').forEach((c) => {
    it(`${c.id}`, () => {
      const Contenu = CONTENUS[c.id];
      const { container } = render(<Contenu membre="u-test" role="cq_ia" />);
      const texte = container.textContent;
      INTERDITS.forEach((mot) => {
        expect(texte).not.toContain(mot);
      });
    });
  });
});

describe('aucune donnée réelle dans les maquettes et les contenus', () => {
  afterEach(cleanup);

  // Les maquettes n'affichent ni client, ni nom, ni adresse de l'équipe (choix du
  // 17/11/2026). Les domaines ci-dessous sont des sites ou des personnes réels.
  const REEL = ['publithings', 'stomos', 'barbanews', 'tourismefrance', 'evenement.com', '@publithings', 'sahara', 'niampita', 'andrianina'];

  CHAPITRES.forEach((c) => {
    it(`${c.id}`, () => {
      const Contenu = CONTENUS[c.id];
      const { container } = render(<Contenu membre="u-test" role="super_admin" />);
      const texte = container.textContent.toLowerCase();
      REEL.forEach((mot) => expect(texte).not.toContain(mot));
    });
  });
});
