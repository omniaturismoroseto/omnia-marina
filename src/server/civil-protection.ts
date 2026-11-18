import "server-only";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { addDays, todayRome } from "@/lib/dates";
import { zonesFromTopojson, type CivilBulletin } from "@/lib/civil-protection";

// Ultimo bollettino di criticità della Protezione Civile, dal repository pubblico su GitHub. Il nome del file cambia
// a ogni emissione (files/AAAAMMGG_HHMM.json): lo si trova dall'ultimo commit che ha toccato la cartella. Si tiene in
// memoria un'ora. GITHUB_TOKEN (facoltativo, sola lettura) alza il limite di richieste all'API di GitHub.
// Per le prove locali DPC_FIXTURE (percorso dell'indice JSON, con i TopoJSON in «topojson/» accanto) sostituisce la rete.

const REPO = "pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica";
const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; bulletin: CivilBulletin | null } | null = null;

type Index = { date: string; name: string; today: { topo_json: string }; tomorrow: { topo_json: string } };

async function getJson<T>(url: string, api = false): Promise<T> {
  const headers: Record<string, string> = { "User-Agent": "omnia-marina" };
  if (api) {
    headers.Accept = "application/vnd.github+json";
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Percorso dell'indice più recente («files/20261117_1519.json»), dagli ultimi commit sulla cartella files. */
async function latestIndexPath(): Promise<string> {
  const commits = await getJson<{ sha: string }[]>(`https://api.github.com/repos/${REPO}/commits?path=files&per_page=3`, true);
  let best = "";
  for (const c of commits) {
    const detail = await getJson<{ files?: { filename: string }[] }>(`https://api.github.com/repos/${REPO}/commits/${c.sha}`, true);
    for (const f of detail.files ?? []) if (/^files\/\d{8}_\d{4}\.json$/.test(f.filename) && f.filename > best) best = f.filename;
    if (best) break;
  }
  if (!best) throw new Error("Nessun bollettino negli ultimi commit.");
  return best;
}

async function load(): Promise<CivilBulletin> {
  let index: Index;
  let topo: (url: string) => Promise<Parameters<typeof zonesFromTopojson>[0]>;
  if (process.env.DPC_FIXTURE) {
    const dir = dirname(process.env.DPC_FIXTURE);
    index = JSON.parse(await readFile(process.env.DPC_FIXTURE, "utf8"));
    topo = async (url) => JSON.parse(await readFile(join(dir, "topojson", basename(url)), "utf8"));
  } else {
    index = await getJson<Index>(`https://raw.githubusercontent.com/${REPO}/master/${await latestIndexPath()}`);
    topo = (url) => getJson(url);
  }
  // «today» è il giorno di emissione (ora italiana), «tomorrow» il successivo.
  const day = todayRome(new Date(index.date));
  const [today, tomorrow] = await Promise.all([topo(index.today.topo_json), topo(index.tomorrow.topo_json)]);
  return {
    name: index.name,
    issuedAt: index.date,
    days: [
      { date: day, zones: zonesFromTopojson(today) },
      { date: addDays(day, 1), zones: zonesFromTopojson(tomorrow) },
    ],
  };
}

/** L'ultimo bollettino, oppure null se non è raggiungibile (si tiene buono quello già letto). */
export async function latestCivilBulletin(): Promise<CivilBulletin | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.bulletin;
  try {
    const bulletin = await load();
    cache = { at: Date.now(), bulletin };
    return bulletin;
  } catch (error) {
    console.error("Bollettino della Protezione Civile non disponibile", error);
    // Si riprova tra 10 minuti, intanto si usa l'ultimo letto.
    cache = { at: Date.now() - TTL_MS + 10 * 60 * 1000, bulletin: cache?.bulletin ?? null };
    return cache.bulletin;
  }
}
