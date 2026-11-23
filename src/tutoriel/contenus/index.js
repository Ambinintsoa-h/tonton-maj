/**
 * Relie l'`id` de chaque chapitre du registre (`../chapitres.js`) à son contenu.
 * Un test vérifie qu'aucune entrée du registre n'est sans contenu — et
 * réciproquement — pour qu'un chapitre ajouté d'un côté ne reste pas fantôme.
 */
import Bienvenue from './bienvenue';
import PremiersPas from './premiers-pas';
import FaireUneMaj from './faire-une-maj';
import ConsigneMaj from './consigne-maj';
import RelirePublier from './relire-publier';
import MajEnLot from './maj-en-lot';
import SuivreSonTravail from './suivre-son-travail';
import Depannage from './depannage';
import AdminApercu from './admin-apercu';
import AdminEquipe from './admin-equipe';
import AdminSkills from './admin-skills';
import AdminWordpress from './admin-wordpress';
import AdminParametres from './admin-parametres';
import AdminBudget from './admin-budget';
import AdminEffet from './admin-effet';
import AdminCoulisses from './admin-coulisses';

export const CONTENUS = {
  'bienvenue': Bienvenue,
  'premiers-pas': PremiersPas,
  'faire-une-maj': FaireUneMaj,
  'consigne-maj': ConsigneMaj,
  'relire-publier': RelirePublier,
  'maj-en-lot': MajEnLot,
  'suivre-son-travail': SuivreSonTravail,
  'depannage': Depannage,
  'admin-apercu': AdminApercu,
  'admin-equipe': AdminEquipe,
  'admin-skills': AdminSkills,
  'admin-wordpress': AdminWordpress,
  'admin-parametres': AdminParametres,
  'admin-budget': AdminBudget,
  'admin-effet': AdminEffet,
  'admin-coulisses': AdminCoulisses,
};
