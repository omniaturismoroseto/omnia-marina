import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Omnia Marina — gestione del porto",
    short_name: "Omnia Marina",
    description: "Posti barca, contratti, banchina e contabilità del porto turistico.",
    lang: "it",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f3ec",
    theme_color: "#0c2130",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
