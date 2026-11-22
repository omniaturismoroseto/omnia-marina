// Servizi del porto che si possono segnare sulla mappa. Le icone sono di lucide-react (vedi `ServiceIcon`).

export const PORT_SERVICES = [
  { key: "carburante", label: "Distributore di carburante" },
  { key: "bar", label: "Bar" },
  { key: "ristorante", label: "Ristorante" },
  { key: "parcheggio", label: "Parcheggio" },
  { key: "cantiere", label: "Cantiere nautico" },
  { key: "porto_secco", label: "Porto a secco" },
  { key: "gru", label: "Gru / travel lift" },
  { key: "scivolo", label: "Scivolo di alaggio" },
  { key: "servizi", label: "Servizi igienici" },
  { key: "docce", label: "Docce" },
  { key: "lavanderia", label: "Lavanderia" },
  { key: "ufficio", label: "Direzione / ufficio del porto" },
  { key: "ormeggiatori", label: "Ormeggiatori" },
  { key: "market", label: "Market" },
  { key: "nautica", label: "Negozio nautico" },
  { key: "rifiuti", label: "Raccolta rifiuti" },
  { key: "acqua", label: "Acqua potabile" },
  { key: "elettricita", label: "Colonnine elettriche" },
  { key: "soccorso", label: "Primo soccorso" },
  { key: "informazioni", label: "Informazioni" },
  { key: "noleggio", label: "Noleggio barche" },
  { key: "hotel", label: "Hotel" },
  { key: "farmacia", label: "Farmacia" },
  { key: "bancomat", label: "Bancomat" },
  { key: "bus", label: "Fermata autobus" },
  { key: "taxi", label: "Taxi" },
  { key: "wifi", label: "Wi-Fi" },
  { key: "accessibile", label: "Accesso per disabili" },
] as const;

export type PortServiceKey = (typeof PORT_SERVICES)[number]["key"];

export const SERVICE_KEYS = PORT_SERVICES.map((s) => s.key) as [PortServiceKey, ...PortServiceKey[]];

const LABELS = new Map<string, string>(PORT_SERVICES.map((s) => [s.key, s.label]));

export function isServiceKey(value: unknown): value is PortServiceKey {
  return typeof value === "string" && LABELS.has(value);
}

export function serviceLabel(key: string): string {
  return LABELS.get(key) ?? "Servizio";
}

// Nome da mostrare: quello dato dal porto (es. «Bar La Vela») o, in mancanza, il tipo.
export function serviceTitle(key: string, name: string | null | undefined): string {
  const n = name?.trim();
  return n ? `${n} (${serviceLabel(key)})` : serviceLabel(key);
}
