import type { Metadata } from "next";
import Link from "next/link";
import { page } from "@/components/page";
import { PortWeatherCard } from "@/components/port-weather";
import { PageHeader } from "@/components/ui";
import { EVERYONE, requireMarina } from "@/lib/context";

export const metadata: Metadata = { title: "Meteo" };

// Meteo del porto per direzione, ufficio e banchina: previsioni e, oltre la soglia, l'avviso da mandare ai diportisti.
export default page(async function StaffWeatherPage() {
  const ctx = await requireMarina(EVERYONE);
  return (
    <>
      <PageHeader
        help="meteo"
        title="Meteo"
        description="Vento, mare (onda, mare lungo, corrente, livello) e allerte della Protezione Civile per il porto. Con burrasca, vento o mare oltre soglia, o allerta arancione o rossa, da qui mandi l'avviso ai diportisti."
      />
      <PortWeatherCard marinaId={ctx.marinaId} role={ctx.role} full />
      <p className="mt-4 text-xs text-muted">
        Previsioni indicative di Open-Meteo e bollettino nazionale di criticità della Protezione Civile. Per la navigazione fanno fede i bollettini
        ufficiali: avvisi di burrasca e meteomar dell&apos;Aeronautica Militare, avvisi della Capitaneria; per le allerte, quella della Regione.
        {ctx.role === "admin" && (
          <>
            {" "}
            Posizione del porto, soglia e invio automatico in{" "}
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
