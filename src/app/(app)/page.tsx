import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { page } from "@/components/page";
import { PortWeatherCard } from "@/components/port-weather";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { boats, contracts, owners, payments, tasks } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { addDays, formatDate, formatDateLong, formatMonth, monthKey, todayRome } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/format";
import { CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { countStates, getBoard } from "@/server/board";
import { chargeTotals, listCharges } from "@/server/charges";
import { getDockRows } from "@/server/dock";
import { contractNumberGaps } from "@/server/contracts";

export const metadata: Metadata = { title: "Cruscotto" };

export default page(async function DashboardPage() {
  const ctx = await requireMarina(OFFICE);
  const today = todayRome();
  const month = monthKey(today);
  const in30 = addDays(today, 30);
  const in60 = addDays(today, 60);

  const [board, dock, totals, [income], upcoming, expiring, [insurance], [privacy], [taskCount], [drafts], numberGaps] = await Promise.all([
    getBoard(ctx.marinaId, today, today),
    getDockRows(ctx.marinaId, today),
    chargeTotals(ctx.marinaId, today),
    db
      .select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.marinaId, ctx.marinaId), gte(payments.paidOn, `${month}-01`), lte(payments.paidOn, today))),
    listCharges(ctx.marinaId, today, { filter: "aperti", limit: 6 }),
    db
      .select({ id: contracts.id, number: contracts.number, type: contracts.type, endDate: contracts.endDate, ownerName: owners.displayName, boatName: boats.name })
      .from(contracts)
      .innerJoin(owners, eq(owners.id, contracts.ownerId))
      .innerJoin(boats, eq(boats.id, contracts.boatId))
      .where(and(eq(contracts.marinaId, ctx.marinaId), eq(contracts.status, "attivo"), ne(contracts.type, "transito"), gte(contracts.endDate, today), lte(contracts.endDate, in60)))
      .orderBy(asc(contracts.endDate))
      .limit(100),
    // Barche con contratto attivo e assicurazione scaduta, mancante o in scadenza entro 30 giorni.
    db
      .select({ count: sql<number>`count(distinct ${boats.id})::int` })
      .from(boats)
      .innerJoin(contracts, and(eq(contracts.boatId, boats.id), eq(contracts.status, "attivo")))
      .where(and(eq(boats.marinaId, ctx.marinaId), sql`(${boats.insuranceExpiry} is null or ${boats.insuranceExpiry} <= ${in30})`)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(owners)
      .where(
        and(
          eq(owners.marinaId, ctx.marinaId),
          sql`${owners.anonymizedAt} is null`,
          sql`coalesce((select pc.granted from privacy_consents pc where pc.owner_id = "owners"."id" and pc.kind = 'informativa' order by pc.recorded_at desc limit 1), false) = false`,
        ),
      ),
    db
      .select({ open: sql<number>`count(*)::int`, urgent: sql<number>`count(*) filter (where ${tasks.priority} = 'alta')::int` })
      .from(tasks)
      .where(and(eq(tasks.marinaId, ctx.marinaId), ne(tasks.status, "chiusa"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(eq(contracts.marinaId, ctx.marinaId), eq(contracts.status, "bozza"))),
    contractNumberGaps(ctx.marinaId),
  ]);

  const counts = countStates(board);
  const usable = counts.total - counts.fermo;
  const taken = usable - counts.libero;
  const arrivals = dock.filter((r) => r.presence === "atteso");
  const departures = dock.filter((r) => r.presence !== "atteso" && r.endDate <= today);

  // Cose che richiedono attenzione, mostrate solo se ce ne sono.
  const todo: { label: string; count: number; href: string; tone: "bad" | "warn" | "sea" }[] = [
    { label: "Addebiti scaduti da incassare", count: totals.overdueCount, href: "/contabilita?stato=scaduti", tone: "bad" as const },
    { label: "Segnalazioni di banchina aperte", count: taskCount.open, href: "/banchina#segnalazioni", tone: taskCount.urgent > 0 ? ("bad" as const) : ("sea" as const) },
    { label: "Contratti in scadenza entro 60 giorni", count: expiring.length, href: "/contratti?stato=scadenza", tone: "warn" as const },
    { label: "Assicurazioni scadute o in scadenza", count: insurance.count, href: "/barche", tone: "warn" as const },
    { label: "Clienti senza informativa privacy firmata", count: privacy.count, href: "/clienti?privacy=mancante", tone: "warn" as const },
    { label: "Contratti in bozza da attivare", count: drafts.count, href: "/contratti?stato=bozze", tone: "sea" as const },
    // Un contratto tornato in bozza lascia un numero libero: si segnala finché il prossimo contratto attivato non lo riprende.
    {
      label: numberGaps.length === 1 ? `Numero di contratto libero: ${numberGaps[0]}` : `Numeri di contratto liberi: ${numberGaps.join(", ")}`,
      count: numberGaps.length,
      href: "/contratti",
      tone: "warn" as const,
    },
  ].filter((t) => t.count > 0);

  if (counts.total === 0) {
    return (
      <>
        <PageHeader help="cruscotto" title="Cruscotto" description={`Benvenuto in ${ctx.marinaName}.`} />
        <div className="card">
          <EmptyState
            title="Il porto è ancora da configurare"
            description="Per iniziare servono i pontili con i posti barca e le tariffe. Poi potrai inserire clienti, barche e contratti."
            action={
              ctx.role === "admin" ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <ButtonLink href="/guida#primi-passi">Leggi i primi passi</ButtonLink>
                  <ButtonLink href="/impostazioni/pontili" variant="primary">
                    Configura pontili e posti
                  </ButtonLink>
                </div>
              ) : undefined
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader help="cruscotto" title="Cruscotto" description={<span className="inline-block first-letter:uppercase">{formatDateLong(today)}</span>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Posti occupati"
          value={
            <>
              {taken} <span className="text-lg font-medium text-muted">su {usable}</span>
            </>
          }
          hint={`${usable > 0 ? formatPercent(taken / usable) : "0%"} di occupazione · ${counts.libero} liberi`}
          href="/mappa"
        />
        <Stat
          label="Movimenti attesi oggi"
          value={arrivals.length + departures.length}
          hint={`${arrivals.length} ${arrivals.length === 1 ? "arrivo" : "arrivi"} · ${departures.length} ${departures.length === 1 ? "partenza" : "partenze"}`}
          href="/banchina"
        />
        <Stat label={`Incassato a ${formatMonth(month).split(" ")[0]}`} value={formatMoney(income.cents)} hint="Somma degli incassi registrati nel mese" href="/contabilita/prima-nota" />
        <Stat
          label="Scaduto da incassare"
          value={formatMoney(totals.overdueCents)}
          tone={totals.overdueCents > 0 ? "bad" : undefined}
          hint={`Totale ancora aperto: ${formatMoney(totals.openCents)}`}
          href="/contabilita?stato=scaduti"
        />
      </div>

      <div className="mt-5">
        <Suspense fallback={null}>
          <PortWeatherCard marinaId={ctx.marinaId} role={ctx.role} />
        </Suspense>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card title="Da tenere d'occhio" flush>
          {todo.length === 0 ? (
            <EmptyState title="Tutto in ordine" description="Nessuna scadenza o segnalazione richiede attenzione." />
          ) : (
            <ul>
              {todo.map((t) => (
                <li key={t.label} className="border-b border-line-soft last:border-b-0">
                  <Link href={t.href} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/60">
                    <Badge tone={t.tone}>{t.count}</Badge>
                    <span className="flex-1 text-[15px] text-ink">{t.label}</span>
                    <ChevronRight size={16} className="text-faint" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Occupazione per pontile" actions={<Link href="/mappa" className="link text-sm">Apri la mappa</Link>}>
          <ul className="space-y-3">
            {board
              .filter((p) => p.berths.length > 0)
              .map((p) => {
                const total = p.berths.filter((b) => b.state !== "fermo").length;
                const used = total - p.berths.filter((b) => b.state === "libero").length;
                const share = total > 0 ? used / total : 0;
                return (
                  <li key={p.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate text-ink">{p.name}</span>
                    <span
                      className="h-2 overflow-hidden rounded-full bg-sea-soft"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={used}
                      aria-label={`${p.name}: ${used} posti occupati su ${total}`}
                      title={`${used} occupati su ${total} (${formatPercent(share)})`}
                    >
                      <span className="block h-full rounded-full bg-sea" style={{ width: `${share * 100}%` }} />
                    </span>
                    <span className="w-16 text-right text-muted tabular-nums">
                      <span className="font-medium text-ink">{used}</span> / {total}
                    </span>
                  </li>
                );
              })}
          </ul>
        </Card>

        <Card title="Banchina oggi" flush actions={<Link href="/banchina" className="link text-sm">Apri la banchina</Link>}>
          {arrivals.length + departures.length === 0 ? (
            <EmptyState title="Nessun arrivo o partenza in programma" />
          ) : (
            <table className="tbl">
              <tbody>
                {[...arrivals.map((r) => ({ r, arrival: true })), ...departures.map((r) => ({ r, arrival: false }))].slice(0, 8).map(({ r, arrival }) => (
                  <tr key={r.contractId}>
                    <td className="w-px">{arrival ? <Badge tone="warn">Arrivo</Badge> : <Badge tone="buoy">Partenza</Badge>}</td>
                    <td>
                      <Link href={`/contratti/${r.contractId}`} className="link">
                        {r.boatName}
                      </Link>
                      <span className="block text-xs text-muted">{r.ownerName}</span>
                    </td>
                    <td className="text-right font-medium">{r.berthCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Prossimi incassi" flush actions={<Link href="/contabilita" className="link text-sm">Scadenziario</Link>}>
          {upcoming.length === 0 ? (
            <EmptyState title="Nessun importo da incassare" />
          ) : (
            <table className="tbl">
              <tbody>
                {upcoming.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(c.dueDate)}
                      {c.status === "scaduto" && <span className="block text-xs font-medium text-bad">scaduto</span>}
                    </td>
                    <td>
                      <Link href={`/contabilita/addebiti/${c.id}`} className="link">
                        {c.ownerName}
                      </Link>
                      <span className="block truncate text-xs text-muted">{c.description}</span>
                    </td>
                    <td className="num font-medium">{formatMoney(c.grossCents - c.paidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {expiring.length > 0 && (
          <Card title="Contratti in scadenza" flush className="lg:col-span-2" actions={<Link href="/contratti?stato=scadenza" className="link text-sm">Vedi tutti</Link>}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Scade il</th>
                  <th>Contratto</th>
                  <th>Cliente</th>
                  <th>Barca</th>
                </tr>
              </thead>
              <tbody>
                {expiring.slice(0, 6).map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap tabular-nums">{formatDate(c.endDate)}</td>
                    <td>
                      <Link href={`/contratti/${c.id}`} className="link">
                        {contractNumberLabel(c.number)}
                      </Link>{" "}
                      <span className="text-xs text-muted">{CONTRACT_TYPE_LABEL[c.type]}</span>
                    </td>
                    <td>{c.ownerName}</td>
                    <td>{c.boatName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
});
