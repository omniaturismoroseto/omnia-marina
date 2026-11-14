import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" produce un server autonomo in .next/standalone: è ciò che finisce nell'immagine Docker.
  output: "standalone",
  poweredByHeader: false,
  // Intestazioni di sicurezza, solo in produzione: l'app non può essere incorniciata in altri siti
  // e il browser non deve "indovinare" il tipo dei file.
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    // Con EMBEDDED_PREVIEW=true (solo anteprime, vedi .env.example) l'app può essere incorniciata.
    const embedded = process.env.EMBEDDED_PREVIEW === "true";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(embedded ? [] : [{ key: "X-Frame-Options", value: "SAMEORIGIN" }]),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
