import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { marinas } from "@/db/schema";
import {
  civilAlertText,
  civilAlertWorthSending,
  findZoneByComune,
  portVigilance,
  vigilanceAlertText,
  vigilanceWorthSending,
  zoneOutlook,
  type CivilBulletin,
  type PortVigilanceDay,
  type ZoneOutlook,
} from "@/lib/civil-protection";
import { alertMessage, marineAlerts, type AlertThresholds, type MarineAlert, type WeatherHour } from "@/lib/weather";
import { latestCivilBulletin, latestVigilance } from "./civil-protection";
import { alertSentRecently, nowRomeLocal, portForecast, weatherEnabled } from "./weather";

// Tutto quello che serve per il meteo di un porto: previsioni marine, allerte (burrasca, raffiche, onda), bollettino
// della Protezione Civile per la zona del porto e il testo dell'avviso ai diportisti. Lo usano gestionale, area
// diportista e controllo automatico.

export interface PortConditions {
  hasPosition: boolean;
  /** Previsioni Open-Meteo accese (solo con abbonamento). */
  forecastEnabled: boolean;
  /** Bollettino di vigilanza: vento e mare vicino al porto, oggi, domani e dopodomani (null se non raggiungibile). */
  vigilance: { name: string; days: PortVigilanceDay[] } | null;
  hours: WeatherHour[] | null;
  now: string;
  today: string;
  thresholds: AlertThresholds;
  alerts: MarineAlert[];
  civil: { bulletin: CivilBulletin; zone: string | null; manual: boolean; outlook: ZoneOutlook | null } | null;
  /**
   * Vero se c'è qualcosa per cui avvisare: burrasca, tempesta o mare agitato vicino al porto nel bollettino di vigilanza,
   * allerta arancione o rossa di criticità, oppure (con le previsioni accese) burrasca, raffiche od onda oltre soglia.
   */
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
  const [hours, bulletin, vigilanceBulletin] = await Promise.all([portForecast(marina.latitude, marina.longitude), latestCivilBulletin(), latestVigilance()]);
  const vigilance = vigilanceBulletin ? { name: vigilanceBulletin.name, days: portVigilance(vigilanceBulletin, today, marina.latitude, marina.longitude) } : null;

  const alerts = hours ? marineAlerts(hours, thresholds, now) : [];
  let civil: PortConditions["civil"] = null;
  if (bulletin) {
    const zone = marina.alertZone ?? findZoneByComune(bulletin.days[0]?.zones ?? [], marina.city)?.name ?? null;
    civil = { bulletin, zone, manual: !!marina.alertZone, outlook: zone ? zoneOutlook(bulletin, today, zone) : null };
  }
  const worthSending = alerts.length > 0 || civilAlertWorthSending(civil?.outlook ?? null) || vigilanceWorthSending(vigilance?.days ?? []);
  const extras = [vigilanceAlertText(vigilance?.days ?? [], today), civilAlertText(civil?.outlook ?? null, today)].filter(
    (x): x is { title: string; lines: string[] } => x !== null,
  );
  return {
    hasPosition: marina.latitude !== null && marina.longitude !== null,
    forecastEnabled: weatherEnabled(),
    vigilance,
    hours,
    now,
    today,
    thresholds,
    alerts,
    civil,
    worthSending,
    proposal: worthSending ? alertMessage(alerts, today, extras) : null,
    sentAt: marina.windAlertSentAt,
    sentRecently: alertSentRecently(marina.windAlertSentAt),
    auto: marina.windAlertAuto,
    vhf: marina.vhfChannel,
  };
}
