import Link from "next/link";
import { ArrowUp, ShieldAlert, TriangleAlert, Waves, Wind } from "@/components/icons";
import { ButtonLink, Card } from "@/components/ui";
import type { Role } from "@/db/schema";
import { CIVIL_LEVEL_LABEL, CIVIL_RISKS, NEARBY_KM, type CivilLevel, type PortVigilanceDay, type ZoneOutlook } from "@/lib/civil-protection";
import { formatDateTime } from "@/lib/dates";
import {
  GALE_KN,
  alertLine,
  beaufort,
  currentHour,
  dailySummary,
  formatMeters,
  seaState,
  tideTurns,
  towards,
  weatherLabel,
  whenLabel,
  windName,
  type DaySummary,
  type WeatherHour,
} from "@/lib/weather";
import { portConditions, type PortConditions } from "@/server/port-conditions";

const SHORT_DAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function dayName(date: string, today: string): string {
  if (date === today) return "Oggi";
  const d = new Date(`${date}T12:00:00Z`);
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Freccia nel verso del movimento: per vento e onda opposta alla provenienza, per la corrente già «verso». */
export function DirArrow({ deg, from = true, size = 16 }: { deg: number; from?: boolean; size?: number }) {
  return <ArrowUp size={size} aria-hidden="true" style={{ transform: `rotate(${deg + (from ? 180 : 0)}deg)` }} className="shrink-0" />;
}

const LEVEL_CLASS: Record<CivilLevel, string> = {
  verde: "bg-ok-soft text-ok",
  gialla: "bg-yellow-100 text-yellow-900",
  arancione: "bg-orange-100 text-orange-900",
  rossa: "bg-bad-soft text-bad",
};

export function CivilBadge({ level, label }: { level: CivilLevel; label?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASS[level]}`}>{label ?? CIVIL_LEVEL_LABEL[level]}</span>;
}

function Stat({ label, value, unit, sub }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="flex items-center gap-1.5 font-display text-2xl font-semibold text-ink">
        {value}
        {unit && <span className="text-sm font-normal text-muted">{unit}</span>}
      </p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Vento adesso: nodi, forza Beaufort, raffiche, direzione. */
export function WindPanel({ hour }: { hour: WeatherHour }) {
  const bf = beaufort(hour.windKn);
  const wind = windName(hour.windDir);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">Vento</h3>
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Medio"
          value={
            <>
              <DirArrow deg={hour.windDir} size={18} />
              {hour.windKn}
            </>
          }
          unit="nodi"
          sub={`da ${wind.short} (${wind.name})`}
        />
        <Stat label="Raffiche" value={hour.gustKn} unit="nodi" sub={`Forza ${bf.force} · ${bf.label.toLowerCase()}`} />
      </div>
    </section>
  );
}

/** Mare adesso: onda e stato del mare, mare lungo, corrente, livello (marea) e temperatura dell'acqua. */
export function SeaPanel({ hour, hours, now }: { hour: WeatherHour; hours: WeatherHour[]; now: string }) {
  const today = now.slice(0, 10);
  const tides = tideTurns(hours, now).slice(0, 2);
  const hasSea = hour.waveM !== null || hour.currentKn !== null || hour.seaLevelM !== null;
  if (!hasSea) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">Mare</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {hour.waveM !== null && (
          <Stat
            label="Onda"
            value={
              <>
                {hour.waveDir !== null && <DirArrow deg={hour.waveDir} size={18} />}
                {formatMeters(hour.waveM)}
              </>
            }
            unit="m"
            sub={`${seaState(hour.waveM).label}${hour.wavePeriodS ? ` · periodo ${hour.wavePeriodS} s` : ""}${hour.waveDir !== null ? ` · da ${windName(hour.waveDir).short}` : ""}`}
          />
        )}
        {hour.swellM !== null && (
          <Stat
            label="Mare lungo"
            value={formatMeters(hour.swellM)}
            unit="m"
            sub={`${hour.swellPeriodS ? `periodo ${hour.swellPeriodS} s` : ""}${hour.swellDir !== null ? ` · da ${windName(hour.swellDir).short}` : ""}`}
          />
        )}
        {hour.currentKn !== null && (
          <Stat
            label="Corrente"
            value={
              <>
                {hour.currentDir !== null && <DirArrow deg={hour.currentDir} from={false} size={18} />}
                {formatMeters(hour.currentKn)}
              </>
            }
            unit="nodi"
            sub={hour.currentDir !== null ? `verso ${towards(hour.currentDir)}` : undefined}
          />
        )}
        {hour.seaLevelM !== null && (
          <Stat
            label="Livello del mare"
            value={`${hour.seaLevelM > 0 ? "+" : ""}${formatMeters(hour.seaLevelM, 2)}`}
            unit="m"
            sub={tides.length ? tides.map((t) => `${t.kind} ${whenLabel(t.time, today).replace(" alle ", " ")}:00`).join(" · ") : undefined}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {hour.seaTempC !== null ? `Acqua ${hour.seaTempC}° · ` : ""}
        {weatherLabel(hour.code)}, aria {hour.tempC}°
      </p>
    </section>
  );
}

/** Bollettino di vigilanza: vento e mare vicino al porto (simboli entro NEARBY_KM) e testi nazionali. */
export function VigilancePanel({ vigilance, today, hasPosition, isAdmin = false }: { vigilance: PortConditions["vigilance"]; today: string; hasPosition: boolean; isAdmin?: boolean }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Wind size={16} aria-hidden="true" />
        Vento e mare · Protezione Civile
      </h3>
      {!hasPosition ? (
        <p className="text-sm text-muted">
          Per sapere se burrasca e mare agitato riguardano il porto serve la sua posizione
          {isAdmin ? (
            <>
              {" "}
              (
              <Link href="/impostazioni" className="link">
                Impostazioni → Porto
              </Link>
              )
            </>
          ) : (
            " (la inserisce la direzione in Impostazioni → Porto)"
          )}
          .
        </p>
      ) : !vigilance ? (
        <p className="text-sm text-muted">Bollettino di vigilanza non disponibile in questo momento.</p>
      ) : (
        <ul className="space-y-3">
          {vigilance.days.map((d: PortVigilanceDay) => (
            <li key={d.date}>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="w-16 font-medium text-ink">{dayName(d.date, today)}</span>
                {d.nearby.length === 0 ? (
                  <span className="inline-flex rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">Niente di rilevante vicino al porto</span>
                ) : (
                  d.nearby.map((p) => (
                    <span
                      key={p.code}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${p.severe ? "bg-bad-soft text-bad" : "bg-yellow-100 text-yellow-900"}`}
                      title={`A ${p.km} km dal porto`}
                    >
                      {p.group === "vento" ? <Wind size={12} aria-hidden="true" /> : <Waves size={12} aria-hidden="true" />}
                      {p.label}
                    </span>
                  ))
                )}
              </div>
              {(d.windText || d.seaText) && (
                <details className="mt-1 pl-[4.375rem]">
                  <summary className="cursor-pointer text-xs text-muted">Testo nazionale su venti e mari</summary>
                  {d.windText && (
                    <p className="mt-1 text-xs text-ink">
                      <strong>Venti:</strong> {d.windText}
                    </p>
                  )}
                  {d.seaText && (
                    <p className="mt-1 text-xs text-ink">
                      <strong>Mari:</strong> {d.seaText}
                    </p>
                  )}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {vigilance && (
        <p className="mt-2 text-xs text-faint">
          {vigilance.name}. Simboli di vento e mare entro {NEARBY_KM} km dal porto. Fonte: Dipartimento della Protezione Civile (CC BY 4.0).
        </p>
      )}
    </section>
  );
}

