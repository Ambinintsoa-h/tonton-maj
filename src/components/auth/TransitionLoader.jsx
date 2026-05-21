import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Splash de transition affiché après le login.
 * Reprend le même niveau d'animation que le loader HTML initial :
 *  - 3 anneaux tournants autour du portrait
 *  - 2 orbes de fond flottants
 *  - Animation de respiration sur l'avatar
 *  - Barre de progression shimmer → remplie dynamiquement
 */

const KEYFRAMES = `
  @keyframes tl-cw  { to { transform: rotate(360deg);  } }
  @keyframes tl-ccw { to { transform: rotate(-360deg); } }
  @keyframes tl-orb1 {
    0%,100% { transform: translate(0,0) scale(1); }
    50%     { transform: translate(30px,20px) scale(1.1); }
  }
  @keyframes tl-orb2 {
    0%,100% { transform: translate(0,0) scale(1); }
    50%     { transform: translate(-24px,-18px) scale(1.08); }
  }
  @keyframes tl-breathe {
    0%,100% { box-shadow: 0 0 0 5px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.65); }
    50%     { box-shadow: 0 0 0 10px rgba(255,255,255,0.11), 0 16px 52px rgba(0,0,0,0.7); }
  }
  @keyframes tl-shimmer {
    0%   { left: -60%; }
    100% { left: 120%; }
  }
`;

export default function TransitionLoader({ onDone }) {
  const [visible,  setVisible]  = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let p = 0;
    const tick = setInterval(() => {
      p += Math.random() * 18 + 4;
      if (p >= 92) { clearInterval(tick); p = 92; }
      setProgress(Math.min(p, 92));
    }, 180);

    const minWait   = new Promise(res => setTimeout(res, 2000));
    const bootstrap = window.__tontonBootstrapPromise instanceof Promise
      ? window.__tontonBootstrapPromise
      : Promise.resolve();

    Promise.all([minWait, bootstrap]).then(() => {
      clearInterval(tick);
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setTimeout(onDone, 550);
      }, 350);
    });

    return () => clearInterval(tick);
  }, [onDone]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="transition-loader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: '#0c0c0c',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <style>{KEYFRAMES}</style>

          {/* Orbe 1 — haut gauche */}
          <div style={{
            position: 'absolute',
            width: 420, height: 420,
            top: -120, left: -120,
            borderRadius: '50%',
            filter: 'blur(80px)',
            background: 'radial-gradient(circle, rgba(255,255,255,0.045) 0%, transparent 70%)',
            animation: 'tl-orb1 9s ease-in-out infinite',
            pointerEvents: 'none',
          }} />

          {/* Orbe 2 — bas droite */}
          <div style={{
            position: 'absolute',
            width: 360, height: 360,
            bottom: -100, right: -100,
            borderRadius: '50%',
            filter: 'blur(80px)',
            background: 'radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)',
            animation: 'tl-orb2 12s ease-in-out infinite',
            pointerEvents: 'none',
          }} />

          {/* Carte centrale */}
          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 18 }}
            animate={{ scale: 1,    opacity: 1, y: 0  }}
            transition={{ duration: 0.55, ease: [0.34, 1.4, 0.64, 1] }}
            style={{
              position: 'relative',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 28,
              padding: '44px 52px 40px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 28,
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 1px 0 rgba(255,255,255,0.1) inset',
            }}
          >
            {/* Avatar + 3 anneaux tournants */}
            <div style={{ position: 'relative', width: 116, height: 116, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

              {/* Anneau externe — rotation horaire */}
              <div style={{
                position: 'absolute', inset: -20,
                borderRadius: '50%',
                border: '1.5px solid transparent',
                borderTopColor: 'rgba(255,255,255,0.55)',
                borderRightColor: 'rgba(255,255,255,0.18)',
                animation: 'tl-cw 2.2s linear infinite',
              }} />

              {/* Anneau intermédiaire — rotation anti-horaire */}
              <div style={{
                position: 'absolute', inset: -10,
                borderRadius: '50%',
                border: '1px solid transparent',
                borderBottomColor: 'rgba(255,255,255,0.45)',
                borderLeftColor: 'rgba(255,255,255,0.14)',
                animation: 'tl-ccw 1.6s linear infinite',
              }} />

              {/* Anneau interne — rotation horaire lente */}
              <div style={{
                position: 'absolute', inset: -3,
                borderRadius: '50%',
                border: '1px solid transparent',
                borderTopColor: 'rgba(255,255,255,0.2)',
                animation: 'tl-cw 3.5s linear infinite',
              }} />

              {/* Portrait */}
              <img
                src="/tonton.jpg"
                alt="TONTON AI"
                style={{
                  width: 116, height: 116,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  objectPosition: 'center 10%',
                  border: '2px solid rgba(255,255,255,0.12)',
                  boxShadow: '0 0 0 5px rgba(255,255,255,0.05), 0 12px 40px rgba(0,0,0,0.6)',
                  animation: 'tl-breathe 3.5s ease-in-out infinite',
                }}
              />
            </div>

            {/* Nom */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
              <div style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
                fontSize: 27, fontWeight: 800,
                color: '#fff', letterSpacing: '-0.9px', lineHeight: 1,
              }}>
                TONTON{' '}
                <span style={{ color: 'rgba(255,255,255,0.38)', fontWeight: 700 }}>AI</span>
              </div>
              <div style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
                fontSize: 10, fontWeight: 600,
                color: 'rgba(255,255,255,0.28)',
                letterSpacing: '2.8px', textTransform: 'uppercase',
              }}>
                Mise à jour d'articles
              </div>
            </div>

            {/* Barre de progression */}
            <div style={{
              width: 148, height: 2,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 999, overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Shimmer permanent */}
              <div style={{
                position: 'absolute', top: 0, left: '-60%',
                width: '60%', height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                animation: 'tl-shimmer 1.8s ease-in-out infinite',
              }} />
              {/* Remplissage dynamique */}
              <motion.div
                style={{ height: '100%', borderRadius: 999, background: '#fff', position: 'relative', zIndex: 1 }}
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
