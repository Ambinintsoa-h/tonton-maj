/**
 * SessionExpiredBanner — « votre session a expiré », dit une fois et clairement.
 *
 * Décision d'Andrianina, 19 août 2026 : un bandeau, PAS une redirection.
 *
 * Ce que ça remplace, et pourquoi c'est mieux :
 *   • avant, `axios` redirigeait vers /login sans prévenir — au milieu d'une
 *     génération, l'appel payé et plusieurs minutes de travail étaient perdus ;
 *   • la couche `fetch` de `/api/data`, elle, ne faisait rien du tout : l'écran
 *     affichait « Aucun skill cerveau (SKILL.md) actif » et refusait de lancer
 *     l'analyse, alors que le skill était bien en base. Un message FAUX, qui
 *     envoyait chercher le problème là où il n'était pas.
 *
 * Le bandeau ne bloque pas l'écran : le rédacteur peut finir de lire, copier un
 * passage, puis reconnecter quand il le décide. C'est tout l'intérêt du choix.
 *
 * Il est VOLONTAIREMENT insistant — fixé en haut, au-dessus de tout (z-index le
 * plus élevé de l'application) : un travail qui ne s'enregistre plus est un
 * problème qu'on ne doit pas pouvoir manquer.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, LogIn } from 'lucide-react';
import { onSessionExpired, resetSessionExpiry } from '../services/sessionExpiry';

export default function SessionExpiredBanner() {
  const [expiree, setExpiree] = useState(false);

  useEffect(() => onSessionExpired(() => setExpiree(true)), []);

  if (!expiree) return null;

  const reconnecter = () => {
    resetSessionExpiry();
    // `replace` et non `assign` : la page courante ne doit pas rester dans
    // l'historique, sinon le bouton Retour ramène sur un écran dont les données
    // ne se chargent plus.
    window.location.replace('/login');
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[2000] bg-amber-500 text-white shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2.5">
        <AlertTriangle size={17} className="shrink-0" />
        <p className="min-w-0 flex-1 text-sm font-medium">
          Votre session a expiré. <span className="font-normal opacity-90">
            Les enregistrements et les analyses ne partent plus sur le serveur. Votre travail à
            l'écran n'est pas perdu — reconnectez-vous pour l'enregistrer.
          </span>
        </p>
        <button
          type="button"
          onClick={reconnecter}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
        >
          <LogIn size={13} /> Se reconnecter
        </button>
      </div>
    </div>
  );
}
