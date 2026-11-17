/**
 * Verrous des briques interactives et des maquettes du tutoriel.
 * Ce que ces tests protègent : un tutoriel qu'on ne peut pas parcourir (clavier,
 * onglets, quiz) ou dont les maquettes affirment autre chose que l'outil.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Onglets, Etapes, Accordeon, Quiz, ListeAFaire, Encadre } from './ui';
import {
  MaquetteMenu, MaquetteLancement, MaquetteLot, MaquettePublication, MaquetteCalculateur,
  contientMinimaChiffres, estimerLot, formaterDuree, CONSIGNE_MAX, COUT_MOYEN_USD,
  MINUTES_PAR_ARTICLE, PARALLELISME_DEFAUT,
} from './maquettes';

afterEach(() => { cleanup(); jest.useRealTimers(); window.localStorage.clear(); });

// ── Largeur : les breakpoints Tailwind mesurent la FENÊTRE, pas la colonne ───────
// Constaté en production le 17/11/2026, fenêtre de 860 px : la colonne d'un chapitre
// n'en fait que ~550 (barre latérale + sommaire). `sm:flex-row` (stepper) et
// `md:grid-cols-[4 colonnes]` (ligne de lot) s'y déclenchaient quand même : « Relecture »
// était rognée et le sélecteur débordait. jsdom ne mesure aucune mise en page : ce
// verrou lit la source pour qu'on ne remette pas la cause.
describe('mise en page : rien qui ne tienne que sur grand écran', () => {
  const fs = require('fs');
  const path = require('path');
  const lire = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

  it('les étapes ne passent en ligne qu\'à partir de `lg`', () => {
    const ui = lire('ui.jsx');
    expect(ui).toMatch(/flex flex-col lg:flex-row/);
    expect(ui).not.toMatch(/flex flex-col sm:flex-row/);
  });

  it('la ligne de lot se replie (flex-wrap) au lieu d\'imposer des colonnes fixes', () => {
    const mq = lire('maquettes.jsx');
    expect(mq).toMatch(/flex flex-wrap gap-2/);
    expect(mq).not.toMatch(/md:grid-cols-\[1\.4fr/);
  });

  it('une maquette trop large défile dans son cadre au lieu de déborder de la page', () => {
    expect(lire('ui.jsx')).toMatch(/p-4 bg-gray-50\/60 overflow-x-auto/);
  });
});

describe('Onglets', () => {
  const onglets = [
    { id: 'a', label: 'Premier', contenu: <p>Contenu A</p> },
    { id: 'b', label: 'Second', contenu: <p>Contenu B</p> },
  ];

  it('affiche le premier onglet, puis change au clic', () => {
    render(<Onglets onglets={onglets} />);
    expect(screen.getByText('Contenu A')).toBeInTheDocument();
    expect(screen.queryByText('Contenu B')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByText('Contenu B')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Premier' })).toHaveAttribute('aria-selected', 'false');
  });

  it('le panneau est relié à son onglet (accessibilité)', () => {
    render(<Onglets onglets={onglets} idGroupe="g" />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'g-tab-a');
  });
});

describe('Etapes', () => {
  const etapes = [
    { titre: 'Un', corps: <p>Détail un</p> },
    { titre: 'Deux', corps: <p>Détail deux</p> },
    { titre: 'Trois', corps: <p>Détail trois</p> },
  ];

  it('un clic sur une étape affiche son détail et marque la courante', () => {
    render(<Etapes etapes={etapes} />);
    expect(screen.getByText('Détail un')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Trois/ }));
    expect(screen.getByText('Détail trois')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Trois/ })).toHaveAttribute('aria-current', 'step');
  });

  it('précédent / suivant : bloqués aux extrémités', () => {
    render(<Etapes etapes={etapes} />);
    expect(screen.getByText(/Étape précédente/)).toBeDisabled();
    fireEvent.click(screen.getByText(/Étape suivante/));
    expect(screen.getByText('Détail deux')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Étape suivante/));
    expect(screen.getByText(/Étape suivante/)).toBeDisabled();
  });
});

describe('Accordeon', () => {
  it('ouvre et referme une réponse, et l\'annonce (aria-expanded)', () => {
    render(<Accordeon items={[{ q: 'Question ?', r: <p>Réponse.</p> }]} />);
    const b = screen.getByRole('button', { name: /Question/ });
    expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Réponse.')).toBeNull();
    fireEvent.click(b);
    expect(screen.getByText('Réponse.')).toBeInTheDocument();
    expect(b).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(b);
    expect(screen.queryByText('Réponse.')).toBeNull();
  });
});

describe('Quiz', () => {
  const questions = [
    { q: 'Deux et deux ?', choix: ['Trois', 'Quatre'], bonne: 1, explication: 'Quatre.' },
    { q: 'Le ciel ?', choix: ['Bleu', 'Vert'], bonne: 0, explication: 'Bleu.' },
  ];

  it('une bonne réponse est confirmée, une mauvaise corrigée', () => {
    render(<Quiz questions={questions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quatre' }));
    expect(screen.getByText(/Exact\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vert' }));
    expect(screen.getByText(/Pas tout à fait\./)).toBeInTheDocument();
  });

  it('le score s\'affiche seulement quand tout est répondu', () => {
    render(<Quiz questions={questions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quatre' }));
    expect(screen.queryByText(/sur 2\./)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Vert' }));
    expect(screen.getByText('1 bonne réponse sur 2.')).toBeInTheDocument();
  });

  it('une réponse donnée est verrouillée, et « Recommencer » remet tout à zéro', () => {
    render(<Quiz questions={questions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trois' }));
    expect(screen.getByRole('button', { name: 'Quatre' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Recommencer/ }));
    expect(screen.getByRole('button', { name: 'Quatre' })).not.toBeDisabled();
    expect(screen.queryByText(/Pas tout à fait\./)).toBeNull();
  });
});

describe('ListeAFaire', () => {
  const etapes = [{ id: 'a', texte: 'Faire A' }, { id: 'b', texte: 'Faire B' }];

  it('coche, compte, et se souvient d\'un affichage à l\'autre', () => {
    const { unmount } = render(<ListeAFaire titre="Ma liste" listeId="t" membre="u1" etapes={etapes} />);
    expect(screen.getByText('0 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Faire A/ }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    unmount();
    render(<ListeAFaire titre="Ma liste" listeId="t" membre="u1" etapes={etapes} />);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('la progression d\'un autre membre n\'est pas la vôtre', () => {
    const { unmount } = render(<ListeAFaire titre="Ma liste" listeId="t" membre="u1" etapes={etapes} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Faire A/ }));
    unmount();
    render(<ListeAFaire titre="Ma liste" listeId="t" membre="u2" etapes={etapes} />);
    expect(screen.getByText('0 / 2')).toBeInTheDocument();
  });

  it('félicite quand tout est coché', () => {
    render(<ListeAFaire titre="Ma liste" listeId="t" membre="u1" etapes={etapes} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Faire A/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Faire B/ }));
    expect(screen.getByText(/Tout est fait/)).toBeInTheDocument();
  });

  it('fonctionne même si le stockage du navigateur est refusé', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    render(<ListeAFaire titre="Ma liste" listeId="t" membre="u1" etapes={etapes} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Faire A/ }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('Encadre', () => {
  it('chaque type porte son titre par défaut', () => {
    render(<><Encadre type="regle">a</Encadre><Encadre type="attention">b</Encadre><Encadre type="astuce">c</Encadre></>);
    expect(screen.getByText('Règle absolue')).toBeInTheDocument();
    expect(screen.getByText('Attention')).toBeInTheDocument();
    expect(screen.getByText('Astuce')).toBeInTheDocument();
  });
});

describe('MaquetteMenu', () => {
  it('change de menu quand on change de rôle', () => {
    render(<MaquetteMenu roleInitial="cq_ia" />);
    expect(screen.queryByText('Skills IA')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manager' }));
    expect(screen.getByText('Skills IA')).toBeInTheDocument();
    expect(screen.getByText('Tutoriel admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Super admin' }));
    expect(screen.getByText('Budget API')).toBeInTheDocument();
    expect(screen.getByText('Paramètres')).toBeInTheDocument();
  });
});

describe('MaquetteLancement', () => {
  it('le bouton est grisé sans mot-clé cible, puis se débloque', () => {
    render(<MaquetteLancement />);
    const bouton = screen.getByRole('button', { name: /Lancer l'analyse IA/ });
    expect(bouton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/URL de l'article/), { target: { value: 'https://exemple.com/article/' } });
    expect(bouton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Mot-clé cible/), { target: { value: 'devis toiture' } });
    expect(bouton).not.toBeDisabled();
    fireEvent.click(bouton);
    expect(screen.getByRole('status')).toHaveTextContent(/phase 1/);
  });

  it('l\'onglet Copier-coller change le champ', () => {
    render(<MaquetteLancement />);
    fireEvent.click(screen.getByRole('tab', { name: /Copier-coller/ }));
    expect(screen.getByLabelText(/Contenu de l'article/)).toBeInTheDocument();
  });
});

describe('contientMinimaChiffres — ce que l\'outil ne tient pas', () => {
  it.each([
    'Cette section doit faire 450 mots minimum',
    'Utilise le mot lucide au moins 8 fois',
    'chaque sous-partie de 70 à 100 mots',
    'répète-le 11 fois',
    'Prévois un mini de 300 mots',
  ])('détecte : %s', (t) => expect(contientMinimaChiffres(t)).toBe(true));

  it.each([
    'Ajoute une section intitulée « Les aides »',
    'Supprime la sous-partie sur les toits plats',
    'Remplace la question de la FAQ',
    '',
    null,
  ])('ne se déclenche pas sur : %s', (t) => expect(contientMinimaChiffres(t)).toBe(false));
});

describe('MaquetteLot', () => {
  it('expliquer chaque type, et prévenir sur un minimum chiffré', () => {
    render(<MaquetteLot />);
    expect(screen.getByText(/L'audit choisit l'ampleur/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type de mise à jour'), { target: { value: 'ciblee' } });
    expect(screen.getByText(/la structure et le texte existants sont conservés/)).toBeInTheDocument();
    expect(screen.queryByText(/Un minimum chiffré/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Consigne (optionnel)'), { target: { value: 'Écris 450 mots minimum' } });
    expect(screen.getByText(/Un minimum chiffré dans votre consigne/)).toBeInTheDocument();
  });

  it('le compteur annonce le dépassement du plafond', () => {
    render(<MaquetteLot />);
    fireEvent.change(screen.getByLabelText('Consigne (optionnel)'), { target: { value: 'x'.repeat(CONSIGNE_MAX + 5) } });
    expect(screen.getByText(/la fin sera coupée/)).toBeInTheDocument();
  });

  it('le lot passe par « En attente », « En cours », « Fait », et dit que rien n\'est publié', () => {
    jest.useFakeTimers();
    render(<MaquetteLot />);
    fireEvent.click(screen.getByRole('button', { name: /Lancer le lot/ }));
    expect(screen.getByRole('status')).toHaveTextContent('En attente');
    act(() => { jest.advanceTimersByTime(1200); });
    expect(screen.getByRole('status')).toHaveTextContent('En cours');
    act(() => { jest.advanceTimersByTime(1200); });
    expect(screen.getByRole('status')).toHaveTextContent('Fait');
    expect(screen.getByText(/rien n'est publié/)).toBeInTheDocument();
  });

  it('le plafond affiché est celui du code', () => {
    expect(CONSIGNE_MAX).toBe(2500);
  });
});

describe('MaquettePublication', () => {
  it('un titre inchangé est conservé, un titre modifié est envoyé', () => {
    render(<MaquettePublication />);
    expect(screen.getByText(/le titre actuel du site est conservé/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Un autre titre' } });
    expect(screen.getByText('modifié')).toBeInTheDocument();
    expect(screen.getByText(/sera envoyé/)).toBeInTheDocument();
  });

  it('l\'étiquette « Déjà publié » apparaît avant le clic sur Publier sur le site', () => {
    render(<MaquettePublication />);
    fireEvent.click(screen.getByLabelText(/un collègue a déjà publié/));
    fireEvent.click(screen.getByRole('button', { name: /^Publier/ }));
    expect(screen.getByText('Déjà publié')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Publier sur le site/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/mis à jour/);
  });
});

describe('estimerLot / formaterDuree / MaquetteCalculateur', () => {
  it('coût = articles × moyenne mesurée', () => {
    expect(estimerLot({ articles: 100, parallelisme: 4 }).coutUsd).toBe(Math.round(100 * COUT_MOYEN_USD * 100) / 100);
  });

  it('la durée se compte par VAGUES : 5 articles à 4 en parallèle = 2 vagues, pas 1,25', () => {
    expect(estimerLot({ articles: 5, parallelisme: 4 }).minutes).toBe(2 * MINUTES_PAR_ARTICLE);
    expect(estimerLot({ articles: 4, parallelisme: 4 }).minutes).toBe(MINUTES_PAR_ARTICLE);
    expect(estimerLot({ articles: 8, parallelisme: 4 }).minutes).toBe(2 * MINUTES_PAR_ARTICLE);
  });

  it('des entrées absurdes ne cassent rien', () => {
    expect(estimerLot({ articles: -5, parallelisme: 0 })).toEqual({ articles: 0, coutUsd: 0, minutes: 0 });
    expect(estimerLot({ articles: 'abc', parallelisme: 'x' }).coutUsd).toBe(0);
  });

  it('formaterDuree : minutes, heures, jours', () => {
    expect(formaterDuree(7)).toBe('7 min');
    expect(formaterDuree(60)).toBe('1 h');
    expect(formaterDuree(125)).toBe('2 h 5 min');
    expect(formaterDuree(60 * 72)).toBe('3 jours');
  });

  it('la maquette affiche le coût et réagit au curseur', () => {
    render(<MaquetteCalculateur />);
    expect(screen.getByLabelText('Articles traités en parallèle')).toHaveValue(String(PARALLELISME_DEFAUT));
    fireEvent.change(screen.getByLabelText("Nombre d'articles"), { target: { value: '1000' } });
    expect(screen.getByText(/≈ 510/)).toBeInTheDocument();
  });
});
