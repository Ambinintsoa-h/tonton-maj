import { Section, Encadre, Onglets, Accordeon, Quiz, Ecran, Mot } from '../ui';
import { MaquettePublication } from '../maquettes';

export default function RelirePublier() {
  return (
    <>
      <Section titre="Les trois vues : Audit, Avant, Après">
        <p>
          L'écran de relecture propose trois onglets. Vous passerez la plupart du temps dans <Ecran>Après</Ecran>.
        </p>
        <Onglets
          idGroupe="vues"
          onglets={[
            {
              id: 'apres', label: 'Après',
              contenu: (
                <p>
                  Le texte proposé. <Mot>Vous pouvez le modifier directement</Mot>, comme dans un éditeur de texte :
                  c'est ce texte-là, avec vos retouches, qui sera publié.
                </p>
              ),
            },
            {
              id: 'avant', label: 'Avant',
              contenu: <p>Le texte d'origine, tel qu'il est en ligne. Utile pour comparer ce que l'IA a changé.</p>,
            },
            {
              id: 'audit', label: 'Audit',
              contenu: <p>Le rapport de la phase 1. L'article réécrit dans « Après » en découle.</p>,
            },
          ]}
        />
      </Section>

      <Section titre="Corriger le texte">
        <p>Relisez comme si vous alliez signer l'article. Vérifiez en priorité :</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>les <Mot>chiffres, dates et prix</Mot> : ils doivent être justes et, si possible, sourcés ;</li>
          <li>les <Mot>affirmations</Mot> que vous ne pouvez pas confirmer : retirez-les ou passez-les au conditionnel ;</li>
          <li>le <Mot>sens général</Mot> : l'article répond-il toujours au mot-clé cible ?</li>
        </ul>
        <Encadre type="info" titre="Une phrase surlignée en jaune">
          <p>
            Quand l'outil doit placer un lien interne que le texte ne permettait pas de placer, il écrit lui-même une
            courte phrase du type « À lire aussi : … » et la surligne en jaune. C'est à vous de la relire et de la
            reformuler. Le surlignage disparaît à la publication ; le lien, lui, reste.
          </p>
        </Encadre>
      </Section>

      <Section titre="Régler le titre">
        <p>
          Le champ <Ecran>Titre</Ecran> se trouve au-dessus de l'image à la une. Il est important de comprendre une règle :
        </p>
        <Encadre type="regle" titre="Le titre n'est envoyé que si vous l'avez modifié">
          <p>
            Si vous ne touchez pas au champ, le titre actuel du site est conservé. Pour changer le titre sur le site,
            modifiez le champ avant de publier. Essayez avec la maquette :
          </p>
        </Encadre>
        <MaquettePublication />
      </Section>

      <Section titre="Image, SEO, catégories, date">
        <Accordeon
          items={[
            {
              q: 'Image à la une',
              r: <p>La barre « Image à la une » permet de la remplacer. Si vous n'y touchez pas, l'image actuelle du site est conservée.</p>,
            },
            {
              q: 'Titre SEO et méta-description',
              r: <p>Ces deux champs sont préparés pour vous à partir de l'article. Relisez-les : ce sont les textes qui apparaissent dans les résultats Google.</p>,
            },
            {
              q: 'Catégories : n\'y touchez pas sans raison',
              r: (
                <>
                  <p>Les catégories ne sont envoyées au site que si <Mot>vous</Mot> les modifiez.</p>
                  <p>Attention : sur beaucoup de sites, la catégorie fait partie de l'adresse de l'article. En changer peut
                    donc changer l'adresse — et l'ancienne répondrait alors « page introuvable ».</p>
                </>
              ),
            },
            {
              q: 'Date de publication',
              r: (
                <p>
                  Le champ est pré-rempli deux jours avant la date du jour. Vous pouvez le modifier ou l'effacer :
                  s'il est vide, le site garde la date existante de l'article.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Section titre="Publier">
        <p>
          Le bouton <Ecran>Publier</Ecran> n'apparaît <Mot>qu'en phase 4</Mot>. Il ouvre un menu qui ne propose que le site
          de l'article. Si un collègue l'a déjà publié, une étiquette <Ecran>Déjà publié</Ecran> vous prévient avant que
          vous ne cliquiez : republier pour mettre à jour reste normal, mais autant le savoir.
        </p>
        <Encadre type="info" titre="Deux fenêtres de confirmation peuvent s'ouvrir">
          <p><Mot>« Factuel écarté en phase 2 »</Mot> : vous aviez décoché les passages à retirer ou à sourcer. L'article part sans
            qu'ils aient été traités. Annulez pour les recocher, ou publiez en connaissance de cause.</p>
          <p><Mot>« Maillage rédigé par le code »</Mot> : l'outil a écrit des phrases pour placer des liens, et vous ne les avez pas relues.
            Annulez pour les voir en jaune et les reformuler.</p>
        </Encadre>
        <p>
          Après la publication, la page s'ouvre dans un nouvel onglet pour que vous vérifiiez le résultat.
          Le bouton <Ecran>Terminer</Ecran> range l'article dans l'<Ecran>Historique</Ecran>.
        </p>
      </Section>

      <Section titre="Ce que l'outil fait à votre place">
        <ul className="list-disc pl-5 space-y-1">
          <li>Il n'ajoute et ne retire <Mot>jamais de lien externe</Mot> ; les liens externes sont publiés en « nofollow », les liens internes en « dofollow ».</li>
          <li>La <Mot>FAQ</Mot> est toujours replacée à la fin de l'article.</li>
          <li>Toutes les paires <Mot>ancre + adresse</Mot> de la phase 2 sont placées dans le texte.</li>
          <li>Les phrases sont limitées à 20 mots : c'est visé et mesuré, pas garanti à 100 %.</li>
        </ul>
      </Section>

      <Quiz
        questions={[
          {
            q: 'Vous voulez changer le titre de l\'article sur le site. Que faites-vous ?',
            choix: [
              'Rien : l\'IA choisit le meilleur titre',
              'Vous modifiez le champ Titre avant de publier',
              'Vous le changez après, directement dans WordPress uniquement',
            ],
            bonne: 1,
            explication: 'Le titre n\'est envoyé au site que si vous l\'avez modifié dans le champ.',
          },
          {
            q: 'Vous changez la catégorie « pour ranger ». Quel risque ?',
            choix: [
              'Aucun',
              'L\'adresse de l\'article peut changer, et l\'ancienne répondre « page introuvable »',
              'L\'article est supprimé',
            ],
            bonne: 1,
            explication: 'Sur beaucoup de sites, la catégorie fait partie de l\'adresse. Ne la modifiez que si on vous le demande.',
          },
          {
            q: 'Une phrase « À lire aussi » est surlignée en jaune. Que signifie-t-elle ?',
            choix: [
              'Elle a été écrite par l\'outil pour placer un lien : à relire et reformuler',
              'Elle est fausse et sera supprimée',
              'Elle est déjà validée',
            ],
            bonne: 0,
            explication: 'Le surlignage disparaît à la publication, le lien reste : relisez la phrase avant.',
          },
        ]}
      />
    </>
  );
}
