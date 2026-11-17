import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { marinas, ownerImports } from "@/db/schema";
import { OFFICE, requireMarina } from "@/lib/context";
import { formatDateTime, todayRome } from "@/lib/dates";
import { OwnerImporter, UndoOwnerImportButton } from "./importer";

export const metadata: Metadata = { title: "Importa clienti" };

export default page(async function ImportOwnersPage() {
  const ctx = await requireMarina(OFFICE);

  const [imports, [marina]] = await Promise.all([
    db.select().from(ownerImports).where(eq(ownerImports.marinaId, ctx.marinaId)).orderBy(desc(ownerImports.createdAt)),
    db.select({ formerLabel: marinas.formerOwnerLabel }).from(marinas).where(eq(marinas.id, ctx.marinaId)),
  ]);

  return (
    <>
      <PageHeader help="clienti"
        title="Importa clienti"
        description="Carica l'elenco dei clienti e delle barche tenuto in Excel. Prima di salvare vedi l'anteprima: doppioni uniti, clienti già presenti, dati da correggere."
        back={{ href: "/clienti", label: "Clienti" }}
      />

      <OwnerImporter today={todayRome()} formerLabel={marina.formerLabel} />

      {imports.length > 0 && (
        <Card title="Importazioni fatte" className="mt-6" flush>
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Clienti nuovi</th>
                <th className="num">Completati</th>
                <th className="num">Barche</th>
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
                    <span className="block text-xs text-muted">
                      Foglio “{i.sheetName}” · {i.rowsCount} righe
                    </span>
                  </td>
                  <td className="num">{i.ownersCreated}</td>
                  <td className="num">{i.ownersUpdated}</td>
                  <td className="num">{i.boatsCreated}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatDateTime(i.createdAt)}</td>
                  <td className="text-right">
                    <UndoOwnerImportButton importId={i.id} />
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
