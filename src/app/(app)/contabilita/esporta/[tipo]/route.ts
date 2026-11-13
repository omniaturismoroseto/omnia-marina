import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { csvAmount, csvResponse, toCsv } from "@/lib/csv";
import { todayRome, yearOf } from "@/lib/dates";
import { CHARGE_KIND_LABEL } from "@/lib/labels";
import { listCharges, type ChargeFilter } from "@/server/charges";

const FILTERS: ChargeFilter[] = ["aperti", "scaduti", "pagati", "annullati", "tutti"];

// Esportazioni per il commercialista: prima nota di un anno e scadenziario.
export async function GET(request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const { tipo } = await params;
  const url = new URL(request.url);
  const today = todayRome();

  if (tipo === "prima-nota") {
    const yearParam = Number(url.searchParams.get("anno"));
    const year = Number.isInteger(yearParam) && yearParam > 2000 && yearParam < 2200 ? yearParam : yearOf(today);
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.marinaId, ctx.marinaId), gte(ledgerEntries.entryDate, `${year}-01-01`), lte(ledgerEntries.entryDate, `${year}-12-31`)))
      .orderBy(asc(ledgerEntries.entryDate), asc(ledgerEntries.createdAt));
    await audit(ctx, "esportazione", "prima nota", null, `Anno ${year}`);
    return csvResponse(
      `prima-nota-${year}.csv`,
      toCsv(
        ["Data", "Tipo", "Conto", "Categoria", "Descrizione", "Controparte", "Documento", "Entrata", "Uscita"],
        rows.map((r) => [
          r.entryDate,
          r.direction === "entrata" ? "Entrata" : "Uscita",
          r.account === "cassa" ? "Cassa" : "Banca",
          r.category,
          r.description,
          r.counterparty,
          r.documentRef,
          r.direction === "entrata" ? csvAmount(r.amountCents) : "",
          r.direction === "uscita" ? csvAmount(r.amountCents) : "",
        ]),
      ),
    );
  }

  if (tipo === "scadenziario") {
    const stato = url.searchParams.get("stato") as ChargeFilter | null;
    const filter = stato && FILTERS.includes(stato) ? stato : "aperti";
    const rows = await listCharges(ctx.marinaId, today, { filter, limit: 20000 });
    await audit(ctx, "esportazione", "scadenziario", null, filter);
    return csvResponse(
      `scadenziario-${filter}-${today}.csv`,
      toCsv(
        ["Scadenza", "Data addebito", "Cliente", "Contratto", "Tipo", "Descrizione", "Stato", "Imponibile", "IVA %", "IVA", "Totale", "Incassato", "Residuo"],
        rows.map((r) => [
          r.dueDate,
          r.issueDate,
          r.ownerName,
          r.contractNumber,
          CHARGE_KIND_LABEL[r.kind],
          r.description,
          r.status,
          csvAmount(r.netCents),
          r.vatRate,
          csvAmount(r.vatCents),
          csvAmount(r.grossCents),
          csvAmount(r.paidCents),
          csvAmount(r.status === "annullato" ? 0 : r.grossCents - r.paidCents),
        ]),
      ),
    );
  }

  return new Response("Non trovato", { status: 404 });
}
