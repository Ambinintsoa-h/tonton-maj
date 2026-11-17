import { Section, Encadre, Onglets, Accordeon, Quiz, Ecran, Mot } from '../ui';
import { MaquetteLot, CONSIGNE_MAX } from '../maquettes';

export default function MajEnLot() {
  return (
    <>
      <Section titre="Pourquoi un lot ?">
        <p>
          La MAJ en lot permet de lancer la mise à jour de <Mot>plusieurs articles en une seule opération</Mot>, plutôt que
          un par un. L'outil les traite seul, plusieurs à la fois, et vous prévient quand ils sont prêts à relire.
        </p>
        <Encadre type="regle" titre="Un lot ne publie jamais rien">
          <p>
            Un article « Fait » est un article <Mot>prêt à relire</Mot>. Vous le relisez et le publiez comme une MAJ seule.
          </p>
        </Encadre>
      </Section>

      <Section titre="Trois façons de constituer un lot">
        <Onglets
          idGroupe="constituer"
          onglets={[
            {
              id: 'main', label: 'À la main',
              contenu: (
                <>
                  <p>Dans <Ecran>Nouveau lot</Ecran>, deux possibilités qui se combinent :</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>coller une liste d'adresses (une par ligne), puis cliquer sur <Ecran>+ Ajouter ces URLs aux lignes ci-dessous</Ecran> ;</li>
                    <li>ou saisir chaque ligne : adresse, mot-clé cible, type de mise à jour, consigne.</li>
                  </ul>
                  <p>
                    La zone <Ecran>Consigne commune</Ecran> pré-remplit la consigne des lignes que vous ajoutez ensuite ;
                    vous pouvez la modifier ligne par ligne.
                  </p>
                </>
              ),
            },
            {
              id: 'excel', label: 'Import Excel',
              contenu: (
                <p>
                  Le bouton <Ecran>Importer un Sheet (.xlsx)</Ecran> charge le fichier exporté du tableau de suivi de la rédaction.
                  Seules les lignes dont la colonne « Validation » est remplie sont importées.
                </p>
              ),
            },
            {
              id: 'sheet', label: 'Google Sheet',
              contenu: (
                <>
                  <p>
                    L'outil vérifie toutes les 5 minutes si de nouvelles lignes ont été ajoutées au tableau partagé de la rédaction.
                    Elles apparaissent dans le bloc <Ecran>Lignes détectées depuis le Google Sheet</Ecran> ;
                    le bouton <Ecran>Synchroniser maintenant</Ecran> force la vérification.
                  </p>
                  <p>
                    Cochez les lignes voulues, puis <Ecran>Lancer la sélection</Ecran>. Rien n'est jamais lancé automatiquement.
                  </p>
                  <Encadre type="attention" titre="Pas de consigne ni de type sur ces lignes">
                    <p>
                      Les lignes venues du Google Sheet n'offrent pas de champ consigne ni de menu de type : elles se traitent
                      « selon l'audit ». Pour une consigne ou une MAJ ciblée, saisissez la ligne à la main dans <Ecran>Nouveau lot</Ecran>.
                    </p>
                  </Encadre>
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section titre="Une ligne de lot : le type et la consigne">
        <p>Chaque ligne demande une adresse, un <Mot>mot-clé cible obligatoire</Mot>, un type et, si vous voulez, une consigne. Essayez :</p>
        <MaquetteLot />
        <Accordeon
          items={[
            {
              q: 'Selon l\'audit, MAJ ciblée ou Refonte : lequel choisir ?',
              r: (
                <>
                  <p><Mot>Selon l'audit</Mot> (par défaut) : l'audit décide. En pratique il recommande presque toujours une refonte.</p>
                  <p><Mot>MAJ ciblée</Mot> : vous imposez des modifications ciblées ; la structure et le texte existants sont conservés.</p>
                  <p><Mot>Refonte</Mot> : vous imposez la réécriture complète.</p>
                  <p>Une consigne seule ne change pas l'ampleur : pour une MAJ ciblée guidée par une consigne, choisissez
                    « MAJ ciblée » <Mot>et</Mot> écrivez la consigne.</p>
                </>
              ),
            },
            {
              q: 'Que fait exactement la consigne ?',
              r: (
                <>
                  <p>Dès qu'elle est renseignée, elle devient le <Mot>fil conducteur</Mot> de la mise à jour : elle remplace les
                    directives que l'outil aurait rédigées d'après l'audit.</p>
                  <p>L'audit continue de compléter, mais seulement par le nécessaire (les données à jour). La consigne prime sur lui.</p>
                  <p>Elle est limitée à {CONSIGNE_MAX.toLocaleString('fr-FR')} caractères.</p>
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section titre="Écrire une bonne consigne">
        <p>
          Nous avons mesuré, sur des articles réels, ce que la consigne obtient et ce qu'elle n'obtient pas. Retenez cette règle :
          <Mot> décrivez la structure et le fond, pas des quantités.</Mot>
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900 mb-2">Fonctionne bien</p>
            <ul className="list-disc pl-5 text-sm text-emerald-900 space-y-1">
              <li>Un nouvel angle pour l'article (titre, introduction)</li>
              <li>Des sections à ajouter, avec leurs <Mot>titres exacts</Mot> et leur <Mot>ordre</Mot></li>
              <li>Un tableau, une liste numérotée</li>
              <li>Remplacer ou ajouter une question de FAQ</li>
              <li>Supprimer une sous-partie</li>
              <li>Des sections à conserver mot pour mot</li>
              <li>Une position précisée (« en première position »)</li>
            </ul>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900 mb-2">Ne fonctionne pas de façon fiable</p>
            <ul className="list-disc pl-5 text-sm text-amber-900 space-y-1">
              <li>Les <Mot>minima de longueur</Mot> : « 450 mots minimum » a donné environ la moitié</li>
              <li>Le <Mot>nombre d'occurrences</Mot> d'un mot : « 11 fois » a donné 6</li>
              <li>Un <Mot>TL;DR avant l'introduction</Mot> : il reste placé après</li>
            </ul>
            <p className="text-xs text-amber-800 mt-2">
              Relever la cible de 30 % n'a rien changé. Vérifiez ces points à la relecture.
            </p>
          </div>
        </div>
        <Encadre type="astuce" titre="Précisez où va chaque section existante">
          <p>
            Si vous placez une section en première position et demandez 4 nouvelles sections « juste après », une section
            d'origine peut s'intercaler entre les deux. Écrivez explicitement l'ordre voulu pour chaque section.
          </p>
        </Encadre>
        <Encadre type="info" titre="Exemple de consigne efficace">
          <p className="italic">
            « Réoriente l'article vers l'angle « choisir une toiture pour une maison ancienne ». Conserve mot pour mot la
            section « Les matériaux ». Ajoute, juste après l'introduction et dans cet ordre, deux sections H2 intitulées
            « Les contraintes d'une maison ancienne » et « Les aides financières ». Remplace la question « Quel budget
            prévoir ? » de la FAQ par « Quel budget pour une maison ancienne ? ». Supprime la sous-partie « Les
            toitures végétalisées ». »
          </p>
        </Encadre>
      </Section>

      <Section titre="Suivre le lot et relire">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Chaque article passe par les statuts <Mot>En attente</Mot>, <Mot>En cours</Mot>, puis <Mot>Fait</Mot> — ou
            <Mot> Erreur</Mot> / <Mot>À revoir</Mot>, avec le détail de ce qui a bloqué (<Ecran>Voir l'erreur</Ecran>).
            Un article dans l'un de ces deux cas se relance avec <Ecran>Relancer</Ecran>, dans un nouveau lot d'un seul
            article : le lot d'origine n'est pas touché.
          </li>
          <li>
            Sur chaque article <Mot>Fait</Mot>, le lien <Ecran>Relire</Ecran> ouvre directement l'article en relecture.
          </li>
          <li>
            Un traitement dure environ <Mot>7 minutes par article</Mot>, plusieurs articles à la fois.
          </li>
          <li>
            Un <Mot>e-mail récapitulatif</Mot> est envoyé à la personne qui a lancé le lot, avec un lien <Ecran>Relire →</Ecran> sur
            chaque article prêt.
          </li>
          <li>
            Sans e-mail, ouvrez <Ecran>Mes MAJ</Ecran>, filtrez sur <Ecran>À relire</Ecran> et cliquez sur <Ecran>Relire</Ecran>.
          </li>
        </ul>
      </Section>

      <Quiz
        questions={[
          {
            q: 'Vous voulez une vraie mise à jour ciblée, guidée par votre consigne. Que choisissez-vous ?',
            choix: [
              'Le type « Selon l\'audit » et une consigne',
              'Le type « MAJ ciblée » et une consigne',
              'Le type « Refonte » et une consigne',
            ],
            bonne: 1,
            explication: 'L\'ampleur vient du menu ; la consigne ne la décide pas.',
          },
          {
            q: 'Votre consigne dit « au moins 450 mots pour cette section ». À la relecture, que faites-vous ?',
            choix: [
              'Rien : c\'est garanti',
              'Vous comptez les mots et complétez à la main si besoin',
              'Vous relancez le lot dix fois',
            ],
            bonne: 1,
            explication: 'Les minima chiffrés ne sont pas tenus de façon fiable : vérifiez et complétez.',
          },
          {
            q: 'Un article du lot est « Fait ». Est-il en ligne ?',
            choix: ['Oui, un lot publie tout seul', 'Non : il est prêt à relire', 'Oui, mais en brouillon'],
            bonne: 1,
            explication: 'Un lot ne publie jamais rien. La relecture et la publication restent à vous.',
          },
        ]}
      />
    </>
  );
}
