import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Omnia Marina Gestionale", template: "%s · Omnia Marina" },
  description: "Gestione del porto turistico: posti barca, contratti, banchina e contabilità interna.",
  applicationName: "Omnia Marina Gestionale",
  appleWebApp: { capable: true, title: "Omnia Marina Gestionale", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#101e35",
  // L'app ha solo il tema chiaro, ma dichiara «light dark»: Samsung Internet ignora «only light» e scurisce da solo
  // le pagine che non gestiscono il tema scuro; così invece crede che lo gestiamo noi (globals.css: nel tema scuro
  // gli stessi colori chiari) e non tocca niente. Vale anche per lo scurimento automatico di Chrome.
  colorScheme: "light dark",
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
