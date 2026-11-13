import type { Metadata, Viewport } from "next";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/fraunces";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Omnia Marina", template: "%s · Omnia Marina" },
  description: "Gestione del porto turistico: posti barca, contratti, banchina e contabilità interna.",
  applicationName: "Omnia Marina",
  appleWebApp: { capable: true, title: "Omnia Marina", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0c2130",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
