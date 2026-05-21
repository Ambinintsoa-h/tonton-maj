import { useState, useCallback } from 'react';
import axios from 'axios';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { loginSuccess } from '../store/slices/authSlice';
import TransitionLoader from '../components/auth/TransitionLoader';

const AGENTS = ['TONTON', 'SHERLOCK', 'SCRAPPY', 'RAOUL'];

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`;

const INPUT = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  padding: '13px 16px',
  border: '1.5px solid #e0e0e0', borderRadius: 12,
  fontSize: 14, color: '#111', background: '#fff',
  outline: 'none', fontFamily: 'inherit',
  transition: 'border-color 0.15s',
};

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [username,     setUsername]     = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [showLoader,   setShowLoader]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/login', { username, password });
      if (data.token) {
        dispatch(loginSuccess({ token: data.token, username, role: data.role ?? null }));
        setShowLoader(true);
      } else {
        setError('Identifiants incorrects');
        setLoading(false);
      }
    } catch {
      setError('Identifiants incorrects');
      setLoading(false);
    }
  };

  const handleLoaderDone = useCallback(() => navigate('/'), [navigate]);
  if (showLoader) return <TransitionLoader onDone={handleLoaderDone} />;

  return (
    <div style={{
      minHeight: '100vh',
      /* Dégradé radial noir → gris → blanc */
      background: 'radial-gradient(ellipse at 38% 52%, #f8f8f8 0%, #aaaaaa 32%, #3a3a3a 62%, #0a0a0a 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <style>{FONT_IMPORT}</style>

      {/* ── Carte principale ── */}
      <div style={{
        display: 'flex',
        width: '100%',
        maxWidth: 920,
        minHeight: 520,
        borderRadius: 28,
        /* Glassmorphisme sur la carte entière */
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        overflow: 'hidden',
      }}>

        {/* ════════════════════════════════════════
            GAUCHE — texte + formulaire + agents
        ════════════════════════════════════════ */}
        <div style={{
          flex: 1,
          padding: '44px 44px 36px',
          display: 'flex',
          flexDirection: 'column',
          /* Glassmorphisme sur le panneau gauche (form) */
          background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
          borderRight: '1px solid rgba(255,255,255,0.3)',
        }}>

          {/* Titre */}
          <div style={{ marginBottom: 16 }}>
            <p style={{
              color: '#888',
              fontSize: 20,
              fontWeight: 900,       /* ultra bold */
              margin: '0 0 3px',
              lineHeight: 1.3,
              letterSpacing: '-0.02em',
            }}>
              Votre TONTON AI pour vous
            </p>
            <h1 style={{
              color: '#111',
              fontSize: 20,
              fontWeight: 900,
              margin: 0,
              lineHeight: 1.3,
              letterSpacing: '-0.02em',
            }}>
              conseiller sur le MAJ
            </h1>
          </div>

          {/* Sous-titre */}
          <p style={{
            color: '#999',
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.65,
            margin: '0 0 22px',
            maxWidth: 310,
          }}>
            Des agents IA qui vous épaulent pour plus d'efficacité et de productivité.
          </p>

          {/* ── Formulaire ── */}
          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              placeholder="Identifiant"
              style={INPUT}
              onFocus={e => { e.target.style.borderColor = '#111'; }}
              onBlur={e => { e.target.style.borderColor = '#e0e0e0'; }}
            />

            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                placeholder="Mot de passe"
                style={{ ...INPUT, paddingRight: 44 }}
                onFocus={e => { e.target.style.borderColor = '#111'; }}
                onBlur={e => { e.target.style.borderColor = '#e0e0e0'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
                style={{
                  position: 'absolute', right: 14, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none',
                  color: '#bbb', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', padding: 0,
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && (
              <div style={{
                padding: '10px 14px',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 10, fontSize: 13, color: '#dc2626',
              }}>
                {error}
              </div>
            )}
          </form>

          {/* ── Étiquettes agents — fond neutre, pas de bordure = pas bouton ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 20 }}>
            {AGENTS.map(agent => (
              <span key={agent} style={{
                background: 'rgba(0,0,0,0.06)',
                borderRadius: 8,
                padding: '5px 13px',
                fontSize: 12,
                fontWeight: 600,
                color: '#555',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                {agent}
              </span>
            ))}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* ── Boutons bas — Se connecter + PUBLITHINGS ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 28 }}>

            {/* Bouton Se connecter — style "Train your AI" du template */}
            <button
              type="submit"
              form=""
              onClick={handleSubmit}
              disabled={loading || !username || !password}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9,
                padding: '12px 24px',
                background: (loading || !username || !password) ? '#555' : '#111',
                color: '#fff',
                border: 'none', borderRadius: 999,
                fontSize: 14, fontWeight: 700,
                cursor: (loading || !username || !password) ? 'not-allowed' : 'pointer',
                letterSpacing: '0.01em', fontFamily: 'inherit',
                transition: 'background 0.15s',
                opacity: (loading || !username || !password) ? 0.55 : 1,
              }}
            >
              {/* Point vert animé — comme dans le template */}
              <span style={{
                width: 9, height: 9, borderRadius: '50%',
                background: '#6ee7b7', flexShrink: 0,
                boxShadow: '0 0 0 2px rgba(110,231,183,0.3)',
                animation: 'pulse 2s infinite',
              }} />
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>

            {/* Badge PUBLITHINGS — pill noir, comme le bouton secondaire du template */}
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '12px 22px',
              background: '#1a1a1a', color: '#fff',
              borderRadius: 999,
              fontSize: 12, fontWeight: 800,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              PUBLITHINGS
            </span>
          </div>

          {/* Animation pulse CSS */}
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.6; transform: scale(1.2); }
            }
          `}</style>
        </div>

        {/* ════════════════════════════════════════
            DROITE — carte sombre avec Tonton
        ════════════════════════════════════════ */}
        <div style={{
          width: '46%',
          flexShrink: 0,
          background: '#111',
          borderRadius: 20,
          margin: 12,
          position: 'relative',
          overflow: 'hidden',
        }}>

          {/* Image de Tonton — cadrée sur la tête */}
          <img
            src="/tonton.jpg"
            alt="Tonton AI"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center 12%',   /* cadrage tête bien visible */
              zIndex: 1,
            }}
          />

          {/* Gradient haut léger (pas de texte → juste bord de fondu) */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '18%',
            background: 'linear-gradient(to bottom, rgba(17,17,17,0.4) 0%, transparent 100%)',
            zIndex: 2,
            pointerEvents: 'none',
          }} />

          {/* Gradient bas */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '25%',
            background: 'linear-gradient(to top, rgba(17,17,17,0.7) 0%, transparent 100%)',
            zIndex: 2,
            pointerEvents: 'none',
          }} />
        </div>

      </div>
    </div>
  );
}