/** Bollettino di criticità della Protezione Civile per la zona del porto. */
export function CivilPanel({ civil, today, isAdmin = false }: { civil: PortConditions["civil"]; today: string; isAdmin?: boolean }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <ShieldAlert size={16} aria-hidden="true" />
        Criticità idrogeologica e temporali · Protezione Civile
      </h3>
      {!civil ? (
        <p className="text-sm text-muted">Bollettino di criticità non disponibile in questo momento.</p>
      ) : !civil.zone ? (
        <p className="text-sm text-muted">
          Zona di allerta del porto non trovata dal Comune.{" "}
          {isAdmin ? (
            <Link href="/impostazioni" className="link">
              Sceglila in Impostazioni → Porto
            </Link>
          ) : (
            "La direzione può sceglierla in Impostazioni → Porto"
          )}
          .
        </p>
      ) : !civil.outlook ? (
        <p className="text-sm text-muted">Nessun bollettino valido per oggi per la zona «{civil.zone}».</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">Zona «{civil.outlook.zone}»</p>
          <ul className="space-y-2">
            {civil.outlook.days.map((d) => (
              <li key={d.date} className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="w-16 font-medium text-ink">{dayName(d.date, today)}</span>
                {d.max === "verde" ? (
                  <CivilBadge level="verde" />
                ) : (
                  CIVIL_RISKS.filter((r) => d.levels[r] !== "verde").map((r) => <CivilBadge key={r} level={d.levels[r]} label={`${CIVIL_LEVEL_LABEL[d.levels[r]]} · ${r}`} />)
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {civil && (
        <p className="mt-2 text-xs text-faint">{civil.bulletin.name}. Fonte: Dipartimento della Protezione Civile (CC BY 4.0); fa fede l&apos;allerta della Regione.</p>
      )}
    </section>
  );
}

export function DaysRow({ days, today, thresholds, outlook }: { days: DaySummary[]; today: string; thresholds: { gustKn: number; waveM: number }; outlook?: ZoneOutlook | null }) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {days.map((d) => {
        const strong = d.maxGustKn >= thresholds.gustKn || d.maxWindKn >= GALE_KN || (d.maxWaveM ?? 0) >= thresholds.waveM;
        const civil = outlook?.days.find((c) => c.date === d.date);
        return (
          <li key={d.date} className={`rounded-md border p-2.5 ${strong ? "border-bad/40 bg-bad-soft" : "border-line-soft"}`}>
            <p className="text-xs font-semibold text-ink">{dayName(d.date, today)}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-ink">
              <DirArrow deg={d.gustDir} size={14} />
              {d.maxWindKn} kn · F{beaufort(d.maxWindKn).force}
            </p>
            <p className={`text-xs ${d.maxGustKn >= thresholds.gustKn ? "font-semibold text-bad" : "text-muted"}`}>raffiche {d.maxGustKn}</p>
            {d.maxWaveM !== null && (
              <p className={`text-xs ${d.maxWaveM >= thresholds.waveM ? "font-semibold text-bad" : "text-muted"}`}>
                onda {formatMeters(d.maxWaveM)} m · {seaState(d.maxWaveM).label.toLowerCase()}
              </p>
            )}
            {d.maxCurrentKn !== null && <p className="text-xs text-muted">corrente fino a {formatMeters(d.maxCurrentKn)} kn</p>}
            {civil && civil.max !== "verde" && (
              <p className="mt-1">
                <CivilBadge level={civil.max} />
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Ora per ora (una riga ogni 3 ore) a partire da adesso; in rosso le ore oltre le soglie. Scorre di lato sul telefono. */
export function HourlyTable({ hours, now, thresholds, hoursAhead = 24 }: { hours: WeatherHour[]; now: string; thresholds: { gustKn: number; waveM: number }; hoursAhead?: number }) {
  const today = now.slice(0, 10);
  const start = Math.max(0, hours.findIndex((h) => h.time >= `${now.slice(0, 13)}:00`));
  const rows = hours.slice(start, start + hoursAhead).filter((_, i) => i % 3 === 0);
  const hasSwell = rows.some((h) => h.swellM !== null);
  const hasCurrent = rows.some((h) => h.currentKn !== null);
  const hasLevel = rows.some((h) => h.seaLevelM !== null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">Ora</th>
            <th className="px-2 py-2 font-medium">Vento (kn)</th>
            <th className="px-2 py-2 font-medium">Raffiche</th>
            <th className="px-2 py-2 font-medium">Onda (m)</th>
            {hasSwell && <th className="px-2 py-2 font-medium">Mare lungo</th>}
            {hasCurrent && <th className="px-2 py-2 font-medium">Corrente (kn)</th>}
            {hasLevel && <th className="px-2 py-2 font-medium">Livello (m)</th>}
            <th className="px-4 py-2 font-medium">Tempo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((h) => {
            const windy = h.gustKn >= thresholds.gustKn || h.windKn >= GALE_KN;
            const rough = (h.waveM ?? 0) >= thresholds.waveM;
            return (
              <tr key={h.time} className={windy || rough ? "bg-bad-soft" : undefined}>
                <td className="px-4 py-2 text-ink">
                  {h.time.slice(0, 10) !== today && <span className="block text-xs text-muted">{dayName(h.time.slice(0, 10), today)}</span>}
                  {h.time.slice(11, 16)}
                </td>
                <td className={`px-2 py-2 ${h.windKn >= GALE_KN ? "font-semibold text-bad" : ""}`}>
                  <span className="inline-flex items-center gap-1">
                    <DirArrow deg={h.windDir} size={14} />
                    {windName(h.windDir).short} {h.windKn} <span className="text-xs text-muted">F{beaufort(h.windKn).force}</span>
                  </span>
                </td>
                <td className={`px-2 py-2 tabular-nums ${h.gustKn >= thresholds.gustKn ? "font-semibold text-bad" : ""}`}>{h.gustKn}</td>
                <td className={`px-2 py-2 tabular-nums ${rough ? "font-semibold text-bad" : ""}`}>
                  {formatMeters(h.waveM)}
                  {h.wavePeriodS ? <span className="text-xs text-muted"> · {h.wavePeriodS}s</span> : null}
                  {h.waveDir !== null ? <span className="text-xs text-muted"> · {windName(h.waveDir).short}</span> : null}
                </td>
                {hasSwell && (
                  <td className="px-2 py-2 tabular-nums">
                    {formatMeters(h.swellM)}
                    {h.swellPeriodS ? <span className="text-xs text-muted"> · {h.swellPeriodS}s</span> : null}
                  </td>
                )}
                {hasCurrent && (
                  <td className="px-2 py-2 tabular-nums">
                    {formatMeters(h.currentKn)}
                    {h.currentDir !== null ? <span className="text-xs text-muted"> → {towards(h.currentDir)}</span> : null}
                  </td>
                )}
                {hasLevel && <td className="px-2 py-2 tabular-nums">{h.seaLevelM === null ? "—" : `${h.seaLevelM > 0 ? "+" : ""}${formatMeters(h.seaLevelM, 2)}`}</td>}
                <td className="px-4 py-2 text-muted">
                  {h.tempC}° · {weatherLabel(h.code)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 pt-1 pb-3 text-xs whitespace-normal text-faint">
        Vento in nodi con la forza Beaufort (F8 e oltre è burrasca). Onda significativa con periodo e provenienza; corrente con la direzione verso cui va;
        livello del mare rispetto al medio (marea e pressione), indicativo e non per la navigazione costiera.
      </p>
    </div>
  );
}

/** Striscia d'allerta: burrasca, raffiche, onda e Protezione Civile, con il pulsante per avvisare (personale). */
export function AlertStrip({ c, role }: { c: PortConditions; role?: Role }) {
  const civilAlert = c.civil?.outlook?.days.filter((d) => d.max === "arancione" || d.max === "rossa") ?? [];
  const seaWind = c.vigilance?.days.filter((d) => d.nearby.some((p) => p.severe)) ?? [];
  if (!c.worthSending) return null;
  const audience = role === "banchina" ? "in_porto" : "tutti";
  const href =
    role && c.proposal
      ? `/messaggi/nuovo?${new URLSearchParams({ a: audience, tipo: "urgente", titolo: c.proposal.title, testo: c.proposal.body, allerta: "1" })}`
      : null;
  const sendLabel = c.sentRecently ? "Manda un altro avviso" : audience === "tutti" ? "Avvisa i clienti" : "Avvisa chi è in porto";
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md bg-bad-soft px-3 py-2.5 text-bad">
      <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <ul className="space-y-0.5">
          {c.alerts.map((a) => (
            <li key={a.kind}>
              <strong>{a.kind === "burrasca" ? "Burrasca" : a.kind === "raffiche" ? "Vento forte" : "Mare agitato"}:</strong> {lowerFirst(alertLine(a, c.today).replace(/^Burrasca: /, ""))}
            </li>
          ))}
          {seaWind.map((d) => (
            <li key={`v-${d.date}`}>
              <strong>Vento e mare {d.date === c.today ? "oggi" : dayName(d.date, c.today)}:</strong>{" "}
              {d.nearby
                .filter((p) => p.severe)
                .map((p) => p.label.toLowerCase())
                .join(", ")}{" "}
              vicino al porto (Protezione Civile).
            </li>
          ))}
          {civilAlert.map((d) => (
            <li key={d.date}>
              <strong>Protezione Civile:</strong> {CIVIL_LEVEL_LABEL[d.max].toLowerCase()} {d.date === c.today ? "oggi" : "domani"} per{" "}
              {CIVIL_RISKS.filter((r) => d.levels[r] === d.max).join(", ")}.
            </li>
          ))}
        </ul>
        {role && c.sentRecently && <p className="mt-1 text-xs">Avviso inviato il {formatDateTime(c.sentAt)}.</p>}
        {role && !c.sentRecently && c.auto && <p className="mt-1 text-xs">L&apos;avviso parte da solo al prossimo controllo.</p>}
      </div>
      {href && (
        <ButtonLink href={href} size="sm" variant={c.sentRecently ? "secondary" : "danger"}>
          {sendLabel}
        </ButtonLink>
      )}
    </div>
  );
}

/**
 * Allerte del porto per il personale (cruscotto, banchina e pagina «Allerte»): bollettini della Protezione Civile
 * (vento e mare vicino al porto, criticità della zona) e, se serve, l'avviso pronto da inviare. Con le previsioni
 * Open-Meteo accese (abbonamento) aggiunge vento e mare previsti e, con `full`, l'andamento ora per ora.
 * La banchina non scrive a tutti: per lei l'avviso va a chi è in porto (lo può cambiare prima di inviare).
 */
export async function PortWeatherCard({ marinaId, role, full = false }: { marinaId: string; role: Role; full?: boolean }) {
  const c = await portConditions(marinaId);
  const isAdmin = role === "admin";
  const current = c.hours ? currentHour(c.hours, c.now) : null;
  return (
    <Card
      title="Allerte meteo e mare"
      actions={
        full ? (
          <span className="text-xs text-faint">Protezione Civile{c.forecastEnabled ? " · Open-Meteo" : ""}</span>
        ) : (
          <Link href="/meteo" className="link text-sm">
            Apri le allerte
          </Link>
        )
      }
      flush={full}
    >
      <div className={`space-y-5 ${full ? "p-4" : ""}`}>
        <AlertStrip c={c} role={role} />
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <VigilancePanel vigilance={c.vigilance} today={c.today} hasPosition={c.hasPosition} isAdmin={isAdmin} />
          <CivilPanel civil={c.civil} today={c.today} isAdmin={isAdmin} />
        </div>
        {/* Previsioni orarie (Open-Meteo): solo con l'abbonamento commerciale. */}
        {c.forecastEnabled && c.hours && current && (
          <>
            <div className="grid grid-cols-1 items-start gap-5 border-t border-line-soft pt-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
              <WindPanel hour={current} />
              <SeaPanel hour={current} hours={c.hours} now={c.now} />
            </div>
            <DaysRow days={dailySummary(c.hours)} today={c.today} thresholds={c.thresholds} outlook={c.civil?.outlook} />
          </>
        )}
      </div>
      {full && c.forecastEnabled && c.hours && (
        <div className="border-t border-line-soft">
          <p className="px-4 pt-3 text-sm font-semibold text-ink">Prossime 48 ore</p>
          <HourlyTable hours={c.hours} now={c.now} thresholds={c.thresholds} hoursAhead={48} />
        </div>
      )}
    </Card>
  );
}
