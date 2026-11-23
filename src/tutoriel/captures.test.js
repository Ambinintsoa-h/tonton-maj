/**
 * Verrous des captures d'écran du tutoriel.
 *
 * Les images vivent dans `public/`, un dossier servi SANS connexion : elles ne
 * doivent contenir ni nom de membre ni texte d'article. Un test ne peut pas lire
 * les pixels — il verrouille donc ce qu'il peut : chaque image citée par un
 * chapitre existe bien, rien n'est cité en double sous un autre nom, et le composant
 * pose ses pastilles en pourcentage.
 */
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Capture } from './ui';

const fs = require('fs');
const path = require('path');

afterEach(cleanup);

const DOSSIER = path.join(__dirname, '..', '..', 'public', 'tutoriel');
const lire = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

describe('Capture', () => {
  it('affiche l\'image depuis /tutoriel/ avec son texte alternatif', () => {
    render(<Capture fichier="x.jpg" alt="Un écran" legende="Légende" pastilles={[]} />);
    const img = screen.getByAltText('Un écran');
    expect(img.getAttribute('src')).toMatch(/\/tutoriel\/x\.jpg$/);
    expect(screen.getByText('Légende')).toBeInTheDocument();
  });

  it('place chaque pastille en pourcentage de l\'image', () => {
    const { container } = render(
      <Capture fichier="x.jpg" alt="a" pastilles={[{ n: 1, x: 25.5, y: 30 }, { n: 2, x: 90, y: 48.1 }]} />,
    );
    const pastilles = [...container.querySelectorAll('span[aria-hidden="true"]')];
    expect(pastilles.map((p) => p.textContent)).toEqual(['1', '2']);
    expect(pastilles[0].style.left).toBe('25.5%');
    expect(pastilles[1].style.top).toBe('48.1%');
  });
});

describe('chapitre « Ajouter une consigne à une MAJ »', () => {
  const source = lire('contenus', 'consigne-maj.jsx');
  const citees = [...source.matchAll(/fichier="([^"]+)"/g)].map((m) => m[1]);

  it('cite quatre captures', () => {
    expect(citees).toHaveLength(4);
    expect(new Set(citees).size).toBe(4);
  });

  citees.forEach((f) => {
    it(`${f} existe dans public/tutoriel`, () => {
      expect(fs.existsSync(path.join(DOSSIER, f))).toBe(true);
    });
  });

  it('chaque pastille a un numéro différent dans sa capture', () => {
    const blocs = source.split('<Capture').slice(1);
    blocs.forEach((b) => {
      const nums = [...b.matchAll(/n: (\d+)/g)].map((m) => m[1]);
      expect(new Set(nums).size).toBe(nums.length);
    });
  });
});
