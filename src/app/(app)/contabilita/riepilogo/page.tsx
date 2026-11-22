import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { Download } from "@/components/icons";
import { page } from "@/components/page";
import { Card, EmptyState, FilterTabs, PageHeader, Stat } from "@/components/ui";
import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { diffDays, formatMonth, todayRome, yearOf } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/format";
import { LEDGER_TECHNICAL_CATEGORIES } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";
import { chargeTotals, listCharges } from "@/server/charges";
import { AccountingTabs } from "../tabs";

export const metadata: Metadata = { title: "Riepilogo contabile" };

// Barra orizzontale sottile: base squadrata a sinistra, estremità arrotondata dal lato del valore.
function Bar({ share, color, label }: { share: number; color: "in" | "out"; label: string }) {
  if (share <= 0) return <span className="block h-2" />;
  return (
    <span
      className={`block h-2 rounded-r ${color === "in" ? "bg-entrate" : "bg-uscite"}`}
      style={{ width: `${Math.max(share * 100, 0.75)}%` }}
      title={label}
    />
  );
}

function Legend() {
  return (
    <ul className="flex gap-4 text-xs text-muted" aria-label="Legenda">
      <li className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-entrate" aria-hidden="true" />
        Entrate
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-uscite" aria-hidden="true" />
        Uscite
      </li>
    </ul>
  );
}

