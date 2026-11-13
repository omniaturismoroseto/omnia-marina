import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { boats, charges, contracts, owners, payments, privacyConsents } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { uuidOrNull } from "@/lib/params";

// Esportazione completa dei dati di un cliente (diritto di accesso e portabilità).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) return new Response("Non trovato", { status: 404 });

  const [owner] = await db
    .select()
    .from(owners)
    .where(and(eq(owners.id, id), eq(owners.marinaId, ctx.marinaId)))
    .limit(1);
  if (!owner) return new Response("Non trovato", { status: 404 });

  const [boatRows, contractRows, chargeRows, paymentRows, consentRows] = await Promise.all([
    db.select().from(boats).where(eq(boats.ownerId, id)).orderBy(asc(boats.name)),
    db.select().from(contracts).where(eq(contracts.ownerId, id)).orderBy(desc(contracts.startDate)),
    db.select().from(charges).where(eq(charges.ownerId, id)).orderBy(desc(charges.dueDate)),
    db.select().from(payments).where(eq(payments.ownerId, id)).orderBy(desc(payments.paidOn)),
    db.select().from(privacyConsents).where(eq(privacyConsents.ownerId, id)).orderBy(desc(privacyConsents.recordedAt)),
  ]);

  await audit(ctx, "esportazione", "cliente", id, "Esportazione completa dei dati");

  // Gli identificativi interni (porto, operatori) non fanno parte dei dati del cliente.
  const strip = <T extends Record<string, unknown>>(row: T) => {
    const { marinaId: _m, createdBy: _c, recordedBy: _r, ...rest } = row as Record<string, unknown>;
    return rest;
  };

  const body = {
    esportatoIl: new Date().toISOString(),
    porto: ctx.marinaName,
    cliente: strip(owner),
    barche: boatRows.map(strip),
    contratti: contractRows.map(strip),
    addebiti: chargeRows.map(strip),
    pagamenti: paymentRows.map(strip),
    consensiPrivacy: consentRows.map(strip),
  };

  const fileName = `dati-${owner.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente"}.json`;
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
