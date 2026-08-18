/**
 * stylePrompt.js — moitié IA de la correction des patterns (PHASE 4).
 *
 * `styleFixes.js` traite ce qui est calculable sans comprendre la phrase (tirets,
 * adverbes). Reste ce qui exige du sens : verbes interdits, participe présent,
 * voix passive, phrases trop longues, clichés, méta-commentaires. Un verbe
 * n'a pas de remplaçant universel — « s'impose » devient « domine », « revient »
 * ou « fait référence » selon ce que la phrase dit.
 *
 * Un SEUL appel pour tout l'article : envoyer 79 occurrences une par une
 * coûterait 79 appels pour un résultat moins cohérent.
 *
 * Contrat volontairement étroit : l'IA renvoie, pour chaque occurrence numérotée,
 * la phrase réécrite — rien d'autre. Pas de commentaire, pas de reformulation du
 * paragraphe : la phase 4 corrige des patterns, elle ne réécrit pas l'article.
 */
import { AI_IDS } from './styleFixes';
import { VERBES_INTERDITS, PARTICIPES, CLICHES, META, MOTS_MAX_PHRASE } from './stylePatterns';

/**
 * LES PATTERNS INTERDITS VOYAGENT AVEC LE PROMPT — corrigé le 18 août 2026.
 *
 * Le prompt disait « remplace le verbe fade par un verbe précis » sans jamais
 * NOMMER les verbes proscrits. Le modèle ne peut pas éviter ce qu'il ne connaît
 * pas, et le résultat était mécanique : pour corriger « constitue », il proposait
 *   « La franchise s'impose en pilier du jeu vidéo depuis deux décennies. »
 * or `s'impose` est lui-même dans VERBES_INTERDITS. La correction rendait la
 * phrase re-signalable au tour suivant — les « récurrences » vues en production.
 *
 * Deux gestes, parce qu'une consigne de prompt n'est pas un verrou :
 *   1. la liste est DITE au modèle (ce bloc) ;
 *   2. toute proposition qui réintroduit un pattern interdit est ÉCARTÉE en code
 *      (`reintroduitUnPattern`, plus bas). Une consigne qu'on ne vérifie pas est
 *      une consigne dont on ne sait rien.
 *
 * Source unique : les listes viennent de `stylePatterns.js`, celles-là même qui
 * servent à la DÉTECTION. Les recopier ici les aurait fait diverger, et on aurait
 * proposé au rédacteur des corrections qu'on rejette ensuite.
 */
const INTERDITS = [
  '',
  'JAMAIS ces tournures dans tes propositions — elles sont proscrites par la charte',
  'et une proposition qui en contient une sera REJETÉE automatiquement :',
  `- verbes fades : ${VERBES_INTERDITS.join(', ')}`,
  `- participes présents : ${PARTICIPES.join(', ')}`,
  `- clichés : ${CLICHES.join(' / ')}`,
  `- méta-commentaires : ${META.join(' / ')}`,
  `- aucune phrase de plus de ${MOTS_MAX_PHRASE} mots.`,
  '- aucune mention du type « [à vérifier] », « (à confirmer) », « source à ajouter » :',
  '  ce sont des notes de travail, elles n\'ont rien à faire dans un article publié.',
].join('\n');

