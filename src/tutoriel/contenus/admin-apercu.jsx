import { Section, Encadre, Ecran, Mot } from '../ui';
import { MaquetteMenu, ENTREES_MENU } from '../maquettes';

// Ce que fait chaque page d'admin. Le « qui y accède » vient de ENTREES_MENU
// (miroir de la barre latérale) : on ne le réécrit pas ici, il ne peut donc pas diverger.
const PAGES = [
  { label: 'Équipe', fait: 'Inviter des membres, choisir leur rôle, suivre l\'activité.' },
  { label: 'Skills IA', fait: 'Régler les règles rédactionnelles que suit l\'IA.' },
  { label: 'WordPress', fait: 'Connecter les sites pour permettre la publication directe.' },
  { label: 'Commentaires', fait: 'Page en bêta.' },
  { label: 'Archives', fait: 'Restaurer ou supprimer définitivement les articles archivés.' },
  { label: 'Suivi positions', fait: 'Suivre la position Google des articles mis à jour.' },
  { label: 'Effet des MAJ', fait: 'Mesurer, page par page, si les mises à jour font gagner des positions.' },
  { label: 'Budget API', fait: 'Suivre le budget de l\'API d\'IA et recevoir une alerte quand il baisse.' },
];

const NOMS_ROLES = {
  super_admin: 'Super admin', manager: 'Manager', support: 'Support', cq_ia: 'Rédacteur',
};

const accesPour = (label) => {
  const e = ENTREES_MENU.find((x) => x.label === label);
  if (!e || e.roles === null) return 'Tous les rôles';
  return e.roles.map((r) => NOMS_ROLES[r] || r).join(', ');
};

export default function AdminApercu() {
  return (
    <>
      <Section titre="Ce que votre rôle ouvre en plus">
        <p>
          En tant que manager ou super admin, votre menu contient des pages que les rédacteurs ne voient pas. Comparez
          avec la maquette, en changeant de rôle :
        </p>
        <MaquetteMenu
          roleInitial="manager"
          surligner={['Équipe', 'Skills IA', 'WordPress', 'Commentaires', 'Archives', 'Suivi positions', 'Effet des MAJ', 'Budget API', 'Tutoriel admin']}
        />
      </Section>

      <Section titre="À quoi sert chaque page">
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-200">
                <th className="px-4 py-2 font-medium">Page</th>
                <th className="px-4 py-2 font-medium">Ce qu'on y fait</th>
                <th className="px-4 py-2 font-medium">Accès</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PAGES.map((p) => (
                <tr key={p.label}>
                  <td className="px-4 py-2.5"><Ecran>{p.label}</Ecran></td>
                  <td className="px-4 py-2.5 text-gray-700">{p.fait}</td>
                  <td className="px-4 py-2.5 text-gray-500">{accesPour(p.label)}</td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2.5"><Ecran>Paramètres</Ecran></td>
                <td className="px-4 py-2.5 text-gray-700">Les clés des services, le modèle d'IA par étape, l'envoi d'e-mails, le traitement en lot.</td>
                <td className="px-4 py-2.5 text-gray-500">Super admin (bas de la barre latérale)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Encadre type="info" titre="Un rôle qui n'a pas la page ne la voit pas">
          <p>
            Ce tableau suit la barre latérale. Si une page manque dans votre menu, c'est que votre rôle n'y donne pas accès,
            pas qu'il y a une panne.
          </p>
        </Encadre>
      </Section>

      <Encadre type="astuce" titre="Gardez le tutoriel rédacteur en tête">
        <p>
          Vos rédacteurs s'appuient sur l'autre menu, <Mot>Tutoriel</Mot>. Le connaître vous permet de répondre à leurs
          questions sans chercher.
        </p>
      </Encadre>
    </>
  );
}
