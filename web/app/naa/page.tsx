import type { Metadata } from 'next';

// /naa — public placeholder landing page (reachable via QR code).
// Renders outside PasscodeGate and the app Shell (see lib/public-paths.ts),
// so it is publicly viewable with no access code and no app chrome.
// Self-contained: depends on no auth/shell context. Edit freely.
//
// Background is matched to the logo's baked-in navy (#070d19) so the
// (non-transparent) logo blends edge-to-edge.

export const metadata: Metadata = {
  title: 'NAA — Schnapp',
  robots: { index: false, follow: false },
};

export default function NaaPage() {
  return (
    <main className="min-h-screen bg-[#070d19] text-white flex flex-col items-center justify-center px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/schnapp-logo.webp"
        alt="schnapp.bet"
        width={640}
        height={613}
        className="w-56 h-auto max-w-[70vw] select-none"
      />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">NAA</h1>
      <p className="mt-2 text-sm text-gray-400">Coming soon.</p>
    </main>
  );
}
