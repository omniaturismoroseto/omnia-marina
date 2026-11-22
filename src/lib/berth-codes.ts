// Nuovi codici per più posti insieme (Impostazioni → Pontili e posti → «Scegli più posti» → «Cambia i codici»).

/** Confronto «naturale» dei codici: A2 prima di A10, CN30 prima di CS01. */
export function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, "it", { numeric: true, sensitivity: "base" });
}

/** Numero finale del codice (CN07 → 7); null se il codice non finisce con un numero. */
export function codeNumber(code: string): number | null {
  const m = /(\d+)$/.exec(code.trim());
  return m ? Number.parseInt(m[1], 10) : null;
}

export type Numbering = { mode: "mantieni" } | { mode: "rinumera"; from: number };

export type RenameResult = { ok: true; codes: { id: string; code: string }[] } | { ok: false; message: string };

/**
 * Nuovi codici: sigla nuova + numero a due cifre (come i posti creati in serie). Con «mantieni» ogni posto tiene il suo numero;
 * con «rinumera» i posti, in ordine di codice, prendono i numeri da `from` in poi. Rifiuta i codici che verrebbero doppi.
 */
export function renameCodes(berths: { id: string; code: string }[], prefix: string, numbering: Numbering): RenameResult {
  const sigla = prefix.trim().toUpperCase();
  if (!sigla) return { ok: false, message: "Indica la sigla." };
  const sorted = [...berths].sort((a, b) => compareCodes(a.code, b.code));
  const codes: { id: string; code: string }[] = [];
  for (const [i, b] of sorted.entries()) {
    const n = numbering.mode === "rinumera" ? numbering.from + i : codeNumber(b.code);
    if (n === null) return { ok: false, message: `${b.code} non finisce con un numero: scegli «Rinumera in fila».` };
    codes.push({ id: b.id, code: `${sigla}${String(n).padStart(2, "0")}` });
  }
  const seen = new Map<string, string>();
  for (const [i, c] of codes.entries()) {
    const before = seen.get(c.code);
    if (before) return { ok: false, message: `${before} e ${sorted[i].code} diventerebbero entrambi ${c.code}: scegli «Rinumera in fila».` };
    seen.set(c.code, sorted[i].code);
  }
  return { ok: true, codes };
}
