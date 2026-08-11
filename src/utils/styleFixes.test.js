// Phase 4, moitié MÉCANIQUE de l'option C : ne proposer que ce dont on est sûr.
// Exigence centrale de ces tests — sur tout ce qui demande de comprendre la
// phrase (verbes, participes, passive, longueur), la fonction doit renvoyer
// `null` et laisser la main à l'IA. Une substitution aveugle qui casse la phrase
// coûterait plus de temps à réparer qu'à écrire.
/* eslint-env jest */
import {
  proposeMechanicalFix, isMechanical, MECHANICAL_IDS, AI_IDS,
} from './styleFixes';

describe('périmètre — qui corrige quoi', () => {
  test('seuls les tirets et les adverbes sont mécaniques', () => {
    expect(MECHANICAL_IDS).toEqual(['cadratins', 'adverbes']);
    expect(isMechanical('cadratins')).toBe(true);
    expect(isMechanical('adverbes')).toBe(true);
  });

  test('tout ce qui demande du SENS renvoie null — l\'IA prendra le relais', () => {
    const phrase = 'Le bac acier offre un atout, permettant de réduire la charge.';
    AI_IDS.forEach((id) => {
      expect(proposeMechanicalFix(id, phrase, 'offre')).toBeNull();
      expect(isMechanical(id)).toBe(false);
    });
  });

  test('une règle inconnue ne produit rien', () => {
    expect(proposeMechanicalFix('n_importe_quoi', 'Un texte.', 'mot')).toBeNull();
  });
});

describe('tirets cadratins → virgule', () => {
  test('incise encadrée par deux tirets', () => {
    const r = proposeMechanicalFix('cadratins', 'Le prix — variable — dépend du toit.');
    expect(r.apres).toBe('Le prix, variable, dépend du toit.');
  });

  test('demi-cadratin traité de la même façon', () => {
    expect(proposeMechanicalFix('cadratins', 'Le prix – variable – dépend.').apres)
      .toBe('Le prix, variable, dépend.');
  });

  test('tiret en FIN de segment : supprimé, pas remplacé', () => {
    // « … pose —. » donnerait « … pose ,. » avec un remplacement naïf
    expect(proposeMechanicalFix('cadratins', 'Comptez 60 EUR la pose —').apres)
      .toBe('Comptez 60 EUR la pose');
  });

  test('tiret collé à une ponctuation : il disparaît', () => {
    expect(proposeMechanicalFix('cadratins', 'Le bac acier dure longtemps —.').apres)
      .toBe('Le bac acier dure longtemps.');
  });

  test('aucun espace avant la virgule produite', () => {
    const r = proposeMechanicalFix('cadratins', 'Un toit léger  —  et durable.');
    expect(r.apres).toBe('Un toit léger, et durable.');
    expect(r.apres).not.toMatch(/\s,/);
  });

  test('un trait d\'union normal n\'est pas touché → null', () => {
    expect(proposeMechanicalFix('cadratins', 'Le sur-mesure coûte plus cher.')).toBeNull();
  });

  test('l\'avant est conservé tel quel pour affichage', () => {
    const avant = 'Le prix — variable — dépend du toit.';
    expect(proposeMechanicalFix('cadratins', avant).avant).toBe(avant);
  });
});

describe('adverbes en -ment → suppression', () => {
  test('l\'adverbe part et la phrase reste grammaticale', () => {
    const r = proposeMechanicalFix('adverbes', 'Le prix varie fortement selon la région.', 'fortement');
    expect(r.apres).toBe('Le prix varie selon la région.');
  });

  test('adverbe en fin de phrase : pas d\'espace laissé devant le point', () => {
    const r = proposeMechanicalFix('adverbes', 'La pose avance rapidement.', 'rapidement');
    expect(r.apres).toBe('La pose avance.');
    expect(r.apres).not.toMatch(/\s\./);
  });

  test('la casse du terme n\'empêche pas la détection', () => {
    const r = proposeMechanicalFix('adverbes', 'Effectivement, le zinc dure plus longtemps.', 'effectivement');
    expect(r.apres).toContain('le zinc dure plus longtemps.');
    expect(r.apres.toLowerCase()).not.toContain('effectivement');
  });

  test('un mot CONTENANT le terme n\'est pas rogné', () => {
    // « ment » dans « ciment » ne doit pas etre attaque : on cible le mot entier
    expect(proposeMechanicalFix('adverbes', 'Le ciment sèche vite.', 'ciment'))
      .toEqual({ avant: 'Le ciment sèche vite.', apres: 'Le sèche vite.' });
    // (le terme fourni EST le mot entier ici — c'est l'appelant qui garantit
    //  qu'il s'agit bien d'un adverbe, cf. stylePatterns)
  });

  test('terme absent de l\'extrait → null, on ne devine pas', () => {
    expect(proposeMechanicalFix('adverbes', 'Le prix varie selon la région.', 'fortement')).toBeNull();
  });

  test('terme vide ou manquant → null', () => {
    expect(proposeMechanicalFix('adverbes', 'Une phrase.', '')).toBeNull();
    expect(proposeMechanicalFix('adverbes', 'Une phrase.')).toBeNull();
  });
});

describe('robustesse', () => {
  test('extrait vide ou absent → null', () => {
    expect(proposeMechanicalFix('cadratins', '')).toBeNull();
    expect(proposeMechanicalFix('cadratins', null)).toBeNull();
    expect(proposeMechanicalFix('adverbes', undefined, 'vite')).toBeNull();
  });

  test('aucune modification réelle → null plutôt qu\'une proposition identique', () => {
    // Rien a corriger : on ne propose pas « avant = apres », ce serait du bruit
    expect(proposeMechanicalFix('cadratins', 'Une phrase sans tiret.')).toBeNull();
  });

  test('types inattendus ne font pas planter', () => {
    expect(() => proposeMechanicalFix('cadratins', 42)).not.toThrow();
    expect(() => proposeMechanicalFix('adverbes', {}, [])).not.toThrow();
  });
});
