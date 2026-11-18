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
        description="Vento, raffiche e onda per il porto. Se le raffiche previste superano la soglia, da qui mandi l'avviso ai diportisti."
      />
      <PortWeatherCard marinaId={ctx.marinaId} role={ctx.role} full />
      <p className="mt-4 text-xs text-muted">
        Previsioni indicative di Open-Meteo. Per la navigazione fanno fede i bollettini ufficiali (meteomar, avvisi della Capitaneria).
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
