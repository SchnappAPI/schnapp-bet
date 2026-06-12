import type { Metadata } from 'next';

// /naa — public placeholder landing page (reachable via QR code).
// Renders outside PasscodeGate and the app Shell (see lib/public-paths.ts),
// so it is publicly viewable with no access code and no app chrome.
// Self-contained: depends on no auth/shell context. Edit freely.

export const metadata: Metadata = {
  title: 'NAA — Schnapp',
  robots: { index: false, follow: false },
};

export default function NaaPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-6">
        <span className="text-3xl font-bold">S</span>
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">NAA</h1>
      <p className="mt-3 text-sm text-gray-500">Coming soon.</p>
    </main>
  );
}
