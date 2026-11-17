import { Section, Encadre, Accordeon, Quiz, Ecran, Mot } from '../ui';

export default function AdminEquipe() {
  return (
    <>
      <Section titre="La page Équipe">
        <p>
          <Ecran>Équipe</Ecran> sert à gérer les membres et leurs rôles. En haut, des compteurs : total des membres, membres
          actifs, et nombre de rédacteurs (CQ IA) et de managers. Les filtres <Ecran>Tous</Ecran>, <Ecran>Actifs</Ecran>,
          <Ecran> Inactifs</Ecran>, <Ecran>CQ IA</Ecran>, <Ecran>Managers</Ecran> et <Ecran>Super Admins</Ecran> aident à s'y retrouver.
          Chaque ligne indique le nom, le rôle, l'état, l'adresse e-mail et la date d'ajout.
        </p>
      </Section>

      <Section titre="Inviter un membre">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Cliquez sur <Ecran>Inviter un membre</Ecran>.</li>
          <li>
            Renseignez le <Mot>prénom</Mot>, le <Mot>nom</Mot>, l'<Mot>e-mail</Mot>, l'identifiant, le <Mot>rôle</Mot> et un
            <Mot> mot de passe temporaire</Mot> (6 caractères minimum).
          </li>
          <li>Cliquez sur <Ecran>Créer le compte</Ecran> : la personne reçoit un e-mail d'invitation avec un lien pour choisir son mot de passe.</li>
        </ol>
        <Encadre type="attention" titre="L'e-mail d'invitation dépend de la configuration d'envoi">
          <p>
            Si l'envoi d'e-mails n'est pas configuré, ou ne fonctionne pas, l'invitation ne part pas — et l'outil ne vous le dit pas
            toujours. Un super admin peut le vérifier dans <Ecran>Paramètres</Ecran> avec <Ecran>Envoyer un test</Ecran>. En attendant,
            transmettez l'identifiant et le mot de passe temporaire à la personne par un autre canal.
          </p>
        </Encadre>
        <Encadre type="attention" titre="Choisissez le rôle le plus restreint qui suffit">
          <p>
            Un rédacteur n'a pas besoin d'être manager. Chaque rôle supplémentaire ouvre des pages (réglages, équipe, budget)
            et des actions qu'il vaut mieux garder à peu de personnes.
          </p>
        </Encadre>
      </Section>

      <Section titre="Les rôles">
        <Accordeon
          items={[
            {
              q: 'Rédacteur (CQ IA)',
              r: <p>Lance des mises à jour (seules ou en lot), relit, corrige et publie ses propres articles, consulte son historique. Voit ses propres chiffres dans « Mes MAJ ».</p>,
            },
            {
              q: 'Manager',
              r: <p>Tout ce que fait un rédacteur, plus : la supervision de l'équipe (Équipe), les Skills IA, la connexion des sites WordPress, les Commentaires (bêta), et la vue sur les articles de toute l'équipe.</p>,
            },
            {
              q: 'Support',
              r: <p>Aide les utilisateurs et répond aux tickets. N'a pas la page « MAJ en lot » et dispose de son propre tableau de bord.</p>,
            },
            {
              q: 'Super admin',
              r: <p>Accès complet : Paramètres, clés des services, Budget API, Archives, Suivi positions, Effet des MAJ, ainsi que tout ce qu'ouvrent les autres rôles.</p>,
            },
          ]}
        />
      </Section>

      <Section titre="Suivre l'activité d'un membre">
        <p>
          Un super admin peut ouvrir la fiche d'un membre pour voir le <Mot>temps passé par article</Mot> — du lancement à la
          publication — et les <Mot>jours sans session</Mot> sur les 30 derniers jours. C'est un repère de charge de travail,
          pas un outil de contrôle : un jour sans session peut simplement être un jour de congé.
        </p>
      </Section>

      <Quiz
        questions={[
          {
            q: 'Un nouveau rédacteur doit lancer des lots et publier ses articles. Quel rôle lui donner ?',
            choix: ['Super admin', 'Manager', 'Rédacteur (CQ IA)'],
            bonne: 2,
            explication: 'Le rôle le plus restreint qui suffit : ici, rédacteur.',
          },
          {
            q: 'Un membre ne voit pas la page « Budget API ». Est-ce une panne ?',
            choix: ['Oui, il faut la réparer', 'Non : cette page est réservée aux super admins'],
            bonne: 1,
            explication: 'Le menu suit les rôles. Une page absente du menu n\'est pas un bug.',
          },
        ]}
      />
    </>
  );
}
