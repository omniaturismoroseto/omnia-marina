import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronRight, CloudSun, FileText, Mail, Phone, Radio } from "lucide-react";
import { page } from "@/components/page";
import { Badge, Card } from "@/components/ui";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { requireOwner } from "@/lib/context";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { formatDate, todayRome } from "@/lib/dates";
import { formatDimensions, formatMoney } from "@/lib/format";
import { CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { marinaAddress } from "@/lib/templates";
import { currentHour, weatherLabel, windAlert, windName } from "@/lib/weather";
import { ownerBoats, ownerCharges, ownerContracts, ownerDeadlines } from "@/server/owner-area";
import { nowRomeLocal, portForecast } from "@/server/weather";

export const metadata: Metadata = { title: "La mia barca" };

const TONE_DOT = { bad: "bg-bad", warn: "bg-warn", neutral: "bg-line" } as const;

export default page(async function OwnerHomePage() {
  const ctx = await requireOwner();
  const today = todayRome();
  const scope = { marinaId: ctx.marinaId, ownerId: ctx.ownerId };
  const [contractRows, boatRows, chargeRows, [marina]] = await Promise.all([
    ownerContracts(scope),
    ownerBoats(scope),
    ownerCharges(scope, today),
    db.select().from(marinas).where(eq(marinas.id, ctx.marinaId)),
  ]);
  const hours = await portForecast(marina.latitude, marina.longitude);
  const nowLocal = nowRomeLocal();
  const weatherNow = hours ? currentHour(hours, nowLocal) : null;
  const strongWind = hours ? windAlert(hours, marina.windAlertKnots, nowLocal) : null;
  const active = contractRows.filter((c) => c.status === "attivo");
  const past = contractRows.filter((c) => c.status !== "attivo");
  const deadlines = ownerDeadlines({ charges: chargeRows, contracts: contractRows, boats: boatRows }, today);
  const dueCents = chargeRows.reduce((s, c) => s + Math.max(0, c.grossCents - c.paidCents), 0);
  const firstName = ctx.user.name.split(" ")[0];
  const address = marinaAddress(marina);

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Ciao {firstName}</h1>
      <p className="mt-1 text-[15px] text-muted">
        {marina.name} · intestatario {ctx.ownerName}
      </p>

      <div className="mt-6 space-y-5">
        {active.length === 0 ? (
          <Card title="Contratto">
            <p className="text-sm text-muted">Nessun contratto attivo in questo momento. Per un nuovo contratto contatta l&apos;ufficio.</p>
          </Card>
        ) : (
          active.map((c) => (
            <section key={c.id} className="card overflow-hidden">
              <div className="bg-sea px-5 py-4 text-white">
                <p className="text-xs tracking-widest text-white/70 uppercase">Posto barca</p>
                <p className="font-display text-4xl font-semibold">{c.berthCode ?? "—"}</p>
                {c.pierName && <p className="text-sm text-white/80">{c.pierName}</p>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm">
                <div>
                  <dt className="text-xs text-muted">Barca</dt>
                  <dd className="font-medium text-ink">{c.boatName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Contratto</dt>
                  <dd className="font-medium text-ink">
                    {CONTRACT_TYPE_LABEL[c.type]} · {contractNumberLabel(c.number)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted">Periodo</dt>
                  <dd className="font-medium text-ink">
                    dal {formatDate(c.startDate)} al {formatDate(c.endDate)}
                  </dd>
                </div>
              </dl>
              <Link href={`/diportista/contratti/${c.id}`} className="flex items-center gap-2 border-t border-line-soft px-5 py-3 text-sm font-medium text-sea-dark hover:bg-paper">
                <FileText size={16} aria-hidden="true" />
                Il contratto (da scaricare o stampare)
                <ChevronRight size={16} className="ml-auto" aria-hidden="true" />
              </Link>
            </section>
          ))
        )}

        {weatherNow && (
          <Link href="/diportista/meteo" className="card flex items-center gap-3 p-4 hover:bg-paper">
            <CloudSun size={22} className="shrink-0 text-sea" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm text-ink">
              Vento {windName(weatherNow.windDir).short} {weatherNow.windKn} nodi, raffiche {weatherNow.gustKn}
              {weatherNow.waveM !== null ? ` · onda ${weatherNow.waveM.toFixed(1).replace(".", ",")} m` : ""} · {weatherLabel(weatherNow.code).toLowerCase()}
              {strongWind && <span className="block font-semibold text-bad">In arrivo raffiche fino a {strongWind.maxGustKn} nodi</span>}
            </span>
            <ChevronRight size={16} className="text-muted" aria-hidden="true" />
          </Link>
        )}

        <Card title="Scadenze">
          {deadlines.length === 0 ? (
            <p className="text-sm text-muted">Nessuna scadenza in vista.</p>
          ) : (
            <ul className="space-y-3">
              {deadlines.map((d) => (
                <li key={d.key} className="flex items-start gap-3">
                  <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TONE_DOT[d.tone]}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{d.title}</p>
                    <p className="text-xs text-muted">
                      {d.date < today ? `Scaduta il ${formatDate(d.date)}` : `Entro il ${formatDate(d.date)}`}
                      {d.detail ? ` · ${d.detail}` : ""}
                    </p>
                  </div>
                  {d.amountCents !== undefined && <span className="text-sm font-semibold text-ink tabular-nums">{formatMoney(d.amountCents)}</span>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/diportista/conto" className="mt-4 flex items-center justify-between border-t border-line-soft pt-3 text-sm">
            <span className="text-muted">
              {dueCents > 0 ? (
                <>
                  Da pagare in tutto: <strong className="text-ink tabular-nums">{formatMoney(dueCents)}</strong>
                </>
              ) : (
                "Sei in regola con i pagamenti."
              )}
            </span>
            <span className="link inline-flex items-center gap-1">
              Estratto conto
              <ChevronRight size={14} aria-hidden="true" />
            </span>
          </Link>
        </Card>

        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
          <Card title={boatRows.length === 1 ? "La tua barca" : "Le tue barche"}>
            {boatRows.length === 0 ? (
              <p className="text-sm text-muted">Nessuna barca registrata.</p>
            ) : (
              <ul className="space-y-3">
                {boatRows.map((b) => (
                  <li key={b.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-ink">{b.name}</span>
                      <span className="text-sm text-muted tabular-nums">{formatDimensions(b.lengthCm, b.beamCm)}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {b.insuranceExpiry ? (
                        <>
                          Assicurazione{b.insuranceCompany ? ` ${b.insuranceCompany}` : ""} fino al {formatDate(b.insuranceExpiry)}{" "}
                          {b.insuranceExpiry < today && <Badge tone="bad">Scaduta</Badge>}
                        </>
                      ) : (
                        "Assicurazione non registrata: portala in ufficio."
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Il porto">
            <ul className="space-y-2 text-sm">
              {marina.phone && (
                <li>
                  <a href={`tel:${marina.phone.replace(/\s/g, "")}`} className="link inline-flex items-center gap-2">
                    <Phone size={15} aria-hidden="true" />
                    {marina.phone}
                  </a>
                </li>
              )}
              {marina.email && (
                <li>
                  <a href={`mailto:${marina.email}`} className="link inline-flex items-center gap-2 break-all">
                    <Mail size={15} aria-hidden="true" />
                    {marina.email}
                  </a>
                </li>
              )}
              {marina.vhfChannel && (
                <li className="inline-flex items-center gap-2 text-ink">
                  <Radio size={15} aria-hidden="true" />
                  VHF canale {marina.vhfChannel}
                </li>
              )}
              {address && <li className="text-muted">{address}</li>}
            </ul>
            {marina.officeHours && (
              <div className="mt-4 border-t border-line-soft pt-3">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Orari dell&apos;ufficio</p>
                <p className="mt-1 text-sm whitespace-pre-line text-ink">{marina.officeHours}</p>
              </div>
            )}
          </Card>
        </div>

        {marina.boaterInfo && (
          <Card title="Informazioni utili">
            <p className="text-sm leading-relaxed whitespace-pre-line text-ink">{marina.boaterInfo}</p>
          </Card>
        )}

        {past.length > 0 && (
          <Card title="Contratti passati">
            <ul className="space-y-2 text-sm">
              {past.map((c) => (
                <li key={c.id}>
                  <Link href={`/diportista/contratti/${c.id}`} className="flex items-center justify-between gap-3 hover:underline">
                    <span>
                      {CONTRACT_TYPE_LABEL[c.type]} {contractNumberLabel(c.number)} · {c.boatName}
                      {c.berthCode ? ` · posto ${c.berthCode}` : ""}
                    </span>
                    <span className="text-muted tabular-nums">
                      {formatDate(c.startDate)} – {formatDate(c.endDate)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="text-center text-sm">
          <Link href="/diportista/account" className="link">
            Il tuo accesso e la password
          </Link>
        </p>
      </div>
    </>
  );
});
