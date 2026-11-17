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

export interface TextSection {
  /** Titolo della sezione («1. Titolare del trattamento»), se la prima riga ne ha la forma. */
  heading: string | null;
  lines: string[];
}

/**
 * Divide un testo libero (informativa) in sezioni separate da righe vuote. Una sezione il cui primo rigo
 * inizia con un numero («1.», «2)») ha quel rigo come titolo; le altre sono solo testo. Serve alla stampa
 * per mettere in evidenza i titoli e non lasciarli soli in fondo alla pagina.
 */
export function textSections(text: string): TextSection[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((l) => l.trim()).filter((l) => l !== ""))
    .filter((lines) => lines.length > 0)
    .map((lines) => (/^\d+[.)]\s+\S/.test(lines[0]) ? { heading: lines[0], lines: lines.slice(1) } : { heading: null, lines }));
}
