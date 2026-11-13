// useGrouping "always": anche "4.700,00 €" (di default l'italiano raggruppa solo da 10.000 in su).
const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const dec2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(cents: number | null | undefined): string {
  return eur.format((cents ?? 0) / 100);
}

// Importo senza simbolo, adatto come valore iniziale di un campo ("1234,50").
export function moneyInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

// Accetta "1.234,56", "1234,56", "1234.56", "1234", "€ 12". Restituisce i centesimi, o null se non è un importo.
export function parseMoney(input: string): number | null {
  let s = input.replace(/[€\s]/g, "");
  if (s === "") return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function formatMeters(cm: number | null | undefined): string {
  if (cm == null) return "—";
  return `${dec2.format(cm / 100)} m`;
}

export function metersInput(cm: number | null | undefined): string {
  if (cm == null) return "";
  return (cm / 100).toFixed(2).replace(".", ",");
}

// Accetta "9,5", "9.50", "12". Restituisce i centimetri, o null.
export function parseMeters(input: string): number | null {
  const s = input.replace(/[m\s]/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function formatDimensions(lengthCm: number, beamCm: number): string {
  return `${dec2.format(lengthCm / 100)} × ${dec2.format(beamCm / 100)} m`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Scorporo IVA da un importo lordo.
export function splitVat(grossCents: number, vatRate: number): { netCents: number; vatCents: number } {
  const netCents = Math.round(grossCents / (1 + vatRate / 100));
  return { netCents, vatCents: grossCents - netCents };
}
