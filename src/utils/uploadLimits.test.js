import toast from 'react-hot-toast';
import { MAX_IMAGE_BYTES, isImageTooLarge, validateImageFile, filterValidImageFiles } from './uploadLimits';

jest.mock('react-hot-toast', () => ({ error: jest.fn() }));

const img = (bytes, type = 'image/jpeg', name = 'photo.jpg') => ({ size: bytes, type, name });

describe('MAX_IMAGE_BYTES', () => {
  // Relevé de 1 à 5 Mo le 7 septembre 2026 -- verrouille la valeur attendue
  // pour qu'un changement futur soit un choix explicite, pas un oubli.
  it('vaut 5 Mo', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('isImageTooLarge', () => {
  it('true pour une image au-delà de la limite', () => {
    expect(isImageTooLarge(img(MAX_IMAGE_BYTES + 1))).toBe(true);
  });
  it('false pour une image sous la limite (limite incluse)', () => {
    expect(isImageTooLarge(img(MAX_IMAGE_BYTES))).toBe(false);
    expect(isImageTooLarge(img(1000))).toBe(false);
  });
  it('false pour un fichier non-image, quelle que soit sa taille', () => {
    expect(isImageTooLarge({ size: MAX_IMAGE_BYTES * 10, type: 'video/mp4' })).toBe(false);
  });
  it('false pour un fichier absent', () => {
    expect(isImageTooLarge(null)).toBe(false);
  });
});

describe('validateImageFile', () => {
  beforeEach(() => { toast.error.mockClear(); });

  it('accepte une image sous la limite, sans toast', () => {
    expect(validateImageFile(img(1000))).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rejette une image trop lourde avec un message citant la VRAIE limite (5 Mo)', () => {
    expect(validateImageFile(img(6 * 1024 * 1024))).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('maximum 5.0 Mo'));
  });
});

describe('filterValidImageFiles', () => {
  it('garde les fichiers acceptés et journalise un toast par image refusée', () => {
    const files = [img(1000, 'image/jpeg', 'a.jpg'), img(6 * 1024 * 1024, 'image/png', 'b.png'), img(2000, 'image/jpeg', 'c.jpg')];
    const kept = filterValidImageFiles(files);
    expect(kept.map((f) => f.name)).toEqual(['a.jpg', 'c.jpg']);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('b.png'));
  });
});
