import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { TriangleAlert } from "lucide-react";
import { page } from "@/components/page";
import { DaysRow, NowBlock, WindArrow, dayName } from "@/components/port-weather";
import { Card } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireOwner } from "@/lib/context";
import { currentHour, dailySummary, weatherLabel, whenLabel, windAlert, windName } from "@/lib/weather";
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
  // Le prossime 24 ore, una riga ogni 3 ore.
  const start = hours.findIndex((h) => h.time >= `${now.slice(0, 13)}:00`);
  const next = hours.slice(Math.max(0, start), Math.max(0, start) + 24).filter((_, i) => i % 3 === 0);

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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Ora</th>
                <th className="px-2 py-2 font-medium">Vento</th>
                <th className="px-2 py-2 font-medium">Raffiche</th>
                <th className="px-2 py-2 font-medium">Onda (m)</th>
                <th className="px-4 py-2 font-medium">Tempo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {next.map((h) => (
                <tr key={h.time} className={h.gustKn >= marina.threshold ? "bg-bad-soft" : undefined}>
                  <td className="px-4 py-2 text-ink">
                    {h.time.slice(0, 10) !== today && <span className="block text-xs text-muted">{dayName(h.time.slice(0, 10), today)}</span>}
                    {h.time.slice(11, 16)}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <WindArrow deg={h.windDir} size={14} />
                      {windName(h.windDir).short} {h.windKn}
                    </span>
                  </td>
                  <td className={`px-2 py-2 tabular-nums ${h.gustKn >= marina.threshold ? "font-semibold text-bad" : ""}`}>{h.gustKn}</td>
                  <td className="px-2 py-2 tabular-nums">{h.waveM === null ? "—" : h.waveM.toFixed(1).replace(".", ",")}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">
                    {h.tempC}° <span className="hidden sm:inline">· {weatherLabel(h.code)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 text-xs text-faint">Vento e raffiche in nodi.</p>
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
