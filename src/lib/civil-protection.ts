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