/** Consigne par règle — ce que l'IA doit faire, pas seulement ce qu'elle doit éviter. */
const CONSIGNE = {
  // PHRASE AMPUTÉE — la seule consigne où l'IA doit AJOUTER du texte, et donc la
  // seule où elle peut inventer un fait. D'où la porte de sortie explicite : sans
  // certitude, elle renvoie la phrase telle quelle, et `normalizeStyleProposals`
  // l'écarte comme « rien à corriger ». Aucune proposition vaut mieux qu'une
  // proposition inventée — c'est précisément en comblant un vide que le modèle a
  // produit « date confirmée au Comic-Con le 24 juillet » sur un article réel.
  coupees:    'Un mot ou un signe manque : la phrase est illisible. Restitue le mot '
              + 'manquant SEULEMENT si le contexte le rend certain, et corrige la '
              + 'ponctuation fusionnée. N\'ajoute aucune information nouvelle, aucun '
              + 'chiffre, aucune date. Si tu n\'es pas certain du mot manquant, renvoie '
              + 'la phrase à l\'identique.',
  verbes:     'Remplace le verbe fade par un verbe précis et concret, sans changer le sens.',
  participes: 'Reformule le participe présent en verbe conjugué (« qui permet », « il évite »).',
  passive:    'Mets le sujet en action : « Google indexe la page » plutôt que « la page est indexée par Google ».',
  phrases:    'Coupe en deux phrases, ou raccourcis sous 20 mots, sans rien perdre du contenu.',
  cliches:    'Supprime la formule creuse et garde uniquement l\'information.',
  meta:       'Supprime le méta-commentaire et garde l\'information factuelle.',
};

const LIGNE = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Aplati les anomalies en une liste d'occurrences numérotées, en ne gardant que
 * celles qui relèvent de l'IA.
 * @returns {Array<{n:number, id:string, terme:string, extrait:string}>}
 */
export const flattenAiOccurrences = (findings = []) => {
  const out = [];
  (Array.isArray(findings) ? findings : []).forEach((f) => {
    if (!f || !AI_IDS.includes(f.id)) return;
    (Array.isArray(f.exemples) ? f.exemples : []).forEach((ex) => {
      const extrait = LIGNE(ex && ex.extrait);
      if (!extrait) return;
      out.push({ n: out.length + 1, id: f.id, terme: LIGNE(ex.terme), extrait });
    });
  });
  return out;
};

/**
 * Construit le prompt. Les occurrences sont numérotées : c'est ce numéro qui
 * permettra de rattacher chaque réponse à son passage, sans dépendre d'une
 * correspondance de texte approximative.
 */
export const buildStyleFixPrompt = (occurrences = []) => {
  const liste = Array.isArray(occurrences) ? occurrences : [];
  if (!liste.length) return '';
  const parRegle = {};
  liste.forEach((o) => { (parRegle[o.id] = parRegle[o.id] || []).push(o); });

  const blocs = Object.entries(parRegle).map(([id, occ]) => {
    const lignes = occ.map((o) => `${o.n}. ${o.terme ? `[${o.terme}] ` : ''}${o.extrait}`);
    return [`## ${CONSIGNE[id] || 'Corrige le passage.'}`, ...lignes].join('\n');
  });

  return [
    'Tu corriges des PATTERNS D\'ÉCRITURE dans un article déjà rédigé.',
    '',
    'Règles absolues :',
    '- Réécris UNIQUEMENT la phrase fournie, jamais le paragraphe autour.',
    '- Ne change aucun chiffre, aucune date, aucun nom propre, aucune unité.',
    '- N\'ajoute ni ne supprime aucun lien.',
    '- Si une phrase est déjà correcte, renvoie-la à l\'identique.',
    INTERDITS,
    '',
    ...blocs,
    '',
    'Réponds UNIQUEMENT par un tableau JSON, sans texte autour :',
    '[{ "n": 1, "apres": "la phrase réécrite" }]',
  ].join('\n');
};

