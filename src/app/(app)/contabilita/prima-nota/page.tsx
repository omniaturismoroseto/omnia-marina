import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet } from "@/components/icons";
import { page } from "@/components/page";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { ledgerEntries, payments } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { addDays, addMonths, formatDate, formatMonth, monthKey, todayRome } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { LEDGER_TECHNICAL_CATEGORIES } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";
import { DeleteLedgerEntryButton, LedgerEntryForm } from "../accounting-forms";
import { AccountingTabs } from "../tabs";

export const metadata: Metadata = { title: "Prima nota" };

export default page(async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const today = todayRome();
  const param = one((await searchParams).mese);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : monthKey(today);
  const first = `${month}-01`;
  const last = addDays(addMonths(first, 1), -1);

  const [rows, balances] = await Promise.all([
    db
      .select({ entry: ledgerEntries, chargeId: payments.chargeId })
      .from(ledgerEntries)
      .leftJoin(payments, eq(payments.id, ledgerEntries.paymentId))
      .where(and(eq(ledgerEntries.marinaId, ctx.marinaId), gte(ledgerEntries.entryDate, first), lte(ledgerEntries.entryDate, last)))
      .orderBy(asc(ledgerEntries.entryDate), asc(ledgerEntries.createdAt)),
    // Saldo progressivo di cassa e banca alla fine del mese mostrato.
    db
      .select({
        account: ledgerEntries.account,
        balance: sql<number>`sum(case when ${ledgerEntries.direction} = 'entrata' then ${ledgerEntries.amountCents} else -${ledgerEntries.amountCents} end)::int`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.marinaId, ctx.marinaId), lte(ledgerEntries.entryDate, last)))
      .groupBy(ledgerEntries.account),
  ]);

  // Giroconti e saldo iniziale spostano denaro ma non sono entrate o uscite: restano fuori dai totali.
  const technical = LEDGER_TECHNICAL_CATEGORIES as readonly string[];
  const operating = rows.filter((r) => !technical.includes(r.entry.category));
  const income = operating.filter((r) => r.entry.direction === "entrata").reduce((s, r) => s + r.entry.amountCents, 0);
  const expense = operating.filter((r) => r.entry.direction === "uscita").reduce((s, r) => s + r.entry.amountCents, 0);
  const balanceOf = (account: "cassa" | "banca") => balances.find((b) => b.account === account)?.balance ?? 0;

  return (
    <>
      <PageHeader help="contabilita"
        title="Contabilità"
        description="Prima nota: tutte le entrate e le uscite di cassa e banca, in ordine di data."
        actions={
          <>
            <Link href="/contabilita/importa" className="btn btn-secondary">
              <FileSpreadsheet size={16} aria-hidden="true" />
              Importa da Excel
            </Link>
            <a href={`/contabilita/esporta/prima-nota?anno=${month.slice(0, 4)}`} className="btn btn-secondary" download>
              <Download size={16} aria-hidden="true" />
              Esporta l&apos;anno in CSV
            </a>
          </>
        }
      />
      <AccountingTabs current="prima-nota" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/contabilita/prima-nota?mese=${monthKey(addMonths(first, -1))}`} className="btn btn-secondary btn-sm" aria-label="Mese precedente">
            <ChevronLeft size={16} aria-hidden="true" />
          </Link>
          <h2 className="min-w-44 text-center text-lg font-semibold first-letter:uppercase">{formatMonth(month)}</h2>
          <Link href={`/contabilita/prima-nota?mese=${monthKey(addMonths(first, 1))}`} className="btn btn-secondary btn-sm" aria-label="Mese successivo">
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
          {month !== monthKey(today) && (
            <Link href="/contabilita/prima-nota" className="btn btn-ghost btn-sm">
              Mese corrente
            </Link>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {(
            [
              ["Entrate del mese", income],
              ["Uscite del mese", expense],
              ["Saldo cassa", balanceOf("cassa")],
              ["Saldo banca", balanceOf("banca")],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={`font-semibold tabular-nums ${value < 0 ? "text-bad" : "text-ink"}`}>{formatMoney(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <details className="card mb-5">
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-ink">Registra un movimento</summary>
        <div className="border-t border-line-soft p-4">
          <LedgerEntryForm today={today} />
        </div>
      </details>

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState title="Nessun movimento in questo mese" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrizione</th>
                <th>Categoria</th>
                <th>Conto</th>
                <th className="num">Entrata</th>
                <th className="num">Uscita</th>
                <th>
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry: e, chargeId }) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(e.entryDate)}</td>
                  <td>
                    {chargeId ? (
                      <Link href={`/contabilita/addebiti/${chargeId}`} className="link">
                        {e.description}
                      </Link>
                    ) : (
                      e.description
                    )}
                    {(e.counterparty || e.documentRef) && <span className="block text-xs text-muted">{[e.counterparty, e.documentRef].filter(Boolean).join(" · ")}</span>}
                  </td>
                  <td>{e.category}</td>
                  <td>{e.account === "cassa" ? "Cassa" : "Banca"}</td>
                  <td className="num">{e.direction === "entrata" ? formatMoney(e.amountCents) : ""}</td>
                  <td className="num">{e.direction === "uscita" ? formatMoney(e.amountCents) : ""}</td>
                  <td className="text-right">{e.paymentId ? <span className="text-xs text-faint">da incasso</span> : <DeleteLedgerEntryButton entryId={e.id} />}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={4} className="px-3 py-2.5 text-right text-sm">
                  Totale del mese · saldo <span className={income - expense < 0 ? "text-bad" : "text-ok"}>{formatMoney(income - expense)}</span>
                </td>
                <td className="num px-3 py-2.5">{formatMoney(income)}</td>
                <td className="num px-3 py-2.5">{formatMoney(expense)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </>
  );
});
