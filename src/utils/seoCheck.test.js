// Tests de analyzeSeo — critères Yoast/SEOPress + règles équipe
/* eslint-env jest */
import { analyzeSeo } from './seoCheck';

const get = (r, id) => r.checks.find(c => c.id === id);

const GOOD_HTML = `
<p>Le portage salarial séduit de plus en plus de cadres. Il combine liberté et sécurité. Voici notre guide complet. Ce statut progresse chaque année. Les entreprises y recourent souvent.</p>
<h2>Avantages du portage salarial</h2>
<p>Un premier avantage concret. ${'Des mots simples et courts pour remplir le texte. '.repeat(50)}<a href="/guide-freelance">notre guide freelance</a> <a href="https://monsite.fr/simulateur">simulateur</a> <a href="/contact">contact</a></p>
<h2>Prix du portage salarial</h2>
<p>Les frais varient. ${'Encore des phrases courtes pour la longueur du texte final. '.repeat(50)}</p>
`;

describe('analyzeSeo — verdict strict', () => {
  it('verdict rouge si mot-clé absent des metas', () => {
    const r = analyzeSeo({
      html: GOOD_HTML,
      focusKeyword: 'portage salarial',
      metaTitle: 'Un titre sans le terme attendu, assez long pour la jauge',
      metaDescription: 'Une description volontairement sans le terme, mais assez longue pour dépasser le seuil des cent vingt caractères requis par Google.',
      articleUrl: 'https://monsite.fr/article',
    });
    expect(get(r, 'title-kw').status).toBe('red');
    expect(get(r, 'desc-kw').status).toBe('red');
    expect(r.verdict).toBe('red');
  });

  it('détecte le mot-clé sans tenir compte des accents ni de la casse', () => {
    const r = analyzeSeo({
      html: '<p>Texte.</p>',
      focusKeyword: 'rénovation énergétique',
      metaTitle: 'Renovation energetique : le guide complet des aides 2026',
      metaDescription: 'x'.repeat(130),
      articleUrl: '',
    });
    expect(get(r, 'title-kw').status).toBe('green');
  });

  it('compte les occurrences et valide les H2 à 50 %', () => {
    const r = analyzeSeo({
      html: GOOD_HTML,
      focusKeyword: 'portage salarial',
      metaTitle: 'Portage salarial : avantages, prix et guide complet 2026',
      metaDescription: 'Portage salarial : découvrez les avantages, les prix et notre guide complet pour bien choisir votre société de portage en 2026.',
      articleUrl: 'https://monsite.fr/article',
    });
    expect(get(r, 'body-kw').status).toBe('green');   // 3 occurrences dans le texte
    expect(get(r, 'subs-kw').status).toBe('green');   // 2/2 H2 contiennent le mot-clé
    expect(get(r, 'intro-kw').status).toBe('green');  // présent dans le chapeau
    expect(get(r, 'links').status).toBe('green');     // 3 liens internes (2 relatifs + 1 même domaine)
  });

  it('signale les titres enchaînés sans texte', () => {
    const r = analyzeSeo({
      html: '<h2>Titre A</h2><h3>Titre B collé</h3><p>Texte.</p>',
      focusKeyword: 'test',
      metaTitle: 'Test : un meta title de longueur raisonnable ici même',
      metaDescription: 'x'.repeat(130),
    });
    expect(get(r, 'intro-between').status).toBe('red');
    expect(r.verdict).toBe('red');
  });

  it('mot-clé manquant → rouge global explicite', () => {
    const r = analyzeSeo({ html: '<p>Texte.</p>', focusKeyword: '', metaTitle: '', metaDescription: '' });
    expect(get(r, 'kw').status).toBe('red');
    expect(r.verdict).toBe('red');
  });

  it('lien externe non compté comme interne', () => {
    const r = analyzeSeo({
      html: `<p>${'mot '.repeat(400)}</p><p><a href="https://autresite.com/x">externe</a></p>`,
      focusKeyword: 'mot',
      metaTitle: 'Mot : un meta title de longueur raisonnable pour test',
      metaDescription: 'x'.repeat(130),
      articleUrl: 'https://monsite.fr/article',
    });
    expect(get(r, 'links').status).toBe('red'); // 0 lien interne
  });
});
