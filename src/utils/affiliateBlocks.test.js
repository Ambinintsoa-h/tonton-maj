import { extraireBlocsProse, appliquerReecritures, MOTS_MIN_BLOC } from './affiliateBlocks';

const O = (n) => `⟦${n}⟧`;
const F = (n) => `⟦/${n}⟧`;

// Extrait fidèle de cyber-securite.fr/meilleur-antivirus/ : de la prose, un lien
// d'affiliation dans une phrase, un encart comparatif, un bouton image.
const ARTICLE = `
<p>Choisir un antivirus en 2025 demande de comparer la protection, le prix et l'impact sur les performances de la machine.</p>
<p>Pour une protection complète, <a href="https://bitdefender.f9tmep.net/c/3120273/827481/4466">Bitdefender</a> reste notre référence, devant <strong>Norton 360</strong> sur le rapport qualité-prix global.</p>
<div class="mg-anti_container">
  <div class="mg-anti_top3-card">
    <p>Bitdefender Total Security</p>
    <a href="https://bitdefender.f9tmep.net/c/3120273/827481/4466">VOIR +</a>
  </div>
</div>
<div class="prefG-btns"><a href="https://profile.google.com/cp/Eh"><img src="https://x/g.png" alt=""/></a></div>
<h2>Comment nous avons testé les antivirus du comparatif</h2>
<p><img src="https://site.fr/banc-essai.jpg" alt="banc d'essai"/> Notre protocole de test mesure la détection sur un échantillon renouvelé chaque mois.</p>
`;

describe('extraireBlocsProse', () => {
  const r = extraireBlocsProse(ARTICLE);

  it('ne retient que la prose, et la rend SANS aucune balise', () => {
    expect(r.blocs).toHaveLength(3);
    expect(r.blocs.map((b) => b.tag)).toEqual(['p', 'p', 'h2']);
    r.blocs.forEach((b) => expect(b.texte).not.toMatch(/<[a-z]/i));
  });

  // Ce que le modèle ne voit pas, il ne peut pas l'abîmer — même garde-fou que
  // la FAQ dans la passe de gras.
  it('n\'envoie NI les encarts, NI les boutons image, NI les blocs à média', () => {
    const tous = r.blocs.map((b) => b.texte).join(' ');
    expect(tous).not.toMatch(/VOIR \+/);
    expect(tous).not.toMatch(/Bitdefender Total Security/);
    expect(tous).not.toMatch(/protocole de test/);      // le <p> porte une image
    expect(r.ecartes.encart).toBeGreaterThan(0);
    expect(r.ecartes.media).toBeGreaterThan(0);
  });

  // LE point qui fait marcher le procédé : le nom du produit reste lisible,
  // seule la balise disparaît. Masquer le lien entier priverait le modèle du sens.
  it('masque la balise mais GARDE le texte d\'ancre lisible', () => {
    const b = r.blocs[1];
    expect(b.texte).toContain(`${O(1)}Bitdefender${F(1)}`);
    expect(b.texte).toContain(`${O(2)}Norton 360${F(2)}`);
    expect(b.texte).not.toContain('bitdefender.f9tmep.net');   // le href ne sort JAMAIS
    expect(b.liens).toBe(2);
  });

  it('écarte les libellés trop courts pour être de la prose', () => {
    const court = extraireBlocsProse('<p>Voir l\'offre</p>');
    expect(court.blocs).toHaveLength(0);
    expect(court.ecartes.court).toBe(1);
    expect(MOTS_MIN_BLOC).toBe(8);
  });

  it('ne plante pas sur une entrée vide', () => {
    expect(extraireBlocsProse('').blocs).toEqual([]);
    expect(extraireBlocsProse().blocs).toEqual([]);
  });
});

