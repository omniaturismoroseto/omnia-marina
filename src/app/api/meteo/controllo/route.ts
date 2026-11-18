import { timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { sendMessage } from "@/server/messages";
import { portConditions } from "@/server/port-conditions";

// Controllo periodico dell'avviso meteo, per i porti che hanno scelto l'invio automatico (Impostazioni → Porto):
// burrasca, raffiche od onda oltre soglia nelle prossime 48 ore, oppure allerta arancione o rossa della Protezione
// Civile per la zona del porto. Lo chiama Cloud Scheduler ogni 3 ore con l'intestazione
// «Authorization: Bearer <METEO_CHECK_TOKEN>» (vedi COME-LAVORIAMO.md). Lo stesso avviso non parte due volte entro 24 ore.

function authorized(request: Request): boolean {
  const token = process.env.METEO_CHECK_TOKEN?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || token.length < 20) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function check(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false }, { status: 401 });
  // Porti con la posizione (meteo) o con il Comune o la zona (Protezione Civile).
  const rows = await db
    .select({ id: marinas.id })
    .from(marinas)
    .where(and(eq(marinas.windAlertAuto, true), or(isNotNull(marinas.latitude), isNotNull(marinas.city), isNotNull(marinas.alertZone))));

  const results: { marinaId: string; sent: boolean; reasons?: string[] }[] = [];
  for (const m of rows) {
    const c = await portConditions(m.id);
    const reasons = [...c.alerts.map((a) => a.kind), ...(c.worthSending && c.alerts.length === 0 ? ["protezione civile"] : [])];
    if (!c.worthSending || !c.proposal || c.sentRecently) {
      results.push({ marinaId: m.id, sent: false, reasons });
      continue;
    }
    try {
      await sendMessage({ marinaId: m.id, role: "admin", user: { id: null } }, { kind: "urgente", title: c.proposal.title, body: c.proposal.body, audience: { type: "tutti" } });
      await db.update(marinas).set({ windAlertSentAt: new Date() }).where(eq(marinas.id, m.id));
      results.push({ marinaId: m.id, sent: true, reasons });
    } catch (error) {
      console.error("Avviso meteo non inviato", m.id, error);
      results.push({ marinaId: m.id, sent: false, reasons });
    }
  }
  return Response.json({ ok: true, checked: rows.length, results });
}

export const POST = check;
export const GET = check;
