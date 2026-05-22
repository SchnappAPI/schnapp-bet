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
  const [runMsg, setRunMsg] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_KEY);
    if (stored) {
      setSavedPin(stored);
      setAuthed(true);
    }
  }, []);

  async function handleLogin() {
    setPinError('');
    // Validate the pin against the admin codes endpoint (same gate as admin page).
    const res = await fetch('/api/admin/codes', {
      headers: { 'x-admin-token': pin },
    });
    if (res.ok) {
      localStorage.setItem(ADMIN_KEY, pin);
      setSavedPin(pin);
      setAuthed(true);
    } else {
      setPinError('Wrong passcode.');
    }
  }

  async function runSync() {
    setRunState('running');
    setRunMsg('Dispatching workflow...');
    try {
      const res = await fetch('/api/fish-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': savedPin,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunState('error');
        setRunMsg(data.error ?? 'Dispatch failed.');
        return;
      }
      setRunState('done');
      setRunMsg(
        data.runId
          ? `Workflow dispatched — run #${data.runId}. Check GitHub Actions for progress.`
          : 'Workflow dispatched. Check GitHub Actions for progress.'
      );
    } catch (e) {
      setRunState('error');
      setRunMsg(e instanceof Error ? e.message : 'Unknown error.');
    }
  }

  function reset() {
    setRunState('idle');
    setRunMsg('');
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-3">
          <h1 className="text-lg font-semibold text-white text-center mb-6">
            Fish Sync
          </h1>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Admin passcode"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gray-500"
          />
          {pinError && (
            <p className="text-sm text-red-400 text-center">{pinError}</p>
          )}
          <button
            onClick={handleLogin}
            className="w-full bg-white text-gray-950 rounded-xl py-3 font-semibold text-sm active:scale-95 transition-transform"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold text-white">Fish Sync</h1>
          <a
            href="/"
            className="text-xs text-gray-500 border border-gray-700 rounded-lg px-3 py-1.5"
          >
            Home
          </a>
        </div>

        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-white">AppFolio CSV Export</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Exports Units, Residents, and Occupancy CSVs from AppFolio, uploads
              them to Dropbox, and refreshes the three Quickbase FISH tables.
              Takes roughly 2 to 3 minutes.
            </p>
          </div>

          {runState === 'idle' && (
            <button
              onClick={runSync}
              className="w-full bg-white text-gray-950 rounded-lg py-3 font-semibold text-sm active:scale-95 transition-transform"
            >
              Run Fish Sync
            </button>
          )}

          {runState === 'running' && (
            <button
              disabled
              className="w-full bg-white text-gray-950 rounded-lg py-3 font-semibold text-sm opacity-50 cursor-not-allowed"
            >
              Dispatching...
            </button>
          )}

          {(runState === 'done' || runState === 'error') && (
            <>
              <p
                className={`text-xs leading-relaxed ${
                  runState === 'error' ? 'text-red-400' : 'text-green-400'
                }`}
              >
                {runMsg}
              </p>
              <button
                onClick={reset}
                className="w-full border border-gray-700 text-gray-300 rounded-lg py-2.5 text-sm active:scale-95 transition-transform"
              >
                Run again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
