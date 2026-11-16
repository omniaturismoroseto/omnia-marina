// Codice fiscale e partita IVA italiani: controllo del carattere di verifica e divisione di «COGNOME NOME»
// guidata dal codice fiscale. Funzioni pure, provate nei test.

const ODD: Record<string, number> = {
  ...Object.fromEntries([1, 0, 5, 7, 9, 13, 15, 17, 19, 21].map((v, i) => [String(i), v])),
  ...Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c, i) => [c, [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23][i]])),
};
const EVEN: Record<string, number> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), i])),
  ...Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c, i) => [c, i])),
};

const CF_SHAPE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

/** Codice fiscale di persona fisica con il carattere di controllo giusto. */
export function isValidFiscalCode(value: string): boolean {
  const cf = value.toUpperCase();
  if (!CF_SHAPE.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? ODD[cf[i]] : EVEN[cf[i]];
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** Partita IVA italiana (11 cifre) con la cifra di controllo giusta. */
export function isValidVatNumber(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(value[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(value[10]);
}

const VOWELS = new Set("AEIOU");
const letters = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .split("");

function surnameCode(surname: string): string {
  const l = letters(surname);
  const cons = l.filter((c) => !VOWELS.has(c));
  const vow = l.filter((c) => VOWELS.has(c));
  return [...cons, ...vow, "X", "X", "X"].slice(0, 3).join("");
}

function nameCode(name: string): string {
  const l = letters(name);
  let cons = l.filter((c) => !VOWELS.has(c));
  const vow = l.filter((c) => VOWELS.has(c));
  if (cons.length >= 4) cons = [cons[0], cons[2], cons[3]];
  return [...cons, ...vow, "X", "X", "X"].slice(0, 3).join("");
}

/**
 * Divide «COGNOME NOME» (anche con cognomi o nomi composti) nel solo modo compatibile con il codice fiscale.
 * Restituisce null se il codice manca, non è di una persona o se più divisioni sono possibili.
 */
export function splitNameByFiscalCode(fullName: string, fiscalCode: string | null): { lastName: string; firstName: string } | null {
  if (!fiscalCode || !CF_SHAPE.test(fiscalCode.toUpperCase())) return null;
  const cf = fiscalCode.toUpperCase();
  const tokens = fullName.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const found: { lastName: string; firstName: string }[] = [];
  for (let k = 1; k < tokens.length; k++) {
    const lastName = tokens.slice(0, k).join(" ");
    const firstName = tokens.slice(k).join(" ");
    if (surnameCode(lastName) === cf.slice(0, 3) && nameCode(firstName) === cf.slice(3, 6)) found.push({ lastName, firstName });
  }
  return found.length === 1 ? found[0] : null;
}

// Particelle che fanno parte del cognome («DEL BONO», «DI GIULIO», «D'ANGELO» resta una parola sola).
const PARTICLES = new Set(["DE", "DEL", "DELLA", "DELLE", "DEI", "DEGLI", "DI", "DA", "DAL", "DALLA", "LA", "LO", "LE", "MC", "MAC", "VAN", "VON", "SAN", "SANTA", "SANTO", "DOS", "DAS"]);

/** Divisione «COGNOME NOME» senza codice fiscale: il cognome è la prima parola, con le sue eventuali particelle. */
export function splitNameGuess(fullName: string): { lastName: string; firstName: string } {
  const tokens = fullName.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { lastName: tokens.join(" "), firstName: "" };
  let k = 0;
  while (k < tokens.length - 2 && PARTICLES.has(tokens[k].toUpperCase())) k++;
  return { lastName: tokens.slice(0, k + 1).join(" "), firstName: tokens.slice(k + 1).join(" ") };
}
