import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, AlertCircle, CheckCircle2, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useBranding, appTitle } from '../lib/branding';

// Replaces the old PinScreen. Renders its children only for an active
// counsellor or admin; everyone else gets the sign-in screen (or a "no access"
// note if they have a session but no active staff row).

const screenStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem 1rem',
  backgroundColor: 'var(--color-background)',
  backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(94, 106, 210, 0.15) 0%, transparent 50%)',
};

const cardStyle: React.CSSProperties = {
  maxWidth: '400px',
  width: '100%',
  padding: '2.5rem 2rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
};

const SchoolMark: React.FC = () => {
  const { logoUrl, schoolName } = useBranding();
  if (logoUrl) {
    return <img src={logoUrl} alt={schoolName ?? 'School logo'} style={{ width: '64px', height: '64px', objectFit: 'contain', marginBottom: '1.25rem' }} />;
  }
  return (
    <div style={{
      width: '60px', height: '60px', borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--color-primary), #8b5cf6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      marginBottom: '1.25rem', boxShadow: '0 8px 16px rgba(94, 106, 210, 0.4)',
    }}>
      <Lock size={28} color="white" />
    </div>
  );
};

const Notice: React.FC<{ tone: 'error' | 'info'; children: React.ReactNode }> = ({ tone, children }) => (
  <motion.div
    role={tone === 'error' ? 'alert' : 'status'}
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: 'auto' }}
    style={{
      display: 'flex', alignItems: 'flex-start', gap: '0.5rem', width: '100%',
      color: tone === 'error' ? '#ef4444' : '#22a06b',
      backgroundColor: tone === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 160, 107, 0.1)',
      padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem',
      fontSize: '0.875rem', fontWeight: 500,
    }}
  >
    {tone === 'error' ? <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
    <span>{children}</span>
  </motion.div>
);

const LoginScreen: React.FC = () => {
  const { signIn, requestNewCode } = useAuth();
  const { schoolName } = useBranding();
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const mobileDigits = mobile.replace(/\D/g, '');
  const mobileValid = mobileDigits.length === 10;
  const canSubmit = mobileValid && code.length === 4 && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    setInfo('');
    const { error: signInError } = await signIn(mobileDigits, code);
    if (signInError) {
      setError(signInError);
      setCode('');
    }
    setBusy(false);
  };

  const handleNewCode = async () => {
    if (!mobileValid) {
      setError('Enter your 10-digit mobile number first.');
      return;
    }
    setBusy(true);
    setError('');
    const { message } = await requestNewCode(mobileDigits);
    setInfo(message);
    setBusy(false);
  };

  return (
    <div style={screenStyle}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bento-card"
        style={cardStyle}
      >
        <SchoolMark />
        <h1 className="text-h2 mb-2" style={{ textAlign: 'center' }}>{appTitle(schoolName)}</h1>
        <p className="text-muted mb-6" style={{ textAlign: 'center', fontSize: '0.875rem' }}>
          Sign in with your mobile number and your 4-digit work code.
        </p>

        <form onSubmit={handleSubmit} style={{ width: '100%' }} noValidate>
          <label htmlFor="login-mobile" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem' }}>
            Mobile number
          </label>
          <input
            id="login-mobile"
            className="input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="10-digit mobile number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/[^\d\s+]/g, '').slice(0, 16))}
            style={{ width: '100%', marginBottom: '1rem' }}
          />

          <label htmlFor="login-code" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem' }}>
            Work code
          </label>
          <input
            id="login-code"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="4 digits"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            style={{ width: '100%', marginBottom: '1.25rem', letterSpacing: code ? '0.5em' : undefined }}
          />

          {error && <Notice tone="error">{error}</Notice>}
          {info && <Notice tone="info">{info}</Notice>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn btn-primary"
            style={{
              width: '100%', padding: '1rem', border: 'none', transition: 'all 0.3s',
              background: canSubmit ? 'linear-gradient(135deg, var(--color-primary), #8b5cf6)' : 'var(--color-surface)',
              color: canSubmit ? 'white' : 'var(--color-text-muted)',
              opacity: canSubmit ? 1 : 0.6,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Please wait…' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleNewCode}
          disabled={busy}
          className="btn btn-secondary"
          style={{ marginTop: '1rem', background: 'transparent', border: 'none', fontSize: '0.875rem' }}
        >
          Forgot your code? Send me a new one
        </button>
      </motion.div>
    </div>
  );
};

const NoAccessScreen: React.FC = () => {
  const { signOut } = useAuth();
  return (
    <div style={screenStyle}>
      <div className="bento-card" style={cardStyle}>
        <SchoolMark />
        <h1 className="text-h2 mb-2" style={{ textAlign: 'center' }}>Your access is not active</h1>
        <p className="text-muted mb-6" style={{ textAlign: 'center', fontSize: '0.875rem' }}>
          This account isn't set up for this app yet, or it has been switched off. Please ask your school's UPsych admin.
        </p>
        <button type="button" onClick={signOut} className="btn btn-secondary">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
};

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div style={{ ...screenStyle, backgroundImage: 'none' }}>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }
  if (status === 'signedOut') return <LoginScreen />;
  if (status === 'noAccess') return <NoAccessScreen />;
  return <>{children}</>;
};
