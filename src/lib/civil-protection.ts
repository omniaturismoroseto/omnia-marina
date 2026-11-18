// Bollettino di criticità idrogeologica e idraulica del Dipartimento della Protezione Civile (pubblicato ogni giorno,
// di norma entro le 16, su GitHub: pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica, licenza CC-BY 4.0).
// Per ogni zona di allerta: livello per rischio idrogeologico, idraulico e temporali, oggi e domani, e i Comuni della
// zona (da cui si trova quella del porto). Funzioni pure.

export const CIVIL_LEVELS = ["verde", "gialla", "arancione", "rossa"] as const;
export type CivilLevel = (typeof CIVIL_LEVELS)[number];

export const CIVIL_RISKS = ["idrogeologico", "idraulico", "temporali"] as const;
export type CivilRisk = (typeof CIVIL_RISKS)[number];

export const CIVIL_LEVEL_LABEL: Record<CivilLevel, string> = {
  verde: "Nessuna allerta",
  gialla: "Allerta gialla",
  arancione: "Allerta arancione",
  rossa: "Allerta rossa",
};

/** Criticità corrispondente al colore, come la scrive il bollettino. */
export const CIVIL_CRITICALITY: Record<CivilLevel, string> = {
  verde: "assenza di fenomeni significativi",
  gialla: "criticità ordinaria",
  arancione: "criticità moderata",
  rossa: "criticità elevata",
};

export interface CivilZone {
  name: string;
  comuni: string[];
  levels: Record<CivilRisk, CivilLevel>;
}

export interface CivilDay {
  /** Giorno a cui si riferisce, AAAA-MM-GG. */
  date: string;
  zones: CivilZone[];
}

export interface CivilBulletin {
  /** «Bollettino del 17 novembre 2026 ore 15:19». */
  name: string;
  /** Emissione (ISO). */
  issuedAt: string;
  days: CivilDay[];
}

/** «Ordinaria / ALLERTA GIALLA» → gialla. Testo sconosciuto → verde. */
export function levelFromText(text: unknown): CivilLevel {
  const t = String(text ?? "").toUpperCase();
  if (t.includes("ALLERTA ROSSA")) return "rossa";
  if (t.includes("ALLERTA ARANCIONE")) return "arancione";
  if (t.includes("ALLERTA GIALLA")) return "gialla";
  return "verde";
}

export function levelRank(level: CivilLevel): number {
  return CIVIL_LEVELS.indexOf(level);
}

export function maxLevel(levels: Record<CivilRisk, CivilLevel>): CivilLevel {
  return CIVIL_RISKS.map((r) => levels[r]).reduce((a, b) => (levelRank(b) > levelRank(a) ? b : a), "verde" as CivilLevel);
}

type TopoProperties = Record<string, unknown>;
type Topology = { objects: Record<string, { geometries: { properties?: TopoProperties }[] }> };

/** Zone di allerta di un file TopoJSON del bollettino (oggi o domani). Servono solo le proprietà, non la geometria. */
export function zonesFromTopojson(topo: Topology): CivilZone[] {
  const object = Object.values(topo.objects ?? {})[0];
  return (object?.geometries ?? [])
    .map((g) => g.properties ?? {})
    .filter((p) => typeof p["Nome zona"] === "string")
    .map((p) => ({
      name: String(p["Nome zona"]),
      comuni: Array.isArray(p["Comuni"]) ? p["Comuni"].map(String) : [],
      levels: {
        idrogeologico: levelFromText(p["Per rischio idrogeologico"]),
        idraulico: levelFromText(p["Per rischio idraulico"]),
        temporali: levelFromText(p["Per rischio temporali"]),
      },
    }));
}

