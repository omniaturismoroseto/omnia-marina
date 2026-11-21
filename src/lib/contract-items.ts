import type { ContractItemKind } from "@/db/schema";
import { CONTRACT_ITEM_LABEL } from "./labels";

// Voci del contratto oltre al posto barca, nell'ordine in cui compaiono nel contratto stampato.
export const SPACE_ITEM_KINDS = ["secca", "auto_coperto", "auto_scoperto", "carrello"] as const satisfies readonly ContractItemKind[];
export const FEE_ITEM_KINDS = ["gestione", "rifiuti"] as const satisfies readonly ContractItemKind[];
// Servizi e cauzioni presi dal listino (o scritti a mano): descrizione e aliquota propria, anche più d'uno per contratto.
export const SERVICE_ITEM_KIND = "servizio" as const satisfies ContractItemKind;
export const ITEM_KINDS = [...SPACE_ITEM_KINDS, ...FEE_ITEM_KINDS, SERVICE_ITEM_KIND] as const;

/** Aliquote ammesse per un servizio; 0 = senza IVA (cauzioni). */
export const SERVICE_VAT_RATES = [22, 10, 5, 4, 0] as const;

export interface ContractItemInput {
  kind: ContractItemKind;
  reference: string | null;
  startDate: string | null;
  endDate: string | null;
  amountCents: number;
  /** Solo per gli spazi: preso per un anno intero dalla data di inizio. */
  annual?: boolean;
  /** Solo per i servizi: descrizione (es. «Cauzione badge») e aliquota (0 = senza IVA). */
  description?: string | null;
  vatRate?: number | null;
}

/** Gli spazi (a terra, posti auto, carrello) hanno un periodo; le spese fisse no. */
export function itemHasPeriod(kind: ContractItemKind): boolean {
  return (SPACE_ITEM_KINDS as readonly string[]).includes(kind);
}

/** Descrizione breve della voce: il nome del servizio, oppure la voce con il numero del posto auto se indicato. */
export function itemTitle(item: { kind: ContractItemKind; reference: string | null; description?: string | null }): string {
  if (item.kind === SERVICE_ITEM_KIND && item.description) return item.description;
  const label = CONTRACT_ITEM_LABEL[item.kind];
  return item.reference ? `${label} n. ${item.reference}` : label;
}

/** Ordina le voci come nel contratto: prima gli spazi, poi le spese. */
export function sortItems<T extends { kind: ContractItemKind }>(items: T[]): T[] {
  return [...items].sort((a, b) => ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind));
}

/**
 * Dal nome di un servizio del listino, la voce del contratto che rappresenta: i posti auto, il carrello e lo spazio a terra
 * nel contratto hanno anche numero e periodo; tutto il resto (cauzioni, altri servizi) è un servizio con il suo nome.
 */
export function itemKindFromName(name: string): (typeof SPACE_ITEM_KINDS)[number] | null {
  const n = name.toLocaleLowerCase("it").replace(/\s+/g, " ");
  if (/cauzion/.test(n)) return null;
  if (/posto auto|posti auto|parcheggio|park/.test(n)) return /scopert/.test(n) ? "auto_scoperto" : /copert/.test(n) ? "auto_coperto" : null;
  if (/carrell|invas/.test(n)) return "carrello";
  if (/(spazio|sosta|rimessaggio|posto) a terra|secca/.test(n)) return "secca";
  return null;
}