describe('appliquerReecritures', () => {
  it('recolle le href D\'ORIGINE, jamais celui du modèle', () => {
    const { blocs } = extraireBlocsProse(ARTICLE);
    const cible = blocs.find((b) => b.liens === 2);
    const res = appliquerReecritures(ARTICLE, [{
      id: cible.id,
      texte: `En 2026, ${O(1)}Bitdefender${F(1)} garde la première place devant ${O(2)}Norton 360${F(2)} sur le rapport qualité-prix.`,
    }]);
    expect(res.appliques).toBe(1);
    expect(res.rejetes).toEqual([]);
    expect(res.html).toContain('<a href="https://bitdefender.f9tmep.net/c/3120273/827481/4466">Bitdefender</a>');
    expect(res.html).toContain('<strong>Norton 360</strong>');
    expect(res.html).toContain('En 2026,');
    // L'encart n'a pas bougé d'un caractère.
    expect(res.html).toContain('<a href="https://bitdefender.f9tmep.net/c/3120273/827481/4466">VOIR +</a>');
    expect(res.html).toContain('prefG-btns');
  });

  // On préfère un paragraphe périmé à un lien d'affiliation disparu.
  it('REFUSE le bloc quand un marqueur manque, et laisse le texte d\'origine', () => {
    const { blocs } = extraireBlocsProse(ARTICLE);
    const cible = blocs.find((b) => b.liens === 2);
    const res = appliquerReecritures(ARTICLE, [{ id: cible.id, texte: 'Bitdefender reste devant Norton en 2026, sans aucun marqueur conservé.' }]);
    expect(res.appliques).toBe(0);
    expect(res.rejetes[0].motif).toMatch(/marqueur 1 absent/);
    expect(res.html).toContain('bitdefender.f9tmep.net');
  });

  it('REFUSE une réécriture vide ou hors de proportion', () => {
    const { blocs } = extraireBlocsProse(ARTICLE);
    const sansLien = blocs.find((b) => b.liens === 0 && b.tag === 'p');
    expect(appliquerReecritures(ARTICLE, [{ id: sansLien.id, texte: '' }]).rejetes[0].motif).toMatch(/vide/);
    expect(appliquerReecritures(ARTICLE, [{ id: sansLien.id, texte: 'Trop court.' }]).rejetes[0].motif).toMatch(/longueur/);
  });

  // Le lien reste bon, mais le MOT a changé : appliqué, et signalé.
  it('signale un texte d\'ancre modifié sans casser le lien', () => {
    const { blocs } = extraireBlocsProse(ARTICLE);
    const cible = blocs.find((b) => b.liens === 2);
    const res = appliquerReecritures(ARTICLE, [{
      id: cible.id,
      texte: `En 2026, ${O(1)}Bitdefender Total Security${F(1)} garde la tête devant ${O(2)}Norton 360${F(2)} sur le prix.`,
    }]);
    expect(res.appliques).toBe(1);
    expect(res.ancresModifiees).toEqual([{ avant: 'Bitdefender', apres: 'Bitdefender Total Security' }]);
    expect(res.html).toContain('href="https://bitdefender.f9tmep.net/c/3120273/827481/4466"');
  });

  // Le texte vient du modèle : il ne doit pas pouvoir introduire de balise.
  it('échappe le HTML que le modèle tenterait de glisser', () => {
    const { blocs } = extraireBlocsProse(ARTICLE);
    const sansLien = blocs.find((b) => b.liens === 0 && b.tag === 'p');
    const res = appliquerReecritures(ARTICLE, [{
      id: sansLien.id,
      texte: 'Choisir un antivirus <a href="https://pirate.fr">en 2026</a> demande de comparer la protection et le prix.',
    }]);
    expect(res.appliques).toBe(1);
    // La balise est INERTE : elle s'affiche comme du texte, elle ne crée aucun
    // lien. C'est un `<` échappé, pas un `<` ouvrant.
    expect(res.html).not.toContain('<a href="https://pirate.fr"');
    expect(res.html).toContain('&lt;a href=');
  });

  // RELEVÉ EN PRODUCTION le 16/09/2026, au premier essai réel : un paragraphe
  // qui n'avait que deux liens est revenu avec ⟦3⟧, ⟦4⟧ et ⟦5⟧ autour de termes
  // ordinaires, et ces caractères sont partis tels quels dans l'article. La
  // consigne « n'invente aucun marqueur » ne tenait pas ; le contrôle, si.
  it('retire les marqueurs INVENTÉS par le modèle et garde les mots', () => {
    const { blocs } = extraireBlocsProse(ARTICLE);
    const cible = blocs.find((b) => b.liens === 2);
    const res = appliquerReecritures(ARTICLE, [{
      id: cible.id,
      texte: `En 2026, ${O(1)}Bitdefender${F(1)} devance ${O(2)}Norton 360${F(2)} et ${O(5)}Kaspersky${F(5)} sur la protection.`,
    }]);
    expect(res.appliques).toBe(1);
    expect(res.marqueursInventes).toBe(2);          // ⟦5⟧ et ⟦/5⟧
    expect(res.html).not.toMatch(/[⟦⟧]/); // plus aucun caractère de marqueur
    expect(res.html).toContain('Kaspersky');        // le mot, lui, est conservé
    expect(res.html).toContain('href="https://bitdefender.f9tmep.net/c/3120273/827481/4466"');
  });

  it('un id inconnu est rejeté, pas ignoré en silence', () => {
    const res = appliquerReecritures(ARTICLE, [{ id: 999, texte: 'Texte quelconque assez long pour passer les bornes de proportion.' }]);
    expect(res.rejetes[0].motif).toBe('bloc inconnu');
  });
});
