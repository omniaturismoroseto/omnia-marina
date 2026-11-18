import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowUp, TriangleAlert, Waves } from "lucide-react";
import { ButtonLink, Card } from "@/components/ui";
import { db } from "@/db";
import { marinas, type Role } from "@/db/schema";
import { formatDateTime } from "@/lib/dates";
import { alertMessage, currentHour, dailySummary, weatherLabel, whenLabel, windAlert, windName, type DaySummary, type WeatherHour } from "@/lib/weather";
import { alertSentRecently, nowRomeLocal, portForecast } from "@/server/weather";

const SHORT_DAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

export function dayName(date: string, today: string): string {
  if (date === today) return "Oggi";
  const d = new Date(`${date}T12:00:00Z`);
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Freccia che indica dove va il vento (opposta a quella da cui soffia). */
export function WindArrow({ deg, size = 16 }: { deg: number; size?: number }) {
  return <ArrowUp size={size} aria-hidden="true" style={{ transform: `rotate(${deg + 180}deg)` }} className="shrink-0" />;
}

export function NowBlock({ hour }: { hour: WeatherHour }) {
  const wind = windName(hour.windDir);
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <div>
        <p className="text-xs text-muted">Vento ora</p>
        <p className="flex items-center gap-1.5 font-display text-3xl font-semibold text-ink">
          <WindArrow deg={hour.windDir} size={22} />
          {hour.windKn} <span className="text-base font-normal text-muted">nodi</span>
        </p>
        <p className="text-sm text-muted">
          da {wind.short} ({wind.name}) · raffiche {hour.gustKn}
        </p>
      </div>
      {hour.waveM !== null && (
        <div>
          <p className="text-xs text-muted">Onda</p>
          <p className="flex items-center gap-1.5 font-display text-3xl font-semibold text-ink">
            <Waves size={22} aria-hidden="true" />
            {hour.waveM.toFixed(1).replace(".", ",")} <span className="text-base font-normal text-muted">m</span>
          </p>
        </div>
      )}
      <div>
        <p className="text-xs text-muted">Tempo</p>
        <p className="font-display text-3xl font-semibold text-ink">{hour.tempC}°</p>
        <p className="text-sm text-muted">{weatherLabel(hour.code)}</p>
      </div>
    </div>
  );
}