/** Nome di un luogo confrontabile: minuscole, senza accenti né apostrofi o trattini. */
export function normalizePlace(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[''`´\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La zona di allerta che contiene il Comune indicato (quello del porto). */
export function findZoneByComune(zones: CivilZone[], comune: string | null | undefined): CivilZone | null {
  if (!comune) return null;
  const key = normalizePlace(comune);
  return zones.find((z) => z.comuni.some((c) => normalizePlace(c) === key)) ?? null;
}

/**
 * I giorni del bollettino ancora validi da oggi in poi. Il bollettino esce nel pomeriggio: la mattina l'ultimo è quello
 * di ieri, e il suo «domani» è oggi.
 */
export function currentDays(bulletin: CivilBulletin, todayLocal: string): CivilDay[] {
  return bulletin.days.filter((d) => d.date >= todayLocal);
}

export interface ZoneOutlook {
  zone: string;
  days: { date: string; levels: Record<CivilRisk, CivilLevel>; max: CivilLevel }[];
}

/** Livelli della zona del porto per i giorni validi. */
export function zoneOutlook(bulletin: CivilBulletin, todayLocal: string, zoneName: string): ZoneOutlook | null {
  const days = currentDays(bulletin, todayLocal)
    .map((d) => {
      const zone = d.zones.find((z) => z.name === zoneName);
      return zone ? { date: d.date, levels: zone.levels, max: maxLevel(zone.levels) } : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  return days.length ? { zone: zoneName, days } : null;
}

/** Vero se la zona ha un'allerta arancione o rossa: è il momento di avvisare i diportisti. */
export function civilAlertWorthSending(outlook: ZoneOutlook | null): boolean {
  return !!outlook?.days.some((d) => levelRank(d.max) >= levelRank("arancione"));
}

const DAY = (date: string, today: string) => (date === today ? "oggi" : "domani");

/** Righe per il messaggio ai diportisti (solo giorni con allerta gialla o superiore). Null se tutto verde. */
export function civilAlertText(outlook: ZoneOutlook | null, todayLocal: string): { title: string; lines: string[] } | null {
  if (!outlook) return null;
  const alerting = outlook.days.filter((d) => d.max !== "verde");
  if (alerting.length === 0) return null;
  const worst = alerting.reduce((a, b) => (levelRank(b.max) > levelRank(a.max) ? b : a));
  const lines = [`Protezione Civile, bollettino di criticità (zona «${outlook.zone}»):`];
  for (const d of alerting) {
    const risks = CIVIL_RISKS.filter((r) => d.levels[r] !== "verde").map((r) => `${CIVIL_LEVEL_LABEL[d.levels[r]].toLowerCase()} per rischio ${r}`);
    lines.push(`• ${DAY(d.date, todayLocal)}: ${risks.join(", ")}.`);
  }
  return { title: `${CIVIL_LEVEL_LABEL[worst.max]} della Protezione Civile ${DAY(worst.date, todayLocal)}`, lines };
}

// ───────────────────────── Bollettino di vigilanza meteorologica ─────────────────────────
// Pubblicato ogni giorno (pcm-dpc/DPC-Bollettini-Vigilanza-Meteorologica, CC-BY 4.0) per oggi, domani e dopodomani:
// testo nazionale per fenomeno (venti, mari…) e simboli sulla mappa, punti con coordinate e codice del fenomeno.
// Per il porto contano i simboli di vento e mare vicini alla sua posizione.

export type PhenomenonGroup = "vento" | "mare";

/** Codici dei simboli di vento e mare (legenda ufficiale «legenda_bv_verticale.jpg»). `severe`: motivo per avvisare. */
export const PHENOMENA: Record<number, { label: string; group: PhenomenonGroup; severe: boolean }> = {
  10: { label: "Venti forti", group: "vento", severe: false },
  11: { label: "Burrasca", group: "vento", severe: true },
  12: { label: "Tempesta", group: "vento", severe: true },
  13: { label: "Frequenti raffiche", group: "vento", severe: false },
  40: { label: "Mare molto mosso", group: "mare", severe: false },
  41: { label: "Mare agitato o molto agitato", group: "mare", severe: true },
  42: { label: "Mare grosso o molto grosso", group: "mare", severe: true },
  50: { label: "Moto ondoso in aumento", group: "mare", severe: false },
  51: { label: "Moto ondoso in diminuzione", group: "mare", severe: false },
};

/** Distanza entro cui un simbolo riguarda il porto: i simboli del mare stanno al largo, sul bacino. */
export const NEARBY_KM = 70;

export interface PhenomenonPoint {
  code: number;
  lat: number;
  lon: number;
}

export interface NearbyPhenomenon {
  code: number;
  label: string;
  group: PhenomenonGroup;
  severe: boolean;
  km: number;
}

export interface VigilanceDay {
  date: string;
  points: PhenomenonPoint[];
  /** Testi nazionali del bollettino per venti e mari (vuoti se assenti). */
  windText: string;
  seaText: string;
}

export interface VigilanceBulletin {
  name: string;
  days: VigilanceDay[];
}

/** Punti dei fenomeni di un TopoJSON «fenomeni_…» (servono solo codice e coordinate). */
export function phenomenaFromTopojson(topo: Topology): PhenomenonPoint[] {
  const object = Object.values(topo.objects ?? {})[0];
  return (object?.geometries ?? [])
    .map((g) => g.properties ?? {})
    .map((p) => ({ code: Number(p["id_fenomeno"]), lat: Number(p["lat"]), lon: Number(p["lon"]) }))
    .filter((p) => Number.isFinite(p.code) && Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/** Distanza in chilometri tra due punti (formula dell'emisenoverso). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Fenomeni di vento e mare entro `km` dal porto: uno per tipo, il più vicino, prima i più gravi. */
export function nearbyPhenomena(points: PhenomenonPoint[], lat: number, lon: number, km = NEARBY_KM): NearbyPhenomenon[] {
  const best = new Map<number, NearbyPhenomenon>();
  for (const p of points) {
    const info = PHENOMENA[p.code];
    if (!info) continue;
    const d = Math.round(distanceKm(lat, lon, p.lat, p.lon));
    if (d > km) continue;
    const prev = best.get(p.code);
    if (!prev || d < prev.km) best.set(p.code, { code: p.code, ...info, km: d });
  }
  return [...best.values()].sort((a, b) => Number(b.severe) - Number(a.severe) || a.group.localeCompare(b.group) || b.code - a.code);
}

/** Testo di una sezione del bollettino («Venti», «Mari»), senza HTML. */
export function bulletinSection(html: string, heading: string): string {
  const paragraphs = html
    .split(/<\/p>/i)
    .map((p) =>
      p
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const out: string[] = [];
  let inside = false;
  for (const p of paragraphs) {
    const head = /^([A-ZÀ-Úa-zà-ú ]+):\s*(.*)$/.exec(p);
    if (head && !p.startsWith("-")) {
      inside = head[1].trim().toLowerCase() === heading.toLowerCase();
      if (inside && head[2]) out.push(head[2]);
    } else if (inside) out.push(p);
  }
  return out.join(" ").trim();
}

export interface PortVigilanceDay {
  date: string;
  nearby: NearbyPhenomenon[];
  windText: string;
  seaText: string;
}

/** Giorni del bollettino da oggi in poi, con i fenomeni vicini al porto. */
export function portVigilance(bulletin: VigilanceBulletin, todayLocal: string, lat: number | null, lon: number | null): PortVigilanceDay[] {
  return bulletin.days
    .filter((d) => d.date >= todayLocal)
    .map((d) => ({
      date: d.date,
      nearby: lat === null || lon === null ? [] : nearbyPhenomena(d.points, lat, lon),
      windText: d.windText,
      seaText: d.seaText,
    }));
}

export function vigilanceWorthSending(days: PortVigilanceDay[]): boolean {
  return days.some((d) => d.nearby.some((p) => p.severe));
}

const DAY3 = (date: string, today: string) => {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return diff === 0 ? "oggi" : diff === 1 ? "domani" : "dopodomani";
};

/** Righe per il messaggio ai diportisti (giorni con vento o mare vicino al porto). Null se non c'è niente. */
export function vigilanceAlertText(days: PortVigilanceDay[], todayLocal: string): { title: string; lines: string[] } | null {
  const withNearby = days.filter((d) => d.nearby.length > 0);
  if (withNearby.length === 0) return null;
  const all = withNearby.flatMap((d) => d.nearby);
  const gale = all.find((p) => p.code === 12) ?? all.find((p) => p.code === 11);
  const sea = all.find((p) => p.code === 42) ?? all.find((p) => p.code === 41);
  const title = gale ? `Avviso di ${gale.label.toLowerCase()}${sea ? ` e ${sea.label.toLowerCase()}` : ""}` : sea ? sea.label : "Avviso vento e mare";
  return {
    title,
    lines: [
      "Protezione Civile, bollettino di vigilanza meteorologica (vento e mare nella zona del porto):",
      ...withNearby.map((d) => `• ${DAY3(d.date, todayLocal)}: ${d.nearby.map((p) => p.label.toLowerCase()).join(", ")}.`),
    ],
  };
}
