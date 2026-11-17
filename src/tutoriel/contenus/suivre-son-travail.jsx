import { Section, Encadre, Onglets, Ecran, Mot } from '../ui';

export default function SuivreSonTravail() {
  return (
    <>
      <Section titre="Où retrouver quoi ?">
        <Onglets
          idGroupe="suivi"
          onglets={[
            {
              id: 'mes-maj', label: 'Mes MAJ',
              contenu: (
                <>
                  <p>
                    Le suivi des mises à jour traitées en lot. Un rédacteur y voit <Mot>ses propres articles</Mot> ; les managers et
                    les super admins voient ceux de toute l'équipe.
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>En haut : <Ecran>Articles traités</Ecran>, <Ecran>Coût total (période)</Ecran>, <Ecran>Coût moyen / article</Ecran>, <Ecran>Relecture</Ecran>.</li>
                    <li>Les filtres : par période, par site, et par statut — <Ecran>À traiter</Ecran>, <Ecran>À relire</Ecran>, <Ecran>Publié</Ecran>, <Ecran>Erreur</Ecran>.</li>
                    <li>Sur chaque ligne à relire, le bouton <Ecran>Relire</Ecran> ouvre l'article.</li>
                    <li><Ecran>Exporter en Excel</Ecran> télécharge le détail.</li>
                  </ul>
                  <Encadre type="astuce" titre="C'est votre point de départ du matin">
                    <p>Filtrez sur « À relire » : vous voyez d'un coup d'œil ce qui vous attend.</p>
                  </Encadre>
                </>
              ),
            },
            {
              id: 'historique', label: 'Historique',
              contenu: (
                <>
                  <p>Tous les articles déjà traités restent consultables.</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Le filtre <Ecran>Par moi</Ecran> / <Ecran>Tous les membres</Ecran> (ou un membre précis), et la période : <Ecran>Aujourd'hui</Ecran>, <Ecran>7 jours</Ecran>, <Ecran>30 jours</Ecran>.</li>
                    <li>Chaque fiche indique le site, qui a traité l'article et quand.</li>
                    <li>
                      Un badge de <Mot>suivi de position</Mot> (par exemple <Ecran>En attente J+7</Ecran>) : après une mise à jour, la position de
                      l'article sur Google est relevée le jour même, 7 jours puis 30 jours plus tard, pour voir l'effet.
                    </li>
                  </ul>
                </>
              ),
            },
            {
              id: 'tickets', label: 'Tickets',
              contenu: (
                <>
                  <p>
                    Pour signaler un problème ou demander de l'aide : <Ecran>Nouveau ticket</Ecran>. Vos tickets sont dans l'onglet
                    <Ecran> Actifs</Ecran> tant qu'ils sont ouverts, puis dans <Ecran>Historique</Ecran>.
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Catégories : <Mot>Bug application</Mot>, <Mot>Problème article/MAJ</Mot>, <Mot>Problème agent IA</Mot>, <Mot>Demande amélioration</Mot>, <Mot>Autre</Mot>.</li>
                    <li>Priorités : <Mot>Urgent</Mot>, <Mot>Haute</Mot>, <Mot>Normale</Mot>, <Mot>Basse</Mot>.</li>
                  </ul>
                </>
              ),
            },
            {
              id: 'dashboard', label: 'Dashboard',
              contenu: (
                <p>
                  La page des chiffres. Elle s'adapte à votre rôle : un rédacteur y retrouve ses propres indicateurs,
                  un manager ou un super admin une vue plus large de l'équipe.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Section titre="Un bon ticket, en quatre lignes">
        <p>Plus un ticket est précis, plus il est traité vite. Indiquez :</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li><Mot>Ce que vous faisiez</Mot> (par exemple : « phase 4, je clique sur Publier »).</li>
          <li><Mot>Ce qui s'est passé</Mot>, avec le message affiché mot pour mot.</li>
          <li><Mot>Ce que vous attendiez</Mot>.</li>
          <li><Mot>L'adresse de l'article</Mot> concerné.</li>
        </ol>
        <Encadre type="info">
          <p>Choisissez la priorité <Mot>Urgent</Mot> seulement quand vous êtes bloqué et ne pouvez pas contourner le problème.</p>
        </Encadre>
      </Section>
    </>
  );
}
