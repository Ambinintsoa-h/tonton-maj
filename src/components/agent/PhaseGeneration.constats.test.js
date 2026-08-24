/**
 * Verrou : les mesures de la génération sont AFFICHÉES, plus seulement calculées.
 *
 * `phrasesTropLongues`, `suroptimisationMotCle` et `elisionsOrphelines` étaient
 * calculées à la génération, émises une fois en `onStep`… et abandonnées là. Or
 * `onStep` meurt avec l'écran : les étapes se replient et rien n'est conservé.
 * C'est le défaut déjà corrigé pour `constatGras` et `boldPass` — trois mesures
 * avaient été oubliées dans ce geste, et le rapport de R5 (`missingBold`) était
 * la quatrième.
 *
 * Le plafond de 20 mots restait au moins RECALCULABLE en phase 4. La
 * suroptimisation et les élisions, elles, étaient perdues pour de bon.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhaseGeneration from './PhaseGeneration';
import { MOTS_MAX_PHRASE, MAX_H2_AVEC_MOT_CLE } from '../../utils/stylePatterns';

// Le bloc ne s'affiche qu'une fois la génération faite : il décrit le texte
// produit, et n'aurait rien à dire avant.
const base = {
  scope: 'refonte',
  onScopeChange: () => {},
  onGenerate: () => {},
  linkRows: [],
  onLinkRowsChange: () => {},
  originalHtml: '<p>Ancien texte.</p>',
  generatedHtml: '<p>Nouveau texte, plus long que le precedent.</p>',
};

const avec = (qatArticle) => render(
  <PhaseGeneration {...base} qatArticle={{ html: base.generatedHtml, ...qatArticle }} />,
);

describe('les mesures de la génération sont dites au rédacteur', () => {
  it('les phrases trop longues sont comptées, et la plus longue est nommée', () => {
    avec({ phrasesLongues: [{ mots: 34 }, { mots: 27 }, { mots: 22 }] });
    expect(screen.getByText(/Sur le texte produit/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`3 phrase\\(s\\) de plus de ${MOTS_MAX_PHRASE} mots`))).toBeInTheDocument();
    expect(screen.getByText(/la plus longue en compte 34/)).toBeInTheDocument();
  });

  it('la suroptimisation donne le RAPPORT, pas une densité', () => {
    // Le chiffre qui trahit, c'est le nombre de H2 portant la forme exacte :
    // 1,1 % de densité passe inaperçu, 8 titres sur 9 non.
    avec({ suroptimisation: { h2AvecMotCle: 8, h2Total: 9, excesH2: 6 } });
    expect(screen.getByText(/8 titres H2 sur 9/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`maximum ${MAX_H2_AVEC_MOT_CLE}`))).toBeInTheDocument();
  });

  it('les élisions orphelines sont CITÉES — signalées, jamais réparées', () => {
    // Choisir entre « le » et « la » demande le genre, et un code qui devine
    // écrit « le toiture ». On montre les mots, le rédacteur tranche.
    avec({ elisions: ['l apos toiture', 'd apos isolant', 'l apos autre'] });
    expect(screen.getByText(/3 élision\(s\) orpheline\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/l apos toiture/)).toBeInTheDocument();
  });

  it('le gras d\'origine non replacé est un CONSTAT (R5)', () => {
    avec({ missingBold: ['coefficient Rw', 'budget au metre carre'] });
    expect(screen.getByText(/2 terme\(s\) en gras d'origine non replacé\(s\)/)).toBeInTheDocument();
  });

  it('les quatre constats cohabitent dans le même bloc', () => {
    avec({
      phrasesLongues: [{ mots: 25 }],
      suroptimisation: { h2AvecMotCle: 5, h2Total: 6, excesH2: 3 },
      elisions: ['l apos ouvrage'],
      missingBold: ['norme NF'],
    });
    expect(screen.getByText(/1 phrase\(s\) de plus de/)).toBeInTheDocument();
    expect(screen.getByText(/5 titres H2 sur 6/)).toBeInTheDocument();
    expect(screen.getByText(/1 élision\(s\) orpheline\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 terme\(s\) en gras d'origine/)).toBeInTheDocument();
  });
});

describe('ce qui ne doit PAS s\'afficher', () => {
  it('une mesure à ZÉRO reste muette — sinon on apprend à ne plus lire le bloc', () => {
    // Une ligne « 0 élision orpheline » à chaque génération est un bruit qui
    // finit par masquer le jour où le chiffre monte.
    avec({ phrasesLongues: [], elisions: [], suroptimisation: { h2AvecMotCle: 1, h2Total: 9, excesH2: 0 }, missingBold: [] });
    expect(screen.queryByText(/Sur le texte produit/)).not.toBeInTheDocument();
  });

  it('un audit sans ces champs (article ancien) n\'affiche rien et ne casse rien', () => {
    // Les articles générés avant ce correctif ne portent aucun de ces champs.
    avec({});
    expect(screen.queryByText(/Sur le texte produit/)).not.toBeInTheDocument();
  });

  it('avant génération, aucun constat — il n\'y a pas encore de texte produit', () => {
    render(<PhaseGeneration {...base} generatedHtml="" qatArticle={null} />);
    expect(screen.queryByText(/Sur le texte produit/)).not.toBeInTheDocument();
  });

  it('la suroptimisation ne s\'affiche pas quand l\'excès est nul, même avec des H2', () => {
    avec({ suroptimisation: { h2AvecMotCle: 2, h2Total: 9, excesH2: 0 } });
    expect(screen.queryByText(/titres H2 sur/)).not.toBeInTheDocument();
  });
});
