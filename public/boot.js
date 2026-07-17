/* ── Scripts de démarrage TONTON AI ──────────────────────────────────────────
   Chargés AVANT le bundle webpack/CRA (balise <script src> dans <head>).
   Anciennement trois <script> inline dans index.html : bloqués par la CSP
   prod (script-src 'self', sans 'unsafe-inline') → déplacés dans ce fichier
   statique servi par la même origine.
──────────────────────────────────────────────────────────────────────────── */

/* Suppresseur de ResizeObserver — Framer Motion déclenche "ResizeObserver loop
   completed with undelivered notifications" pendant ses animations : bénin.
   On coupe les deux canaux (window.onerror + capture) avant que CRA puisse
   enregistrer son propre handler et afficher l'overlay rouge. */
(function () {
  var _onerror = window.onerror;
  window.onerror = function (msg) {
    if (typeof msg === 'string' && msg.indexOf('ResizeObserver loop') !== -1) return true;
    return _onerror ? _onerror.apply(this, arguments) : false;
  };
  window.addEventListener('error', function (e) {
    if (e.message && e.message.indexOf('ResizeObserver loop') !== -1) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
})();

/* Suppresseur d'AbortError — CRA enregistre son overlay unhandledrejection via
   HMR avant index.js. capture:true nous intercale en phase de capture, avant
   CRA ; stopImmediatePropagation() empêche son handler bubble de s'exécuter.
   Ces erreurs (AbortError, CanceledError) sont déjà gérées dans les .catch()
   du code applicatif — les afficher dans l'overlay est un faux positif. */
(function () {
  function isAbortLike(reason) {
    if (!reason) return false;
    var n = reason.name || '';
    var m = (reason.message || '').toLowerCase();
    var c = reason.code || '';
    return (
      n === 'AbortError' ||
      n === 'CanceledError' ||
      c === 'ERR_CANCELED' ||
      m === 'canceled' ||
      m.indexOf('aborted') !== -1 ||
      m.indexOf('abort') !== -1 ||
      m.indexOf('cancel') !== -1
    );
  }
  window.addEventListener(
    'unhandledrejection',
    function (e) {
      if (isAbortLike(e.reason)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true /* capture phase — s'exécute avant les handlers bubble de CRA */
  );
})();

/* Favicon crop — reproduit objectPosition:'50% 18%' + objectFit:'cover'
   pour cadrer sur le visage de TONTON AI comme dans la sidebar. */
(function () {
  var img = new Image();
  img.onload = function () {
    var size = 64;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    /* Arrondi compatible tous navigateurs */
    var r = size * 0.22;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size); ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath(); ctx.clip();
    /* Cover + objectPosition 50% 18% */
    var scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    var w = img.naturalWidth * scale;
    var h = img.naturalHeight * scale;
    var x = (size - w) * 0.50; /* centré horizontalement */
    var y = (size - h) * 0.18; /* 18 % depuis le haut → visage */
    ctx.drawImage(img, x, y, w, h);
    var link = document.getElementById('favicon');
    if (link) link.href = c.toDataURL('image/png');
  };
  img.src = '/tonton.jpg';
})();
