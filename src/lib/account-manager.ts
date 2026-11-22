import "server-only";
import { isNull, notInArray, or, type SQL } from "drizzle-orm";
import { users } from "@/db/schema";

// Account manager di Omnia Marina: entra in ogni porto con i permessi della direzione, è l'unico che crea i porti
// (con il loro direttore) e nei porti non lascia tracce visibili: non compare tra gli utenti, nel registro delle
// operazioni né accanto a incassi, movimenti, consensi, segnalazioni e messaggi.
//
// Chi è lo dice la variabile ACCOUNT_MANAGER_EMAILS (una o più email separate da virgole), impostata su Cloud Run:
// così le email non stanno nel codice. L'account deve già esistere: nessuno può crearne uno nuovo con quelle email
// (vedi createAccount), quindi non basta conoscerle per diventare account manager.

export function accountManagerEmails(): string[] {
  return (process.env.ACCOUNT_MANAGER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAccountManagerEmail(email: string): boolean {
  return accountManagerEmails().includes(email.trim().toLowerCase());
}

/**
 * Da aggiungere alla condizione di un join con `users` per mostrare un nome: con l'account manager il join resta
 * vuoto e la pagina mostra «—» come per un utente cancellato.
 */
export function visibleUser(): SQL | undefined {
  const emails = accountManagerEmails();
  return emails.length > 0 ? notInArray(users.email, emails) : undefined;
}

/** Come visibleUser, per i filtri su righe con un utente facoltativo (left join): tiene le righe senza utente. */
export function withoutAccountManager(): SQL | undefined {
  const emails = accountManagerEmails();
  return emails.length > 0 ? or(isNull(users.email), notInArray(users.email, emails)) : undefined;
}
