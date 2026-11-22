import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "@/components/icons";
import { page } from "@/components/page";
import { ChargeStatusBadge } from "@/components/status";
import { ButtonLink, EmptyState, FilterTabs, PageHeader, SearchBox } from "@/components/ui";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { one, qs, type SearchParams } from "@/lib/params";
import { chargeTotals, listCharges, type ChargeFilter } from "@/server/charges";
import { AccountingTabs } from "./tabs";

export const metadata: Metadata = { title: "Scadenziario" };

const FILTERS: ChargeFilter[] = ["aperti", "scaduti", "pagati", "annullati", "tutti"];

export default page(async function ChargesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const filter: ChargeFilter = FILTERS.includes(one(sp.stato) as ChargeFilter) ? (one(sp.stato) as ChargeFilter) : "aperti";
  const today = todayRome();

  const [rows, totals] = await Promise.all([
    listCharges(ctx.marinaId, today, { filter, q, newestFirst: filter === "pagati" || filter === "tutti" || filter === "annullati" }),
    chargeTotals(ctx.marinaId, today),
  ]);
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const tab = (value: ChargeFilter, label: string, count?: number) => ({ value, label, count, href: `/contabilita${qs({ q, stato: value === "aperti" ? null : value })}` });

  return (
    <>
      <PageHeader help="contabilita"
        title="Contabilità"
        description="Addebiti ai clienti e relativi incassi. È una contabilità interna di gestione: non sostituisce la fatturazione elettronica."
        actions={
          <>
            <a href={`/contabilita/esporta/scadenziario${qs({ stato: filter })}`} className="btn btn-secondary" download>
              <Download size={16} aria-hidden="true" />
              Esporta CSV
            </a>
            <ButtonLink href="/contabilita/addebiti/nuovo" variant="primary">
              <Plus size={16} aria-hidden="true" />
              Nuovo addebito
            </ButtonLink>
          </>
        }
      />
      <AccountingTabs current="scadenziario" />

      <dl className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <dt className="text-[13px] font-medium text-muted">Da incassare</dt>
          <dd className="mt-1 text-[28px] leading-tight font-semibold tabular-nums">{formatMoney(totals.openCents)}</dd>
          <dd className="mt-1 text-xs text-muted">{totals.openCount} addebiti aperti</dd>
        </div>
        <div className="card p-4">
          <dt className="text-[13px] font-medium text-muted">Di cui scaduto</dt>
          <dd className={`mt-1 text-[28px] leading-tight font-semibold tabular-nums ${totals.overdueCents > 0 ? "text-bad" : ""}`}>{formatMoney(totals.overdueCents)}</dd>
          <dd className="mt-1 text-xs text-muted">{totals.overdueCount} addebiti oltre la scadenza</dd>
        </div>
      </dl>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox action="/contabilita" defaultValue={q} placeholder="Cliente o descrizione…">
          {filter !== "aperti" && <input type="hidden" name="stato" value={filter} />}
        </SearchBox>
        <FilterTabs
          current={filter}
          items={[tab("aperti", "Da incassare", totals.openCount), tab("scaduti", "Scaduti", totals.overdueCount), tab("pagati", "Pagati"), tab("annullati", "Annullati"), tab("tutti", "Tutti")]}
        />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title={q ? "Nessun addebito corrisponde alla ricerca" : filter === "aperti" ? "Nessun importo da incassare" : "Nessun addebito in questo elenco"} />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Scadenza</th>
                <th>Cliente</th>
                <th>Descrizione</th>
                <th>Stato</th>
                <th className="num">Importo</th>
                <th className="num">Incassato</th>
                <th className="num">Residuo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(c.dueDate)}</td>
                  <td>
                    <Link href={`/clienti/${c.ownerId}`} className="hover:underline">
                      {c.ownerName}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/contabilita/addebiti/${c.id}`} className="link">
                      {c.description}
                    </Link>
                  </td>
                  <td>
                    <ChargeStatusBadge status={c.status} />
                  </td>
                  <td className="num">{formatMoney(c.grossCents)}</td>
                  <td className="num text-muted">{formatMoney(c.paidCents)}</td>
                  <td className="num font-medium">{c.status === "annullato" ? "—" : formatMoney(c.grossCents - c.paidCents)}</td>
                </tr>
              ))}
            </tbody>
            {filter !== "annullati" && filter !== "tutti" && (
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4} className="px-3 py-2.5 text-right text-sm">
                    Totale ({rows.length})
                  </td>
                  <td className="num px-3 py-2.5">{formatMoney(sum((r) => r.grossCents))}</td>
                  <td className="num px-3 py-2.5">{formatMoney(sum((r) => r.paidCents))}</td>
                  <td className="num px-3 py-2.5">{formatMoney(sum((r) => r.grossCents - r.paidCents))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      {rows.length === 500 && <p className="mt-3 text-sm text-muted">Sono mostrati i primi 500 addebiti: usa la ricerca o l&apos;esportazione per l&apos;elenco completo.</p>}
    </>
  );
});
