import { Section, Encadre, Accordeon, Ecran, Mot } from '../ui';

export default function Depannage() {
  return (
    <>
      <Section titre="Les problèmes les plus courants">
        <p>Cliquez sur une question pour voir la réponse.</p>
        <Accordeon
          items={[
            {
              q: 'L\'outil annonce que la page n\'existe plus (404), mais je la vois',
              r: (
                <>
                  <p>Le site bloque probablement la lecture automatique de ses pages : c'est fréquent avec les sites protégés contre les robots.</p>
                  <p>Dans <Ecran>Faire une MAJ</Ecran>, ouvrez l'onglet <Ecran>Copier-coller</Ecran>, collez le texte de l'article
                    et relancez. Si ce site pose problème à chaque fois, ouvrez un ticket avec son adresse.</p>
                </>
              ),
            },
            {
              q: 'J\'ai changé le titre mais il n\'a pas changé sur le site',
              r: (
                <>
                  <p>Le titre n'est envoyé au site que si le champ <Ecran>Titre</Ecran> a été modifié avant la publication.</p>
                  <p>Vérifiez d'abord que le champ contient bien le titre voulu, republiez, puis ouvrez la page avec un
                    rechargement forcé (Ctrl + F5) : le cache du site peut afficher l'ancienne version quelques minutes.
                    Si l'ancien titre est toujours là, ouvrez un ticket « Problème article/MAJ » avec l'adresse de l'article.</p>
                </>
              ),
            },
            {
              q: 'Je ne trouve plus mon article',
              r: (
                <>
                  <p>Dans <Ecran>Historique</Ecran>, vérifiez que le filtre est sur <Ecran>Par moi</Ecran> et élargissez la période
                    (<Ecran>30 jours</Ecran>). Pour un article traité en lot, <Ecran>Mes MAJ</Ecran> affiche son statut.</p>
                </>
              ),
            },
            {
              q: 'Le bouton Publier n\'apparaît pas',
              r: (
                <>
                  <p>Il n'apparaît <Mot>qu'en phase 4</Mot> (Relecture) : c'est voulu, pour qu'on ne puisse pas publier un article
                    non relu. Terminez d'abord les phases précédentes.</p>
                  <p>S'il manque aussi en phase 4, le site n'est peut-être pas encore connecté à l'outil : demandez à un manager.</p>
                </>
              ),
            },
            {
              q: 'Un article de mon lot est en « Erreur » ou « À revoir »',
              r: (
                <>
                  <p>Cliquez sur <Ecran>Voir l'erreur</Ecran> pour lire ce qui a bloqué — souvent un site injoignable à ce moment-là.
                    Puis <Ecran>Relancer</Ecran> : l'article repart dans un nouveau lot d'un seul article.</p>
                  <p>Si l'erreur revient, ouvrez un ticket avec le message affiché.</p>
                </>
              ),
            },
            {
              q: 'Mon travail ne s\'enregistre plus / je suis déconnecté',
              r: (
                <p>
                  Votre session a expiré. Reconnectez-vous avant de continuer : tant que la bannière d'avertissement est affichée,
                  vos modifications risquent de ne pas être enregistrées.
                </p>
              ),
            },
            {
              q: 'Un écran se comporte bizarrement après une mise à jour de l\'outil',
              r: (
                <>
                  <p>Essayez d'abord de recharger la page. Si cela ne suffit pas, le bouton <Ecran>Vider le cache</Ecran> recharge
                    les fichiers depuis le serveur.</p>
                  <p>Attention : vous restez connecté, mais les brouillons non synchronisés et l'historique d'annulation (Ctrl+Z)
                    de ce navigateur sont effacés. Terminez ou enregistrez votre travail avant.</p>
                </>
              ),
            },
            {
              q: 'L\'IA a écrit quelque chose que je ne peux pas vérifier',
              r: (
                <p>
                  Ne le publiez pas tel quel. Retirez-le, ou passez-le au conditionnel. L'outil vous aide à repérer ces points
                  (affirmations « non confirmées » ou « à sourcer » dans l'audit), mais c'est vous qui avez le dernier mot.
                </p>
              ),
            },
            {
              q: 'Combien coûte un article ?',
              r: (
                <p>
                  Environ 0,5 $ par article en moyenne (mesuré en novembre 2026). Dans <Ecran>Mes MAJ</Ecran>, vous voyez le coût
                  de vos propres articles.
                </p>
              ),
            },
          ]}
        />
      </Section>

      <Encadre type="astuce" titre="Dans le doute, un ticket">
        <p>
          Rien ne vous oblige à deviner. <Ecran>Tickets</Ecran> → <Ecran>Nouveau ticket</Ecran>, avec ce que vous faisiez, ce qui
          s'est passé et l'adresse de l'article : c'est la voie la plus rapide.
        </p>
      </Encadre>
    </>
  );
}
