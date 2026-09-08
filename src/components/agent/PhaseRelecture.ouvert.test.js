/**
 * L'onglet d'une règle (« rounded-xl », ex. « Verbes interdits ») ne doit se
 * fermer QUE sur un clic explicite de son en-tête — jamais tout seul.
 *
 * Avant ce correctif : `ouvert` était un `useState(null)` pur. Le parent
 * (`ArticleResult`) remonte tout le composant à chaque « Accepter »
 * (`key={relectureTick}`), ce qui repartait donc systématiquement à `null` —
 * la règle qu'on venait de corriger se refermait sous les yeux du rédacteur,
 * sans qu'il l'ait demandé. Reproduit ici par un vrai démontage/remontage
 * (pas un simple re-render), pour matcher exactement ce que fait `key`.
 *
 * `ouvert` vit désormais dans un objet de portée module (même mécanisme que
 * `cote`/`replie`) : il survit donc aussi d'un test à l'autre DANS ce fichier
 * (même tradeoff assumé que `PhaseRelecture.drag.test.js` pour `cote` et
 * `decalage`). Chaque test amène donc lui-même le panneau à l'état dont il a
 * besoin plutôt que de supposer un état de départ.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhaseRelecture from './PhaseRelecture';

const HTML = '<p>Le confort thermique — un vrai plus — change tout.</p>';
const ENTETE = 'Tirets cadratins';
const HINT = 'Remplacer par une virgule, deux points, ou deux phrases.';

const estDeplie = () => !!screen.queryByText(HINT);
const amener = (deplieAttendu) => {
  if (estDeplie() !== deplieAttendu) fireEvent.click(screen.getByText(ENTETE));
  expect(estDeplie()).toBe(deplieAttendu);
};

afterEach(cleanup);

describe('accordéon des règles — survit au remount forcé par le parent', () => {
  it('reste déplié après un démontage/remontage (ex: clic « Accepter » ailleurs)', () => {
    const { unmount } = render(<PhaseRelecture html={HTML} />);
    amener(true);

    unmount();
    render(<PhaseRelecture html={HTML} />);

    expect(estDeplie()).toBe(true);
    amener(false);   // on repart propre pour les tests suivants du fichier
  });

  it('ne se ferme que sur un clic explicite de l\'en-tête', () => {
    render(<PhaseRelecture html={HTML} />);
    amener(true);

    fireEvent.click(screen.getByText(ENTETE));
    expect(estDeplie()).toBe(false);
  });

  it('« Ignorer » appelle onIgnore plutôt que de gérer un état local', () => {
    const onIgnore = jest.fn();
    render(<PhaseRelecture html={HTML} ignores={[]} onIgnore={onIgnore} />);
    amener(true);

    fireEvent.click(screen.getByText('Ignorer'));
    expect(onIgnore).toHaveBeenCalledTimes(1);
    expect(onIgnore).toHaveBeenCalledWith('cadratins-0');

    amener(false);
  });

  it('une occurrence listée dans `ignores` (prop du parent) reste masquée après remount', () => {
    const { unmount } = render(<PhaseRelecture html={HTML} ignores={['cadratins-0']} />);
    amener(true);
    // La règle reste visible (son hint s'affiche toujours) mais son unique
    // occurrence, ignorée, ne doit plus proposer de correction.
    expect(screen.queryByText('Accepter')).not.toBeInTheDocument();

    unmount();
    // Le parent garde `ignores` dans SON état (pas remonté) : la prop est
    // donc systématiquement re-fournie, y compris juste après un remount.
    render(<PhaseRelecture html={HTML} ignores={['cadratins-0']} />);
    amener(true);
    expect(screen.queryByText('Accepter')).not.toBeInTheDocument();
  });
});
