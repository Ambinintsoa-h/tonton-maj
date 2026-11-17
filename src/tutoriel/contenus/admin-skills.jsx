import { Section, Encadre, Accordeon, Quiz, Ecran, Mot } from '../ui';

export default function AdminSkills() {
  return (
    <>
      <Section titre="Ce qu'est un skill">
        <p>
          Un <Mot>skill</Mot> est un ensemble d'instructions injectées dans le prompt de l'IA à chaque analyse : méthode d'audit,
          règles rédactionnelles de la maison, consignes de style. La page <Ecran>Skills IA</Ecran> permet de les gérer sans
          intervention technique.
        </p>
        <Encadre type="regle" titre="Les règles rédactionnelles se modifient ici">
          <p>
            C'est le principe de la maison : une règle d'écriture (ce qu'on évite, comment on structure…) vit dans un skill,
            que l'équipe peut éditer — pas dans le code. Ainsi elle se change en quelques minutes, sans déploiement.
          </p>
        </Encadre>
      </Section>

      <Section titre="Lire la page">
        <Accordeon
          items={[
            {
              q: 'Le bandeau « Contexte injecté à chaque MAJ »',
              r: (
                <>
                  <p>Il résume ce que l'IA reçoit : le nombre de skills actifs, de bases de connaissances actives, et combien sont
                    <Mot> hors budget</Mot>.</p>
                  <p><Ecran>Aperçu prompt</Ecran> montre le texte exact qui sera envoyé : à consulter avant de croire qu'une règle « ne marche pas ».</p>
                </>
              ),
            },
            {
              q: 'Le budget de caractères',
              r: (
                <>
                  <p>Un compteur indique le total de caractères injectés par rapport au plafond (par exemple « 6 458 / 6 000 »).</p>
                  <p>Au-delà, des skills sont signalés « hors budget » : à raccourcir, fusionner ou désactiver. Plus le contexte est long, plus
                    chaque règle pèse peu dans la décision de l'IA : mieux vaut peu de règles claires que beaucoup de règles diluées.</p>
                </>
              ),
            },
            {
              q: 'Ajouter ou importer un skill',
              r: (
                <>
                  <p><Ecran>Nouveau skill</Ecran> accepte un fichier <Mot>SKILL.md</Mot> (format Claude, avec ses ressources), un simple
                    <Mot> .md</Mot> ou une archive <Mot>.zip</Mot> ; plusieurs fichiers à la fois sont acceptés.</p>
                  <p>Les boutons <Ecran>Export</Ecran> et <Ecran>Import</Ecran> permettent de sauvegarder et de restaurer l'ensemble.</p>
                </>
              ),
            },
            {
              q: '« Skills par Tonton AI » : le socle',
              r: (
                <p>
                  Ce bloc, marqué « géré par le code », contient des règles transversales à toutes les mises à jour (par exemple
                  l'intégrité factuelle : ne jamais inventer un chiffre). Il ne se modifie pas depuis cette page.
                </p>
              ),
            },
            {
              q: 'Le skill « cerveau »',
              r: (
                <p>
                  L'audit et la génération s'appuient sur un skill principal au format SKILL.md. Sans skill de ce type actif,
                  l'audit refuse de se lancer et vous le dit.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Encadre type="attention" titre="Avant de cliquer sur « Vider »">
        <p>
          <Ecran>Vider</Ecran> supprime les skills. Faites un <Ecran>Export</Ecran> d'abord : c'est votre seule sauvegarde simple.
        </p>
      </Encadre>

      <Quiz
        questions={[
          {
            q: 'Une règle d\'écriture ne s\'applique pas. Que consultez-vous en premier ?',
            choix: [
              'Le code, pour chercher un bug',
              'L\'« Aperçu prompt », pour voir si la règle est bien envoyée',
              'Rien : une règle ne peut pas échouer',
            ],
            bonne: 1,
            explication: 'L\'aperçu montre ce que l\'IA reçoit vraiment. Un skill signalé « hors budget » est aussi à vérifier.',
          },
          {
            q: 'Où modifie-t-on une règle rédactionnelle de la maison ?',
            choix: ['Dans un skill, depuis la page Skills IA', 'Dans le code de l\'application'],
            bonne: 0,
            explication: 'Les règles d\'écriture appartiennent à l\'équipe, pas au code.',
          },
        ]}
      />
    </>
  );
}
