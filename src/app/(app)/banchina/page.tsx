import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { asc, eq } from "drizzle-orm";
import { Phone } from "lucide-react";
import { MovementButtons } from "@/components/movement-buttons";
import { page } from "@/components/page";
import { PortWeatherCard } from "@/components/port-weather";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { berths, marinas } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, formatDateLong, formatDateTime, formatTime, parseISO, todayRome } from "@/lib/dates";
import { formatDimensions, formatMeters, formatMoney } from "@/lib/format";
import { CONTRACT_TYPE_LABEL, MOVEMENT_LABEL, TASK_KIND_LABEL, TASK_PRIORITY_LABEL } from "@/lib/labels";
import { getDockRows, getOpenTasks, getRecentMovements, type DockRow } from "@/server/dock";
import { NewTaskForm, TaskActions } from "./task-forms";

export const metadata: Metadata = { title: "Banchina" };

function BoatRow({ row, today, office, children }: { row: DockRow; today: string; office: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 border-b border-line-soft p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-12 min-w-14 shrink-0 items-center justify-center rounded-md bg-deep px-2 font-display text-lg font-semibold text-white">
          {row.berthCode ?? "—"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] leading-tight font-semibold text-ink">
            <Link href={`/barche/${row.boatId}`} className="hover:underline">
              {row.boatName}
            </Link>
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {formatDimensions(row.lengthCm, row.beamCm)}
            {row.draftCm ? ` · pesc. ${formatMeters(row.draftCm)}` : ""} · {CONTRACT_TYPE_LABEL[row.type]}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-ink">
            {row.ownerName}
            {row.ownerPhone && (
              <a href={`tel:${row.ownerPhone.replace(/\s/g, "")}`} className="link inline-flex items-center gap-1">
                <Phone size={14} aria-hidden="true" />
                {row.ownerPhone}
              </a>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {children}
            {row.dueCents > 0 && <Badge tone="bad">{office ? `Da incassare ${formatMoney(row.dueCents)}` : "Saldo da regolare in ufficio"}</Badge>}
          </div>
          {row.notes && <p className="mt-1.5 text-sm text-muted">{row.notes}</p>}
        </div>
      </div>
      <div className="shrink-0">
        <MovementButtons contractId={row.contractId} presence={row.presence} canArrive departing={row.endDate <= today} size="lg" />
      </div>
    </li>
  );
}

export default page(async function DockPage() {
  const ctx = await requireMarina();
  const today = todayRome();
  const office = OFFICE.includes(ctx.role);
  const startOfDay = new Date(parseISO(today).getTime() - 2 * 3_600_000);

  const [rows, tasks, moves, berthList, [marina]] = await Promise.all([
    getDockRows(ctx.marinaId, today),
    getOpenTasks(ctx.marinaId),
    getRecentMovements(ctx.marinaId, startOfDay),
    db.select({ id: berths.id, code: berths.code }).from(berths).where(eq(berths.marinaId, ctx.marinaId)).orderBy(asc(berths.code)),
    db.select({ vhf: marinas.vhfChannel }).from(marinas).where(eq(marinas.id, ctx.marinaId)),
  ]);

  const arrivals = rows.filter((r) => r.presence === "atteso");
  const departures = rows.filter((r) => r.presence !== "atteso" && r.endDate <= today);
  const away = rows.filter((r) => r.presence === "fuori" && r.endDate > today);
  const inPort = rows.filter((r) => r.presence === "in_porto" && r.endDate > today);

  const summary: [string, number, string][] = [
    ["Arrivi", arrivals.length, "#arrivi"],
    ["Partenze", departures.length, "#partenze"],
    ["Fuori in mare", away.length, "#fuori"],
    ["Segnalazioni", tasks.length, "#segnalazioni"],
  ];

  return (
    <>
      <PageHeader
        help="banchina"
        title="Banchina"
        description={
          <>
            <span className="inline-block first-letter:uppercase">{formatDateLong(today)}</span>
            {marina?.vhf ? ` · VHF canale ${marina.vhf}` : ""}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map(([label, value, href]) => (
          <a key={label} href={href} className="card block p-3 transition-colors hover:border-faint">
            <p className="text-[28px] leading-none font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-[13px] font-medium text-muted">{label}</p>
          </a>
        ))}
      </div>

      <div className="mb-6">
        <Suspense fallback={null}>
          <PortWeatherCard marinaId={ctx.marinaId} role={ctx.role} />
        </Suspense>
      </div>

      <div className="space-y-6">
        <Card title={`Arrivi attesi (${arrivals.length})`} flush>
          <div id="arrivi" className="scroll-mt-20">
            {arrivals.length === 0 ? (
              <EmptyState title="Nessun arrivo atteso oggi" />
            ) : (
              <ul>
                {arrivals.map((r) => (
                  <BoatRow key={r.contractId} row={r} today={today} office={office}>
                    {r.startDate < today ? <Badge tone="warn">Atteso dal {formatDate(r.startDate)}</Badge> : <Badge tone="sea">Arriva oggi</Badge>}
                    <Badge>fino al {formatDate(r.endDate)}</Badge>
                  </BoatRow>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card title={`Partenze (${departures.length})`} flush>
          <div id="partenze" className="scroll-mt-20">
            {departures.length === 0 ? (
              <EmptyState title="Nessuna partenza prevista oggi" />
            ) : (
              <ul>
                {departures.map((r) => (
                  <BoatRow key={r.contractId} row={r} today={today} office={office}>
                    {r.endDate < today ? <Badge tone="bad">Doveva partire il {formatDate(r.endDate)}</Badge> : <Badge tone="buoy">Parte oggi</Badge>}
                    {r.presence === "fuori" && <Badge tone="sea">Ora fuori in mare</Badge>}
                  </BoatRow>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card title={`Fuori in mare (${away.length})`} flush>
          <div id="fuori" className="scroll-mt-20">
            {away.length === 0 ? (
              <EmptyState title="Nessuna barca fuori" description="Qui compaiono le barche uscite in mare che hanno il posto assegnato." />
            ) : (
              <ul>
                {away.map((r) => (
                  <BoatRow key={r.contractId} row={r} today={today} office={office} />
                ))}
              </ul>
            )}
          </div>
        </Card>

        <details className="card group">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[15px] font-semibold text-ink">
            In porto ({inPort.length})<span className="text-sm font-normal text-muted group-open:hidden">Mostra</span>
            <span className="hidden text-sm font-normal text-muted group-open:inline">Nascondi</span>
          </summary>
          <ul className="border-t border-line-soft">
            {inPort.map((r) => (
              <BoatRow key={r.contractId} row={r} today={today} office={office} />
            ))}
          </ul>
        </details>

        <Card title={`Segnalazioni aperte (${tasks.length})`}>
          <div id="segnalazioni" className="scroll-mt-20">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted">Nessuna segnalazione aperta.</p>
            ) : (
              <ul className="-mx-4 -mt-4 mb-4">
                {tasks.map((t) => (
                  <li key={t.id} className="border-b border-line-soft px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.priority === "alta" && <Badge tone="bad">{TASK_PRIORITY_LABEL.alta}</Badge>}
                      {t.status === "in_corso" && <Badge tone="sea">In corso</Badge>}
                      <Badge>{TASK_KIND_LABEL[t.kind]}</Badge>
                      {t.berthCode && <Badge>Posto {t.berthCode}</Badge>}
                      {t.boatName && <Badge>{t.boatName}</Badge>}
                    </div>
                    <p className="mt-1.5 font-medium text-ink">{t.title}</p>
                    {t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}
                    <p className="mt-1 text-xs text-faint">
                      {t.createdByName ?? "—"} · {formatDateTime(t.createdAt)}
                    </p>
                    <TaskActions taskId={t.id} status={t.status === "in_corso" ? "in_corso" : "aperta"} />
                  </li>
                ))}
              </ul>
            )}
            <details className={tasks.length === 0 ? "mt-3" : ""}>
              <summary className="link cursor-pointer text-sm">Nuova segnalazione</summary>
              <div className="mt-3">
                <NewTaskForm berths={berthList} />
              </div>
            </details>
          </div>
        </Card>

        <Card title="Movimenti di oggi" flush>
          {moves.length === 0 ? (
            <EmptyState title="Nessun movimento registrato oggi" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ora</th>
                  <th>Movimento</th>
                  <th>Barca</th>
                  <th>Posto</th>
                  <th>Operatore</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="tabular-nums">{formatTime(m.at)}</td>
                    <td>{MOVEMENT_LABEL[m.kind]}</td>
                    <td>
                      <Link href={`/barche/${m.boatId}`} className="link">
                        {m.boatName}
                      </Link>
                    </td>
                    <td>{m.berthCode ?? "—"}</td>
                    <td className="text-muted">{m.userName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
});
