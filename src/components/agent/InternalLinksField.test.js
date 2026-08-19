/**
 * Verrou du maillage saisissable en PHASE 2.
 *
 * Le défaut corrigé ici n'était pas dans `weaveBriefLinks` — qui place bien
 * 100 % des paires — mais dans le fait qu'un article arrivé par « MAJ en
 * attente » n'avait AUCUNE paire à placer et aucun moyen d'en ajouter : le
 * formulaire ne vivait que sur l'écran de lancement manuel. La garantie était
 * donc exacte et sans effet sur tout ce parcours.
 *
 * Ces tests verrouillent les deux points de rendu et le signalement du cas vide.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import InternalLinksField from './InternalLinksField';
import QatBriefFields from './QatBriefFields';
import PhaseGeneration from './PhaseGeneration';
import { emptyLinkRow } from '../../constants/majMode';

const URL_ART = 'https://stomos.net/actualites/mon-article';

// Enveloppe avec état : les mises à jour passent par un updateur fonctionnel,
// une simple jest.fn() ne dirait rien de ce que le rédacteur voit.
const AvecEtat = ({ initial = [emptyLinkRow()], articleUrl = URL_ART }) => {
  const [rows, setRows] = useState(initial);
  return <InternalLinksField linkRows={rows} setLinkRows={setRows} articleUrl={articleUrl} />;
};

describe('InternalLinksField — saisie des paires', () => {
  it('affiche une ligne ancre + URL', () => {
    render(<AvecEtat />);
    expect(screen.getByPlaceholderText(/^Ancre/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://mon-site.fr/ma-page')).toBeInTheDocument();
  });

  it('compte les paires COMPLÈTES seulement', () => {
    render(<AvecEtat initial={[{ anchor: 'prime rénovation', url: '/prime' }, { anchor: 'sans url', url: '' }]} />);
    expect(screen.getByText(/1 paire complète/)).toBeInTheDocument();
  });

  it('saisir une ancre puis une URL fait passer le compteur à 1', () => {
    render(<AvecEtat />);
    fireEvent.change(screen.getByPlaceholderText(/^Ancre/), { target: { value: 'prime rénovation' } });
    fireEvent.change(screen.getByPlaceholderText('https://mon-site.fr/ma-page'), { target: { value: '/prime-renovation' } });
    expect(screen.getByText(/1 paire complète/)).toBeInTheDocument();
  });

  it('DIT au rédacteur qu\'une URL hors domaine sera écartée (règle 8)', () => {
    render(<AvecEtat initial={[{ anchor: 'comparateur', url: 'https://concurrent.fr/x' }]} />);
    expect(screen.getByText(/hors du domaine de l'article/)).toBeInTheDocument();
    expect(screen.getByText(/jamais ajouter de lien externe/)).toBeInTheDocument();
  });

  it('une URL interne ne déclenche AUCUN avertissement', () => {
    render(<AvecEtat initial={[{ anchor: 'guide', url: 'https://stomos.net/guide' }]} />);
    expect(screen.queryByText(/hors du domaine/)).not.toBeInTheDocument();
  });
});

describe('QatBriefFields — écran de lancement allégé, rien de perdu', () => {
  const monter = () => render(
    <QatBriefFields
      articleType="dossier" setArticleType={() => {}}
      seoPlugin="yoast" setSeoPlugin={() => {}}
      targetWords={2500} setTargetWords={() => {}}
      linkRows={[emptyLinkRow()]} setLinkRows={() => {}}
      articleUrl={URL_ART}
    />
  );

  it('les réglages jamais touchés sont REPLIÉS par défaut', () => {
    // Trois de ces quatre réglages valent toujours la valeur par défaut — la file
    // d'attente impose DEFAULT_* à TOUS les articles qui passent par elle. Les
    // demander avant l'audit, c'était quatre décisions pour rien.
    monter();
    expect(screen.getByText(/Réglages avancés/)).toBeInTheDocument();
    expect(screen.queryByText(/Type d'article/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Liens internes à placer/)).not.toBeInTheDocument();
  });

  it('un clic les rend TOUS, maillage compris — rien n\'est perdu', () => {
    // L'invariant protégé par l'ancien test ne change pas : le bloc de maillage
    // reste ATTEIGNABLE depuis l'écran de lancement. Seul son affichage par
    // défaut change — masqué n'est pas supprimé.
    monter();
    fireEvent.click(screen.getByText(/Réglages avancés/));
    expect(screen.getByPlaceholderText(/^Ancre/)).toBeInTheDocument();
    expect(screen.getByText(/Liens internes à placer/)).toBeInTheDocument();
    expect(screen.getByText(/Type d'article/)).toBeInTheDocument();
    expect(screen.getByText(/Longueur cible/)).toBeInTheDocument();
  });
});

describe('PhaseGeneration — le maillage est saisissable AVANT de générer', () => {
  const base = {
    audit: { scores: { global: 5 } },
    scope: null,
    onScopeChange: () => {},
    onGenerate: () => {},
    articleUrl: URL_ART,
  };

  it('rend le bloc de maillage sur l\'écran de génération', () => {
    render(<PhaseGeneration {...base} linkRows={[emptyLinkRow()]} onLinkRowsChange={() => {}} />);
    expect(screen.getByPlaceholderText(/^Ancre/)).toBeInTheDocument();
  });

  it('AVERTIT quand aucune paire n\'est saisie — le silence était le défaut', () => {
    render(<PhaseGeneration {...base} linkRows={[emptyLinkRow()]} onLinkRowsChange={() => {}} />);
    expect(screen.getByText(/aucun lien interne nouveau/)).toBeInTheDocument();
  });

  it('l\'avertissement disparaît dès qu\'une paire est complète', () => {
    render(
      <PhaseGeneration {...base}
        linkRows={[{ anchor: 'prime rénovation', url: '/prime-renovation' }]}
        onLinkRowsChange={() => {}} />
    );
    expect(screen.queryByText(/aucun lien interne nouveau/)).not.toBeInTheDocument();
  });

  it('DIT que les lignes viennent de l\'audit quand elles en viennent', () => {
    render(
      <PhaseGeneration {...base}
        linkRows={[{ anchor: 'laine de roche', url: '/laine-de-roche' }]}
        onLinkRowsChange={() => {}}
        auditSuggestionsCount={4} />
    );
    expect(screen.getByText(/4 liens suggérés par l'audit/)).toBeInTheDocument();
  });

  it('ne parle pas de l\'audit quand il n\'a rien suggéré', () => {
    render(<PhaseGeneration {...base} linkRows={[emptyLinkRow()]} onLinkRowsChange={() => {}} />);
    expect(screen.queryByText(/suggéré.? par l'audit/)).not.toBeInTheDocument();
  });
});
