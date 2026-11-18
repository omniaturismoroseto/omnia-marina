import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import { civilAlertText, civilAlertWorthSending, findZoneByComune, zoneOutlook, type CivilBulletin, type ZoneOutlook } from "@/lib/civil-protection";
import { alertMessage, marineAlerts, type AlertThresholds, type MarineAlert, type WeatherHour } from "@/lib/weather";
import { latestCivilBulletin } from "./civil-protection";
import { alertSentRecently, nowRomeLocal, portForecast } from "./weather";

// Tutto quello che serve per il meteo di un porto: previsioni marine, allerte (burrasca, raffiche, onda), bollettino
// della Protezione Civile per la zona del porto e il testo dell'avviso ai diportisti. Lo usano gestionale, area
// diportista e controllo automatico.

export interface PortConditions {
  hasPosition: boolean;
  hours: WeatherHour[] | null;
  now: string;
  today: string;
  thresholds: AlertThresholds;
  alerts: MarineAlert[];
  civil: { bulletin: CivilBulletin; zone: string | null; manual: boolean; outlook: ZoneOutlook | null } | null;
  /** Vero se c'è qualcosa per cui avvisare: burrasca, raffiche od onda oltre soglia, allerta arancione o rossa. */
  worthSending: boolean;
  proposal: { title: string; body: string } | null;
  sentAt: Date | null;
  sentRecently: boolean;
  auto: boolean;
  vhf: string | null;
}

export async function portConditions(marinaId: string): Promise<PortConditions> {
  const [marina] = await db.select().from(marinas).where(eq(marinas.id, marinaId));
  const now = nowRomeLocal();
  const today = now.slice(0, 10);
  const thresholds = { gustKn: marina.windAlertKnots, waveM: marina.waveAlertM };
  const [hours, bulletin] = await Promise.all([portForecast(marina.latitude, marina.longitude), latestCivilBulletin()]);

  const alerts = hours ? marineAlerts(hours, thresholds, now) : [];
  let civil: PortConditions["civil"] = null;
  if (bulletin) {
    const zone = marina.alertZone ?? findZoneByComune(bulletin.days[0]?.zones ?? [], marina.city)?.name ?? null;
    civil = { bulletin, zone, manual: !!marina.alertZone, outlook: zone ? zoneOutlook(bulletin, today, zone) : null };
  }
  const worthSending = alerts.length > 0 || civilAlertWorthSending(civil?.outlook ?? null);
  return {
    hasPosition: marina.latitude !== null && marina.longitude !== null,
    hours,
    now,
    today,
    thresholds,
    alerts,
    civil,
    worthSending,
    proposal: worthSending ? alertMessage(alerts, today, civilAlertText(civil?.outlook ?? null, today)) : null,
    sentAt: marina.windAlertSentAt,
    sentRecently: alertSentRecently(marina.windAlertSentAt),
    auto: marina.windAlertAuto,
    vhf: marina.vhfChannel,
  };
}
