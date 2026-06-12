/**
 * Suppression d'un compte Firebase Auth orphelin (par email).
 *
 * Contexte : avant le fix, supprimer un membre via le SaaS n'effaçait que la
 * fiche Firestore — le compte Firebase Auth survivait, donc l'utilisateur
 * pouvait encore se connecter. Ce script nettoie ces comptes orphelins.
 *
 * À lancer sur le serveur où data/firebase-service-account.json est présent :
 *   node scripts/delete-auth-user.js annick@publithings.com
 *
 * Supprime le compte Auth ET, si elle existe encore, la fiche Firestore (par uid).
 */
const fs = require('fs');
const path = require('path');

const email = process.argv[2];
if (!email) {
  console.error('Usage : node scripts/delete-auth-user.js <email>');
  process.exit(1);
}

const saPath = path.join(__dirname, '..', 'data', 'firebase-service-account.json');
if (!fs.existsSync(saPath)) {
  console.error(`Service account introuvable : ${saPath}`);
  process.exit(1);
}

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });

(async () => {
  try {
    const user = await admin.auth().getUserByEmail(email);
    console.log(`→ Compte Auth trouvé : uid=${user.uid}, créé le ${user.metadata.creationTime}`);

    await admin.auth().deleteUser(user.uid);
    console.log('Compte Firebase Auth supprimé');

    await admin.firestore().collection('users').doc(user.uid).delete();
    console.log('Fiche Firestore supprimée (si elle existait)');

    console.log(`\n${email} ne peut plus se connecter.`);
    process.exit(0);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      console.log(`Aucun compte Auth pour ${email} — rien à supprimer.`);
      process.exit(0);
    }
    console.error('Erreur :', e.message);
    process.exit(1);
  }
})();
