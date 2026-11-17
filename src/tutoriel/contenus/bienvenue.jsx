import { Section, Encadre, Etapes, Quiz, Ecran, Mot } from '../ui';
import { MaquetteMenu } from '../maquettes';

export default function Bienvenue() {
  return (
    <>
      <Section titre="À quoi sert Tonton AI ?">
        <p>
          Tonton AI est un outil interne qui utilise l'intelligence artificielle pour aider à garder à jour
          les articles publiés sur nos sites : guides pratiques, comparatifs de prix, fiches conseils…
        </p>
        <p>
          Un article en ligne depuis plusieurs mois peut contenir des informations qui ne sont plus exactes :
          un prix qui a changé, une règle qui a évolué, un chiffre qui date. Refaire cette vérification à la main,
          article par article, prend beaucoup de temps.
        </p>
        <p>
          Tonton AI automatise la partie la plus longue : il relit l'article, cherche des informations récentes
          sur internet et propose une version mise à jour. <Mot>Vous</Mot> relisez ensuite le résultat avant
          de le publier.
        </p>
        <Encadre type="regle">
          <p>
            Aucun article n'est jamais publié automatiquement. Une personne relit toujours le résultat avant qu'il
            parte en ligne. Le bouton <Ecran>Publier</Ecran> n'existe d'ailleurs qu'à la dernière étape.
          </p>
        </Encadre>
      </Section>

      <Section titre="Le parcours en 4 étapes">
        <p>
          Pour un seul article comme pour un lot, l'outil suit toujours le même principe. Cliquez sur chaque
          étape pour voir ce que fait l'outil, et ce que vous faites.
        </p>
        <Etapes
          idGroupe="quatre-etapes"
          etapes={[
            {
              titre: 'Audit',
              sousTitre: 'Phase 1 — bouton « Lancer l\'audit »',
              corps: (
                <>
                  <p><Mot>L'outil</Mot> analyse l'article en ligne (qualité, exactitude, transparence), cherche des informations récentes
                    sur le web et repère ce qui mérite d'être mis à jour. Le rapport est enregistré et reste consultable.</p>
                  <p><Mot>Vous</Mot> lisez le rapport : les scores, le résumé et les actions prioritaires.</p>
                </>
              ),
            },
            {
              titre: 'Génération',
              sousTitre: 'Phase 2 — bouton « Générer la MAJ »',
              corps: (
                <>
                  <p><Mot>L'outil</Mot> rédige la nouvelle version : soit en modifiant seulement des passages (MAJ simple),
                    soit en réécrivant l'article en profondeur (refonte).</p>
                  <p><Mot>Vous</Mot> décidez de ce qui part à l'IA : ce que l'audit a trouvé, vos propres directives,
                    les liens internes à placer, l'ampleur.</p>
                </>
              ),
            },
            {
              titre: 'Obsolescence',
              sousTitre: 'Phase 3 — bouton « Vérifier les informations »',
              corps: (
                <>
                  <p><Mot>L'outil</Mot> contrôle le texte qui vient d'être produit : chiffres, dates, normes, tarifs.
                    Il propose des suggestions prêtes à coller.</p>
                  <p><Mot>Vous</Mot> parcourez les suggestions et appliquez celles qui sont justes.</p>
                </>
              ),
            },
            {
              titre: 'Relecture',
              sousTitre: 'Phase 4 — boutons « Terminer » et « Publier »',
              corps: (
                <>
                  <p><Mot>L'outil</Mot> retire les tournures typiques d'une écriture d'IA.</p>
                  <p><Mot>Vous</Mot> faites les dernières retouches, réglez le titre, puis publiez vous-même sur le site.
                    C'est la seule étape qui modifie un article public.</p>
                </>
              ),
            },
          ]}
        />
        <Encadre type="info" titre="En MAJ en lot">
          <p>
            En lot, l'outil enchaîne seul l'audit, la génération, la vérification et la correction de style, puis
            s'arrête : la relecture reste la vôtre. Voir le chapitre « La MAJ en lot ».
          </p>
        </Encadre>
      </Section>

      <Section titre="Votre menu">
        <p>
          Chaque personne a un rôle, qui détermine les pages qu'elle voit. En tant que rédacteur (CQ IA), vous utilisez
          surtout <Ecran>Faire une MAJ</Ecran>, <Ecran>Mes MAJ</Ecran>, <Ecran>MAJ en lot</Ecran>,
          {' '}<Ecran>Historique</Ecran> et <Ecran>Tickets</Ecran>. Essayez les autres rôles pour voir la différence.
        </p>
        <MaquetteMenu roleInitial="cq_ia" surligner={['Faire une MAJ', 'Mes MAJ', 'MAJ en lot', 'Historique', 'Tickets']} />
        <p>
          Le <Ecran>Dashboard</Ecran> s'adapte à votre rôle : un rédacteur y retrouve ses propres chiffres.
          Les autres pages (réglages, équipe, budget…) relèvent des managers et des super admins : un menu
          « Tutoriel admin » leur est dédié.
        </p>
      </Section>

      <Quiz
        questions={[
          {
            q: 'Quand un article est-il publié sur le site ?',
            choix: [
              'Dès que l\'IA a fini sa mise à jour',
              'Seulement quand une personne clique sur Publier, à la dernière étape',
              'Automatiquement, chaque nuit',
            ],
            bonne: 1,
            explication: 'Le bouton Publier n\'apparaît qu\'en phase 4, après votre relecture.',
          },
          {
            q: 'Dans quel ordre passe un article ?',
            choix: [
              'Génération, Audit, Relecture, Obsolescence',
              'Audit, Génération, Obsolescence, Relecture',
              'Relecture, Audit, Génération, Publication',
            ],
            bonne: 1,
            explication: 'Audit → Génération → Obsolescence → Relecture, dans cet ordre.',
          },
          {
            q: 'En MAJ en lot, qui fait la relecture finale ?',
            choix: ['L\'IA, avec une seconde passe', 'Personne : le lot publie tout seul', 'Vous, comme pour une MAJ seule'],
            bonne: 2,
            explication: 'Un lot s\'arrête à la relecture : il ne publie jamais rien.',
          },
        ]}
      />
    </>
  );
}
