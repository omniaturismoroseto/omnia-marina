export interface MarinaIdentity {
  name: string;
  legalName: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  province: string | null;
  email: string | null;
  vatNumber: string | null;
}

export function marinaAddress(m: MarinaIdentity): string {
  return [m.address, [m.zip, m.city].filter(Boolean).join(" "), m.province ? `(${m.province})` : null].filter(Boolean).join(", ");
}

// Sostituisce i segnaposto {{…}} dei testi modello con i dati del porto.
export function fillTemplate(text: string, m: MarinaIdentity): string {
  const values: Record<string, string> = {
    porto: m.name,
    titolare: m.legalName || m.name,
    indirizzo: marinaAddress(m) || "________________",
    email: m.email || "________________",
    partitaIva: m.vatNumber || "________________",
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}
