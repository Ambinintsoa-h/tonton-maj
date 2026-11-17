/**
 * Verrous de la page Tutoriel.
 *
 * Le point qui compte : un rédacteur qui TAPE l'adresse du tutoriel admin ne doit rien
 * y lire. Le menu masqué n'est pas une protection ; la page se garde elle-même.
 *
 * `react-router-dom` (v7) n'est pas résolu par le Jest de ce projet (react-scripts 5 ne
 * lit pas le champ `exports` des paquets). On le SIMULE ici, au minimum : un lien rend
 * un <a>, une redirection rend un marqueur lisible. C'est suffisant pour vérifier ce que
 * la page décide ; le vrai routage est couvert par la compilation de l'application.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import Tutoriel from './Tutoriel';
import { CHAPITRES, chapitresVisibles } from '../tutoriel/chapitres';

let mockParams = {};
jest.mock('react-router-dom', () => {
  const R = require('react');
  return {
    Link: ({ to, children, ...rest }) => R.createElement('a', { href: to, ...rest }, children),
    Navigate: ({ to }) => R.createElement('div', { 'data-testid': 'redirection', 'data-vers': to }),
    useParams: () => mockParams,
  };
}, { virtual: true });

const boutique = (role, uid = 'u-test') => configureStore({
  reducer: { auth: () => ({ role, uid, username: 'test' }) },
});

const monter = (role, parcours, id, uid) => {
  mockParams = id ? { id } : {};
  return render(
    <Provider store={boutique(role, uid)}>
      <Tutoriel parcours={parcours} />
    </Provider>,
  );
};

const redirigeVers = (cible) => {
  const r = screen.getByTestId('redirection');
  expect(r).toHaveAttribute('data-vers', cible);
};

beforeEach(() => { window.localStorage.clear(); mockParams = {}; });
afterEach(cleanup);

describe('le tutoriel rédacteur', () => {
  it('l\'accueil liste les chapitres du rôle, et seulement eux', () => {
    monter('cq_ia', 'redacteur');
    chapitresVisibles('redacteur', 'cq_ia').forEach((c) => {
      expect(screen.getByRole('heading', { name: c.titre })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Administrer Tonton AI/)).toBeNull();
  });

  it('un manager voit un lien vers le tutoriel admin, un rédacteur non', () => {
    monter('manager', 'redacteur');
    expect(screen.getByRole('link', { name: /Tutoriel admin/ })).toHaveAttribute('href', '/tutoriel-admin');
    cleanup();
    monter('cq_ia', 'redacteur');
    expect(screen.queryByRole('link', { name: /Tutoriel admin/ })).toBeNull();
  });

  it('le support n\'a pas le chapitre « MAJ en lot »', () => {
    monter('support', 'redacteur');
    expect(screen.queryByRole('heading', { name: 'La MAJ en lot' })).toBeNull();
  });

  it('un chapitre s\'ouvre avec son contenu et sa navigation', () => {
    monter('cq_ia', 'redacteur', 'bienvenue');
    expect(screen.getByRole('heading', { level: 1, name: /Bienvenue/ })).toBeInTheDocument();
    expect(screen.getByText(/Chapitre 1 sur/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Précédent/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Suivant/ })).toHaveAttribute('href', '/tutoriel/premiers-pas');
  });

  it('le dernier chapitre n\'a pas de « Suivant », et a un « Précédent »', () => {
    const l = chapitresVisibles('redacteur', 'cq_ia');
    monter('cq_ia', 'redacteur', l[l.length - 1].id);
    expect(screen.queryByRole('link', { name: /Suivant/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Précédent/ })).toHaveAttribute('href', `/tutoriel/${l[l.length - 2].id}`);
  });

  it('un chapitre inconnu renvoie à l\'accueil du tutoriel', () => {
    monter('cq_ia', 'redacteur', 'nimporte-quoi');
    redirigeVers('/tutoriel');
  });
});

describe('la progression', () => {
  it('« Marquer comme lu » est mémorisé et se reflète sur l\'accueil', () => {
    monter('cq_ia', 'redacteur', 'bienvenue');
    fireEvent.click(screen.getByRole('button', { name: /Marquer ce chapitre comme lu/ }));
    expect(screen.getByRole('button', { name: /Chapitre lu/ })).toHaveAttribute('aria-pressed', 'true');
    cleanup();
    monter('cq_ia', 'redacteur');
    expect(screen.getByRole('progressbar', { name: /Progression dans le tutoriel/ })).toHaveAttribute(
      'aria-valuenow', String(Math.round(100 / chapitresVisibles('redacteur', 'cq_ia').length)),
    );
    expect(screen.getByRole('link', { name: /Reprendre/ })).toBeInTheDocument();
  });

  it('on peut décocher', () => {
    monter('cq_ia', 'redacteur', 'bienvenue');
    fireEvent.click(screen.getByRole('button', { name: /Marquer ce chapitre comme lu/ }));
    fireEvent.click(screen.getByRole('button', { name: /Chapitre lu/ }));
    expect(screen.getByRole('button', { name: /Marquer ce chapitre comme lu/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('la progression d\'un membre n\'apparaît pas chez un autre', () => {
    const { unmount } = monter('cq_ia', 'redacteur', 'bienvenue', 'alice');
    fireEvent.click(screen.getByRole('button', { name: /Marquer ce chapitre comme lu/ }));
    unmount();
    monter('cq_ia', 'redacteur', 'bienvenue', 'bob');
    expect(screen.getByRole('button', { name: /Marquer ce chapitre comme lu/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tout lu : l\'accueil le dit et ne propose plus de « Reprendre »', () => {
    const l = chapitresVisibles('redacteur', 'cq_ia');
    window.localStorage.setItem('tonton_tuto_v1:u-test:redacteur:lus', JSON.stringify(l.map((c) => c.id)));
    monter('cq_ia', 'redacteur');
    expect(screen.getByText(/Vous avez lu tous les chapitres/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Reprendre|Commencer/ })).toBeNull();
  });
});

describe('le tutoriel admin est PROTÉGÉ par la page elle-même', () => {
  it('un rédacteur qui tape l\'adresse est renvoyé au tutoriel rédacteur', () => {
    monter('cq_ia', 'admin');
    redirigeVers('/tutoriel');
    expect(screen.queryByText(/Administrer Tonton AI/)).toBeNull();
  });

  it('…même vers un chapitre précis, dont rien ne s\'affiche', () => {
    monter('cq_ia', 'admin', 'admin-budget');
    redirigeVers('/tutoriel');
    expect(screen.queryByText(/Budget API et alerte/)).toBeNull();
    expect(screen.queryByText(/recharges saisies/)).toBeNull();
  });

  it('un support n\'y a pas accès non plus', () => {
    monter('support', 'admin', 'admin-equipe');
    redirigeVers('/tutoriel');
  });

  it('un rôle inconnu ou absent non plus', () => {
    monter(undefined, 'admin');
    redirigeVers('/tutoriel');
  });

  it('un manager voit les chapitres qui le concernent, pas ceux des super admins', () => {
    monter('manager', 'admin');
    expect(screen.getByRole('heading', { name: 'Gérer l\'équipe et les rôles' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Budget API et alerte/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Paramètres : clés/ })).toBeNull();
  });

  it('…et ne peut pas ouvrir un chapitre de super admin par l\'adresse', () => {
    monter('manager', 'admin', 'admin-parametres');
    redirigeVers('/tutoriel-admin');
  });

  it('un super admin voit tous les chapitres admin', () => {
    monter('super_admin', 'admin');
    CHAPITRES.filter((c) => c.parcours === 'admin').forEach((c) => {
      expect(screen.getByRole('heading', { name: c.titre })).toBeInTheDocument();
    });
  });

  it('un parcours inexistant renvoie au tutoriel rédacteur', () => {
    monter('super_admin', 'nimporte');
    redirigeVers('/tutoriel');
  });
});

describe('le sommaire d\'un chapitre', () => {
  it('liste les chapitres du rôle et marque le courant', () => {
    monter('cq_ia', 'redacteur', 'faire-une-maj');
    const nav = screen.getByRole('navigation', { name: 'Chapitres' });
    expect(within(nav).getAllByRole('link')).toHaveLength(chapitresVisibles('redacteur', 'cq_ia').length);
    expect(within(nav).getByRole('link', { name: /Faire une MAJ, pas à pas/ })).toHaveAttribute('aria-current', 'page');
  });

  it('ne propose aucun chapitre d\'admin à un rédacteur', () => {
    monter('cq_ia', 'redacteur', 'bienvenue');
    const nav = screen.getByRole('navigation', { name: 'Chapitres' });
    expect(within(nav).queryByText(/Budget API|Paramètres|rôles/)).toBeNull();
  });
});
