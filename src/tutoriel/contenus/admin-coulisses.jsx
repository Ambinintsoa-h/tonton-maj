import { Section, Encadre, Quiz, Ecran, Mot } from '../ui';
import { MaquetteCalculateur, COUT_MOYEN_USD, MINUTES_PAR_ARTICLE } from '../maquettes';

const SERVICES = [
  { nom: 'Claude (Anthropic)', role: 'Le « cerveau » : il lit les articles, comprend le contenu, cherche ce qui doit changer et rédige le nouveau texte.' },
  { nom: 'Brave Search et Tavily', role: 'Deux moteurs de recherche utilisés en parallèle pour trouver des informations récentes avant d\'écrire la mise à jour.' },
  { nom: 'WordPress', role: 'Le système qui héberge nos sites : c\'est là que l\'article final est publié, une fois relu.' },
  { nom: 'Haloscan', role: 'Mesure la position d\'un article dans les résultats Google (J+0, J+7, J+30).' },
  { nom: 'Google Sheets', role: 'Pour la MAJ en lot : la rédaction y liste les articles, l\'outil détecte les nouvelles lignes.' },
  { nom: 'Groq', role: 'Convertit un enregistrement vocal en texte.' },
  { nom: 'E-mail', role: 'Notifications automatiques : invitations, fin de lot, alerte de budget.' },
];

export default function AdminCoulisses() {
  const cout = COUT_MOYEN_USD.toString().replace('.', ',');
  return (
    <>
      <Section titre="Les services que l'outil utilise">
        <p>
          Tonton AI ne fait rien seul : il s'appuie sur plusieurs services extérieurs, chacun avec un rôle précis. Les clés
          d'accès sont saisies une seule fois par un super admin, dans <Ecran>Paramètres</Ecran> ; personne d'autre n'a à s'en soucier.
        </p>
        <dl className="grid gap-2 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <div key={s.nom} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
              <dt className="text-sm font-semibold text-gray-900">{s.nom}</dt>
              <dd className="text-xs text-gray-600 mt-0.5 leading-relaxed">{s.role}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section titre="Ce que ça coûte">
        <p>
          Le coût réel, en dollars, dépensé auprès du service d'IA est suivi automatiquement à chaque étape et à chaque article. Sur
          les articles traités en novembre 2026, la moyenne observée est d'<Mot>environ {cout} $ par article</Mot>, pour
          <Mot> {MINUTES_PAR_ARTICLE} minutes</Mot> de traitement machine (recherche web, rédaction et vérification, hors relecture humaine).
        </p>
        <MaquetteCalculateur />
        <Encadre type="info" titre="Un ordre de grandeur, pas un devis">
          <p>
            Le coût varie avec la longueur de l'article et le nombre de mises à jour nécessaires. Pour le chiffre exact, la page
            <Ecran> Budget API</Ecran> et la page <Ecran>Mes MAJ</Ecran> font foi.
          </p>
        </Encadre>
      </Section>

      <Section titre="Ce qui se mesure, ce qui ne se mesure pas">
        <p>
          <Mot>Le coût</Mot> est un chiffre exact, visible à plusieurs endroits. <Mot>Le gain</Mot>, lui, n'est pas calculé automatiquement :
          il n'y a pas de « retour sur investissement » chiffré. Il se lit en croisant le coût avec trois indices :
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><Mot>Le temps gagné</Mot> : une mise à jour qui prenait une à plusieurs heures de travail manuel se fait en quelques minutes de relecture.</li>
          <li><Mot>Le volume traité</Mot> : la MAJ en lot met à jour plusieurs dizaines d'articles en une seule opération, ce qui serait impossible à la main.</li>
          <li><Mot>L'évolution du positionnement</Mot> : le suivi Haloscan donne une indication indirecte de l'impact sur la visibilité.</li>
        </ul>
        <Encadre type="regle" titre="Une personne relit toujours avant publication">
          <p>
            C'est ce qui permet de traiter beaucoup d'articles sans perdre le contrôle : l'automatisation fait la recherche et la
            rédaction, jamais la décision de publier.
          </p>
        </Encadre>
      </Section>

      <Quiz
        questions={[
          {
            q: 'On vous demande combien coûterait la mise à jour de 200 articles. Que répondez-vous ?',
            choix: [
              'Un montant précis, au centime',
              'Un ordre de grandeur issu de la moyenne mesurée, en précisant qu\'il varie avec la longueur des articles',
              'Qu\'on ne peut pas le savoir',
            ],
            bonne: 1,
            explication: 'La moyenne mesurée donne un ordre de grandeur honnête. Le coût réel dépend de chaque article.',
          },
          {
            q: 'L\'outil affiche-t-il un retour sur investissement chiffré ?',
            choix: ['Oui, sur le Dashboard', 'Non : le gain se déduit du temps gagné, du volume et des positions'],
            bonne: 1,
            explication: 'Seul le coût est un chiffre exact et automatique.',
          },
        ]}
      />
    </>
  );
}
