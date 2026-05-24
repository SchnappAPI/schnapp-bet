import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import PasscodeGate from "@/components/PasscodeGate";
import { Shell } from "@/components/shell/Shell";

export const metadata: Metadata = {
  title: "Schnapp",
  description: "NBA, NFL, and MLB prop betting research",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Schnapp",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#08090A",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            // Register the service worker only in production. In dev the SW
            // intercepts every navigation, caches stale shell HTML, and makes
            // hot-reload effectively invisible — the first thing developers
            // see after a code change is the old page. Unregister any prior
            // dev-registered SW on every load so previously-poisoned browsers
            // self-heal without DevTools surgery.
            __html: `
              if ('serviceWorker' in navigator) {
                if (${process.env.NODE_ENV === "production" ? "true" : "false"}) {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js');
                  });
                } else {
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    regs.forEach(function(r) { r.unregister(); });
                  });
                  if (window.caches && caches.keys) {
                    caches.keys().then(function(keys) {
                      keys.forEach(function(k) { caches.delete(k); });
                    });
                  }
                }
              }
            `,
          }}
        />
      </head>
      <body
        className="bg-canvas text-fg min-h-screen"
        data-density="compact"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <PasscodeGate>
          <Shell>{children}</Shell>
        </PasscodeGate>
      </body>
    </html>
  );
}
