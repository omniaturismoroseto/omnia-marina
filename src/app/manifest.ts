import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Il nome con cui l'app compare quando la si installa su PC, telefono o tablet.
    name: "Omnia Marina Gestionale",
    short_name: "Omnia Marina Gestionale",
    description: "Posti barca, contratti, banchina e contabilità del porto turistico.",
    lang: "it",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f3ec",
    theme_color: "#101e35",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
