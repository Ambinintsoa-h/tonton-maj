import { encodeMediaUrl } from './mediaUrl';

describe('encodeMediaUrl', () => {
  // Le cas EXACT relevé en production le 15/09/2026 : l'API Vision répondait
  // « Unable to download the file » et la suggestion ALT/Légende restait vide.
  it('percent-encode un ® dans le nom de fichier', () => {
    expect(encodeMediaUrl('https://circuits-culture.com/wp-content/uploads/2026/09/Heliosol®-2-scaled.jpg'))
      .toBe('https://circuits-culture.com/wp-content/uploads/2026/09/Heliosol%C2%AE-2-scaled.jpg');
  });

  it('percent-encode les accents et les espaces', () => {
    expect(encodeMediaUrl('https://x.fr/été/photo n°1.jpg'))
      .toBe('https://x.fr/%C3%A9t%C3%A9/photo%20n%C2%B01.jpg');
  });

  // LE piège qui a écarté `encodeURI` : il ré-encode le `%` et transforme une
  // URL déjà correcte en URL cassée (%C2%AE → %25C2%25AE).
  it('ne double-encode JAMAIS une URL déjà encodée', () => {
    const deja = 'https://x.fr/a%C2%AEb.jpg';
    expect(encodeMediaUrl(deja)).toBe(deja);
  });

  it('laisse une URL entièrement ASCII intacte', () => {
    const simple = 'https://x.fr/wp-content/uploads/2026/09/photo-1.jpg';
    expect(encodeMediaUrl(simple)).toBe(simple);
  });

  // NO-OP plutôt que mutilation : l'appelant n'a pas à vérifier ce qu'il tient.
  it('renvoie tel quel ce qui n\'est pas une URL absolue', () => {
    expect(encodeMediaUrl('/wp-content/uploads/photo.jpg')).toBe('/wp-content/uploads/photo.jpg');
    expect(encodeMediaUrl('')).toBe('');
    expect(encodeMediaUrl(null)).toBe('');
    expect(encodeMediaUrl(undefined)).toBe('');
  });
});
