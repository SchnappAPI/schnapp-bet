'use client';

import { useState, useEffect } from 'react';

const ADMIN_KEY = 'schnapp_admin_token';

type RunState = 'idle' | 'running' | 'done' | 'error';

export default function FishPage() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [savedPin, setSavedPin] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [statusMsg, setStatusMsg] = useState('Last refresh: today at 11:00 AM');
  const [statusClass, setStatusClass] = useState('ok');

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_KEY);
    if (stored) { setSavedPin(stored); setAuthed(true); }
  }, []);

  function signOut() {
    localStorage.removeItem(ADMIN_KEY);
    setSavedPin(''); setAuthed(false); setRunState('idle');
    setStatusMsg('Last refresh: today at 11:00 AM'); setStatusClass('ok');
  }

  async function handleLogin() {
    setPinError('');
    const res = await fetch('/api/admin/codes', { headers: { 'x-admin-token': pin } });
    if (res.ok) {
      localStorage.setItem(ADMIN_KEY, pin);
      setSavedPin(pin); setAuthed(true);
    } else { setPinError('Wrong passcode.'); }
  }

  async function runSync() {
    if (runState === 'running') return;
    setRunState('running');
    setStatusMsg('Contacting AppFolio...'); setStatusClass('running');
    try {
      const res = await fetch('/api/fish-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': savedPin },
        body: JSON.stringify({}),
      });
      if (res.status === 401) { signOut(); return; }
      const data = await res.json();
      if (!res.ok) {
        setRunState('error');
        setStatusMsg(data.error ?? 'Dispatch failed.'); setStatusClass('error');
        return;
      }
      setRunState('done');
      setStatusMsg('Last refresh: just now'); setStatusClass('ok');
      setTimeout(() => setRunState('idle'), 3500);
    } catch (e) {
      setRunState('error');
      setStatusMsg(e instanceof Error ? e.message : 'Unknown error.'); setStatusClass('error');
    }
  }

  const btnLabel = runState === 'running' ? 'FETCHING...' : runState === 'done' ? 'FISH FRESH NOW' : 'REFRESH';
  const btnBg = runState === 'done' ? '#0a4a28' : runState === 'error' ? '#4a1010' : '#0a2a40';

  if (!authed) {
    return (
      <>
        <style>{googleFonts + baseStyles}</style>
        <div style={{ minHeight: '100vh', background: '#f0f6fc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 'clamp(52px, 14vw, 88px)', color: '#0a2a40', lineHeight: 0.88, letterSpacing: '0.04em', textAlign: 'center' }}>
              FISH<br />STALE.
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: '#6a8aaa', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '8px' }}>
              Data old. People mad. Fix now.
            </div>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Passcode"
              style={{ width: '100%', background: 'white', border: '1px solid #c8d8e8', padding: '14px 16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', color: '#0a2a40', outline: 'none' }}
            />
            {pinError && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', color: '#aa4a40', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{pinError}</div>}
            <button onClick={handleLogin} style={{ width: '100%', background: '#0a2a40', color: '#e8f4fc', fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', letterSpacing: '0.12em', padding: '16px 32px', border: 'none', cursor: 'pointer' }}>
              ENTER
            </button>
          </div>
        </div>
        <div style={{ position: 'fixed', bottom: '14px', right: '16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '8px', color: '#c0d0e0', letterSpacing: '0.08em' }}>schnapp.bet/fish</div>
      </>
    );
  }

  return (
    <>
      <style>{googleFonts + baseStyles + buttonStyles}</style>
      <div style={{ minHeight: '100vh', background: '#f0f6fc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 'clamp(52px, 14vw, 88px)', color: '#0a2a40', lineHeight: 0.88, letterSpacing: '0.04em' }}>
            FISH<br />STALE.
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: '#6a8aaa', letterSpacing: '0.15em', textTransform: 'uppercase', marginTop: '14px', marginBottom: '32px' }}>
            Data old. People mad. Fix now.
          </div>

          <button
            id="fish-btn"
            onClick={runSync}
            disabled={runState === 'running'}
            style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: btnBg, color: '#e8f4fc', fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', letterSpacing: '0.12em', padding: '16px 32px', border: 'none', cursor: runState === 'running' ? 'not-allowed' : 'pointer', overflow: 'hidden', opacity: runState === 'running' ? 0.8 : 1, transition: 'background 0.18s ease' }}
          >
            <span className={runState === 'running' ? 'spin-icon' : ''} style={{ width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8f4fc" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </span>
            {btnLabel}
          </button>

          <div style={{ marginTop: '12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: statusClass === 'ok' ? '#3a9a68' : statusClass === 'running' ? '#2a7ab8' : '#aa4a40', minHeight: '14px' }}>
            {statusMsg}
          </div>

          <button onClick={signOut} style={{ marginTop: '32px', background: 'none', border: 'none', fontFamily: "'IBM Plex Mono', monospace", fontSize: '8px', color: '#b0c4d4', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
            sign out
          </button>
        </div>
      </div>
      <div style={{ position: 'fixed', bottom: '14px', right: '16px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '8px', color: '#c0d0e0', letterSpacing: '0.08em' }}>schnapp.bet/fish</div>
    </>
  );
}

const googleFonts = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&display=swap');`;

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; }
`;

const buttonStyles = `
  #fish-btn::after {
    content: '';
    position: absolute;
    top: 0; left: -100%;
    width: 60%; height: 100%;
    background: linear-gradient(105deg, transparent 30%, rgba(232,244,252,0.12) 50%, transparent 70%);
    pointer-events: none;
  }
  #fish-btn:not(:disabled):hover::after { animation: shimmer 0.55s ease forwards; }
  #fish-btn:not(:disabled):hover { filter: brightness(0.85); transform: translateY(-2px); box-shadow: 0 6px 24px rgba(10,42,64,0.28); }
  @keyframes shimmer { 0% { left: -80%; } 100% { left: 140%; } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spin-icon { animation: spin 0.8s linear infinite; }
`;
