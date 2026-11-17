import { timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { alertMessage, windAlert } from "@/lib/weather";
import { sendMessage } from "@/server/messages";
import { alertSentRecently, nowRomeLocal, portForecast } from "@/server/weather";

// Controllo periodico dell'allerta vento, per i porti che hanno scelto l'invio automatico (Impostazioni → Porto).
// Lo chiama Cloud Scheduler ogni 3 ore con l'intestazione «Authorization: Bearer <METEO_CHECK_TOKEN>»
// (vedi COME-LAVORIAMO.md). La stessa allerta non parte due volte entro 24 ore.

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
  const rows = await db
    .select({ id: marinas.id, latitude: marinas.latitude, longitude: marinas.longitude, threshold: marinas.windAlertKnots, sentAt: marinas.windAlertSentAt })
    .from(marinas)
    .where(and(eq(marinas.windAlertAuto, true), isNotNull(marinas.latitude), isNotNull(marinas.longitude)));

  const now = nowRomeLocal();
  const results: { marinaId: string; sent: boolean; maxGustKn?: number }[] = [];
  for (const m of rows) {
    const hours = await portForecast(m.latitude, m.longitude);
    const alert = hours ? windAlert(hours, m.threshold, now, 36) : null;
    if (!alert || alertSentRecently(m.sentAt)) {
      results.push({ marinaId: m.id, sent: false, maxGustKn: alert?.maxGustKn });
      continue;
    }
    const text = alertMessage(alert, now.slice(0, 10));
    try {
      await sendMessage({ marinaId: m.id, role: "admin", user: { id: null } }, { kind: "urgente", title: text.title, body: text.body, audience: { type: "tutti" } });
      await db.update(marinas).set({ windAlertSentAt: new Date() }).where(eq(marinas.id, m.id));
      results.push({ marinaId: m.id, sent: true, maxGustKn: alert.maxGustKn });
    } catch (error) {
      console.error("Allerta vento non inviata", m.id, error);
      results.push({ marinaId: m.id, sent: false, maxGustKn: alert.maxGustKn });
    }
  }
  return Response.json({ ok: true, checked: rows.length, results });
}

export const POST = check;
export const GET = check;
