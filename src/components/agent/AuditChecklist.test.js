/**
 * Verrou de l'affichage des faits dans la liste cochable (phase 2).
 *
 * Ce que ces tests protègent n'est pas un détail d'interface : les cases
 * n'affichaient qu'un COMPTEUR — « 4 », « 10 ». Or cocher, c'est décider qu'une
 * consigne part au modèle. Décider sur un nombre, sans voir de quoi il s'agit, ce
 * n'est pas décider — c'est deviner, et le pré-cochage par ampleur devenait alors
 * la seule vraie décision (demande d'Andrianina, 18 août 2026).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuditChecklist from './AuditChecklist';
import { defaultAuditSelection } from '../../utils/auditSelection';
import { SCOPE_SIMPLE, SCOPE_REFONTE } from '../../constants/majPhases';

const AUDIT = {
  recent_context: {
    donnees_obsoletes: [
      { element: 'Metascore Sons of Sparta', valeur_actuelle: '64/100', source: 'https://www.metacritic.com/x' },
    ],
    developpements_manquants: [
      {
        sujet: 'God of War: Laufey', description: 'sortie visée le 16 février 2027',
        nuance: 'à confirmer', source: 'https://www.playstation.com/fr-fr/god-of-war/',
      },
      { sujet: 'Série TV Amazon', description: 'tournage en cours' },
      { sujet: 'Portage PC', description: 'aucune date annoncée' },
      { sujet: 'Édition collector', description: 'rupture de stock' },
    ],
  },
  sources_check: [{ affirmation: '76,5 millions de ventes cumulées' }],
};

/** Le composant est piloté : on lui donne un état réel, comme en phase 2. */
const Harnais = ({ audit = AUDIT, scope = SCOPE_SIMPLE }) => {
  const [sel, setSel] = useState(defaultAuditSelection(scope));
  return <AuditChecklist audit={audit} selection={sel} onChange={setSel} scope={scope} />;
};

describe('les faits de l\'audit sont LISIBLES sous la case', () => {
  it('affiche les faits, leur nuance et leur source — pas seulement « 5 »', () => {
    render(<Harnais />);
    expect(screen.getByText(/Metascore Sons of Sparta.*64\/100/)).toBeInTheDocument();
    expect(screen.getByText(/God of War: Laufey.*16 février 2027/)).toBeInTheDocument();
    // La nuance est le point EXACT qui a lâché en production : « à confirmer »
    // noyé dans un JSON, et le modèle a écrit « date confirmée au Comic-Con ».
    expect(screen.getByText('à confirmer')).toBeInTheDocument();
    // La source rend le fait vérifiable : un fait sans source est cru sur parole.
    expect(screen.getByText(/metacritic\.com/)).toBeInTheDocument();
    expect(screen.getByText(/playstation\.com/)).toBeInTheDocument();
  });

  it('distingue une donnée PÉRIMÉE d\'un développement MANQUANT', () => {
    // Les fondre sans le dire ferait lire « 5 » comme cinq choses de même nature.
    render(<Harnais />);
    expect(screen.getByText('Périmé')).toBeInTheDocument();
    expect(screen.getAllByText('Manquant').length).toBeGreaterThan(0);
  });

  it('replie au-delà de 3 faits, et le dit sans rien cacher en silence', () => {
    render(<Harnais />);
    // 5 faits au total : 3 montrés, le reste annoncé.
    expect(screen.getByText('+ 2 autres')).toBeInTheDocument();
    expect(screen.queryByText(/Édition collector/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('+ 2 autres'));
    expect(screen.getByText(/Édition collector/)).toBeInTheDocument();
    expect(screen.getByText('replier')).toBeInTheDocument();
  });

  it('les faits sont montrés même quand la case est DÉCOCHÉE', () => {
    // C'est en les lisant qu'on décide de cocher : ne les afficher qu'une fois
    // coché inverserait l'ordre de la décision.
    render(<Harnais scope={SCOPE_SIMPLE} />);
    const caseSources = screen.getByRole('checkbox', { name: /Affirmations à sourcer/ });
    expect(caseSources).not.toBeChecked();                    // MAJ simple : décoché
    expect(screen.getByText(/76,5 millions de ventes/)).toBeInTheDocument();
  });

  it('un audit sans fait n\'affiche aucune ligne inventée', () => {
    render(<Harnais audit={{ recent_context: {} }} scope={SCOPE_REFONTE} />);
    expect(screen.queryByText('Périmé')).not.toBeInTheDocument();
    expect(screen.queryByText(/autres$/)).not.toBeInTheDocument();
  });
});
