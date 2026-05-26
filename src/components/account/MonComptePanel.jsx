import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  User, Camera, Shield, Mail, Smartphone, CheckCircle2,
  XCircle, Eye, EyeOff, X, ChevronRight, Loader2,
} from 'lucide-react';
import { setProfile } from '../../store/slices/authSlice';

// ─── Avatar : photo > DiceBear kawaii > initiales colorées ──────────────────
const AVATAR_COLORS = [
  ['#f0e6ff', '#7c3aed'], ['#fef3c7', '#d97706'], ['#d1fae5', '#059669'],
  ['#fee2e2', '#dc2626'], ['#dbeafe', '#2563eb'], ['#fce7f3', '#db2777'],
];
function avatarColor(name) {
  const i = (name || 'U').charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[i];
}
export function AccountAvatar({ avatarUrl, prenom, nom, username, size = 36 }) {
  const [diceFailed, setDiceFailed] = useState(false);
  const initials = ((prenom?.[0] || '') + (nom?.[0] || '') || (username?.[0] || 'U')).toUpperCase();
  const [bg, fg] = avatarColor(username || 'U');
  const kawaiiUrl = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(username || 'user')}&backgroundColor=fde68a,fecdd3,bbf7d0,bfdbfe,e9d5ff`;
  const borderRadius = size * 0.3;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="avatar"
        style={{ width: size, height: size, borderRadius, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  if (!diceFailed) {
    return (
      <img
        src={kawaiiUrl}
        alt="avatar"
        style={{ width: size, height: size, borderRadius, background: '#fef9c3', flexShrink: 0 }}
        onError={() => setDiceFailed(true)}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius, background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ─── Panneau Mon Compte ───────────────────────────────────────────────────────
const PANEL_W = 360;

export default function MonComptePanel({ onClose }) {
  const dispatch  = useDispatch();
  const auth      = useSelector(s => s.auth);
  const panelRef  = useRef(null);

  // Profil
  const [nom,       setNom]       = useState(auth.nom       || '');
  const [prenom,    setPrenom]    = useState(auth.prenom    || '');
  const [email,     setEmail]     = useState(auth.email     || '');
  const [avatarUrl, setAvatarUrl] = useState(auth.avatarUrl || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef(null);

  // 2FA
  const [tab2fa, setTab2fa] = useState(''); // '' | 'totp' | 'email'
  const [totpQr,    setTotpQr]    = useState('');
  const [totpSecret,setTotpSecret]= useState('');
  const [totpCode,  setTotpCode]  = useState('');
  const [emailStep, setEmailStep] = useState(1); // 1=saisir email, 2=saisir code
  const [emailOtp,  setEmailOtp]  = useState('');
  const [emailCode2fa, setEmailCode2fa] = useState('');
  const [loading2fa, setLoading2fa] = useState(false);

  // Fermer sur clic extérieur
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Sauvegarder le profil
  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await axios.put('/api/account', { nom, prenom, email, avatarUrl });
      dispatch(setProfile({ nom, prenom, email, avatarUrl }));
      toast.success('Profil sauvegardé');
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSavingProfile(false);
    }
  };

  // Upload photo
  const handleAvatarUpload = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const { data } = await axios.post('/api/account/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAvatarUrl(data.avatarUrl);
      dispatch(setProfile({ avatarUrl: data.avatarUrl }));
      await axios.put('/api/account', { nom, prenom, email, avatarUrl: data.avatarUrl });
      toast.success('Photo mise à jour');
    } catch {
      toast.error('Erreur upload photo');
    }
  };

  // ── TOTP setup ──────────────────────────────────────────────────────────────
  const startTotpSetup = async () => {
    setLoading2fa(true);
    try {
      const { data } = await axios.post('/api/2fa/setup-totp');
      setTotpQr(data.qrCode);
      setTotpSecret(data.secret);
      setTotpCode('');
      setTab2fa('totp');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erreur setup TOTP');
    } finally {
      setLoading2fa(false);
    }
  };

  const enableTotp = async () => {
    setLoading2fa(true);
    try {
      await axios.post('/api/2fa/enable-totp', { code: totpCode });
      dispatch(setProfile({ twoFaEnabled: true, twoFaMethod: 'totp' }));
      setTab2fa('');
      toast.success('2FA TOTP activée !');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Code incorrect');
    } finally {
      setLoading2fa(false);
    }
  };

  // ── Email 2FA setup ─────────────────────────────────────────────────────────
  const sendEmail2fa = async () => {
    if (!emailOtp) return toast.error('Saisissez un email');
    setLoading2fa(true);
    try {
      await axios.post('/api/2fa/setup-email', { email: emailOtp });
      setEmailStep(2);
      toast.success(`Code envoyé à ${emailOtp}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erreur envoi email');
    } finally {
      setLoading2fa(false);
    }
  };

  const enableEmail2fa = async () => {
    setLoading2fa(true);
    try {
      await axios.post('/api/2fa/enable-email', { code: emailCode2fa });
      dispatch(setProfile({ twoFaEnabled: true, twoFaMethod: 'email', email: emailOtp }));
      setEmail(emailOtp);
      setTab2fa('');
      setEmailStep(1);
      toast.success('2FA email activée !');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Code incorrect ou expiré');
    } finally {
      setLoading2fa(false);
    }
  };

  // ── Désactiver 2FA ──────────────────────────────────────────────────────────
  const disable2fa = async () => {
    setLoading2fa(true);
    try {
      await axios.delete('/api/2fa');
      dispatch(setProfile({ twoFaEnabled: false, twoFaMethod: 'none' }));
      setTab2fa('');
      toast.success('2FA désactivée');
    } catch {
      toast.error('Erreur lors de la désactivation');
    } finally {
      setLoading2fa(false);
    }
  };

  const twoFaEnabled = auth.twoFaEnabled;
  const twoFaMethod  = auth.twoFaMethod;

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, scale: 0.95, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0,
        width: PANEL_W,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        zIndex: 9999,
      }}
    >
      {/* ── Header ── */}
      <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111' }}>Mon compte</p>
          <p style={{ margin: 0, fontSize: 12, color: '#999' }}>@{auth.username}</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 4, display: 'flex' }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: '16px 20px', maxHeight: 520, overflowY: 'auto' }}>

        {/* ── Avatar + photo ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div style={{ position: 'relative' }}>
            <AccountAvatar avatarUrl={avatarUrl} prenom={prenom} nom={nom} username={auth.username} size={64} />
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 22, height: 22, borderRadius: '50%',
                background: '#111', border: '2px solid #fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Camera size={11} color="#fff" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => handleAvatarUpload(e.target.files?.[0])} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#111' }}>
              {prenom || nom ? `${prenom} ${nom}`.trim() : auth.username}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#999' }}>
              {auth.role === 'admin' ? 'Administrateur' : auth.role || 'Utilisateur'}
            </p>
            {avatarUrl && (
              <button onClick={() => { setAvatarUrl(''); dispatch(setProfile({ avatarUrl: '' })); axios.put('/api/account', { nom, prenom, email, avatarUrl: '' }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11, padding: '2px 0', marginTop: 2 }}>
                Supprimer la photo
              </button>
            )}
          </div>
        </div>

        {/* ── Champs profil ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Prénom</label>
              <input value={prenom} onChange={e => setPrenom(e.target.value)}
                placeholder="Votre prénom"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Nom</label>
              <input value={nom} onChange={e => setNom(e.target.value)}
                placeholder="Votre nom"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="votre@email.com"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none' }} />
          </div>
          <button onClick={saveProfile} disabled={savingProfile}
            style={{
              background: '#111', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: savingProfile ? 0.6 : 1,
            }}>
            {savingProfile && <Loader2 size={13} className="animate-spin" />}
            Enregistrer
          </button>
        </div>

        {/* ── Séparateur 2FA ── */}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Shield size={14} color="#7c3aed" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Double authentification</span>
            {twoFaEnabled && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#059669', background: '#d1fae5', padding: '2px 8px', borderRadius: 99 }}>
                {twoFaMethod === 'totp' ? 'TOTP' : 'Email'} activée
              </span>
            )}
          </div>

          {twoFaEnabled ? (
            /* 2FA active — option désactiver */
            <div style={{ background: '#fef9c3', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#92400e' }}>
                La 2FA est activée ({twoFaMethod === 'totp' ? 'application authenticator' : 'email'}).
              </p>
              <button onClick={disable2fa} disabled={loading2fa}
                style={{ background: 'none', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 7, padding: '5px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                {loading2fa ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                Désactiver la 2FA
              </button>
            </div>
          ) : (
            /* 2FA inactive — choix TOTP ou Email */
            !tab2fa ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={startTotpSetup} disabled={loading2fa}
                  style={{ flex: 1, background: '#f5f3ff', border: '1.5px solid #e9d5ff', color: '#7c3aed', borderRadius: 10, padding: '10px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  {loading2fa ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />}
                  App Authenticator
                  <span style={{ fontWeight: 400, color: '#a78bfa', fontSize: 10 }}>Google Auth, Authy…</span>
                </button>
                <button onClick={() => { setTab2fa('email'); setEmailStep(1); }}
                  style={{ flex: 1, background: '#f0f9ff', border: '1.5px solid #bae6fd', color: '#0284c7', borderRadius: 10, padding: '10px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <Mail size={16} />
                  Email OTP
                  <span style={{ fontWeight: 400, color: '#7dd3fc', fontSize: 10 }}>Code par email</span>
                </button>
              </div>
            ) : tab2fa === 'totp' ? (
              /* Setup TOTP */
              <div style={{ background: '#f5f3ff', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>Configurer l'app authenticator</span>
                  <button onClick={() => setTab2fa('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a78bfa' }}><X size={14} /></button>
                </div>
                {totpQr && (
                  <div style={{ textAlign: 'center', marginBottom: 10 }}>
                    <img src={totpQr} alt="QR Code" style={{ width: 140, height: 140, borderRadius: 8, border: '2px solid #e9d5ff' }} />
                    <p style={{ margin: '6px 0 2px', fontSize: 10, color: '#7c3aed' }}>Scannez avec Google Authenticator, Authy, etc.</p>
                    <p style={{ margin: 0, fontSize: 9, color: '#a78bfa', wordBreak: 'break-all', fontFamily: 'monospace' }}>{totpSecret}</p>
                  </div>
                )}
                <label style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', display: 'block', marginBottom: 4 }}>Code à 6 chiffres</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={totpCode} onChange={e => setTotpCode(e.target.value)} maxLength={6}
                    placeholder="000000"
                    style={{ flex: 1, padding: '8px 10px', border: '1.5px solid #e9d5ff', borderRadius: 7, fontSize: 18, letterSpacing: 6, textAlign: 'center', outline: 'none', fontFamily: 'monospace' }} />
                  <button onClick={enableTotp} disabled={loading2fa || totpCode.length < 6}
                    style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, padding: '0 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: (loading2fa || totpCode.length < 6) ? 0.5 : 1 }}>
                    {loading2fa ? <Loader2 size={13} className="animate-spin" /> : 'Activer'}
                  </button>
                </div>
              </div>
            ) : (
              /* Setup Email */
              <div style={{ background: '#f0f9ff', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0284c7' }}>Configurer la 2FA par email</span>
                  <button onClick={() => { setTab2fa(''); setEmailStep(1); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7dd3fc' }}><X size={14} /></button>
                </div>
                {emailStep === 1 ? (
                  <>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#0284c7', display: 'block', marginBottom: 4 }}>Adresse email</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="email" value={emailOtp} onChange={e => setEmailOtp(e.target.value)}
                        placeholder={email || 'votre@email.com'}
                        style={{ flex: 1, padding: '8px 10px', border: '1.5px solid #bae6fd', borderRadius: 7, fontSize: 13, outline: 'none' }} />
                      <button onClick={sendEmail2fa} disabled={loading2fa || !emailOtp}
                        style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: 7, padding: '0 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: (!emailOtp || loading2fa) ? 0.5 : 1 }}>
                        {loading2fa ? <Loader2 size={13} className="animate-spin" /> : 'Envoyer'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ margin: '0 0 8px', fontSize: 12, color: '#0284c7' }}>Code envoyé à <strong>{emailOtp}</strong></p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={emailCode2fa} onChange={e => setEmailCode2fa(e.target.value)} maxLength={6}
                        placeholder="000000"
                        style={{ flex: 1, padding: '8px 10px', border: '1.5px solid #bae6fd', borderRadius: 7, fontSize: 18, letterSpacing: 6, textAlign: 'center', outline: 'none', fontFamily: 'monospace' }} />
                      <button onClick={enableEmail2fa} disabled={loading2fa || emailCode2fa.length < 6}
                        style={{ background: '#0284c7', color: '#fff', border: 'none', borderRadius: 7, padding: '0 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: (loading2fa || emailCode2fa.length < 6) ? 0.5 : 1 }}>
                        {loading2fa ? <Loader2 size={13} className="animate-spin" /> : 'Activer'}
                      </button>
                    </div>
                    <button onClick={() => setEmailStep(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7dd3fc', fontSize: 11, marginTop: 6, padding: 0 }}>
                      Changer d'email
                    </button>
                  </>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </motion.div>
  );
}
