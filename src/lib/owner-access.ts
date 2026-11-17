// Area diportista: codici d'invito, seconda prova (codice fiscale o partita IVA) e messaggio da consegnare.
// Funzioni pure, usate dal server e dalle pagine.

/** Caratteri dei codici: niente 0/O e 1/I, che si confondono quando si legge da un foglio. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
export const INVITE_DAYS = 30;
/** Tentativi con codice fiscale / partita IVA sbagliati prima che l'invito si blocchi. */
export const INVITE_MAX_FAILED = 5;

/** Codice d'invito da byte casuali (almeno INVITE_CODE_LENGTH). 32 caratteri possibili: ogni byte ne sceglie uno senza sbilanciamenti. */
export function inviteCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < INVITE_CODE_LENGTH) throw new Error("Servono più byte casuali.");
  return Array.from(bytes.subarray(0, INVITE_CODE_LENGTH), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

/** Codice scritto dall'utente → forma salvata (maiuscole, senza trattini né spazi). Null se non può essere un codice. */
export function normalizeInviteCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === INVITE_CODE_LENGTH && [...code].every((c) => INVITE_ALPHABET.includes(c)) ? code : null;
}

/** «ABCD-EFGH»: più facile da leggere e da dettare. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Codice fiscale o partita IVA scritti in qualsiasi modo → maiuscole, solo lettere e cifre, senza «IT» davanti alla partita IVA. */
export function normalizeTaxId(input: string | null | undefined): string {
  const value = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^IT\d{11}$/.test(value) ? value.slice(2) : value;
}

/** Vero se il valore scritto è il codice fiscale o la partita IVA del cliente. */
export function taxIdMatches(input: string, owner: { fiscalCode: string | null; vatNumber: string | null }): boolean {
  const given = normalizeTaxId(input);
  if (given.length < 11) return false;
  return [owner.fiscalCode, owner.vatNumber].some((v) => v && normalizeTaxId(v) === given);
}

/** Un invito si può creare solo se la scheda ha la seconda prova da chiedere al diportista. */
export function canInvite(owner: { fiscalCode: string | null; vatNumber: string | null }): boolean {
  return normalizeTaxId(owner.fiscalCode).length >= 11 || normalizeTaxId(owner.vatNumber).length >= 11;
}

export function activationUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}/attiva/${code}`;
}

/** Messaggio pronto da inviare (WhatsApp, SMS, email dell'ufficio). */
export function inviteMessage(input: { personName: string; marinaName: string; url: string; code: string; expiresOn: string; company: boolean }): string {
  const proof = input.company ? "la partita IVA o il codice fiscale della società" : "il codice fiscale dell'intestatario del contratto";
  return [
    `Ciao ${input.personName}, ${input.marinaName} ti invita nell'area diportisti dell'app Omnia Marina.`,
    `Apri ${input.url} e inserisci ${proof}, poi scegli email e password.`,
    `Codice di attivazione: ${formatInviteCode(input.code)} (valido fino al ${input.expiresOn}, una sola volta).`,
  ].join("\n");
}

/** Collegamento WhatsApp con il messaggio già scritto; con un numero di telefono apre direttamente la chat. */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Cellulare italiano scritto senza prefisso internazionale.
  if (/^3\d{8,9}$/.test(digits)) digits = `39${digits}`;
  const to = digits.length >= 10 ? digits : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
