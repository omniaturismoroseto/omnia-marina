import type { Metadata } from "next";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { ledgerEntries, ledgerImports } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDate, formatDateTime, todayRome } from "@/lib/dates";
import { AccountingTabs } from "../tabs";
import { LedgerImporter, UndoImportButton } from "./importer";

export const metadata: Metadata = { title: "Importa prima nota" };

export default page(async function ImportLedgerPage() {
  const ctx = await requireMarina(OFFICE);

  const [imports, manualByMonth] = await Promise.all([
    db.select().from(ledgerImports).where(eq(ledgerImports.marinaId, ctx.marinaId)).orderBy(desc(ledgerImports.createdAt)),
    // Movimenti già presenti non arrivati da un'importazione (incassi dalle schede, movimenti a mano):
    // servono all'anteprima per avvisare se il file copre gli stessi mesi.
    db
      .select({ month: sql<string>`to_char(${ledgerEntries.entryDate}, 'YYYY-MM')`, count: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.marinaId, ctx.marinaId), isNull(ledgerEntries.importId)))
      .groupBy(sql`1`),
  ]);

  return (
    <>
      <PageHeader
        title="Contabilità"
        description="Importa una prima nota tenuta in Excel. Prima di salvare vedi l'anteprima, con le righe da controllare e le correzioni proposte."
        back={{ href: "/contabilita/prima-nota", label: "Prima nota" }}
      />
      <AccountingTabs current="prima-nota" />

      <LedgerImporter today={todayRome()} existingByMonth={Object.fromEntries(manualByMonth.map((m) => [m.month, m.count]))} />

      {imports.length > 0 && (
        <Card title="Importazioni fatte" className="mt-6" flush>
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th>Periodo</th>
                <th className="num">Movimenti</th>
                <th>Importato il</th>
                <th>
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.fileName}
                    <span className="block text-xs text-muted">Foglio “{i.sheetName}” · {i.rowsCount} righe</span>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDate(i.firstDate)} – {formatDate(i.lastDate)}
                  </td>
                  <td className="num">{i.entriesCount}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatDateTime(i.createdAt)}</td>
                  <td className="text-right">
                    <UndoImportButton importId={i.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
});
