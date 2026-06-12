import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound, ArrowRight, Circle } from 'lucide-react';
import { confirmPasswordReset, verifyPasswordResetCode, getAuth } from 'firebase/auth';
import { getFirebaseAuth } from '../services/firebase';

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`;

const INPUT = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  padding: '13px 16px',
  border: '1.5px solid #e0e0e0', borderRadius: 12,
  fontSize: 14, color: '#111', background: '#fff',
  outline: 'none', fontFamily: 'inherit',
  transition: 'border-color 0.15s',
};

// ── Indicateur de force du mot de passe ──────────────────────────────────────
function PasswordStrength({ password }) {
  const checks = [
    { label: '8 caractères min.', ok: password.length >= 8 },
    { label: 'Majuscule',         ok: /[A-Z]/.test(password) },
    { label: 'Chiffre',           ok: /[0-9]/.test(password) },
    { label: 'Caractère spécial', ok: /[^a-zA-Z0-9]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e'];
  const labels = ['Très faible', 'Faible', 'Moyen', 'Fort'];

  if (!password) return null;

  return (
    <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
      {/* Barre de force */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < score ? colors[score - 1] : '#e5e7eb',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      {/* Label + checks */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: colors[score - 1] || '#aaa', fontWeight: 600 }}>
          {score > 0 ? labels[score - 1] : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {checks.map(c => (
          <span key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: c.ok ? '#22c55e' : '#aaa' }}>
            {c.ok ? <CheckCircle2 size={12} className="text-green-600" /> : <Circle size={12} className="text-gray-300" />} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const navigate    = useNavigate();
  const [params]    = useSearchParams();

  const oobCode     = params.get('oobCode');
  const mode        = params.get('mode'); // 'resetPassword'

  const [step,        setStep]        = useState('loading'); // loading | form | success | expired | confirmed
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [countdown,   setCountdown]   = useState(5);

  // ── Vérifier le oobCode au chargement ────────────────────────────────────
  useEffect(() => {
    const verify = async () => {
      if (oobCode && mode === 'resetPassword') {
        try {
          const auth = getFirebaseAuth();
          if (!auth) { setStep('expired'); return; }
          await verifyPasswordResetCode(auth, oobCode);
          setStep('form');
        } catch {
          setStep('expired');
        }
      } else {
        // Pas de oobCode = l'utilisateur vient de la page Firebase par défaut
        // (mot de passe déjà changé) → afficher confirmation
        setStep('confirmed');
      }
    };
    verify();
  }, [oobCode, mode]);

  // ── Countdown après succès ────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'success' && step !== 'confirmed') return;
    const timer = setInterval(() => {
      setCountdown(n => {
        if (n <= 1) { clearInterval(timer); navigate('/login'); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [step, navigate]);

  // ── Soumettre le nouveau mot de passe ─────────────────────────────────────
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      await confirmPasswordReset(auth, oobCode, password);
      setStep('success');
    } catch (err) {
      if (err.code === 'auth/expired-action-code') {
        setStep('expired');
      } else {
        setError('Erreur lors de la mise à jour. Réessayez ou demandez un nouveau lien.');
      }
    } finally {
      setLoading(false);
    }
  }, [password, confirm, oobCode]);

  // ── Layout partagé ────────────────────────────────────────────────────────
  const Wrapper = ({ children }) => (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 38% 52%, #f8f8f8 0%, #aaaaaa 32%, #3a3a3a 62%, #0a0a0a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <style>{FONT_IMPORT}</style>
      <div style={{
        width: '100%', maxWidth: 460,
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        borderRadius: 28, overflow: 'hidden',
      }}>
        <div style={{
          padding: '44px 44px 40px',
          background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
            <img
              src="/tonton.jpg"
              alt="TONTON AI"
              style={{ width: 42, height: 42, borderRadius: 12, objectFit: 'cover', objectPosition: '50% 18%', flexShrink: 0 }}
            />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#111', letterSpacing: '-0.02em' }}>TONTON AI</div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>MAJ d'articles par IA</div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );

  // ── États ─────────────────────────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <Wrapper>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            border: '3px solid #e5e7eb', borderTopColor: '#111',
            animation: 'spin 0.8s linear infinite',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: '#666', fontSize: 14 }}>Vérification du lien…</p>
        </div>
      </Wrapper>
    );
  }

  if (step === 'expired') {
    return (
      <Wrapper>
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#fef2f2', border: '2px solid #fecaca',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <AlertCircle size={26} color="#ef4444" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111', marginBottom: 8 }}>Lien expiré</h1>
          <p style={{ fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 28 }}>
            Ce lien de réinitialisation n'est plus valide.<br />
            Les liens expirent après 24h pour des raisons de sécurité.
          </p>
          <button
            onClick={() => navigate('/login')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '14px 0', borderRadius: 12,
              background: '#111', color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Retour à la connexion <ArrowRight size={15} />
          </button>
        </div>
      </Wrapper>
    );
  }

  if (step === 'success' || step === 'confirmed') {
    const isCustom = step === 'success';
    return (
      <Wrapper>
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#f0fdf4', border: '2px solid #bbf7d0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            animation: 'popIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275)',
          }}>
            <CheckCircle2 size={28} color="#22c55e" />
          </div>
          <style>{`@keyframes popIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111', marginBottom: 8 }}>
            {isCustom ? 'Mot de passe mis à jour !' : 'Mot de passe défini !'}
          </h1>
          <p style={{ fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 28 }}>
            Vous pouvez maintenant vous connecter<br />avec votre nouveau mot de passe.
          </p>
          {/* Barre de progression du countdown */}
          <div style={{ background: '#f3f4f6', borderRadius: 8, height: 4, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{
              height: '100%', background: '#22c55e', borderRadius: 8,
              width: `${(countdown / 5) * 100}%`,
              transition: 'width 1s linear',
            }} />
          </div>
          <p style={{ fontSize: 12, color: '#999', marginBottom: 24 }}>
            Redirection dans {countdown} seconde{countdown !== 1 ? 's' : ''}…
          </p>
          <button
            onClick={() => navigate('/login')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '14px 0', borderRadius: 12,
              background: '#111', color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Se connecter maintenant <ArrowRight size={15} />
          </button>
        </div>
      </Wrapper>
    );
  }

  // ── Formulaire principal ──────────────────────────────────────────────────
  return (
    <Wrapper>
      {/* Icône */}
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
      }}>
        <KeyRound size={22} color="#fff" />
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 6, letterSpacing: '-0.02em' }}>
        Nouveau mot de passe
      </h1>
      <p style={{ fontSize: 13, color: '#777', marginBottom: 28, lineHeight: 1.5 }}>
        Choisissez un mot de passe sécurisé pour votre compte.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Mot de passe */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
            Nouveau mot de passe
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoFocus
              style={{ ...INPUT, paddingRight: 44 }}
              onFocus={e => { e.target.style.borderColor = '#111'; }}
              onBlur={e => { e.target.style.borderColor = '#e0e0e0'; }}
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 0,
              }}
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <PasswordStrength password={password} />
        </div>

        {/* Confirmation */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>
            Confirmer le mot de passe
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                ...INPUT, paddingRight: 44,
                borderColor: confirm && password !== confirm ? '#ef4444' : '#e0e0e0',
              }}
              onFocus={e => { if (!confirm || password === confirm) e.target.style.borderColor = '#111'; }}
              onBlur={e => { e.target.style.borderColor = confirm && password !== confirm ? '#ef4444' : '#e0e0e0'; }}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              style={{
                position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 0,
              }}
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {confirm && password !== confirm && (
            <p style={{ fontSize: 12, color: '#ef4444', marginTop: 5 }}>
              Les mots de passe ne correspondent pas
            </p>
          )}
        </div>

        {/* Erreur */}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#dc2626',
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            {error}
          </div>
        )}

        {/* Bouton */}
        <button
          type="submit"
          disabled={loading || !password || !confirm || password !== confirm}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '14px 0', borderRadius: 12, marginTop: 4,
            background: loading || !password || !confirm || password !== confirm ? '#d1d5db' : '#111',
            color: '#fff', border: 'none',
            fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
            transition: 'background 0.2s', fontFamily: 'inherit',
          }}
        >
          {loading ? (
            <>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
                animation: 'spin 0.7s linear infinite',
              }} />
              Mise à jour…
            </>
          ) : (
            <>Mettre à jour le mot de passe <ArrowRight size={15} /></>
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate('/login')}
          style={{
            background: 'none', border: 'none', color: '#888',
            fontSize: 13, cursor: 'pointer', textAlign: 'center',
            fontFamily: 'inherit', padding: '4px 0',
          }}
        >
          ← Retour à la connexion
        </button>
      </form>
    </Wrapper>
  );
}
