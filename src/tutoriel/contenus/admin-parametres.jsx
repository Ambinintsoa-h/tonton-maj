import { Section, Encadre, Accordeon, Quiz, Ecran, Mot } from '../ui';

export default function AdminParametres() {
  return (
    <>
      <Section titre="Une page réservée aux super admins">
        <p>
          <Ecran>Paramètres</Ecran> se trouve en bas de la barre latérale. On y règle ce dont l'outil a besoin pour fonctionner.
          Les clés sont saisies <Mot>une seule fois</Mot> ; elles sont lues côté serveur et ne sont jamais montrées aux autres rôles.
        </p>
      </Section>

      <Section titre="Les grandes sections">
        <Accordeon
          items={[
            {
              q: 'Les clés des services',
              r: (
                <>
                  <p>La clé de l'<Mot>API Anthropic</Mot> (l'IA), celles des deux moteurs de recherche <Mot>Brave</Mot> et <Mot>Tavily</Mot>,
                    <Mot> Groq</Mot> (transcription audio) et <Mot>Haloscan</Mot> (position Google).</p>
                  <p>Un bouton de test existe pour certains services (par exemple Haloscan) : utilisez-le après toute modification de clé.</p>
                </>
              ),
            },
            {
              q: 'Gestion des modèles d\'IA',
              r: (
                <>
                  <p>Pour chaque étape (audit, refonte, obsolescence, gras, style, réécriture d'un passage…), vous choisissez quel modèle
                    Claude est utilisé. Le coût moyen observé sur les 20 derniers articles est affiché à côté du choix.</p>
                  <Encadre type="attention" titre="« Synchroniser » est facturé">
                    <p>Ce bouton teste réellement chaque modèle, avec un appel à l'IA par modèle. Ne le lancez que quand c'est utile.</p>
                  </Encadre>
                </>
              ),
            },
            {
              q: 'L\'envoi d\'e-mails (SMTP)',
              r: (
                <>
                  <p>Hôte, port, adresse d'expéditeur, utilisateur et mot de passe. C'est ce qui fait partir les invitations, les
                    réinitialisations de mot de passe, les récapitulatifs de fin de lot et l'alerte de budget.</p>
                  <p>Le champ <Ecran>Alerte budget API — destinataire(s)</Ecran> fixe qui est prévenu quand le budget baisse
                    (plusieurs adresses séparées par des virgules ; vide, c'est l'adresse par défaut).</p>
                </>
              ),
            },
            {
              q: 'Le traitement en lot',
              r: (
                <p>
                  Le nombre d'articles traités <Mot>en parallèle</Mot> (de 1 à 10, 4 par défaut) et le comportement en cas d'erreur.
                  Plus le parallélisme est élevé, plus un lot est rapide, mais plus le site source et le serveur sont sollicités.
                </p>
              ),
            },
            {
              q: 'Google Sheets',
              r: <p>La connexion au tableau partagé de la rédaction, qui alimente le bloc « Lignes détectées depuis le Google Sheet » de la page MAJ en lot.</p>,
            },
          ]}
        />
      </Section>

      <Section titre="Vérifier que l'envoi d'e-mails fonctionne">
        <p>
          Dans la section d'envoi, le champ <Ecran>Vérifier que l'envoi aboutit</Ecran> envoie un <Mot>vrai e-mail de test</Mot>.
          Pourquoi c'est important : les champs peuvent être tous remplis sans que l'envoi marche, et ailleurs dans l'outil
          un envoi qui échoue ne se signale pas.
        </p>
        <Encadre type="info" titre="Le test porte sur les réglages enregistrés">
          <p>
            Il utilise ce qui est <Mot>sauvegardé</Mot>, pas ce qui est affiché à l'écran. Si vous venez de modifier un champ,
            enregistrez d'abord. En cas d'échec, la fenêtre indique l'étape qui a échoué : configuration, connexion, envoi ou destinataire.
          </p>
        </Encadre>
      </Section>

      <Quiz
        questions={[
          {
            q: 'Les champs SMTP sont tous remplis. L\'envoi d\'e-mails fonctionne-t-il forcément ?',
            choix: ['Oui', 'Non : seul un e-mail de test le prouve'],
            bonne: 1,
            explication: 'Des identifiants faux donnent des champs remplis et aucun e-mail. D\'où le bouton « Envoyer un test ».',
          },
          {
            q: 'Vous modifiez l\'hôte SMTP puis cliquez sur « Envoyer un test » sans enregistrer. Que teste-t-il ?',
            choix: ['La nouvelle valeur', 'L\'ancienne valeur, celle qui est enregistrée'],
            bonne: 1,
            explication: 'Le test vérifie ce que le serveur utilisera vraiment : les réglages enregistrés.',
          },
        ]}
      />
    </>
  );
}
