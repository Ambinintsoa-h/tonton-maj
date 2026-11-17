import { Section, Encadre, Accordeon, Ecran, Mot } from '../ui';

export default function PremiersPas() {
  return (
    <>
      <Section titre="Se connecter">
        <p>
          Sur la page de connexion, saisissez votre <Mot>identifiant</Mot> et votre <Mot>mot de passe</Mot>,
          puis cliquez sur <Ecran>Se connecter</Ecran>. Si vous venez d'être invité, un e-mail vous a été envoyé
          avec un lien pour choisir votre mot de passe.
        </p>
        <p>
          Mot de passe oublié ? Le lien <Ecran>Mot de passe oublié ?</Ecran> vous envoie un e-mail de réinitialisation.
        </p>
        <Encadre type="attention" titre="Si la session expire">
          <p>
            Une bannière vous prévient quand votre session n'est plus valide. Reconnectez-vous <Mot>avant</Mot> de
            continuer à travailler : sinon votre travail risque de ne plus s'enregistrer.
          </p>
        </Encadre>
      </Section>

      <Section titre="Votre compte">
        <p>
          Cliquez sur votre nom, en haut à droite, pour ouvrir <Mot>Mon compte</Mot>. Vous pouvez y régler :
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>votre <Mot>prénom et votre nom</Mot>, affichés dans l'historique et dans le suivi de l'équipe ;</li>
          <li>une <Mot>photo de profil</Mot> (facultatif) ;</li>
          <li>la <Mot>double authentification</Mot>, fortement recommandée.</li>
        </ul>
        <Accordeon
          items={[
            {
              q: 'Double authentification : application ou e-mail ?',
              r: (
                <>
                  <p><Mot>Application d'authentification</Mot> : vous scannez un code une fois, puis l'application vous
                    donne un code à chaque connexion.</p>
                  <p><Mot>E-mail</Mot> : un code à usage unique est envoyé à votre adresse à chaque connexion.</p>
                  <p>Les deux protègent votre compte : choisissez celle que vous aurez toujours sous la main.</p>
                </>
              ),
            },
            {
              q: 'Pourquoi l\'activer ?',
              r: <p>Avec elle, un mot de passe volé ne suffit plus pour entrer dans l'outil. C'est un geste de deux minutes.</p>,
            },
          ]}
        />
      </Section>

      <Section titre="La barre du haut">
        <ul className="list-disc pl-5 space-y-2">
          <li>La <Mot>cloche</Mot> affiche vos notifications.</li>
          <li>
            Le bouton <Ecran>Vider le cache</Ecran> efface le cache du navigateur et recharge les fichiers depuis le serveur.
          </li>
        </ul>
        <Encadre type="attention" titre="Vider le cache efface vos brouillons locaux">
          <p>
            Vous restez connecté, mais les <Mot>brouillons non synchronisés</Mot> et l'<Mot>historique d'annulation (Ctrl+Z)</Mot>
            de ce navigateur sont effacés — et la progression de ce tutoriel avec eux. Ne l'utilisez jamais au milieu d'un travail
            non enregistré, et seulement si un écran se comporte bizarrement après une mise à jour de l'outil.
          </p>
        </Encadre>
      </Section>

      <Encadre type="astuce" titre="Et maintenant ?">
        <p>
          Le chapitre suivant, « Faire une MAJ, pas à pas », contient une liste « Ma première MAJ » qui se coche
          au fur et à mesure et que le navigateur retient.
        </p>
      </Encadre>
    </>
  );
}
