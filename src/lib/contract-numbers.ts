// Numerazione dei contratti: un numero per anno (2026/0001, 2026/0002…), assegnato solo ai contratti definitivi.
// Funzioni pure, provate nei test.

export function formatContractNumber(year: number, seq: number): string {
  return `${year}/${String(seq).padStart(4, "0")}`;
}

/** Il numero da dare al prossimo contratto definitivo: il più basso libero, così i buchi si riempiono per primi. */
export function firstFreeSeq(used: Iterable<number>): { seq: number; fillsGap: boolean } {
  const taken = new Set(used);
  let seq = 1;
  while (taken.has(seq)) seq++;
  const max = taken.size ? Math.max(...taken) : 0;
  return { seq, fillsGap: seq < max };
}

/** I numeri rimasti liberi tra 1 e il più alto usato (per esempio di un contratto tornato in bozza). */
export function seqGaps(used: Iterable<number>): number[] {
  const taken = new Set(used);
  const max = taken.size ? Math.max(...taken) : 0;
  const gaps: number[] = [];
  for (let seq = 1; seq < max; seq++) if (!taken.has(seq)) gaps.push(seq);
  return gaps;
}

/** Come si mostra il numero: le bozze non ne hanno. */
export function contractNumberLabel(number: string | null): string {
  return number ?? "Bozza";
}