export function DaysRow({ days, today, threshold }: { days: DaySummary[]; today: string; threshold: number }) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {days.map((d) => {
        const strong = d.maxGustKn >= threshold;
        return (
          <li key={d.date} className={`rounded-md border p-2.5 ${strong ? "border-bad/40 bg-bad-soft" : "border-line-soft"}`}>
            <p className="text-xs font-semibold text-ink">{dayName(d.date, today)}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-ink">
              <WindArrow deg={d.gustDir} size={14} />
              {d.maxWindKn} kn
            </p>
            <p className={`text-xs ${strong ? "font-semibold text-bad" : "text-muted"}`}>raffiche {d.maxGustKn}</p>
            {d.maxWaveM !== null && <p className="text-xs text-muted">onda {d.maxWaveM.toFixed(1).replace(".", ",")} m</p>}
            <p className="text-xs text-muted">
              {weatherLabel(d.code)} · {d.minTempC}°/{d.maxTempC}°
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Ora per ora (una riga ogni 3 ore) a partire da adesso; in rosso le ore con raffiche oltre la soglia. */
export function HourlyTable({ hours, now, threshold, hoursAhead = 24 }: { hours: WeatherHour[]; now: string; threshold: number; hoursAhead?: number }) {
  const today = now.slice(0, 10);
  const start = Math.max(
    0,
    hours.findIndex((h) => h.time >= `${now.slice(0, 13)}:00`),
  );
  const rows = hours.slice(start, start + hoursAhead).filter((_, i) => i % 3 === 0);
  return (
    <>
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
          {rows.map((h) => (
            <tr key={h.time} className={h.gustKn >= threshold ? "bg-bad-soft" : undefined}>
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
              <td className={`px-2 py-2 tabular-nums ${h.gustKn >= threshold ? "font-semibold text-bad" : ""}`}>{h.gustKn}</td>
              <td className="px-2 py-2 tabular-nums">{h.waveM === null ? "—" : h.waveM.toFixed(1).replace(".", ",")}</td>
              <td className="px-4 py-2 whitespace-nowrap text-muted">
                {h.tempC}° <span className="hidden sm:inline">· {weatherLabel(h.code)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 pt-1 pb-3 text-xs text-faint">Vento e raffiche in nodi.</p>
    </>
  );
}

/**
 * Meteo del porto per il personale (cruscotto, banchina e pagina «Meteo»): vento adesso, prossimi giorni e, se le
 * raffiche superano la soglia, l'allerta pronta da inviare. Con `full` aggiunge l'andamento ora per ora.
 * La banchina non scrive a tutti: per lei l'avviso va a chi è in porto (lo può cambiare prima di inviare).
 */
export async function PortWeatherCard({ marinaId, role, full = false }: { marinaId: string; role: Role; full?: boolean }) {
  const isAdmin = role === "admin";
  const [marina] = await db
    .select({
      latitude: marinas.latitude,
      longitude: marinas.longitude,
      threshold: marinas.windAlertKnots,
      auto: marinas.windAlertAuto,
      sentAt: marinas.windAlertSentAt,
    })
    .from(marinas)
    .where(eq(marinas.id, marinaId));
  if (marina.latitude === null || marina.longitude === null) {
    return (
      <Card title="Meteo del porto">
        <p className="text-sm text-muted">
          Per vedere vento e onda e ricevere le allerte, inserisci la posizione del porto
          {isAdmin ? (
            <>
              {" "}
              in{" "}
              <Link href="/impostazioni" className="link">
                Impostazioni → Porto
              </Link>
            </>
          ) : (
            " (lo fa la direzione, da Impostazioni → Porto)"
          )}
          .
        </p>
      </Card>
    );
  }
  const hours = await portForecast(marina.latitude, marina.longitude);
  if (!hours) {
    return (
      <Card title="Meteo del porto">
        <p className="text-sm text-muted">Previsioni non disponibili in questo momento: riprova più tardi.</p>
      </Card>
    );
  }
  const now = nowRomeLocal();
  const today = now.slice(0, 10);
  const current = currentHour(hours, now);
  const alert = windAlert(hours, marina.threshold, now);
  const recentlySent = alertSentRecently(marina.sentAt);
  const proposal = alert ? alertMessage(alert, today) : null;
  const audience = role === "banchina" ? "in_porto" : "tutti";
  const href = proposal
    ? `/messaggi/nuovo?${new URLSearchParams({ a: audience, tipo: "urgente", titolo: proposal.title, testo: proposal.body, allerta: "1" })}`
    : null;
  const sendLabel = recentlySent ? "Manda un altro avviso" : audience === "tutti" ? "Avvisa i clienti" : "Avvisa chi è in porto";

  return (
    <Card
      title="Meteo del porto"
      actions={
        full ? (
          <span className="text-xs text-faint">Open-Meteo · indicativo</span>
        ) : (
          <Link href="/meteo" className="link text-sm">
            Apri il meteo
          </Link>
        )
      }
      flush={full}
    >
      <div className={full ? "p-4" : undefined}>
        {alert && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-bad-soft px-3 py-2.5 text-bad">
            <TriangleAlert size={18} aria-hidden="true" className="shrink-0" />
            <p className="min-w-0 flex-1 text-sm">
              <strong>Raffiche fino a {alert.maxGustKn} nodi</strong> da {windName(alert.dir).name}, {whenLabel(alert.at, today)} (soglia {marina.threshold}).
              {recentlySent && ` Allerta inviata il ${formatDateTime(marina.sentAt)}.`}
              {!recentlySent && marina.auto && " L'allerta parte da sola al prossimo controllo."}
            </p>
            {href && (
              <ButtonLink href={href} size="sm" variant={recentlySent ? "secondary" : "danger"}>
                {sendLabel}
              </ButtonLink>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          {current && <NowBlock hour={current} />}
          <DaysRow days={dailySummary(hours)} today={today} threshold={marina.threshold} />
        </div>
      </div>
      {full && (
        <div className="border-t border-line-soft">
          <p className="px-4 pt-3 text-sm font-semibold text-ink">Prossime 48 ore</p>
          <HourlyTable hours={hours} now={now} threshold={marina.threshold} hoursAhead={48} />
        </div>
      )}
    </Card>
  );
}
