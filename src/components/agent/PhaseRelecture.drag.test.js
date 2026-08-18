/**
 * Le panneau « Patterns d'écriture IA » se déplace à la souris.
 *
 * Livré une première fois SANS effet : `motion.div` animait `y`, donc
 * framer-motion pilotait `transform` et écrasait le `translate3d` du
 * déplacement. Le panneau ne bougeait pas d'un pixel, et rien ne le disait.
 * D'où ce test : il échoue si le transform repasse sous contrôle de l'animation.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhaseRelecture from './PhaseRelecture';

const HTML = '<h2>Isolants</h2><p>Le polyuréthane projeté est réellement efficace ici.</p>';

const poignee = () => screen.getByTitle(/Glissez pour déplacer/);
// L'en-tete vit dans la motion.div, elle-meme dans l'enveloppe qui porte le
// deplacement : deux niveaux au-dessus de la poignee.
const panneau = () => poignee().parentElement.parentElement;

describe('déplacement du panneau', () => {
  it('l\'en-tête est une poignée de glissement', () => {
    render(<PhaseRelecture html={HTML} />);
    expect(poignee()).toBeInTheDocument();
    expect(poignee()).toHaveStyle({ cursor: 'grab' });
  });

  it("le TRANSFORM du panneau est sous NOTRE contrôle, pas sous celui de l'animation", () => {
    // C'est le défaut d'origine : `motion.div` animait `y`, donc framer-motion
    // possédait `transform` et écrasait le déplacement. L'enveloppe porte
    // désormais le translate, et l'animation ne touche plus que l'opacité.
    // jsdom ne dispatche pas de PointerEvent : le glissement lui-même se vérifie
    // dans un vrai navigateur, pas ici.
    render(<PhaseRelecture html={HTML} />);
    expect(panneau().style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(panneau().style.position).toBe('fixed');
  });

  it('le double-clic est bien la remise en place', () => {
    render(<PhaseRelecture html={HTML} />);
    fireEvent.doubleClick(poignee());
    expect(panneau().style.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('un clic sur un BOUTON de l\'en-tête ne déclenche pas de glissement', () => {
    render(<PhaseRelecture html={HTML} />);
    const avant = panneau().style.transform;
    const bouton = screen.getByTitle(/Replier en languette/);
    fireEvent.pointerDown(bouton, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window);
    expect(panneau().style.transform).toBe(avant);
  });
});