function CategoryBars({ rows, color }: { rows: { category: string; cents: number }[]; color: "in" | "out" }) {
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const max = Math.max(1, ...rows.map((r) => r.cents));
  if (rows.length === 0) return <p className="text-sm text-muted">Nessun movimento nell&apos;anno.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.category}>
            <th scope="row" className="w-40 py-1.5 pr-3 text-left font-normal text-ink">
              {r.category}
            </th>
            <td className="py-1.5">
              <Bar share={r.cents / max} color={color} label={`${r.category}: ${formatMoney(r.cents)}`} />
            </td>
            <td className="w-28 py-1.5 pl-3 text-right font-medium tabular-nums">{formatMoney(r.cents)}</td>
            <td className="w-12 py-1.5 pl-2 text-right text-xs text-muted tabular-nums">{formatPercent(r.cents / total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default page(async function SummaryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMarina(OFFICE);
  const today = todayRome();
  const currentYear = yearOf(today);
  const param = Number(one((await searchParams).anno));

  const yearRows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${ledgerEntries.entryDate})::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.marinaId, ctx.marinaId));
  const years = [...new Set([currentYear, ...yearRows.map((y) => y.year)])].sort((a, b) => b - a);
  const year = years.includes(param) ? param : currentYear;
  // Giroconti e saldo iniziale non sono né entrate né uscite: restano fuori dal riepilogo.
  const inYear = and(
    eq(ledgerEntries.marinaId, ctx.marinaId),
    gte(ledgerEntries.entryDate, `${year}-01-01`),
    lte(ledgerEntries.entryDate, `${year}-12-31`),
    notInArray(ledgerEntries.category, [...LEDGER_TECHNICAL_CATEGORIES]),
  );
  const total = sql<number>`sum(${ledgerEntries.amountCents})::int`;

  const [byMonth, byCategory, totals, openCharges] = await Promise.all([
    db
      .select({ month: sql<string>`to_char(${ledgerEntries.entryDate}, 'YYYY-MM')`, direction: ledgerEntries.direction, cents: total })
      .from(ledgerEntries)
      .where(inYear)
      .groupBy(sql`1`, ledgerEntries.direction),
    db
      .select({ category: ledgerEntries.category, direction: ledgerEntries.direction, cents: total })
      .from(ledgerEntries)
      .where(inYear)
      .groupBy(ledgerEntries.category, ledgerEntries.direction),
    chargeTotals(ctx.marinaId, today),
    listCharges(ctx.marinaId, today, { filter: "aperti", limit: 20000 }),
  ]);

  const lastMonth = year === currentYear ? Number(today.slice(5, 7)) : 12;
  const months = Array.from({ length: lastMonth }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    const income = byMonth.find((r) => r.month === key && r.direction === "entrata")?.cents ?? 0;
    const expense = byMonth.find((r) => r.month === key && r.direction === "uscita")?.cents ?? 0;
    return { key, income, expense };
  });
  const income = months.reduce((s, m) => s + m.income, 0);
  const expense = months.reduce((s, m) => s + m.expense, 0);
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const categories = (direction: "entrata" | "uscita") =>
    byCategory
      .filter((r) => r.direction === direction)
      .map((r) => ({ category: r.category, cents: r.cents }))
      .sort((a, b) => b.cents - a.cents);

  // Anzianità dei crediti: da quanto tempo gli importi aperti sono scaduti.
  const aging = [
    { label: "Non ancora scaduti", cents: 0, count: 0 },
    { label: "Scaduti da 1 a 30 giorni", cents: 0, count: 0 },
    { label: "Scaduti da 31 a 90 giorni", cents: 0, count: 0 },
    { label: "Scaduti da oltre 90 giorni", cents: 0, count: 0 },
  ];
  for (const c of openCharges) {
    const late = diffDays(c.dueDate, today);
    const bucket = aging[late <= 0 ? 0 : late <= 30 ? 1 : late <= 90 ? 2 : 3];
    bucket.cents += c.grossCents - c.paidCents;
    bucket.count++;
  }

  return (
    <>
      <PageHeader help="contabilita"
        title="Contabilità"
        description="Riepilogo dell'anno: entrate e uscite registrate in prima nota e crediti ancora da incassare."
        actions={
          <a href={`/contabilita/esporta/prima-nota?anno=${year}`} className="btn btn-secondary" download>
            <Download size={16} aria-hidden="true" />
            Esporta la prima nota {year}
          </a>
        }
      />
      <AccountingTabs current="riepilogo" />

      {years.length > 1 && (
        <div className="mb-5">
          <FilterTabs current={String(year)} items={years.map((y) => ({ value: String(y), label: String(y), href: `/contabilita/riepilogo?anno=${y}` }))} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Entrate ${year}`} value={formatMoney(income)} />
        <Stat label={`Uscite ${year}`} value={formatMoney(expense)} />
        <Stat label="Risultato di cassa" value={formatMoney(income - expense)} tone={income - expense < 0 ? "bad" : "ok"} hint="Entrate meno uscite registrate" />
        <Stat label="Crediti da incassare" value={formatMoney(totals.openCents)} hint={`di cui scaduti ${formatMoney(totals.overdueCents)}`} href="/contabilita" />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card title="Andamento mensile" actions={<Legend />} className="lg:col-span-2" flush>
          {income + expense === 0 ? (
            <EmptyState title="Nessun movimento registrato nell'anno" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mese</th>
                  <th className="w-[40%]">
                    <span className="sr-only">Confronto entrate e uscite</span>
                  </th>
                  <th className="num">Entrate</th>
                  <th className="num">Uscite</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.key}>
                    <th scope="row" className="border-b border-line-soft px-3 py-2 text-left font-normal whitespace-nowrap first-letter:uppercase">
                      <Link href={`/contabilita/prima-nota?mese=${m.key}`} className="link">
                        {formatMonth(m.key).split(" ")[0]}
                      </Link>
                    </th>
                    <td>
                      <span className="flex flex-col gap-0.5 border-l border-line">
                        <Bar share={m.income / max} color="in" label={`Entrate: ${formatMoney(m.income)}`} />
                        <Bar share={m.expense / max} color="out" label={`Uscite: ${formatMoney(m.expense)}`} />
                      </span>
                    </td>
                    <td className="num">{formatMoney(m.income)}</td>
                    <td className="num">{formatMoney(m.expense)}</td>
                    <td className={`num font-medium ${m.income - m.expense < 0 ? "text-bad" : ""}`}>{formatMoney(m.income - m.expense)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={2} className="px-3 py-2.5 text-sm">
                    Totale {year}
                  </td>
                  <td className="num px-3 py-2.5">{formatMoney(income)}</td>
                  <td className="num px-3 py-2.5">{formatMoney(expense)}</td>
                  <td className={`num px-3 py-2.5 ${income - expense < 0 ? "text-bad" : ""}`}>{formatMoney(income - expense)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>

        <Card title="Entrate per categoria">
          <CategoryBars rows={categories("entrata")} color="in" />
        </Card>
        <Card title="Uscite per categoria">
          <CategoryBars rows={categories("uscita")} color="out" />
        </Card>

        <Card title="Crediti verso clienti" className="lg:col-span-2" flush>
          <table className="tbl">
            <thead>
              <tr>
                <th>Anzianità</th>
                <th className="num">Addebiti</th>
                <th className="num">Da incassare</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((a, i) => (
                <tr key={a.label}>
                  <td>{a.label}</td>
                  <td className="num">{a.count}</td>
                  <td className={`num font-medium ${i >= 2 && a.cents > 0 ? "text-bad" : ""}`}>{formatMoney(a.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
});
