import { Section, Encadre, Onglets, Accordeon, Quiz, Ecran, Mot, Capture } from '../ui';
import { CONSIGNE_MAX } from '../maquettes';

const GABARIT = `OBJECTIF : réorienter l'article vers les particuliers qui isolent en 2026.
AJOUTER : un H2 « Aides disponibles en 2026 » (environ 200 mots)
          avec les montants et la source.
CONSERVER : le tableau comparatif et la FAQ telle quelle.
À ÉVITER : les promesses de gain exact, aucun chiffre non sourcé.`;

const EXEMPLE_CIBLEE = `REMPLACER : le montant de la prime dans le 2e H2
  par 3 000 € (source : service-public.fr).
CONSERVER : tout le reste de l'article tel quel.
ÉVITER : de modifier le titre et la FAQ.`;

const EXEMPLE_REFONTE = `OBJECTIF : passer d'un angle « présentation »
  à un angle « comparatif pour acheter ».
AJOUTER : un H2 « Comment choisir » et un H2
  « Erreurs fréquentes ».
CONSERVER : les chiffres sourcés et les liens.
TON : factuel, vouvoiement.`;

const Code = ({ children }) => (
  <pre className="my-2 rounded-xl bg-gray-900 text-gray-100 text-[12.5px] leading-relaxed p-3 overflow-x-auto whitespace-pre-wrap">{children}</pre>
);

