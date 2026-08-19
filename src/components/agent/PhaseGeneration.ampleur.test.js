/**
 * Verrou : « L'audit recommande une . » ne doit plus jamais s'afficher.
 *
 * Le défaut, constaté en production le 19 août 2026, venait de DEUX LECTURES DU
 * MÊME CHAMP qui se contredisaient :
 *   • `scopeRecommendationSource` choisit la branche à afficher avec
 *     `auditAmpleurDecision`, TOLÉRANT au texte libre → il répondait 'ampleur' ;
 *   • l'affichage lisait `audit.ampleur.decision` en BRUT → vide.
 * Résultat : la phrase « l'audit a tranché » s'affichait sans dire QUOI. Pire
 * qu'une absence, parce qu'elle affirme qu'une décision existe.
 *
 * La forme dégradée (`ampleur` en texte libre) est documentée depuis le 17/08 :
 * ces tests la couvrent explicitement, c'est elle qui a produit le bug.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhaseGeneration from './PhaseGeneration';

const base = {
  scope: null,
  onScopeChange: () => {},
  onGenerate: () => {},
  linkRows: [],
  onLinkRowsChange: () => {},
};

/** Le texte de la ligne d'ampleur, espaces normalisés. */
const ligneAmpleur = () => {
  const el = screen.getByText(/L'audit recommande une/).closest('p');
  return el.textContent.replace(/\s+/g, ' ').trim();
};

describe('ligne d\'ampleur — la décision est toujours NOMMÉE', () => {
  it('forme NORMALE : le libellé et la justification s\'affichent', () => {
    render(<PhaseGeneration {...base} audit={{
      ampleur: { decision: 'refonte_totale', justification: 'Le fond est daté.' },
    }} />);
    expect(ligneAmpleur()).toBe('L\'audit recommande une refonte totale. Le fond est daté.');
  });

  it('forme DÉGRADÉE (texte libre) : plus jamais de libellé vide', () => {
    // C'est LE cas de production. Avant le correctif : « L'audit recommande une . »
    render(<PhaseGeneration {...base} audit={{
      ampleur: 'Refonte structurelle prioritaire : le plan ne répond pas à la requête.',
    }} />);
    const ligne = ligneAmpleur();
    expect(ligne).not.toMatch(/une\s*\./);            // le trou exact du bug
    expect(ligne).toContain('refonte totale');
    // Le « pourquoi » ne se perd pas : en forme dégradée, la justification EST le
    // champ lui-même. `'chaîne'.justification` valait undefined, donc en silence.
    expect(ligne).toContain('Refonte structurelle prioritaire');
  });

  it('texte libre porté par la JUSTIFICATION, decision vide', () => {
    render(<PhaseGeneration {...base} audit={{
      ampleur: { decision: '', justification: 'Une simple MAJ ciblée suffit ici.' },
    }} />);
    const ligne = ligneAmpleur();
    expect(ligne).not.toMatch(/une\s*\./);
    expect(ligne).toContain('MAJ ciblée');
  });

  it('aucune ampleur exploitable → ce n\'est PAS cette phrase qui s\'affiche', () => {
    // Une déduction sur les scores ne doit jamais être présentée comme une
    // décision de l'audit : c'est l'autre branche qui doit prendre.
    render(<PhaseGeneration {...base} audit={{ scores: { global: 4 } }} />);
    expect(screen.queryByText(/L'audit recommande une/)).not.toBeInTheDocument();
    expect(screen.getByText(/n'a pas tranché l'ampleur/)).toBeInTheDocument();
  });
});
