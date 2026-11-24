/* eslint-env jest */
import {
  detecterCibles, mesurerCibles, proximite, repriseConsigne,
  SEUIL_PROXIMITE_PARAGRAPHE,
} from './consigneCibles';

describe('detecterCibles — ce que la consigne demande de changer', () => {
  test('la consigne réelle du cas evenement.com', () => {
    expect(detecterCibles('Change les H2 et le châpo et l\'introduction'))
      .toEqual(['titres', 'chapo', 'intro']);
  });

  test('une seule cible nommée = une seule cible contrôlée', () => {
    expect(detecterCibles('Réécris l\'introduction.')).toEqual(['intro']);
    expect(detecterCibles('Nouveau chapeau stp')).toEqual(['chapo']);
    expect(detecterCibles('Modifie les intertitres')).toEqual(['titres']);
  });

  test('une consigne qui ne nomme rien ne déclenche aucun contrôle', () => {
    expect(detecterCibles('Mets à jour les prix 2026 et ajoute la source INSEE.')).toEqual([]);
    expect(detecterCibles('')).toEqual([]);
    expect(detecterCibles(undefined)).toEqual([]);
  });

  test('une cible NIÉE n\'est jamais contrôlée', () => {
    expect(detecterCibles('Garde les H2, change l\'introduction')).toEqual(['intro']);
    expect(detecterCibles('Ne change pas le chapô')).toEqual([]);
    expect(detecterCibles('Conserve les titres mais réécris le chapô et l\'intro'))
      .toEqual(['chapo', 'intro']);
    expect(detecterCibles('Laisse l\'introduction inchangée')).toEqual([]);
  });

  test('« titre SEO » et H1 ne sont pas des H2', () => {
    expect(detecterCibles('Change le titre SEO')).toEqual([]);
    expect(detecterCibles('Reformule le H1')).toEqual([]);
    expect(detecterCibles('Change le titre SEO et les H2')).toEqual(['titres']);
  });

  test('accents et casse sont indifférents', () => {
    expect(detecterCibles('CHANGE LE CHAPÔ')).toEqual(['chapo']);
    expect(detecterCibles('change le chapô')).toEqual(['chapo']);
  });
});

describe('proximite', () => {
  test('identique = 1, rien en commun = 0, apostrophes et accents ignorés', () => {
    expect(proximite('Le chat dort', 'le chat dort')).toBe(1);
    expect(proximite('alpha beta', 'gamma delta')).toBe(0);
    expect(proximite('L’entité française', "L'entite francaise")).toBe(1);
  });
});

const P_CHAPO = 'Fondée en 1976 aux États-Unis et implantée en France via Ticketnet en 1997, la plateforme distribue des millions de places.';
const P_INTRO = 'Acheter une place de concert sur une billetterie en ligne semble d’une simplicité enfantine, mais le parcours reste complexe pour beaucoup.';
const SOURCE = `<p>Suivez EVENEMENT.COM</p><p>${P_CHAPO}</p><p>${P_INTRO}</p>
<h2>Ticketnet, l'entité française</h2><p>a</p>
<h2>Compte et inscription</h2><p>b</p>
<h2>Transférer un billet</h2><p>c</p>
<h2>Sécurité et tarification</h2><p>d</p>
<h2>FAQ</h2><p>e</p>`;

describe('mesurerCibles', () => {
  test('sans cible : rien n\'est mesuré', () => {
    expect(mesurerCibles(SOURCE, SOURCE, []).insuffisantes).toEqual([]);
  });

  test('un article IDENTIQUE à l\'original échoue sur les trois cibles', () => {
    const m = mesurerCibles(SOURCE, SOURCE, ['chapo', 'intro', 'titres']);
    expect(m.insuffisantes).toEqual(['chapo', 'intro', 'titres']);
    expect(m.mesures.chapo).toBe(1);
    expect(m.mesures.titres).toEqual({ eligibles: 4, changes: 0 });
  });

  test('l\'en-tête « Suivez … » (paragraphe court) n\'est pas pris pour le chapô', () => {
    const m = mesurerCibles(SOURCE, SOURCE, ['chapo']);
    expect(m.originaux.chapo).toBe(P_CHAPO);
  });

  test('un article réellement réécrit passe', () => {
    const neuf = `<p>Un clic suffit parfois pour réserver, mais la mécanique derrière reste méconnue des acheteurs et de leurs proches.</p>
<p>Voici comment réserver, transférer et se faire rembourser sans stress ni mauvaise surprise sur la billetterie officielle.</p>
<h2>Qui se cache derrière la billetterie</h2><p>a</p>
<h2>Créer son profil client</h2><p>b</p>
<h2>Passer un billet à un ami</h2><p>c</p>
<h2>Prix dynamiques et protection</h2><p>d</p>
<h2>FAQ</h2><p>e</p>`;
    const m = mesurerCibles(SOURCE, neuf, ['chapo', 'intro', 'titres']);
    expect(m.insuffisantes).toEqual([]);
    expect(m.mesures.titres.changes).toBe(4);
  });

  test('une introduction reformulée à la marge est rejetée', () => {
    const marge = SOURCE.replace('semble d’une simplicité enfantine', 'paraît très simple en apparence');
    const m = mesurerCibles(SOURCE, marge, ['intro']);
    expect(m.mesures.intro).toBeGreaterThan(SEUIL_PROXIMITE_PARAGRAPHE);
    expect(m.insuffisantes).toEqual(['intro']);
  });

  test('FAQ et résumé ne comptent pas parmi les titres à changer', () => {
    const m = mesurerCibles(SOURCE, SOURCE, ['titres']);
    expect(m.originaux.titres).not.toContain('FAQ');
  });

  test('moins de 3 titres éligibles : on ne tranche pas', () => {
    const court = '<p>' + P_CHAPO + '</p><h2>Un</h2><p>x</p><h2>FAQ</h2><p>y</p>';
    expect(mesurerCibles(court, court, ['titres']).insuffisantes).toEqual([]);
  });

  test('chapô/intro introuvables (un seul paragraphe long) : on ne tranche pas', () => {
    const un = `<p>${P_CHAPO}</p><h2>A</h2><p>x</p>`;
    expect(mesurerCibles(un, un, ['chapo', 'intro']).insuffisantes).toEqual(['chapo']);
  });

  test('le score baisse quand l\'article s\'éloigne de l\'original', () => {
    let i = 0;
    const neuf = SOURCE.replace(/<h2>[^<]*<\/h2>/g, () => `<h2>Rubrique inédite numéro ${i += 1}</h2>`);
    expect(mesurerCibles(SOURCE, neuf, ['titres']).score)
      .toBeLessThan(mesurerCibles(SOURCE, SOURCE, ['titres']).score);
  });
});

describe('repriseConsigne', () => {
  test('nomme ce qui a échoué et donne le texte d\'origine à ne pas reprendre', () => {
    const m = mesurerCibles(SOURCE, SOURCE, ['intro', 'titres']);
    const r = repriseConsigne(m);
    expect(r).toMatch(/LA CONSIGNE DE L'ÉQUIPE N'A PAS ÉTÉ APPLIQUÉE/);
    expect(r).toMatch(/l'INTRODUCTION : trop proche de l'original \(100 % de mots communs\)/);
    expect(r).toContain(P_INTRO);
    expect(r).toMatch(/les TITRES H2 : seulement 0 titre\(s\) sur 4/);
    expect(r).toContain('Compte et inscription');
    expect(r).not.toMatch(/le CHAPÔ/);   // pas demandé, pas cité
  });
});