export default function ConsigneMaj() {
  const max = CONSIGNE_MAX.toLocaleString('fr-FR');
  return (
    <>
      <Section titre="Une consigne, à quoi ça sert ?">
        <p>
          Une <Mot>consigne</Mot> est une instruction libre qui dit à l'IA ce que vous attendez de <Mot>cet</Mot> article :
          un nouvel angle, une section à ajouter, un passage à garder tel quel. Sans consigne, l'outil suit ce que l'audit
          recommande.
        </p>
        <p>
          Où la saisir dépend de la façon dont vous lancez la MAJ. Les captures ci-dessous montrent l'écran réel.
        </p>
      </Section>

      <Section titre="Où saisir la consigne ?">
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Je veux…</th>
                <th className="text-left px-3 py-2">Où</th>
                <th className="text-left px-3 py-2">Consigne</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr><td className="px-3 py-2">Mettre à jour <Mot>un article</Mot></td><td className="px-3 py-2"><Ecran>Faire une MAJ</Ecran>, phase 2</td><td className="px-3 py-2"><Mot>Oui</Mot> : « Directives envoyées à TONTON »</td></tr>
              <tr><td className="px-3 py-2">Reprendre un article de la file</td><td className="px-3 py-2"><Ecran>Mes MAJ</Ecran>, puis phase 2</td><td className="px-3 py-2"><Mot>Oui</Mot> : même écran</td></tr>
              <tr><td className="px-3 py-2">Plusieurs articles d'un coup</td><td className="px-3 py-2"><Ecran>MAJ en lot</Ecran></td><td className="px-3 py-2"><Mot>Oui</Mot> : par ligne, ou commune</td></tr>
              <tr><td className="px-3 py-2">Un fichier Excel importé</td><td className="px-3 py-2"><Ecran>Importer un Sheet (.xlsx)</Ecran></td><td className="px-3 py-2">À saisir <Mot>après l'import</Mot>, ligne par ligne</td></tr>
              <tr><td className="px-3 py-2">Les lignes du Google Sheet de suivi</td><td className="px-3 py-2"><Ecran>Lignes détectées</Ecran></td><td className="px-3 py-2"><Mot>Non</Mot> : pas de champ consigne</td></tr>
              <tr><td className="px-3 py-2">Retoucher <Mot>un passage</Mot></td><td className="px-3 py-2"><Ecran>Après</Ecran>, bouton Réécrire</td><td className="px-3 py-2"><Mot>Oui</Mot> : « Consigne supplémentaire »</td></tr>
            </tbody>
          </table>
        </div>
        <Encadre type="info" titre="Le rôle support">
          <p>Le menu <Ecran>MAJ en lot</Ecran> n'existe pas pour le rôle support : les parties « lot » ne le concernent pas.</p>
        </Encadre>
      </Section>

      <Section titre="Un article : les directives de la phase 2">
        <p>
          C'est l'écran que <Mot>tous</Mot> les articles traversent avant la génération, que vous veniez de{' '}
          <Ecran>Faire une MAJ</Ecran> ou de <Ecran>Mes MAJ</Ecran>.
        </p>
        <Capture
          fichier="consigne-phase2.jpg"
          alt="Phase 2 : à gauche les cases de l'audit, à droite le champ Directives envoyées à TONTON"
          legende="Phase 2 d'une refonte. Le contenu des cases de l'audit est volontairement flouté."
          pastilles={[
            { n: 1, x: 24.5, y: 27.7 },
            { n: 2, x: 94, y: 34.5 },
            { n: 3, x: 75.5, y: 31.5 },
            { n: 4, x: 89.5, y: 70.9 },
          ]}
        />
        <ol className="list-decimal pl-5 space-y-2">
          <li><Mot>Les cases de l'audit.</Mot> Décochez ce que vous ne voulez pas transmettre à l'IA : ce qui est décoché ne part nulle part.</li>
          <li><Mot>« Directives envoyées à TONTON »</Mot> : le champ de la consigne. Il est pré-rempli et entièrement modifiable.</li>
          <li><Ecran>Enregistrer comme mon modèle</Ecran> garde vos directives permanentes pour vos prochains articles ; <Ecran>Reconstruire</Ecran> remet le pré-remplissage.</li>
          <li><Mot>Le compteur</Mot> : le plafond est de {max} caractères.</li>
        </ol>
        <Encadre type="attention" titre="Mettez l'essentiel en premier">
          <p>
            Au-delà de {max} caractères, le texte est <Mot>coupé par la fin</Mot>. Votre consigne
            propre va en tête, avant les blocs repris de l'audit.
          </p>
        </Encadre>
        <Encadre type="astuce" titre="En MAJ simple, peu de cases">
          <p>
            Une MAJ simple ajoute environ 200 mots, soit une section sourcée. L'outil ne pré-coche donc que le contexte récent :
            trente consignes n'y tiennent pas.
          </p>
        </Encadre>
      </Section>

      <Section titre="Un lot : la consigne de ligne">
        <p>
          Dans <Ecran>Nouveau lot</Ecran>, chaque ligne a son menu de type et son champ consigne. La
          <Mot> consigne commune</Mot> pré-remplit les nouvelles lignes : remplissez-la <Mot>avant</Mot> d'ajouter les adresses.
        </p>
        <Capture
          fichier="consigne-lot.jpg"
          alt="Page MAJ en lot : liste d'adresses, consigne commune, deux lignes avec type et consigne"
          legende="Deux lignes d'exemple (adresses fictives). Rien n'est lancé tant que vous ne cliquez pas sur Lancer le lot."
          pastilles={[
            { n: 1, x: 25.6, y: 30 },
            { n: 2, x: 93.5, y: 30 },
            { n: 3, x: 59.8, y: 48.1 },
            { n: 4, x: 90.3, y: 48.1 },
            { n: 5, x: 93.5, y: 63.7 },
          ]}
        />
        <ol className="list-decimal pl-5 space-y-2">
          <li>La liste d'adresses, une par ligne, puis <Ecran>+ Ajouter ces URLs aux lignes ci-dessous</Ecran>.</li>
          <li>La <Mot>consigne commune</Mot>, qui ne remplace jamais une consigne déjà saisie sur une ligne.</li>
          <li>Le <Mot>type</Mot> de la ligne : Selon l'audit, MAJ ciblée ou Refonte.</li>
          <li>La <Mot>consigne de la ligne</Mot>, modifiable à tout moment.</li>
          <li><Ecran>Lancer le lot</Ecran> : rien n'est publié, chaque article attend votre relecture.</li>
        </ol>
        <p>
          Le détail des types et du suivi d'un lot est dans le chapitre <Mot>La MAJ en lot</Mot>. Ce qu'il faut retenir ici :
          dès qu'une consigne est saisie, elle devient le <Mot>fil conducteur</Mot> et l'audit ne complète que le nécessaire.
        </p>
      </Section>

      <Section titre="Un passage : la consigne supplémentaire">
        <p>
          Dans l'onglet <Ecran>Après — article réécrit</Ecran>, sélectionnez un passage : une barre d'outils apparaît.
        </p>
        <Capture
          fichier="consigne-reecrire-barre.jpg"
          alt="Barre d'outils avec le bouton Réécrire sur un paragraphe sélectionné"
          legende="Le texte de l'article est volontairement flouté."
          pastilles={[{ n: 1, x: 9.75, y: 59.5 }]}
        />
        <Capture
          fichier="consigne-reecrire-fenetre.jpg"
          alt="Fenêtre Réécrire la phrase : styles de réécriture et consigne supplémentaire"
          legende="Rien n'est remplacé tant que vous ne validez pas."
          pastilles={[{ n: 2, x: 21.5, y: 54.7 }, { n: 3, x: 78, y: 59.5 }]}
        />
        <ol className="list-decimal pl-5 space-y-2">
          <li>Cliquez sur <Ecran>Réécrire</Ecran> dans la barre d'outils.</li>
          <li>Choisissez un <Mot>style</Mot> : Fluidifier, Ton humain (anti-IA), Raccourcir (~30 %), Simplifier.</li>
          <li>Ajoutez, si besoin, une <Mot>consigne supplémentaire</Mot> : elle s'ajoute au style. Vos dernières consignes sont mémorisées.</li>
        </ol>
        <p>
          La proposition s'insère comme une modification à <Mot>accepter ✓ ou rejeter ✗</Mot>. Si elle faisait perdre ou modifier
          un lien, elle est refusée : reformulez alors votre consigne.
        </p>
      </Section>

      <Section titre="Bien structurer une consigne">
        <p>Une bonne consigne est <Mot>courte, découpée en lignes et vérifiable</Mot>. Un modèle qui marche :</p>
        <Code>{GABARIT}</Code>
        <ol className="list-decimal pl-5 space-y-2">
          <li><Mot>Une directive par ligne</Mot>, qui commence par un verbe : AJOUTER, CONSERVER, REMPLACER, ÉVITER.</li>
          <li><Mot>L'essentiel en premier</Mot> : la coupure se fait par la fin.</li>
          <li><Mot>Donnez vous-même les faits</Mot> à intégrer, avec leur source. Quand on laisse un trou à l'IA, elle peut le combler par un fait inventé.</li>
          <li><Mot>Dites ce qu'il faut garder</Mot> autant que ce qu'il faut changer, sinon une refonte réécrit tout.</li>
          <li><Mot>Accordez le type et la consigne</Mot> : retouche limitée, « MAJ ciblée » ; changement d'angle, « Refonte ».</li>
        </ol>
        <Onglets
          idGroupe="exemples-consigne"
          onglets={[
            { id: 'cible', label: 'MAJ ciblée', contenu: (<><p>Mettre un chiffre à jour, sans toucher au reste :</p><Code>{EXEMPLE_CIBLEE}</Code></>) },
            { id: 'refonte', label: 'Refonte', contenu: (<><p>Changer l'angle de l'article :</p><Code>{EXEMPLE_REFONTE}</Code></>) },
          ]}
        />
        <Accordeon
          items={[
            {
              q: 'Ce que la consigne obtient, et ce qu\'elle n\'obtient pas',
              r: (
                <>
                  <p>Sur un essai réel avec 13 directives détaillées, 8 ont été appliquées exactement et 74 % du contenu d'origine a été conservé.</p>
                  <p><Mot>Fiable :</Mot> l'angle, les sections à ajouter, le ton, ce qu'il faut conserver.</p>
                  <p><Mot>Pas fiable :</Mot> les minima chiffrés (« 450 mots » a donné 237 ; « 11 fois » a donné 6) et un TL;DR demandé « tout en haut », qui reste après l'introduction. Vérifiez ces points à la relecture.</p>
                </>
              ),
            },
            {
              q: 'Ce qu\'il est inutile de demander',
              r: (
                <>
                  <p>Le code l'applique déjà, quoi que dise la consigne :</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>phrases de 20 mots au maximum ;</li>
                    <li>gras sur les termes qui portent le sens ;</li>
                    <li>aucun lien externe ajouté ou retiré, et les liens externes en nofollow ;</li>
                    <li>les liens internes se saisissent dans le bloc dédié de la phase 2, pas dans la consigne.</li>
                  </ul>
                </>
              ),
            },
          ]}
        />
      </Section>

      <Quiz
        questions={[
          {
            q: 'Votre consigne fait 3 200 caractères. Que devient la fin ?',
            choix: ['Elle est lue normalement', 'Elle est coupée', 'L\'outil refuse de lancer'],
            bonne: 1,
            explication: 'Le plafond est de 2 500 caractères et la coupure se fait par la fin : l\'essentiel va en premier.',
          },
          {
            q: 'Vous avez saisi la consigne commune d\'un lot, puis modifié la consigne d\'une ligne. Que se passe-t-il si vous ajoutez de nouvelles adresses ?',
            choix: [
              'La consigne commune écrase celle de la ligne modifiée',
              'Seules les nouvelles lignes reprennent la consigne commune',
              'Toutes les lignes sont vidées',
            ],
            bonne: 1,
            explication: 'La consigne commune pré-remplit les nouvelles lignes et ne réécrit jamais une consigne déjà saisie.',
          },
          {
            q: 'Vous voulez un tableau sourcé dans la section 2. Que faites-vous ?',
            choix: [
              'Vous donnez les chiffres et leur source dans la consigne',
              'Vous écrivez « trouve des chiffres »',
              'Vous demandez 11 fois le mot « tableau »',
            ],
            bonne: 0,
            explication: 'Fournir les faits évite que l\'IA comble le vide par un fait inventé ; les quantités, elles, ne sont pas tenues de façon fiable.',
          },
        ]}
      />
    </>
  );
}
