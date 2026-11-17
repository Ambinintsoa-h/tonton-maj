import { Section, Encadre, Etapes, Accordeon, Quiz, Ecran, Mot } from '../ui';

export default function AdminBudget() {
  return (
    <>
      <Section titre="À quoi sert la page">
        <p>
          Anthropic, le service d'IA, <Mot>n'expose aucun solde</Mot> : on ne peut pas lui demander « combien reste-t-il ? ».
          La page <Ecran>Budget API</Ecran> le calcule donc elle-même : <Mot>recharges saisies, moins consommation mesurée</Mot>.
        </p>
        <Encadre type="attention" titre="C'est une estimation, pas un relevé">
          <p>
            La page le dit en toutes lettres, et c'est exact. Retenez deux conséquences : le décompte part de la <Mot>première
            recharge saisie</Mot> (un solde antérieur n'est pas compté, donc le restant réel peut être plus élevé, jamais plus bas),
            et le coût du cache de l'IA est compté ici, mais pas dans le Dashboard.
          </p>
        </Encadre>
      </Section>

      <Section titre="Le geste à faire à chaque recharge">
        <Etapes
          idGroupe="budget"
          etapes={[
            {
              titre: 'Recharger',
              sousTitre: 'Chez Anthropic',
              corps: <p>Rechargez le compte de l'API comme d'habitude, dans la console d'Anthropic. Notez le montant en dollars.</p>,
            },
            {
              titre: 'Saisir',
              sousTitre: 'Dans Tonton AI',
              corps: (
                <>
                  <p>Page <Ecran>Budget API</Ecran>, formulaire <Ecran>Enregistrer une recharge</Ecran> : le <Mot>montant (USD)</Mot>,
                    la <Mot>date</Mot> et une note facultative.</p>
                  <p>Le même jour, saisissez-la : sans recharge enregistrée, le restant est « inconnu » et l'alerte ne se déclenche pas.</p>
                </>
              ),
            },
            {
              titre: 'Lire',
              sousTitre: 'Le restant',
              corps: (
                <p>
                  Le chiffre en tête est le <Mot>budget restant (estimation)</Mot>, avec le consommé, la moyenne par jour et le nombre
                  de jours avant épuisement « au rythme actuel ». Ce dernier lisse sur les jours écoulés : un repère de tendance,
                  pas une échéance.
                </p>
              ),
            },
          ]}
        />
        <p>
          Une recharge saisie par erreur peut être supprimée (avec confirmation) : une faute de frappe fausserait le restant et le
          seuil d'alerte.
        </p>
      </Section>

      <Section titre="L'alerte sous 50 $">
        <p>
          Quand le restant passe sous <Mot>50 $</Mot>, un e-mail est envoyé <Mot>une fois</Mot> au franchissement, puis un
          <Mot> rappel par semaine</Mot> tant qu'aucune recharge ne repasse au-dessus. Sans ce réarmement, la même alerte
          partirait quatre fois par jour et finirait filtrée.
        </p>
        <Accordeon
          items={[
            {
              q: 'Qui reçoit l\'alerte ?',
              r: <p>Les adresses saisies dans <Ecran>Paramètres</Ecran>, champ « Alerte budget API — destinataire(s) ». Si le champ est vide, une adresse par défaut est utilisée.</p>,
            },
            {
              q: 'Comment savoir qu\'elle partira vraiment ?',
              r: (
                <>
                  <p>La page l'annonce <Mot>avant</Mot> tout franchissement : un bandeau rouge « SMTP n'est pas configuré : aucune alerte ne partira »
                    apparaît si l'envoi est impossible.</p>
                  <p>Chaque tentative d'envoi est consignée dans un journal visible sur la page, échecs compris : « envoyée »,
                    « NON envoyée (SMTP absent) », ou le message d'erreur en cas d'échec.
                    Un envoi raté ne compte pas comme une alerte délivrée : l'outil réessaie.</p>
                </>
              ),
            },
            {
              q: 'Et le Dashboard ?',
              r: <p>Un bandeau d'une ligne y rappelle le restant. S'il est bas et que l'alerte ne peut pas partir (SMTP absent), un marqueur le signale.</p>,
            },
          ]}
        />
      </Section>

      <Section titre="Les statistiques de consommation">
        <p>
          La page ventile le coût <Mot>par jour</Mot>, <Mot>par modèle</Mot> et <Mot>par flux</Mot> (audit, refonte, obsolescence, passe de
          gras, passe de style…). C'est le moyen de voir où part l'argent : un flux qui grossit sans raison se repère ici.
        </p>
        <Encadre type="info" titre="Pourquoi deux chiffres de coût ?">
          <p>
            Le widget de coût du Dashboard ne compte pas les « tokens de cache » de l'IA ; la page Budget API, si. Elle est donc
            légèrement plus haute, et c'est elle qui est juste. Ne cherchez pas un bug dans l'écart. Les anciennes lignes, antérieures à la
            mise en place du suivi, n'ont pas ce détail : la page indique combien d'appels sont dans ce cas.
          </p>
        </Encadre>
      </Section>

      <Quiz
        questions={[
          {
            q: 'Vous venez de recharger 600 $ chez Anthropic. Que faites-vous dans Tonton AI ?',
            choix: ['Rien, la page lit le solde', 'Vous saisissez la recharge sur la page Budget API', 'Vous videz le cache'],
            bonne: 1,
            explication: 'Anthropic n\'expose aucun solde : la page ne peut calculer le restant qu\'à partir des recharges saisies.',
          },
          {
            q: 'Le restant affiché est de 42 $ et aucun e-mail n\'est arrivé. Premier réflexe ?',
            choix: [
              'Attendre',
              'Regarder le journal des alertes sur la page : il dit si l\'envoi a été tenté, et s\'il a échoué',
              'Supprimer la dernière recharge',
            ],
            bonne: 1,
            explication: 'Chaque tentative est consignée, échecs compris. Puis testez l\'envoi dans Paramètres.',
          },
        ]}
      />
    </>
  );
}
