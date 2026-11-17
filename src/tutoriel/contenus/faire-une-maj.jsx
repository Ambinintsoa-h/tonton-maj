import { Section, Encadre, Onglets, Quiz, ListeAFaire, Accordeon, Ecran, Mot } from '../ui';
import { MaquetteLancement } from '../maquettes';

export default function FaireUneMaj({ membre }) {
  return (
    <>
      <Section titre="1. Lancer l'analyse">
        <p>
          Ouvrez <Ecran>Faire une MAJ</Ecran> dans le menu. L'écran vous demande l'article à mettre à jour et son
          mot-clé cible. Essayez la maquette ci-dessous : elle reprend les libellés réels de l'écran.
        </p>
        <MaquetteLancement />
        <Encadre type="attention" titre="Le site refuse la récupération ?">
          <p>
            Certains sites bloquent la lecture automatique de leurs pages. Si l'outil annonce que la page n'existe plus
            (404) alors que vous la voyez dans votre navigateur, ouvrez l'onglet <Ecran>Copier-coller</Ecran>,
            collez le texte de l'article, et relancez. Si le problème se répète sur un site, ouvrez un ticket.
          </p>
        </Encadre>
      </Section>

      <Section titre="2. Lire l'audit (phase 1)">
        <p>Quand l'audit est terminé, un rapport s'affiche. Voici comment le lire, du plus important au détail :</p>
        <Onglets
          idGroupe="audit"
          onglets={[
            {
              id: 'scores', label: 'Les scores',
              contenu: (
                <>
                  <p>
                    Cinq notes sur 10 : <Mot>IA</Mot>, <Mot>GEO</Mot>, <Mot>SEO</Mot>, <Mot>Citabilité</Mot> et un
                    <Mot> Global</Mot>. Une ligne indique aussi le <Mot>score atteignable après mise à jour</Mot> :
                    c'est l'objectif réaliste, pas une promesse.
                  </p>
                </>
              ),
            },
            {
              id: 'resume', label: 'Résumé et QAT',
              contenu: (
                <p>
                  Le <Mot>résumé exécutif</Mot> dit en quelques lignes ce qui ne va pas. Le <Mot>framework QAT</Mot> note trois
                  dimensions — Quality, Accuracy, Transparency — chacune avec une phrase d'explication.
                </p>
              ),
            },
            {
              id: 'actions', label: 'Actions prioritaires',
              contenu: (
                <>
                  <p>
                    Une liste d'actions classées <Mot>P1</Mot> (à traiter en premier), <Mot>P2</Mot>… Chaque action a un titre
                    et une raison. C'est ce qui nourrit la phase suivante.
                  </p>
                </>
              ),
            },
          ]}
        />
        <Encadre type="info">
          <p>
            Un rapport peut signaler une affirmation « non confirmée » ou « à sourcer ». Ne la gardez jamais telle quelle
            si vous ne pouvez pas la vérifier : retirez-la ou mettez-la au conditionnel.
          </p>
        </Encadre>
      </Section>

      <Section titre="3. Générer la MAJ (phase 2)">
        <p>
          C'est l'étape où <Mot>vous décidez</Mot> de ce qui part à l'IA. Rien n'est écrit tant que vous n'avez pas cliqué
          sur <Ecran>Générer la MAJ</Ecran>.
        </p>
        <Accordeon
          items={[
            {
              q: 'Les cases à cocher : ce que l\'audit transmet',
              r: (
                <>
                  <p>Chaque case est une catégorie de constats de l'audit. Cochée, elle part à l'IA ; décochée, elle est ignorée.</p>
                  <p>Le pré-cochage dépend de l'ampleur : pour une <Mot>refonte</Mot>, le factuel, les données récentes et les actions P1 ;
                    pour une <Mot>MAJ simple</Mot>, les données récentes seulement, afin de ne pas la surcharger.</p>
                  <p>Le bloc <Mot>Factuel</Mot> (passages à retirer, affirmations à sourcer) est à part : si vous le décochez,
                    l'outil vous le rappellera au moment de publier.</p>
                </>
              ),
            },
            {
              q: 'Vos directives',
              r: (
                <p>
                  Une zone de texte, pré-remplie, qui guide la rédaction. Vous pouvez la modifier librement.
                  Elle est limitée à 2 500 caractères : au-delà, la fin est coupée et l'outil vous l'annonce.
                </p>
              ),
            },
            {
              q: 'Les liens internes',
              r: (
                <>
                  <p>Des paires <Mot>ancre + adresse</Mot> vers d'autres pages du même site, pré-remplies par l'audit.
                    L'outil place chacune dans le texte.</p>
                  <p>Une adresse d'un autre site est écartée : l'outil n'ajoute jamais de lien externe. Les liens externes
                    déjà présents dans l'article sont, eux, conservés.</p>
                </>
              ),
            },
            {
              q: 'L\'ampleur : MAJ simple ou refonte',
              r: (
                <>
                  <p><Mot>MAJ simple</Mot> : modifications ciblées, validées une par une ; la structure et le texte existants sont conservés.</p>
                  <p><Mot>Refonte</Mot> : l'article est réécrit intégralement ; la structure est refaite.</p>
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section titre="4. Vérifier les informations (phase 3)">
        <p>
          L'outil contrôle le texte qui vient d'être produit : chiffres, dates, normes, tarifs. Il propose des suggestions
          prêtes à coller. Pour chacune, vous choisissez de l'<Ecran>Appliquer</Ecran> ou de l'ignorer : c'est vous qui
          connaissez le sujet.
        </p>
      </Section>

      <Section titre="5. Relire et finir (phase 4)">
        <p>
          La dernière phase retire les tournures typiques d'une écriture d'IA et vous laisse faire les retouches.
          Elle a son propre chapitre : « Relire et publier ».
        </p>
      </Section>

      <ListeAFaire
        titre="Ma première MAJ"
        listeId="premiere-maj"
        membre={membre}
        etapes={[
          { id: 'article', texte: 'Choisir un article à mettre à jour', detail: 'Demandez à un collègue lequel si vous hésitez.' },
          { id: 'mot-cle', texte: 'Définir son mot-clé cible', detail: 'Obligatoire : sans lui le bouton reste grisé.' },
          { id: 'lancer', texte: 'Cliquer sur « Lancer l\'analyse IA »', detail: 'La phase 1 démarre ; comptez quelques minutes.' },
          { id: 'audit', texte: 'Lire les scores et les actions P1' },
          { id: 'generer', texte: 'Choisir les cases, écrire vos directives, puis « Générer la MAJ »' },
          { id: 'verifier', texte: 'Parcourir les suggestions de la phase 3' },
          { id: 'relire', texte: 'Relire l\'article en phase 4 et corriger' },
          { id: 'publier', texte: 'Publier, puis ouvrir la page pour vérifier le résultat' },
        ]}
      />

      <Quiz
        questions={[
          {
            q: 'Le bouton « Lancer l\'analyse IA » reste grisé. Quelle est la cause la plus probable ?',
            choix: ['Le mot-clé cible n\'est pas renseigné', 'Le site est en panne', 'Il faut d\'abord publier'],
            bonne: 0,
            explication: 'Le mot-clé cible est obligatoire : l\'IA optimise l\'article autour de lui.',
          },
          {
            q: 'L\'outil dit que la page n\'existe plus, mais vous la voyez. Que faites-vous ?',
            choix: [
              'Vous attendez une heure',
              'Vous utilisez l\'onglet « Copier-coller » avec le texte de l\'article',
              'Vous supprimez l\'article',
            ],
            bonne: 1,
            explication: 'Le site bloque sans doute la lecture automatique ; en collant le texte, l\'outil n\'a plus besoin de la lire.',
          },
          {
            q: 'À quoi servent les cases à cocher de la phase 2 ?',
            choix: [
              'À choisir quels constats de l\'audit partent à l\'IA',
              'À choisir le site de publication',
              'À valider la publication',
            ],
            bonne: 0,
            explication: 'Cocher, c\'est décider qu\'une consigne de l\'audit est transmise à l\'IA.',
          },
        ]}
      />
    </>
  );
}
