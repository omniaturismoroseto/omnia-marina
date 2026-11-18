import type { Metadata } from "next";
import { page } from "@/components/page";
import { AlertStrip, CivilPanel, DaysRow, HourlyTable, SeaPanel, WindPanel } from "@/components/port-weather";
import { Card } from "@/components/ui";
import { requireOwner } from "@/lib/context";
import { currentHour, dailySummary } from "@/lib/weather";
import { portConditions } from "@/server/port-conditions";

export const metadata: Metadata = { title: "Meteo e mare" };

export default page(async function OwnerWeatherPage() {
  const ctx = await requireOwner();
  const c = await portConditions(ctx.marinaId);
  const current = c.hours ? currentHour(c.hours, c.now) : null;

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Meteo e mare</h1>
      <p className="mt-1 text-[15px] text-muted">Vento, onda, corrente e allerte per {ctx.marinaName}.</p>

      <div className="mt-6 space-y-5">
        <AlertStrip c={c} />

        {current && c.hours ? (
          <Card>
            <div className="space-y-5">
              <WindPanel hour={current} />
              <SeaPanel hour={current} hours={c.hours} now={c.now} />
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-muted">{c.hasPosition ? "Previsioni non disponibili in questo momento: riprova più tardi." : "Il porto non ha ancora attivato le previsioni."}</p>
          </Card>
        )}

        <Card>
          <CivilPanel civil={c.civil} today={c.today} />
        </Card>

        {c.hours && (
          <>
            <Card title="Prossime 24 ore" flush>
              <HourlyTable hours={c.hours} now={c.now} thresholds={c.thresholds} />
            </Card>
            <Card title="Prossimi giorni">
              <DaysRow days={dailySummary(c.hours)} today={c.today} thresholds={c.thresholds} outlook={c.civil?.outlook} />
            </Card>
          </>
        )}

        <p className="text-xs text-muted">
          Previsioni indicative di Open-Meteo per la posizione del porto e bollettino nazionale di criticità della Protezione Civile. Prima di uscire
          consulta i bollettini ufficiali (avvisi di burrasca e meteomar dell&apos;Aeronautica Militare, avvisi della Capitaneria)
          {c.vhf ? ` e ascolta il canale VHF ${c.vhf}` : ""}.
        </p>
      </div>
    </>
  );
});
