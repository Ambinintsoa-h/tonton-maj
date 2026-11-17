import { Section, Encadre, Onglets, Accordeon, Ecran, Mot } from '../ui';

export default function AdminEffet() {
  return (
    <>
      <Section titre="Trois pages, trois questions">
        <Onglets
          idGroupe="effet"
          onglets={[
            {
              id: 'positions', label: 'Suivi positions',
              contenu: (
                <>
                  <p>
                    <Mot>Où se classe cet article sur Google ?</Mot> Quand un article est mis à jour, sa position est relevée à trois
                    moments : le <Mot>jour même</Mot> (J+0), <Mot>7 jours après</Mot> et <Mot>30 jours après</Mot>. Un service externe,
                    Haloscan, fournit la mesure.
                  </p>
                  <p>Dans l'Historique, un badge comme « En attente J+7 » indique la prochaine mesure à venir.</p>
                </>
              ),
            },
            {
              id: 'effet', label: 'Effet des MAJ',
              contenu: (
                <>
                  <p>
                    <Mot>Les mises à jour font-elles gagner des positions ?</Mot> La page ne liste pas les suivis : elle les agrège,
                    <Mot> une ligne par page</Mot> (adresse + mot-clé), en comparant la position avant la première MAJ à la position après
                    la dernière.
                  </p>
                  <p>
                    Elle s'interdit d'afficher un taux de réussite sans son dénominateur : le <Mot>nombre de pages comparables</Mot> est le
                    premier chiffre de l'écran.
                  </p>
                </>
              ),
            },
            {
              id: 'archives', label: 'Archives',
              contenu: (
                <p>
                  <Mot>Où sont les articles que j'ai archivés ?</Mot> Le bouton Archiver de l'Historique (super admin) retire un article
                  de la liste sans le détruire. Dans <Ecran>Archives</Ecran>, vous pouvez le <Ecran>Restaurer</Ecran> ou le
                  <Ecran> Supprimer définitivement</Ecran>.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Section titre="Lire les statuts de « Effet des MAJ »">
        <p>Chaque page porte un statut qui dit <Mot>ce qui a été mesuré</Mot> — pas ce qu'on aimerait conclure.</p>
        <Accordeon
          items={[
            {
              q: 'A progressé, A reculé, Stable',
              r: <p>La position médiane après la dernière MAJ est meilleure, moins bonne ou équivalente à celle d'avant la première.</p>,
            },
            {
              q: 'Entrée en SERP, Sortie de SERP',
              r: <p>L'article n'apparaissait pas dans les résultats et y apparaît maintenant (ou l'inverse).</p>,
            },
            {
              q: 'Trop récent',
              r: <p>La mise à jour est trop récente pour qu'un effet se mesure : revenez plus tard. Ce n'est pas un échec.</p>,
            },
            {
              q: 'Pas de position avant, Pas d\'historique Haloscan, Relevé en échec',
              r: (
                <p>
                  Il manque une mesure : l'outil n'a pas pu comparer. Ces pages ne comptent <Mot>ni comme réussites ni comme échecs</Mot> :
                  les compter comme des échecs donnerait à l'outil l'air de rater ce qu'on n'a même pas pu mesurer.
                </p>
              ),
            },
          ]}
        />
        <Encadre type="attention" titre="Une tendance, jamais un verdict">
          <p>
            Tant que le nombre de pages comparables est faible, le bilan se lit comme une <Mot>tendance</Mot>. Une position dépend de bien
            d'autres choses que la mise à jour (concurrence, saison, algorithme) : ne présentez pas ces chiffres comme la preuve que
            l'outil « marche » ou « ne marche pas ».
          </p>
        </Encadre>
      </Section>
    </>
  );
}
