import type { Metadata } from "next";
import Link from "next/link";
import { page } from "@/components/page";
import { PortWeatherCard } from "@/components/port-weather";
import { PageHeader } from "@/components/ui";
import { EVERYONE, requireMarina } from "@/lib/context";

export const metadata: Metadata = { title: "Allerte meteo e mare" };

// Meteo del porto per direzione, ufficio e banchina: previsioni e, oltre la soglia, l'avviso da mandare ai diportisti.
export default page(async function StaffWeatherPage() {
  const ctx = await requireMarina(EVERYONE);
  return (
    <>
      <PageHeader
        help="meteo"
        title="Allerte"
        description="Burrasca e mare agitato vicino al porto e criticità della zona, dai bollettini ufficiali della Protezione Civile. Quando serve, da qui mandi l'avviso ai diportisti."
      />
      <PortWeatherCard marinaId={ctx.marinaId} role={ctx.role} full />
      <p className="mt-4 text-xs text-muted">
        I bollettini della Protezione Civile escono ogni giorno nel primo pomeriggio. Per la navigazione fanno fede anche gli avvisi di burrasca e il
        meteomar dell&apos;Aeronautica Militare e gli avvisi della Capitaneria; per le allerte, quella della Regione.
        {ctx.role === "admin" && (
          <>
            {" "}
            Posizione del porto, zona di allerta e invio automatico in{" "}
            <Link href="/impostazioni" className="link">
              Impostazioni → Porto
            </Link>
            .
          </>
        )}
      </p>
    </>
  );
});
