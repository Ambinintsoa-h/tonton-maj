import { Section, Encadre, Etapes, Ecran, Mot } from '../ui';

export default function AdminWordpress() {
  return (
    <>
      <Section titre="Pourquoi connecter un site">
        <p>
          La page <Ecran>WordPress</Ecran> sert à gérer les sites pour la <Mot>publication directe</Mot>. Un site connecté permet
          à un rédacteur de cliquer sur <Ecran>Publier</Ecran> en phase 4. L'outil reconnaît le site d'un article par son nom de
          domaine : l'article n'est proposé qu'à son propre site.
        </p>
        <Encadre type="info">
          <p>Si un rédacteur ne voit pas le bouton Publier en phase 4, la cause la plus probable est un site non connecté.</p>
        </Encadre>
      </Section>

      <Section titre="Ajouter un site, en 4 étapes">
        <Etapes
          idGroupe="wp"
          etapes={[
            {
              titre: 'Créer le mot de passe',
              sousTitre: 'Dans WordPress',
              corps: (
                <>
                  <p>Dans l'administration du site : <Mot>Utilisateurs → Profil → Mots de passe d'application</Mot>. Donnez-lui un nom
                    (par exemple « Tonton AI ») et copiez le mot de passe affiché, de la forme <code>xxxx xxxx xxxx xxxx</code>.</p>
                  <p>Utilisez un compte autorisé à modifier les articles.</p>
                </>
              ),
            },
            {
              titre: 'Ouvrir le formulaire',
              sousTitre: 'Dans Tonton AI',
              corps: <p>Page <Ecran>WordPress</Ecran>, puis <Ecran>Ajouter un site</Ecran>.</p>,
            },
            {
              titre: 'Remplir',
              sousTitre: 'Quatre champs',
              corps: (
                <ul className="list-disc pl-5 space-y-1">
                  <li><Mot>Nom du site</Mot> : le nom affiché dans l'outil.</li>
                  <li><Mot>URL</Mot> : l'adresse du site, avec le https://.</li>
                  <li><Mot>Identifiant</Mot> : celui du compte WordPress.</li>
                  <li><Mot>Mot de passe d'application</Mot> : celui de l'étape 1 — pas le mot de passe de connexion du compte.</li>
                </ul>
              ),
            },
            {
              titre: 'Vérifier',
              sousTitre: 'Avant de prévenir l\'équipe',
              corps: (
                <p>
                  Demandez à un rédacteur d'arriver en phase 4 sur un article de ce site : le bouton <Ecran>Publier</Ecran> doit
                  proposer le site. Ne publiez pas un article réel juste pour tester.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Encadre type="attention" titre="Un mot de passe d'application est un secret">
        <p>
          Il donne un accès en écriture au site. Ne le partagez pas par message, et révoquez-le dans WordPress si vous soupçonnez
          qu'il a fuité : l'outil cessera simplement de publier sur ce site jusqu'à ce que vous en saisissiez un nouveau.
        </p>
      </Encadre>
    </>
  );
}
