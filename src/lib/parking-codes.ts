// Codici dei posti auto (Impostazioni → Posti auto).

/** Codice successivo libero con la stessa sigla: dopo P32 viene P33, o il primo numero dopo che non esiste già. */
export function nextParkingCode(after: string, taken: Set<string>): string {
  const m = /^(.*?)(\d+)$/.exec(after);
  const prefix = m ? m[1] : after;
  let n = m ? Number(m[2]) + 1 : 1;
  while (taken.has(`${prefix}${n}`.toUpperCase())) n++;
  return `${prefix}${n}`;
}
