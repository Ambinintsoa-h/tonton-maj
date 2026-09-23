/* eslint-env jest */
import { wrapOrphanJsonLd } from './publishSanitize';

// Échantillon RÉEL (guiderenovation.fr, article budget rénovation, constaté
// le 17/09/2026) — JSON nu dans un bloc `wp:html`, backslash perdus devant
// les \u, aucun <script> autour.
const BROKEN_SAMPLE = `<!-- wp:html -->
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Comment connau00eetre les aides locales disponibles ?","acceptedAnswer":{"@type":"Answer","text":"Contactez votre ADIL ou consultez france-renov.gouv.fr pour vu00e9rifier les dispositifs locaux actualisu00e9s."}},{"@type":"Question","name":"Quand demander les aides u00e0 la ru00e9novation ?","acceptedAnswer":{"@type":"Answer","text":"Du00e9posez les demandes avant la signature des devis et avant le du00e9marrage des travaux."}},{"@type":"Question","name":"Pourquoi pru00e9voir une ru00e9serve financiu00e8re ?","acceptedAnswer":{"@type":"Answer","text":"Elle couvre les du00e9fauts du00e9couverts apru00e8s lu2019ouverture des murs, sols ou plafonds."}}]}

<h3>Comment connaître les aides locales disponibles ?</h3>
<p>Contactez votre ADIL ou consultez france-renov.gouv.fr pour vérifier les dispositifs locaux actualisés.</p>
<h3>Quand demander les aides à la rénovation ?</h3>
<p>Déposez les demandes avant la signature des devis et avant le démarrage des travaux.</p>
<h3>Pourquoi prévoir une réserve financière ?</h3>
<p>Elle couvre les défauts découverts après l’ouverture des murs, sols ou plafonds.</p>
<!-- /wp:html -->`;

describe('wrapOrphanJsonLd — filet de sécurité JSON-LD avant publication WP', () => {
  test('répare le bloc réel constaté sur guiderenovation.fr : backslash restaurés + enveloppé dans <script>', () => {
    const { html, fixed, unresolved } = wrapOrphanJsonLd(BROKEN_SAMPLE);
    expect(fixed).toBe(1);
    expect(unresolved).toBe(0);
    expect(html).toContain('<script type="application/ld+json">');

    const scriptMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    const parsed = JSON.parse(scriptMatch[1]);
    expect(parsed.mainEntity).toHaveLength(3);
    expect(parsed.mainEntity[0].name).toBe('Comment connaître les aides locales disponibles ?');
    expect(parsed.mainEntity[2].acceptedAnswer.text)
      .toBe('Elle couvre les défauts découverts après l’ouverture des murs, sols ou plafonds.');

    // Plus aucun "uXXXX" orphelin (non précédé d'un backslash) dans le script.
    expect(scriptMatch[1]).not.toMatch(/[^\\]u[0-9a-f]{4}/);
  });

  test('le HTML visible (titres, paragraphes) reste intact — seul le JSON-LD est touché', () => {
    const { html } = wrapOrphanJsonLd(BROKEN_SAMPLE);
    expect(html).toContain('<h3>Comment connaître les aides locales disponibles ?</h3>');
    expect(html).toContain('<p>Déposez les demandes avant la signature des devis et avant le démarrage des travaux.</p>');
  });

  test('idempotent : ré-appliquer sur un contenu déjà réparé ne change rien', () => {
    const first = wrapOrphanJsonLd(BROKEN_SAMPLE);
    const second = wrapOrphanJsonLd(first.html);
    expect(second.fixed).toBe(0);
    expect(second.unresolved).toBe(0);
    expect(second.html).toBe(first.html);
  });

  test('un article sans JSON-LD du tout est renvoyé identique', () => {
    const plain = '<p>Un simple article sans schema.org, avec des "guillemets" et du texte.</p>';
    const { html, fixed, unresolved } = wrapOrphanJsonLd(plain);
    expect(html).toBe(plain);
    expect(fixed).toBe(0);
    expect(unresolved).toBe(0);
  });

  test('un JSON-LD déjà bien formé et déjà enveloppé dans <script> est laissé tel quel', () => {
    const good = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>';
    const { html, fixed } = wrapOrphanJsonLd(good);
    expect(html).toBe(good);
    expect(fixed).toBe(0);
  });

  test('un bloc orphelin réellement irréparable (JSON structurellement cassé) est signalé, pas publié cassé en silence', () => {
    const irreparable = '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question"';
    const { fixed, unresolved } = wrapOrphanJsonLd(irreparable);
    expect(fixed).toBe(0);
    expect(unresolved).toBe(1);
  });

  test('ne double-échappe jamais un \\u déjà correct, et répare un uXXXX cassé juste à côté dans la même chaîne', () => {
    const mixed = '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"D\\u00e9j\\u00e0 correct puis u00e9lectricien cass\\u00e9"}]}';
    const { html, fixed } = wrapOrphanJsonLd(mixed);
    expect(fixed).toBe(1);
    const scriptMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(scriptMatch[1]);
    expect(parsed.mainEntity[0].name).toBe('Déjà correct puis électricien cassé');
  });
});