/** Toute URL présente dans un texte, pour comparer avant/après. */
const urlsDe = (s) => String(s || '').match(/(?:https?:\/\/|www\.)[^\s<>"')]+/gi) || [];

/**
 * Rattache les réponses de l'IA aux occurrences, par NUMÉRO.
 *
 * Écarte silencieusement ce qui n'est pas exploitable — numéro inconnu, réponse
 * vide, ou proposition identique à l'original (rien à accepter). Une proposition
 * absurdement plus longue que la phrase d'origine est aussi écartée : c'est le
 * signe que le modèle a réécrit le paragraphe malgré la consigne.
 *
 * VERROU LIENS (règle 8 du projet). Le prompt interdit déjà d'ajouter ou de
 * retirer un lien, mais une consigne de prompt N'EST PAS un verrou : la règle 8
 * exige du code. Et la proposition retenue ici part directement dans
 * `innerHTML` via handleAcceptStyleFix, un chemin qui ne passe NI par
 * `enforceExternalLinkPolicy` NI par `balanceFragment`. Deux rejets donc :
 *   - tout balisage (`<`, `href=`) : les extraits sont du TEXTE NU (texteDe
 *     retire les balises), une proposition n'a jamais de raison légitime d'en
 *     porter — et du balisage déséquilibré casserait en plus le HTML ;
 *   - toute URL ABSENTE de l'original : c'est un lien ajouté. Une URL déjà
 *     présente dans `avant` reste autorisée, sinon on écarterait des
 *     corrections légitimes sur une phrase qui cite une adresse.
 */
const PORTE_BALISAGE = /<|href\s*=/i;

/** Apostrophe droite ou typographique, comme dans stylePatterns. */
const motifTerme = (terme) => new RegExp(
  `(?<![\\p{L}])${terme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]")}(?![\\p{L}])`, 'iu',
);

/** Notes de travail : jamais dans un article publié (demande Andrianina, août 2026). */
const NOTE_DE_TRAVAIL = /\[[^\]]*(?:vérifier|verifier|confirmer|à sourcer|source manquante|todo)[^\]]*\]|\((?:à vérifier|a verifier|à confirmer|à sourcer)\)/i;

/**
 * Vrai si la proposition réintroduit un pattern que la phase 4 signalerait.
 *
 * Le filtre est ASYMÉTRIQUE, et c'est voulu : on ne rejette que ce qui est
 * ABSENT de l'original. Rejeter un pattern déjà présent dans `avant` écarterait
 * des corrections légitimes — la phrase « La franchise constitue un pilier »
 * corrigée sur son participe présent n'a pas à être perdue parce qu'elle contient
 * encore « constitue », qui sera traité par sa propre occurrence. Même logique que
 * le verrou liens juste au-dessus.
 */
const PATTERNS_REJETES = [...VERBES_INTERDITS, ...PARTICIPES, ...CLICHES, ...META];

const reintroduitUnPattern = (avant, apres) => {
  if (NOTE_DE_TRAVAIL.test(apres) && !NOTE_DE_TRAVAIL.test(avant)) return true;
  return PATTERNS_REJETES.some((t) => {
    const re = motifTerme(t);
    return re.test(apres) && !re.test(avant);
  });
};

export const normalizeStyleProposals = (brut, occurrences = []) => {
  const parNum = new Map((Array.isArray(occurrences) ? occurrences : []).map((o) => [o.n, o]));
  const items = Array.isArray(brut) ? brut : (brut && Array.isArray(brut.propositions) ? brut.propositions : []);
  const out = new Map();
  items.forEach((it) => {
    if (!it) return;
    const n = Number(it.n);
    const occ = parNum.get(n);
    const apres = LIGNE(it.apres);
    if (!occ || !apres) return;
    if (apres === occ.extrait) return;                      // rien à corriger
    if (apres.length > occ.extrait.length * 2.5 + 40) return; // le modèle a débordé
    if (PORTE_BALISAGE.test(apres)) return;                 // verrou liens : balisage
    if (reintroduitUnPattern(occ.extrait, apres)) return;   // corrige un pattern par un autre
    const dejaLa = new Set(urlsDe(occ.extrait).map((u) => u.toLowerCase()));
    if (urlsDe(apres).some((u) => !dejaLa.has(u.toLowerCase()))) return; // lien ajouté
    out.set(n, { n, id: occ.id, avant: occ.extrait, apres });
  });
  return [...out.values()];
};
