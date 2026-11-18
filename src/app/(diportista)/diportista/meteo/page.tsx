import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { TriangleAlert } from "lucide-react";
import { page } from "@/components/page";
import { DaysRow, HourlyTable, NowBlock } from "@/components/port-weather";
import { Card } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireOwner } from "@/lib/context";
import { currentHour, dailySummary, whenLabel, windAlert, windName } from "@/lib/weather";
import { nowRomeLocal, portForecast } from "@/server/weather";

export const metadata: Metadata = { title: "Meteo" };

export default page(async function OwnerWeatherPage() {
  const ctx = await requireOwner();
  const [marina] = await db
    .select({ latitude: marinas.latitude, longitude: marinas.longitude, threshold: marinas.windAlertKnots, vhf: marinas.vhfChannel })
    .from(marinas)
    .where(eq(marinas.id, ctx.marinaId));
  const hours = await portForecast(marina.latitude, marina.longitude);
  const now = nowRomeLocal();
  const today = now.slice(0, 10);

  if (!hours) {
    return (
      <>
        <h1 className="font-display text-3xl font-semibold text-ink">Meteo</h1>
        <Card className="mt-6">
          <p className="text-sm text-muted">
            {marina.latitude === null ? "Il porto non ha ancora attivato le previsioni." : "Previsioni non disponibili in questo momento: riprova più tardi."}
          </p>
        </Card>
      </>
    );
  }

  const current = currentHour(hours, now);
  const alert = windAlert(hours, marina.threshold, now);

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Meteo</h1>
      <p className="mt-1 text-[15px] text-muted">Previsioni per {ctx.marinaName}.</p>

      <div className="mt-6 space-y-5">
        {alert && (
          <div className="flex items-start gap-3 rounded-lg bg-bad px-4 py-3 text-white">
            <TriangleAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p className="text-sm">
              <strong>Vento forte previsto:</strong> raffiche fino a {alert.maxGustKn} nodi da {windName(alert.dir).name}, {whenLabel(alert.at, today)}. Controlla
              gli ormeggi.
            </p>
          </div>
        )}

        {current && (
          <Card>
            <NowBlock hour={current} />
          </Card>
        )}

        <Card title="Prossime 24 ore" flush>
          <HourlyTable hours={hours} now={now} threshold={marina.threshold} />
        </Card>

        <Card title="Prossimi giorni">
          <DaysRow days={dailySummary(hours)} today={today} threshold={marina.threshold} />
        </Card>

        <p className="text-xs text-muted">
          Previsioni indicative di Open-Meteo per la posizione del porto. Prima di uscire consulta i bollettini ufficiali (meteomar dell&apos;Aeronautica
          Militare, avvisi della Capitaneria)
          {marina.vhf ? ` e ascolta il canale VHF ${marina.vhf}` : ""}.
        </p>
      </div>
    </>
  );
});
